import { servicePool } from "../db/client.js";
import type { CaseContext, RevenueRiskEvent, RootCauseResult } from "../types/domain.js";
import { transitionCase, ConcurrentModificationError } from "./caseManager.js";
import { runDecisionCycle, runPipelineForEvent } from "./pipeline.js";

/**
 * Closes §5's "continue" branch — the arrow from the stop/continue
 * decision back to the top of the loop.
 *
 * Without this the pipeline is one-shot: a case reaches 'retry_scheduled'
 * and nothing ever touches it again, so `max_retry_count` and
 * `min_retry_interval_hours` are unreachable — a second attempt never
 * happens. The webhook receiver only starts NEW cases; this is what
 * continues existing ones.
 *
 * Designed to be driven by an external scheduler (a Render Cron Job
 * hitting POST /internal/sweep, say) rather than an in-process timer, so
 * it doesn't fire on every replica and can be triggered on demand during
 * a demo.
 */

export interface SweepResult {
  examined: number;
  resumed: number;
  skipped: number;
  errors: number;
  brokenPromises: number;
}

/**
 * Cases eligible for another pass. The timing predicates here are a COST
 * filter, not the rule: the guardrail remains the authority and will
 * reject anything that slips through. The point of filtering in SQL is
 * that every resumed case costs a model call, so waking one the guardrail
 * would only reject is real money for no outcome.
 *
 * Per-playbook intervals mirror DEFAULT_POLICY_RULES. A merchant override
 * that is *stricter* is still enforced by the guardrail; one that is
 * *looser* just means the sweeper is slightly conservative, which is the
 * safe direction to be wrong in.
 */
async function findDueCases(limit: number): Promise<string[]> {
  const { rows } = await servicePool.query<{ id: string }>(
    `select rc.id
       from recovery_cases rc
      where rc.state = 'retry_scheduled'
        and rc.holdout = false
        -- Campaign window: never wake a case that is past its longest
        -- possible duration for its playbook.
        and rc.opened_at > now() - (
              case rc.playbook
                when 'failed_subscription'  then interval '14 days'
                when 'checkout_abandonment' then interval '2 days'
                else interval '60 days'
              end)
        -- Respect any communication cooldown still running.
        and not exists (
              select 1 from communication_attempts ca
               where ca.case_id = rc.id and ca.cooldown_until > now())
        -- Respect the minimum spacing between attempts.
        and not exists (
              select 1 from recovery_actions ra
               where ra.case_id = rc.id
                 and ra.created_at > now() - (
                       case rc.playbook
                         when 'failed_subscription'  then interval '24 hours'
                         when 'checkout_abandonment' then interval '48 hours'
                         else interval '72 hours'
                       end))
      order by rc.opened_at asc
      limit $1`,
    [limit]
  );
  return rows.map((r) => r.id);
}

/**
 * Loads everything a resumed case needs. Root cause is reused from the
 * original diagnosis rather than recomputed — why a card was declined
 * doesn't change between attempts.
 */
async function loadCaseForResume(
  caseId: string
): Promise<{ caseCtx: CaseContext; event: RevenueRiskEvent; rootCause: RootCauseResult } | null> {
  const { rows } = await servicePool.query(
    `select rc.id as case_id, rc.merchant_id, rc.playbook, rc.state, rc.holdout,
            rc.opened_at, t.gateway_ref,
            coalesce(t.amount, i.amount, 0) as original_amount,
            rre.id as event_id, rre.type, rre.transaction_id, rre.invoice_id,
            rre.customer_id, rre.payload, rre.detected_at,
            rca.cause, rca.confidence, rca.model_used,
            (select count(*)::int from recovery_actions ra
              where ra.case_id = rc.id
                and ra.action_type = 'retry_payment'
                and ra.status in ('executed','failed')) as retry_count
       from recovery_cases rc
       join revenue_risk_events rre on rre.id = rc.event_id
       left join transactions t on t.id = rre.transaction_id
       left join invoices i on i.id = rre.invoice_id
       left join lateral (
         select cause, confidence, model_used from root_cause_analysis
          where event_id = rre.id order by created_at desc limit 1
       ) rca on true
      where rc.id = $1`,
    [caseId]
  );
  const r = rows[0];
  if (!r) return null;

  return {
    caseCtx: {
      case_id: r.case_id,
      merchant_id: r.merchant_id,
      playbook: r.playbook,
      state: r.state,
      holdout: r.holdout,
      retry_count: Number(r.retry_count ?? 0),
      opened_at: r.opened_at,
      original_amount: Number(r.original_amount ?? 0),
      gateway_ref: r.gateway_ref,
    },
    event: {
      id: r.event_id,
      merchant_id: r.merchant_id,
      type: r.type,
      transaction_id: r.transaction_id,
      invoice_id: r.invoice_id,
      customer_id: r.customer_id,
      payload: r.payload ?? {},
      detected_at: r.detected_at,
    },
    rootCause: {
      cause: r.cause ?? "unknown",
      confidence: Number(r.confidence ?? 0),
      // Marks the diagnosis as carried over rather than freshly computed,
      // so the audit trail doesn't imply a model ran on this pass.
      model_used: r.model_used ? `${r.model_used} (carried over)` : "unavailable",
      raw_output: null,
    },
  };
}

/**
 * Promises whose date has passed without payment (§10 B2B receivables:
 * "customer promises to pay but doesn't"). Marking them broken emits a
 * `promise_to_pay_broken` risk event, which the pipeline already knows
 * how to score and act on — it just had nothing producing one until now.
 */
async function processBrokenPromises(): Promise<string[]> {
  const { rows } = await servicePool.query<{ id: string }>(
    `with broken as (
       update promises_to_pay p
          set status = 'broken'
         from recovery_cases rc
        where p.case_id = rc.id
          and p.status = 'pending'
          and p.promised_date < current_date
        returning p.case_id, rc.merchant_id, rc.customer_id,
                  coalesce(
                    (select rre.invoice_id from revenue_risk_events rre where rre.id = rc.event_id),
                    null) as invoice_id
     )
     insert into revenue_risk_events (merchant_id, type, customer_id, invoice_id, payload)
     select b.merchant_id, 'promise_to_pay_broken', b.customer_id, b.invoice_id,
            jsonb_build_object(
              'type', 'promise_to_pay_broken',
              'origin_case_id', b.case_id)
       from broken b
     returning id`
  );
  return rows.map((r) => r.id);
}

export async function sweepDueCases(options: { limit?: number } = {}): Promise<SweepResult> {
  const limit = options.limit ?? 25;
  const result: SweepResult = { examined: 0, resumed: 0, skipped: 0, errors: 0, brokenPromises: 0 };

  // A broken promise is a new risk signal, so it enters through the front
  // door: a revenue_risk_events row, then the full pipeline. That routes
  // it through the same detection, guardrail and audit path as any other
  // event rather than giving it a privileged side channel.
  const brokenPromiseEventIds = await processBrokenPromises().catch((err) => {
    console.error("[sweeper] broken-promise scan failed", err);
    return [] as string[];
  });
  result.brokenPromises = brokenPromiseEventIds.length;

  for (const eventId of brokenPromiseEventIds) {
    await runPipelineForEvent(eventId).catch((err) => {
      result.errors++;
      console.error(`[sweeper] broken-promise event ${eventId} failed`, err);
    });
  }

  const dueCaseIds = await findDueCases(limit);
  result.examined = dueCaseIds.length;

  for (const caseId of dueCaseIds) {
    try {
      const loaded = await loadCaseForResume(caseId);
      if (!loaded) {
        result.skipped++;
        continue;
      }

      // Move back into 'recommending' before deciding. This doubles as
      // the concurrency claim: if another sweeper (or a webhook) already
      // moved this case, the guarded UPDATE fails and we skip rather than
      // running a second decision cycle on the same case.
      await transitionCase(caseId, "retry_scheduled", "recommending");

      await runDecisionCycle({ ...loaded.caseCtx, state: "recommending" }, loaded.event, loaded.rootCause);
      result.resumed++;
    } catch (err) {
      if (err instanceof ConcurrentModificationError) {
        result.skipped++;
      } else {
        result.errors++;
        console.error(`[sweeper] case ${caseId} failed`, err);
      }
    }
  }

  return result;
}
