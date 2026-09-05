import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { servicePool } from "../src/db/client.js";
import { transitionCase, observeExternalRecovery, ConcurrentModificationError } from "../src/pipeline/caseManager.js";
import { normalizeWebhookEvent } from "../src/pipeline/detection.js";
import { claimIdempotencyKey } from "../src/pipeline/idempotency.js";

/**
 * Integration tests against a REAL database. These exist because the races
 * they cover are invisible to a unit test with a mocked client — the whole
 * point is what Postgres does when two callers hit the same row at once.
 *
 * Skipped automatically when no database is reachable, so the suite stays
 * runnable offline (`RUN_DB_TESTS=0` forces skip).
 */
let dbAvailable = false;
let merchantId = "";
let customerId = "";

beforeAll(async () => {
  if (process.env.RUN_DB_TESTS === "0") return;
  try {
    await servicePool.query("select 1");
    dbAvailable = true;
  } catch {
    return;
  }
  const { rows: m } = await servicePool.query<{ id: string }>(
    `insert into merchants (name, config) values ('concurrency-test', '{}') returning id`
  );
  merchantId = m[0].id;
  const { rows: c } = await servicePool.query<{ id: string }>(
    `insert into customers (merchant_id, name, email) values ($1, 'Race Tester', 'race@test.local') returning id`,
    [merchantId]
  );
  customerId = c[0].id;
}, 30_000);

afterAll(async () => {
  if (!dbAvailable || !merchantId) return;
  // Clean up in FK order.
  await servicePool.query(
    `delete from experiment_results where campaign_id in (select id from recovery_campaigns where merchant_id = $1)`,
    [merchantId]
  );
  await servicePool.query(
    `delete from agent_decisions where case_id in (select id from recovery_cases where merchant_id = $1)`,
    [merchantId]
  );
  await servicePool.query(`delete from recovery_cases where merchant_id = $1`, [merchantId]);
  await servicePool.query(`delete from revenue_risk_events where merchant_id = $1`, [merchantId]);
  await servicePool.query(`delete from recovery_campaigns where merchant_id = $1`, [merchantId]);
  await servicePool.query(`delete from customers where merchant_id = $1`, [merchantId]);
  await servicePool.query(`delete from merchants where id = $1`, [merchantId]);
  await servicePool.end();
}, 30_000);

async function openTestCase(state = "contacting"): Promise<string> {
  const { rows: e } = await servicePool.query<{ id: string }>(
    `insert into revenue_risk_events (merchant_id, type, customer_id, payload)
     values ($1, 'payment_failed', $2, '{}') returning id`,
    [merchantId, customerId]
  );
  const { rows: c } = await servicePool.query<{ id: string }>(
    `insert into recovery_cases (event_id, merchant_id, customer_id, playbook, state)
     values ($1, $2, $3, 'failed_subscription', $4) returning id`,
    [e[0].id, merchantId, customerId, state]
  );
  return c[0].id;
}

describe.runIf(() => dbAvailable)("concurrency: state transitions", () => {
  it("only one of two concurrent transitions wins; the loser throws instead of silently no-op'ing", async () => {
    if (!dbAvailable) return;
    const caseId = await openTestCase("contacting");

    // Both callers believe the case is in 'contacting' and try to move it.
    const results = await Promise.allSettled([
      transitionCase(caseId, "contacting", "recovered"),
      transitionCase(caseId, "contacting", "escalated"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConcurrentModificationError);

    // And the database holds exactly one of the two outcomes — not a
    // torn state, and not a value neither caller chose.
    const { rows } = await servicePool.query<{ state: string }>(
      "select state from recovery_cases where id = $1",
      [caseId]
    );
    expect(["recovered", "escalated"]).toContain(rows[0].state);
  }, 30_000);

  it("a transition against a stale expectation fails loudly rather than pretending to succeed", async () => {
    if (!dbAvailable) return;
    const caseId = await openTestCase("recovered");
    // Caller still thinks the case is mid-pipeline.
    await expect(transitionCase(caseId, "contacting", "escalated")).rejects.toBeInstanceOf(
      ConcurrentModificationError
    );
  }, 30_000);
});

describe.runIf(() => dbAvailable)("concurrency: duplicate recovery confirmations", () => {
  it("two simultaneous success webhooks recover the case exactly once", async () => {
    if (!dbAvailable) return;
    const caseId = await openTestCase("contacting");

    // The real scenario: a provider redelivers a capture, or two
    // deliveries land together. Both call observeExternalRecovery.
    const [a, b] = await Promise.all([observeExternalRecovery(caseId), observeExternalRecovery(caseId)]);

    // Exactly one may report that it performed the recovery. If both did,
    // the §11 experiment record would double-count this recovery and
    // inflate the measured lift.
    expect([a, b].filter(Boolean)).toHaveLength(1);

    const { rows } = await servicePool.query<{ count: string }>(
      `select count(*)::text as count from experiment_results er
         join recovery_campaigns rc on rc.id = er.campaign_id
        where rc.merchant_id = $1`,
      [merchantId]
    );
    // No campaign exists for this test merchant, so nothing should be
    // recorded either way — the assertion that matters is the single
    // `true` above. This guards against a stray double-insert if a
    // campaign is later added to the fixture.
    expect(Number(rows[0].count)).toBeLessThanOrEqual(1);
  }, 30_000);
});

describe.runIf(() => dbAvailable)("concurrency: webhook double-processing", () => {
  it("concurrent normalization of one webhook produces exactly one risk event", async () => {
    if (!dbAvailable) return;
    const { rows } = await servicePool.query<{ id: string }>(
      `insert into webhook_events (provider, provider_event_id, payload)
       values ('synthetic', $1, $2) returning id`,
      [
        `race_${Date.now()}_${Math.random().toString(36).slice(2)}`,
        JSON.stringify({ type: "payment_failed", merchant_id: merchantId, customer_id: customerId, amount: 1000 }),
      ]
    );
    const webhookEventId = rows[0].id;

    // Two deliveries of the same event racing through normalization.
    const results = await Promise.all([
      normalizeWebhookEvent(webhookEventId),
      normalizeWebhookEvent(webhookEventId),
    ]);

    // Exactly one may produce a risk event. Two would mean two cases and
    // two rounds of real customer-facing actions for one real failure.
    const produced = results.filter((r): r is string => r !== null);
    expect(produced).toHaveLength(1);

    const { rows: countRows } = await servicePool.query<{ count: string }>(
      "select count(*)::text as count from revenue_risk_events where source_event_id = $1",
      [webhookEventId]
    );
    expect(Number(countRows[0].count)).toBe(1);
  }, 30_000);
});

describe.runIf(() => dbAvailable)("concurrency: idempotency keys", () => {
  it("only one of many concurrent claims on the same key succeeds", async () => {
    if (!dbAvailable) return;
    const key = `test_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    // Each claim needs its OWN connection: a single pg client serializes
    // queries, so sharing one would test sequential calls while looking
    // like a concurrency test.
    const clients = await Promise.all(Array.from({ length: 8 }, () => servicePool.connect()));
    try {
      const claims = await Promise.all(clients.map((c) => claimIdempotencyKey(c, key, "retry_payment")));
      expect(claims.filter(Boolean)).toHaveLength(1);
    } finally {
      clients.forEach((c) => c.release());
      await servicePool.query("delete from idempotency_keys where key = $1", [key]);
    }
  }, 30_000);
});
