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

/**
 * Sarvam covers the major Indian languages, so the seeded book of
 * business looks like a real Indian merchant's: a Tamil customer in
 * Chennai and a Bengali one in Kolkata each get dunned in their own
 * language, not a single Hinglish default. Nothing in the pipeline is
 * keyed to this list — it's passed straight through to Sarvam.
 */
const LANGUAGES = ["en", "hi", "hinglish", "ta", "bn", "mr", "te", "gu", "kn", "ml"];

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

  // One customer has opted out and one is unreachable by email. Both are
  // guardrail rejections the demo can point at (§17 Phase 8 asks for a
  // visibly-handled failure case, not just a happy path).
  const customerIds: string[] = [];
  for (const [i, name] of NAMES.entries()) {
    const optedOut = i === 0;
    const unreachable = i === 1;
    const { rows } = await servicePool.query<{ id: string }>(
      `insert into customers (merchant_id, name, phone, email, language_pref, contact_opt_out)
       values ($1, $2, $3, $4, $5, $6) returning id`,
      [
        merchantId,
        name,
        `+91${9000000000 + Math.floor(Math.random() * 99999999)}`,
        unreachable ? null : `${name.split(" ")[0].toLowerCase()}@example.com`,
        pick(LANGUAGES),
        optedOut,
      ]
    );
    customerIds.push(rows[0].id);
  }

  console.log("driving synthetic events through the real pipeline...");
  // Volume matters for credibility: at the 20% holdout rate, 50 events
  // leaves ~10 holdout cases, too few for the §11 incrementality figure to
  // mean anything (computeFunnel flags exactly this). 120 puts the holdout
  // arm comfortably over that bar.
  const FAILED_SUBSCRIPTIONS = 55;
  const ABANDONED_CHECKOUTS = 35;
  const OVERDUE_INVOICES = 30;

  // Build the work first, then run it with bounded concurrency. Each event
  // is independent, and the pipeline makes a dozen-plus round trips — run
  // serially against a remote database that is minutes, not seconds.
  const jobs: Array<() => Promise<void>> = [];

  // Failed subscriptions. The first two carry suspected_fraud, which the
  // guardrail refuses to automate at all (§10) — a visibly-handled failure
  // case in the timeline, as §17 Phase 8 asks for.
  for (let i = 0; i < FAILED_SUBSCRIPTIONS; i++) {
    jobs.push(async () => {
      const customerId = pick(customerIds);
      const amount = 50000 + Math.floor(Math.random() * 500000); // paise
      const { rows } = await servicePool.query<{ id: string }>(
        `insert into transactions (merchant_id, customer_id, amount, status, gateway_ref)
         values ($1, $2, $3, 'failed', $4) returning id`,
        [merchantId, customerId, amount, `tx_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 8)}`]
      );
      await fireWebhook(merchantId, {
        type: "payment_failed",
        transaction_id: rows[0].id,
        customer_id: customerId,
        amount,
        failure_code: i < 2 ? "suspected_fraud" : pick(FAILURE_CODES),
      });
    });
  }

  for (let i = 0; i < ABANDONED_CHECKOUTS; i++) {
    jobs.push(async () => {
      const customerId = pick(customerIds);
      const amount = 100000 + Math.floor(Math.random() * 800000);
      await fireWebhook(merchantId, { type: "checkout_abandoned", customer_id: customerId, amount });
    });
  }

  for (let i = 0; i < OVERDUE_INVOICES; i++) {
    jobs.push(async () => {
      const customerId = pick(customerIds);
      const amount = 500000 + Math.floor(Math.random() * 5000000);
      const { rows } = await servicePool.query<{ id: string }>(
        `insert into invoices (merchant_id, customer_id, amount, due_date, status)
         values ($1, $2, $3, now() - interval '5 days', 'overdue') returning id`,
        [merchantId, customerId, amount]
      );
      await fireWebhook(merchantId, {
        type: "invoice_overdue",
        invoice_id: rows[0].id,
        customer_id: customerId,
        amount,
      });
    });
  }

  await runWithConcurrency(jobs, 8);
  await simulateOrganicRecovery(merchantId);

  console.log(`seeded merchant ${merchantId} with ${jobs.length} events run through the pipeline`);
  console.log(`use header  x-merchant-id: ${merchantId}  when calling the API`);
  await servicePool.end();
}

/**
 * Bounded-concurrency runner. The limit is matched to the connection pool
 * (`max: 8` in db/client.ts) — going wider just queues on connection
 * acquisition and risks exhausting Supabase's pooler quota.
 */
async function runWithConcurrency(jobs: Array<() => Promise<void>>, limit: number) {
  let next = 0;
  let done = 0;
  const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      try {
        await job();
      } catch (err) {
        console.error("seed job failed", err);
      }
      if (++done % 25 === 0) console.log(`  ${done}/${jobs.length} events processed`);
    }
  });
  await Promise.all(workers);
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
