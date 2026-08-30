import { servicePool } from "../db/client.js";
import { normalizeWebhookEvent } from "../pipeline/detection.js";
import { runPipelineForEvent } from "../pipeline/pipeline.js";
import { observeExternalRecovery } from "../pipeline/caseManager.js";

/**
 * §17 Phase 8: seed a convincing batch of synthetic cases across all 3
 * playbooks, driven through the real webhook -> outbox -> pipeline path
 * (not inserted directly into recovery_cases) so the seeded data
 * exercises the same code the live demo does, including at least one
 * guardrail rejection ("visibly-handled failure case").
 */

const FAILURE_CODES = ["insufficient_funds", "card_expired", "bank_decline"];
const NAMES = ["Aarav Sharma", "Priya Patel", "Rohan Mehta", "Ananya Iyer", "Vikram Rao", "Sneha Gupta", "Karan Singh", "Divya Nair"];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function main() {
  console.log("seeding merchant + customers...");
  const { rows: merchantRows } = await servicePool.query<{ id: string }>(
    `insert into merchants (name, config) values ('Demo Merchant Pvt Ltd', '{}') returning id`
  );
  const merchantId = merchantRows[0].id;

  await servicePool.query(
    `insert into recovery_campaigns (merchant_id, name, stopping_rules) values ($1, 'Launch Campaign', '{}')`,
    [merchantId]
  );

  const customerIds: string[] = [];
  for (const name of NAMES) {
    const { rows } = await servicePool.query<{ id: string }>(
      `insert into customers (merchant_id, name, phone, email, language_pref) values ($1, $2, $3, $4, $5) returning id`,
      [merchantId, name, `+91${9000000000 + Math.floor(Math.random() * 99999999)}`, `${name.split(" ")[0].toLowerCase()}@example.com`, pick(["en", "hi", "hinglish"])]
    );
    customerIds.push(rows[0].id);
  }

  console.log("driving synthetic events through the real pipeline...");
  let eventCount = 0;

  // Failed subscriptions (payment_failed) — several retries to demonstrate
  // both a recovery and a guardrail rejection (max_retry_count hit).
  for (let i = 0; i < 20; i++) {
    const customerId = pick(customerIds);
    const amount = 50000 + Math.floor(Math.random() * 500000); // paise
    const { rows: txRows } = await servicePool.query<{ id: string }>(
      `insert into transactions (merchant_id, customer_id, amount, status, gateway_ref) values ($1, $2, $3, 'failed', $4) returning id`,
      [merchantId, customerId, amount, `tx_${Date.now()}_${i}`]
    );
    await fireWebhook(merchantId, {
      type: "payment_failed",
      transaction_id: txRows[0].id,
      customer_id: customerId,
      amount,
      failure_code: pick(FAILURE_CODES),
    });
    eventCount++;
  }

  // Checkout abandonment
  for (let i = 0; i < 15; i++) {
    const customerId = pick(customerIds);
    const amount = 100000 + Math.floor(Math.random() * 800000);
    await fireWebhook(merchantId, { type: "checkout_abandoned", customer_id: customerId, amount });
    eventCount++;
  }

  // B2B receivables (invoice overdue)
  for (let i = 0; i < 15; i++) {
    const customerId = pick(customerIds);
    const amount = 500000 + Math.floor(Math.random() * 5000000);
    const { rows: invRows } = await servicePool.query<{ id: string }>(
      `insert into invoices (merchant_id, customer_id, amount, due_date, status) values ($1, $2, $3, now() - interval '5 days', 'overdue') returning id`,
      [merchantId, customerId, amount]
    );
    await fireWebhook(merchantId, { type: "invoice_overdue", invoice_id: invRows[0].id, customer_id: customerId, amount });
    eventCount++;
  }

  await simulateOrganicRecovery(merchantId);

  console.log(`seeded merchant ${merchantId} with ${eventCount} events run through the pipeline`);
  console.log(`use header  x-merchant-id: ${merchantId}  when calling the API`);
  await servicePool.end();
}

/**
 * Some customers pay on their own, with or without an agent nudge. The
 * demo has to model that, because a holdout group that can never recover
 * would make the incrementality number in §11 meaningless — it would
 * report 100% of recovery as agent-driven by construction.
 *
 * Applied at the same base rate to treated and holdout cases alike; the
 * agent's measured lift is whatever it achieves on top of this.
 */
const ORGANIC_RECOVERY_RATE = 0.19;

async function simulateOrganicRecovery(merchantId: string) {
  const { rows } = await servicePool.query<{ id: string }>(
    `select id from recovery_cases where merchant_id = $1 and state not in ('recovered', 'closed_unrecovered')`,
    [merchantId]
  );
  let recovered = 0;
  for (const row of rows) {
    if (Math.random() >= ORGANIC_RECOVERY_RATE) continue;
    if (await observeExternalRecovery(row.id)) recovered++;
  }
  console.log(`simulated ${recovered} organic recoveries (no agent action) across both groups`);
}

async function fireWebhook(merchantId: string, payload: Record<string, unknown>) {
  const providerEventId = `synthetic_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const { rows } = await servicePool.query<{ id: string }>(
    `insert into webhook_events (provider, provider_event_id, payload) values ('synthetic', $1, $2) returning id`,
    [providerEventId, JSON.stringify({ ...payload, merchant_id: merchantId })]
  );
  const eventId = await normalizeWebhookEvent(rows[0].id);
  if (eventId) {
    await runPipelineForEvent(eventId).catch((err) => console.error("pipeline error during seed", err));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
