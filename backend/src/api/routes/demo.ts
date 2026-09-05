import { Router } from "express";
import { servicePool } from "../../db/client.js";
import { normalizeWebhookEvent } from "../../pipeline/detection.js";
import { runPipelineForEvent } from "../../pipeline/pipeline.js";

/**
 * "Watch it happen live" — for demoing the pipeline, not for real traffic.
 * Deliberately unauthenticated (a judge clicking a button shouldn't need a
 * key) but bounded on every axis that costs money: per-IP rate limit at
 * the mount point in server.ts, a hard daily cap here, and a small retry
 * budget against landing in the holdout group.
 */
export const demoRouter = Router();

const FAILURE_CODES = ["insufficient_funds", "card_expired", "bank_decline"];
const MAX_HOLDOUT_RETRIES = 4;

// A holdout draw is free (the pipeline returns before any model call), so
// this only bounds the case where every draw keeps landing in holdout —
// worst case a handful of near-instant DB writes, not LLM spend.
const DAILY_CAP = 100;
let triggeredToday = 0;
let dayKey = new Date().toDateString();

function underDailyCap(): boolean {
  const today = new Date().toDateString();
  if (today !== dayKey) {
    dayKey = today;
    triggeredToday = 0;
  }
  return triggeredToday < DAILY_CAP;
}

async function createSyntheticEvent(merchantId: string, customerId: string): Promise<string> {
  const isPaymentFailure = Math.random() < 0.7;
  const providerEventId = `demo_${Date.now()}_${Math.random().toString(36).slice(2)}`;

  let payload: Record<string, unknown>;
  if (isPaymentFailure) {
    const amount = 50000 + Math.floor(Math.random() * 500000);
    const { rows: txRows } = await servicePool.query<{ id: string }>(
      `insert into transactions (merchant_id, customer_id, amount, status, gateway_ref)
       values ($1, $2, $3, 'failed', $4) returning id`,
      [merchantId, customerId, amount, `demo_tx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`]
    );
    payload = {
      type: "payment_failed",
      transaction_id: txRows[0].id,
      customer_id: customerId,
      amount,
      failure_code: FAILURE_CODES[Math.floor(Math.random() * FAILURE_CODES.length)],
    };
  } else {
    const amount = 100000 + Math.floor(Math.random() * 800000);
    payload = { type: "checkout_abandoned", customer_id: customerId, amount };
  }

  const { rows } = await servicePool.query<{ id: string }>(
    `insert into webhook_events (provider, provider_event_id, payload) values ('synthetic', $1, $2) returning id`,
    [providerEventId, JSON.stringify({ ...payload, merchant_id: merchantId })]
  );
  const eventId = await normalizeWebhookEvent(rows[0].id);
  if (!eventId) throw new Error("synthetic event failed to normalize");
  return eventId;
}

async function waitForCase(eventId: string, timeoutMs = 1500, intervalMs = 60): Promise<{ id: string; holdout: boolean } | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await servicePool.query<{ id: string; holdout: boolean }>(
      "select id, holdout from recovery_cases where event_id = $1",
      [eventId]
    );
    if (rows[0]) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

demoRouter.post("/trigger", async (req, res, next) => {
  try {
    if (!underDailyCap()) {
      res.status(429).json({ error: "demo trigger daily cap reached — try again tomorrow" });
      return;
    }

    const merchantId = req.body?.merchantId as string | undefined;
    if (!merchantId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(merchantId)) {
      res.status(400).json({ error: "merchantId (uuid) is required" });
      return;
    }

    const { rows: customers } = await servicePool.query<{ id: string }>(
      "select id from customers where merchant_id = $1 order by random() limit 1",
      [merchantId]
    );
    const customer = customers[0];
    if (!customer) {
      res.status(404).json({ error: "no customers found for this merchant" });
      return;
    }

    let treatedCaseId: string | null = null;

    for (let attempt = 0; attempt < MAX_HOLDOUT_RETRIES && !treatedCaseId; attempt++) {
      const eventId = await createSyntheticEvent(merchantId, customer.id);

      // Fire-and-forget: the HTTP response doesn't wait for the full
      // pipeline (that's the whole point — the frontend watches it happen
      // via the timeline endpoint), only for the case to exist.
      runPipelineForEvent(eventId).catch((err) => {
        console.error("demo trigger pipeline failed", eventId, err);
      });

      const created = await waitForCase(eventId);
      if (created && !created.holdout) {
        treatedCaseId = created.id;
      }
    }

    if (!treatedCaseId) {
      res.status(503).json({ error: "kept landing in the holdout group — try again" });
      return;
    }

    triggeredToday += 1;
    res.status(202).json({ caseId: treatedCaseId });
  } catch (err) {
    next(err);
  }
});
