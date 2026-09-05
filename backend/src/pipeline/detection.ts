import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import { scoreRisk } from "./riskScoring.js";
import type { RevenueRiskEvent } from "../types/domain.js";

/**
 * Normalizes one webhook_events row into the outbox (§7). This is the
 * only place that reads raw webhook payloads — everything downstream
 * works off the normalized `revenue_risk_events` shape.
 */
export async function normalizeWebhookEvent(webhookEventId: string, client?: PoolClient): Promise<string | null> {
  const db = client ?? servicePool;

  // Claim the row atomically instead of reading `processed` and then
  // writing it (§4 "Webhook duplication"). A check-then-act pair lets two
  // concurrent deliveries of the same event both observe processed=false,
  // both normalize it, and produce two cases — and therefore two rounds of
  // real actions — for one real-world event. The conditional UPDATE means
  // exactly one caller can win.
  const { rows } = await db.query<{ payload: Record<string, unknown> }>(
    `update webhook_events set processed = true
      where id = $1 and processed = false
      returning payload`,
    [webhookEventId]
  );
  const webhook = rows[0];
  if (!webhook) return null; // already claimed, or no such row

  const eventType = mapProviderEventType(webhook.payload);
  if (!eventType) return null; // already marked processed by the claim above

  const merchantId = webhook.payload.merchant_id as string;
  if (!merchantId) return null;

  const { rows: inserted } = await db.query<{ id: string }>(
    `insert into revenue_risk_events (source_event_id, merchant_id, type, transaction_id, invoice_id, customer_id, payload)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      webhookEventId,
      merchantId,
      eventType,
      (webhook.payload.transaction_id as string) ?? null,
      (webhook.payload.invoice_id as string) ?? null,
      (webhook.payload.customer_id as string) ?? null,
      JSON.stringify(webhook.payload),
    ]
  );
  return inserted[0].id;
}

function mapProviderEventType(payload: Record<string, unknown>): RevenueRiskEvent["type"] | null {
  const knownTypes: RevenueRiskEvent["type"][] = [
    "payment_failed",
    "checkout_abandoned",
    "invoice_overdue",
    "customer_responded",
    "promise_to_pay_broken",
  ];
  const t = payload.type as string;
  return knownTypes.includes(t as RevenueRiskEvent["type"]) ? (t as RevenueRiskEvent["type"]) : null;
}

/** Deterministic risk scoring stage — writes risk_scores, no AI involved. */
export async function scoreEvent(
  event: RevenueRiskEvent,
  context: { amount: number; failureCode?: string; retryCount?: number },
  client?: PoolClient
) {
  const db = client ?? servicePool;
  const score = scoreRisk(event, context);
  await db.query("insert into risk_scores (event_id, score, factors) values ($1, $2, $3)", [
    event.id,
    score.score,
    JSON.stringify(score.factors),
  ]);
  return score;
}
