import { servicePool } from "../db/client.js";
import type { CaseContext, CaseState, RevenueRiskEvent } from "../types/domain.js";
import { scoreEvent } from "./detection.js";
import { openCase, transitionCase, getRetryCount, campaignAgeDays } from "./caseManager.js";
import { getPolicyRules } from "../policy/rules.js";
import { evaluateGuardrail, deterministicFallbackAction, getActiveCooldown } from "./guardrail.js";
import { executeAction } from "./executor.js";
import { recordDecision, timedStage } from "./audit.js";
import { createReasoningAdapter } from "../adapters/llm.js";
import { createSarvamAdapter } from "../adapters/sarvam.js";
import { createRazorpayAdapter } from "../adapters/razorpay.js";
import { createMessagingAdapter } from "../adapters/messaging.js";
import { recordExperimentOutcome } from "./measurement.js";

const reasoning = createReasoningAdapter();
const sarvam = createSarvamAdapter();
const razorpay = createRazorpayAdapter();
const messaging = createMessagingAdapter();

/**
 * The full Detect -> Diagnose -> Decide -> Guardrail -> Act -> Measure loop
 * from §5, run once per revenue_risk_events row. Every stage writes to
 * agent_decisions via recordDecision/timedStage — this function's job is
 * sequencing and state transitions, not the individual stage logic (that
 * lives in detection.ts, guardrail.ts, executor.ts).
 */
/**
 * Transitions the case in the DB and returns an updated CaseContext with
 * `state` in sync — `caseCtx` is a snapshot, so every state change must go
 * through this instead of `transitionCase` directly, or downstream stages
 * (guardrail in particular) end up validating against a stale state.
 */
async function moveTo(caseCtx: CaseContext, to: CaseState): Promise<CaseContext> {
  await transitionCase(caseCtx.case_id, caseCtx.state, to);
  return { ...caseCtx, state: to };
}

export async function runPipelineForEvent(eventId: string): Promise<void> {
  const { rows } = await servicePool.query<RevenueRiskEvent & { payload: Record<string, unknown> }>(
    "select * from revenue_risk_events where id = $1",
    [eventId]
  );
  const event = rows[0];
  if (!event) throw new Error(`revenue_risk_events row not found: ${eventId}`);

  const amount = Number(event.payload.amount ?? 0);
  const failureCode = event.payload.failure_code as string | undefined;

  // Stage: Detect (risk scoring — deterministic, §9)
  const riskScore = await scoreEvent(event, { amount, failureCode });

  let caseCtx = await openCase(event, amount);
  await recordDecision({ caseId: caseCtx.case_id, stage: "detect", input: { event }, output: { riskScore } });

  // §11: holdout cases get NO agent intervention — no diagnosis, no
  // recommendation, no action. They are tracked identically so that
  // "would this have recovered anyway?" has a real answer. Whether one
  // recovers on its own is decided by the outside world (a success
  // webhook landing later), never by this pipeline.
  if (caseCtx.holdout) {
    await recordDecision({
      caseId: caseCtx.case_id,
      stage: "stop_or_escalate",
      input: { holdout: true },
      output: { action: "no_intervention" },
    });
    return;
  }

  caseCtx = await moveTo(caseCtx, "diagnosing");

  const rootCause = await timedStage(
    caseCtx.case_id,
    "root_cause",
    { event },
    () => reasoning.analyzeRootCause(event, { amount, failureCode }),
    { model: "reasoning-llm" }
  ).catch(async (err) => {
    // §4 "AI provider outage": deterministic fallback, case doesn't stall.
    await recordDecision({ caseId: caseCtx.case_id, stage: "root_cause", input: { event }, output: { error: String(err) } });
    return { cause: "unknown", confidence: 0, model_used: "unavailable", raw_output: null };
  });

  await servicePool.query(
    `insert into root_cause_analysis (event_id, cause, confidence, model_used, raw_output) values ($1, $2, $3, $4, $5)`,
    [event.id, rootCause.cause, rootCause.confidence, rootCause.model_used, JSON.stringify(rootCause.raw_output)]
  );

  caseCtx = await moveTo(caseCtx, "recommending");
  caseCtx = { ...caseCtx, retry_count: await getRetryCount(caseCtx.case_id) };

  const recommendation = rootCause.model_used === "unavailable"
    ? deterministicFallbackAction(caseCtx, await getPolicyRules(caseCtx.merchant_id, caseCtx.playbook))
    : await timedStage(
        caseCtx.case_id,
        "recommend",
        { rootCause },
        () => reasoning.recommend(event, rootCause, caseCtx),
        { model: "reasoning-llm" }
      ).catch(async (err) => {
        await recordDecision({ caseId: caseCtx.case_id, stage: "recommend", input: { rootCause }, output: { error: String(err) } });
        return deterministicFallbackAction(caseCtx, await getPolicyRules(caseCtx.merchant_id, caseCtx.playbook));
      });

  // Stage: Guardrail — the one function in this whole loop that can say no.
  const policy = await getPolicyRules(caseCtx.merchant_id, caseCtx.playbook);
  const cooldownActiveUntil = recommendation.action_type === "send_message" && recommendation.channel
    ? await getActiveCooldown(caseCtx.case_id, recommendation.channel)
    : null;
  const verdict = evaluateGuardrail({
    recommendation,
    caseCtx,
    policy,
    cooldownActiveUntil,
    campaignAgeDays: campaignAgeDays(caseCtx.opened_at),
  });
  await recordDecision({ caseId: caseCtx.case_id, stage: "guardrail", input: { recommendation, policy }, output: verdict });

  if (!verdict.approved) {
    caseCtx = await moveTo(caseCtx, "escalated");
    await servicePool.query(`insert into escalations (case_id, reason) values ($1, $2)`, [caseCtx.case_id, verdict.reason]);
    await recordDecision({ caseId: caseCtx.case_id, stage: "stop_or_escalate", input: { verdict }, output: { action: "escalated" } });
    return;
  }

  caseCtx = await moveTo(caseCtx, "awaiting_approval");

  // Stage: Idempotency check + Execute — only ever runs a guardrail-approved action.
  caseCtx = await moveTo(caseCtx, "contacting");
  const { rows: customerRows } = await servicePool.query<{ phone: string | null; email: string | null; language_pref: string }>(
    "select phone, email, language_pref from customers where id = $1",
    [event.customer_id]
  );
  const customer = customerRows[0] ?? { phone: null, email: null, language_pref: "en" };

  const execution = await timedStage(
    caseCtx.case_id,
    "execute",
    { action: verdict.action },
    () =>
      executeAction({
        caseCtx,
        action: verdict.action,
        policy,
        razorpay,
        messaging,
        sarvam,
        customerContact: customer,
      })
  );

  // Stage: Observe result + Measure
  let outcomeState: "recovered" | "retry_scheduled" | "escalated" = "retry_scheduled";
  if (verdict.action.action_type === "retry_payment") {
    outcomeState = execution.detail.status === "succeeded" ? "recovered" : "retry_scheduled";
  } else if (verdict.action.action_type === "escalate_to_human") {
    outcomeState = "escalated";
  } else if (verdict.action.action_type === "send_message" || verdict.action.action_type === "schedule_retry") {
    outcomeState = "retry_scheduled";
  }
  caseCtx = await moveTo(caseCtx, outcomeState);
  await recordDecision({ caseId: caseCtx.case_id, stage: "measure", input: { execution }, output: { outcomeState } });

  if (outcomeState === "recovered" || outcomeState === "escalated") {
    await recordExperimentOutcome(caseCtx.case_id, outcomeState === "recovered");
  }
}
