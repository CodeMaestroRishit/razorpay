import type { Request, Response } from "express";
import crypto from "node:crypto";
import { servicePool } from "../db/client.js";
import { env } from "../config/env.js";
import { verifyRazorpaySignature } from "./verifySignature.js";
import { normalizeWebhookEvent } from "../pipeline/detection.js";
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
  const rawBody = JSON.stringify(req.body);

  if (provider === "razorpay" && env.razorpayWebhookSecret) {
    const signature = req.header("x-razorpay-signature");
    if (!verifyRazorpaySignature(rawBody, signature, env.razorpayWebhookSecret)) {
      res.status(401).json({ error: "invalid webhook signature" });
      return;
    }
  }

  const providerEventId = (req.body.event_id as string) ?? crypto.randomUUID();

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
  const eventId = await normalizeWebhookEvent(webhookEventId).catch((err) => {
    console.error("normalizeWebhookEvent failed", err);
    return null;
  });
  if (eventId) {
    await runPipelineForEvent(eventId).catch((err) => {
      console.error("pipeline run failed", eventId, err);
    });
  }
}
