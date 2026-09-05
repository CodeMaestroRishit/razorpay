import type { Request, Response } from "express";
import crypto from "node:crypto";
import { servicePool } from "../db/client.js";
import { env } from "../config/env.js";
import { verifyRazorpaySignature } from "./verifySignature.js";
import { normalizeWebhookEvent } from "../pipeline/detection.js";
import { ingestRazorpayEvent } from "./razorpayEvents.js";
import { runPipelineForEvent } from "../pipeline/pipeline.js";

/**
 * Inbound webhook endpoint. Every event — real Razorpay or the
 * synthetic ones the demo self-triggers (checkout-abandonment, per §17
 * Phase 2, since Razorpay test mode won't emit that natively) — lands
 * here first, keyed on provider_event_id so redelivery is stored, not
 * reprocessed (§4).
 */
export async function handleWebhook(req: Request, res: Response): Promise<void> {
  const provider = (req.params.provider as string) ?? "synthetic";

  // Signed against the exact bytes Razorpay sent (captured by the
  // express.json verify hook in api/server.ts) — re-serializing req.body
  // is not guaranteed to reproduce what was actually signed.
  const rawBody = req.rawBody?.toString("utf8") ?? JSON.stringify(req.body);

  if (provider === "razorpay" && env.razorpayWebhookSecret) {
    const signature = req.header("x-razorpay-signature");
    if (!verifyRazorpaySignature(rawBody, signature, env.razorpayWebhookSecret)) {
      res.status(401).json({ error: "invalid webhook signature" });
      return;
    }
  }

  // Razorpay sends a per-delivery id in this header for exactly this
  // purpose. Falling back to a body field id (synthetic events) or, last,
  // a hash of the body itself — content-based, so a byte-identical
  // redelivery with no header still dedupes instead of minting a new row.
  const providerEventId =
    req.header("x-razorpay-event-id") ??
    (req.body.event_id as string | undefined) ??
    crypto.createHash("sha256").update(rawBody).digest("hex");

  const { rows, rowCount } = await servicePool.query<{ id: string }>(
    `insert into webhook_events (provider, provider_event_id, payload)
     values ($1, $2, $3)
     on conflict (provider, provider_event_id) do nothing
     returning id`,
    [provider, providerEventId, JSON.stringify(req.body)]
  );

  if (rowCount === 0) {
    res.status(200).json({ status: "duplicate_ignored" });
    return;
  }

  const webhookEventId = rows[0].id;
  res.status(202).json({ status: "accepted", webhookEventId });

  // Normalize + run the pipeline asynchronously so the webhook responds
  // fast — mirrors "backend subscribes to outbox inserts" from §7,
  // simplified to an in-process call for the hackathon build instead of
  // a separate poller process.
  const normalize = provider === "razorpay" ? ingestRazorpayEvent : normalizeWebhookEvent;
  const eventId = await normalize(webhookEventId).catch((err) => {
    console.error(`${provider} event normalization failed`, err);
    return null;
  });
  if (eventId) {
    await runPipelineForEvent(eventId).catch((err) => {
      console.error("pipeline run failed", eventId, err);
    });
  }
}
