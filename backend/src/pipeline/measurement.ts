import { servicePool } from "../db/client.js";

/**
 * Records one experiment_results row when a case reaches a terminal
 * outcome — this is what powers the holdout-vs-treated comparison in
 * §11, the "would this have recovered anyway?" answer.
 */
export async function recordExperimentOutcome(caseId: string, recovered: boolean): Promise<void> {
  const { rows } = await servicePool.query<{ campaign_id: string | null; amount: number; holdout: boolean }>(
    `select rc.merchant_id, coalesce(t.amount, i.amount, 0) as amount, rc.holdout
     from recovery_cases rc
     join revenue_risk_events rre on rre.id = rc.event_id
     left join transactions t on t.id = rre.transaction_id
     left join invoices i on i.id = rre.invoice_id
     where rc.id = $1`,
    [caseId]
  );
  const row = rows[0] as unknown as { merchant_id: string; amount: number; holdout: boolean } | undefined;
  if (!row) return;

  // Demo simplification: one implicit campaign per merchant rather than
  // requiring an explicit recovery_campaigns row per case. A real
  // multi-campaign UI would resolve caseId -> campaign_id directly.
  const { rows: campaignRows } = await servicePool.query<{ id: string }>(
    `select id from recovery_campaigns where merchant_id = $1 order by started_at desc limit 1`,
    [row.merchant_id]
  );
  if (campaignRows.length === 0) return;

  await servicePool.query(
    `insert into experiment_results (campaign_id, holdout_group, outcome, amount) values ($1, $2, $3, $4)`,
    [campaignRows[0].id, row.holdout, recovered ? "recovered" : "not_recovered", row.amount]
  );
}

export interface RecoveryFunnel {
  revenueAtRisk: number;
  grossRecovered: number;
  incrementalRecovered: number;
  recoveryRateTreated: number;
  recoveryRateHoldout: number;
}

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

  return { revenueAtRisk, grossRecovered, incrementalRecovered, recoveryRateTreated, recoveryRateHoldout };
}
