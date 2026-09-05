import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import { observeExternalRecovery } from "../pipeline/caseManager.js";

/**
 * A real Razorpay webhook body looks like:
 *
 *   {
 *     "event": "payment.failed",
 *     "account_id": "acc_...",
 *     "payload": { "payment": { "entity": {
 *       "id": "pay_...", "amount": 100000, "currency": "INR",
 *       "email": "...", "contact": "+91...",
 *       "error_code": "...", "error_reason": "..."
 *     } } }
 *   }
 *
 * — nothing like our internal `{ type, merchant_id, customer_id,
 * transaction_id, amount }` shape, which only the synthetic seed path
 * produces. This is the translation layer between the two.
 */
export interface ParsedRazorpayEvent {
  eventType: string;
  accountId: string | null;
  gatewayRef: string | null;
  amount: number | null; // paise — Razorpay already reports in the same unit we use
  currency: string;
  email: string | null;
  phone: string | null;
  failureCode: string | null;
}

/** Pure — no I/O, so this is unit-testable without a database or network. */
export function parseRazorpayEvent(body: unknown): ParsedRazorpayEvent | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as Record<string, unknown>;
  const eventType = b.event;
  const payload = b.payload as Record<string, unknown> | undefined;
  const payment = payload?.payment as Record<string, unknown> | undefined;
  const entity = payment?.entity as Record<string, unknown> | undefined;
  if (typeof eventType !== "string" || !entity) return null;

  return {
    eventType,
    accountId: typeof b.account_id === "string" ? b.account_id : null,
    gatewayRef: typeof entity.id === "string" ? entity.id : null,
    amount: typeof entity.amount === "number" ? entity.amount : null,
    currency: typeof entity.currency === "string" ? entity.currency : "INR",
    email: typeof entity.email === "string" ? entity.email : null,
    phone: typeof entity.contact === "string" ? entity.contact : null,
    failureCode:
      (typeof entity.error_reason === "string" && entity.error_reason) ||
      (typeof entity.error_code === "string" && entity.error_code) ||
      null,
  };
}

/**
 * Processes one webhook_events row already known to be `provider =
 * 'razorpay'`. Returns a revenue_risk_events id when a NEW pipeline run
 * should follow (payment.failed), or null when the event was fully
 * handled here (payment.captured, or an event type this build doesn't
 * act on) — mirrors normalizeWebhookEvent's return contract in
 * pipeline/detection.ts so webhooks/receiver.ts can treat both uniformly.
 */
export async function ingestRazorpayEvent(webhookEventId: string, client?: PoolClient): Promise<string | null> {
  const db = client ?? servicePool;
  const { rows } = await db.query<{ payload: unknown; processed: boolean }>(
    "select payload, processed from webhook_events where id = $1",
    [webhookEventId]
  );
  const webhook = rows[0];
  if (!webhook || webhook.processed) return null; // §4 "Webhook duplication"

  const parsed = parseRazorpayEvent(webhook.payload);
  if (!parsed || !parsed.gatewayRef) {
    await db.query("update webhook_events set processed = true where id = $1", [webhookEventId]);
    return null;
  }

  const merchantId = await resolveMerchant(parsed.accountId, db);
  let riskEventId: string | null = null;

  if (parsed.eventType === "payment.failed") {
    riskEventId = await handlePaymentFailed(merchantId, parsed, db);
  } else if (parsed.eventType === "payment.captured") {
    await handlePaymentCaptured(parsed, db);
  }
  // Other subscribed event types (payment.authorized, etc.) are stored
  // but intentionally not acted on yet — see README "known gaps".

  await db.query("update webhook_events set processed = true where id = $1", [webhookEventId]);
  return riskEventId;
}

/**
 * One merchant row per connected Razorpay account, keyed on account_id in
 * merchants.config. Auto-provisioned on first webhook rather than
 * requiring manual setup — this build has no onboarding flow, and the
 * account_id is a stable, trustworthy tenant key once the signature has
 * verified.
 */
async function resolveMerchant(accountId: string | null, db: PoolClient | typeof servicePool): Promise<string> {
  const key = accountId ?? "unknown";
  const { rows } = await db.query<{ id: string }>(
    `select id from merchants where config->>'razorpay_account_id' = $1 limit 1`,
    [key]
  );
  if (rows[0]) return rows[0].id;

  const { rows: created } = await db.query<{ id: string }>(
    `insert into merchants (name, config) values ($1, $2) returning id`,
    [`Razorpay account ${key}`, JSON.stringify({ razorpay_account_id: key })]
  );
  return created[0].id;
}

async function resolveCustomer(
  merchantId: string,
  email: string | null,
  phone: string | null,
  db: PoolClient | typeof servicePool
): Promise<string> {
  if (email) {
    const { rows } = await db.query<{ id: string }>(
      "select id from customers where merchant_id = $1 and email = $2 limit 1",
      [merchantId, email]
    );
    if (rows[0]) return rows[0].id;
  }
  if (phone) {
    const { rows } = await db.query<{ id: string }>(
      "select id from customers where merchant_id = $1 and phone = $2 limit 1",
      [merchantId, phone]
    );
    if (rows[0]) return rows[0].id;
  }
  const { rows: created } = await db.query<{ id: string }>(
    `insert into customers (merchant_id, name, phone, email, language_pref)
     values ($1, $2, $3, $4, 'en') returning id`,
    [merchantId, email ?? phone ?? "Razorpay customer", phone, email]
  );
  return created[0].id;
}

async function handlePaymentFailed(
  merchantId: string,
  parsed: ParsedRazorpayEvent,
  db: PoolClient | typeof servicePool
): Promise<string> {
  const customerId = await resolveCustomer(merchantId, parsed.email, parsed.phone, db);

  const { rows: existing } = await db.query<{ id: string }>("select id from transactions where gateway_ref = $1", [
    parsed.gatewayRef,
  ]);
  let transactionId: string;
  if (existing[0]) {
    transactionId = existing[0].id;
    await db.query("update transactions set status = 'failed' where id = $1", [transactionId]);
  } else {
    const { rows: created } = await db.query<{ id: string }>(
      `insert into transactions (merchant_id, customer_id, amount, currency, status, gateway_ref)
       values ($1, $2, $3, $4, 'failed', $5) returning id`,
      [merchantId, customerId, parsed.amount ?? 0, parsed.currency, parsed.gatewayRef]
    );
    transactionId = created[0].id;
  }

  // Append-only attempt record (§6) — never update one in place.
  await db.query("insert into payments (transaction_id, status, failure_code) values ($1, 'failed', $2)", [
    transactionId,
    parsed.failureCode,
  ]);

  const { rows: eventRows } = await db.query<{ id: string }>(
    `insert into revenue_risk_events (merchant_id, type, transaction_id, customer_id, payload)
     values ($1, 'payment_failed', $2, $3, $4) returning id`,
    [
      merchantId,
      transactionId,
      customerId,
      JSON.stringify({
        type: "payment_failed",
        amount: parsed.amount ?? 0,
        failure_code: parsed.failureCode,
        gateway_ref: parsed.gatewayRef,
      }),
    ]
  );
  return eventRows[0].id;
}

/**
 * A capture is a recovery CONFIRMATION, not a new risk — §11: "money isn't
 * counted until the webhook lands." If an open recovery case exists for
 * this transaction, this is exactly the "customer paid" signal
 * observeExternalRecovery exists for. If there's no local transaction at
 * all, this is an ordinary payment this build never flagged as at-risk —
 * correctly not the pipeline's concern.
 */
async function handlePaymentCaptured(parsed: ParsedRazorpayEvent, db: PoolClient | typeof servicePool): Promise<void> {
  const { rows: txRows } = await db.query<{ id: string }>("select id from transactions where gateway_ref = $1", [
    parsed.gatewayRef,
  ]);
  if (!txRows[0]) return;
  const transactionId = txRows[0].id;

  await db.query("update transactions set status = 'succeeded' where id = $1", [transactionId]);
  await db.query("insert into payments (transaction_id, status) values ($1, 'succeeded')", [transactionId]);

  const { rows: caseRows } = await db.query<{ id: string }>(
    `select rc.id from recovery_cases rc
       join revenue_risk_events rre on rre.id = rc.event_id
      where rre.transaction_id = $1
      order by rc.opened_at desc limit 1`,
    [transactionId]
  );
  if (caseRows[0]) {
    await observeExternalRecovery(caseRows[0].id, db as PoolClient);
  }
}
