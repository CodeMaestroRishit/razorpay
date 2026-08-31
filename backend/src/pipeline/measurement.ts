import { servicePool } from "../db/client.js";

/**
 * Appends one `experiment_results` row when a case reaches a genuinely
 * TERMINAL outcome — recovered, or closed without recovery.
 *
 * Deliberately not called on escalation: an escalated case is still open
 * (a human may yet recover it), and recording it as "not_recovered" would
 * bake a pessimistic bias into the historical record. Equally, a case
 * still in flight is not recorded at all — it has no outcome yet.
 *
 * This table is the append-only historical record of settled outcomes.
 * The live funnel (`computeFunnel`) deliberately reads `recovery_cases`
 * instead, because it must count in-flight cases in its denominator —
 * see the note there.
 *
 * One statement, not three: the campaign lookup and amount join happen
 * inside an INSERT ... SELECT rather than as separate round trips.
 */
export async function recordExperimentOutcome(caseId: string, recovered = true): Promise<void> {
  await servicePool.query(
    `insert into experiment_results (campaign_id, holdout_group, outcome, amount)
     select camp.id, rc.holdout, $2, coalesce(t.amount, i.amount, 0)
       from recovery_cases rc
       join revenue_risk_events rre on rre.id = rc.event_id
       left join transactions t on t.id = rre.transaction_id
       left join invoices i on i.id = rre.invoice_id
       -- Demo simplification: newest campaign per merchant. A real
       -- multi-campaign build resolves case -> campaign directly.
       join lateral (
         select c.id from recovery_campaigns c
          where c.merchant_id = rc.merchant_id
          order by c.started_at desc limit 1
       ) camp on true
      where rc.id = $1`,
    [caseId, recovered ? "recovered" : "not_recovered"]
  );
}

export interface RecoveryFunnel {
  revenueAtRisk: number;
  grossRecovered: number;
  incrementalRecovered: number;
  recoveryRateTreated: number;
  recoveryRateHoldout: number;
  /** Sample sizes behind the two rates — reported so the lift can be judged, not just read. */
  treatedCases: number;
  holdoutCases: number;
  /**
   * False when the holdout arm is too small for its rate to mean much. The
   * incremental figure is still computed, but a consumer should present it
   * as indicative rather than measured.
   */
  holdoutSampleSufficient: boolean;
}

/**
 * Below this many holdout cases, a single case flipping moves the holdout
 * rate by whole percentage points, and "0 of 7 recovered" is
 * indistinguishable from a 20% true rate. Claiming a precise incremental
 * number off that is the §11 trap wearing a lab coat.
 */
const MIN_HOLDOUT_FOR_CONFIDENCE = 20;

/**
 * §11's funnel: at risk -> gross recovered -> incremental (holdout-adjusted).
 *
 * Derived from `recovery_cases` rather than `experiment_results` on
 * purpose: a case still in flight (retry_scheduled) is a case that has
 * NOT recovered, and it must sit in the denominator. Computing the rate
 * only over cases that reached a terminal outcome is precisely how you
 * end up reporting a 100% recovery rate — the misleading number §11
 * warns about.
 */
export async function computeFunnel(merchantId: string): Promise<RecoveryFunnel> {
  const { rows } = await servicePool.query<{
    holdout: boolean;
    recovered: boolean;
    amount: string;
    count: string;
  }>(
    `select rc.holdout,
            (rc.state = 'recovered') as recovered,
            sum(coalesce(t.amount, i.amount, 0))::text as amount,
            count(*)::text as count
     from recovery_cases rc
     join revenue_risk_events rre on rre.id = rc.event_id
     left join transactions t on t.id = rre.transaction_id
     left join invoices i on i.id = rre.invoice_id
     where rc.merchant_id = $1
     group by rc.holdout, (rc.state = 'recovered')`,
    [merchantId]
  );

  let revenueAtRisk = 0, grossRecovered = 0;
  let treatedRecovered = 0, treatedTotal = 0, holdoutRecovered = 0, holdoutTotal = 0;
  for (const r of rows) {
    const count = Number(r.count);
    const amount = Number(r.amount);
    revenueAtRisk += amount;
    if (r.holdout) {
      holdoutTotal += count;
      if (r.recovered) holdoutRecovered += count;
    } else {
      treatedTotal += count;
      if (r.recovered) {
        treatedRecovered += count;
        grossRecovered += amount;
      }
    }
  }

  const recoveryRateTreated = treatedTotal > 0 ? treatedRecovered / treatedTotal : 0;
  const recoveryRateHoldout = holdoutTotal > 0 ? holdoutRecovered / holdoutTotal : 0;

  // Incremental is scaled off gross, not off total revenue at risk: it
  // answers "of what we actually recovered, how much would have come in
  // anyway?" — never larger than gross.
  const liftShare = recoveryRateTreated > 0
    ? Math.max(0, (recoveryRateTreated - recoveryRateHoldout) / recoveryRateTreated)
    : 0;
  const incrementalRecovered = grossRecovered * liftShare;

  return {
    revenueAtRisk,
    grossRecovered,
    incrementalRecovered,
    recoveryRateTreated,
    recoveryRateHoldout,
    treatedCases: treatedTotal,
    holdoutCases: holdoutTotal,
    holdoutSampleSufficient: holdoutTotal >= MIN_HOLDOUT_FOR_CONFIDENCE,
  };
}
