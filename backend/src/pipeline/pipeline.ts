import { servicePool } from "../db/client.js";
import type { ActionType, CaseContext, CaseState, RevenueRiskEvent, RootCauseResult } from "../types/domain.js";
import { scoreEvent } from "./detection.js";
import { openCase, transitionCase, getRetryCount } from "./caseManager.js";
import { getPolicyRules } from "../policy/rules.js";
import { evaluateGuardrail, deterministicFallbackAction } from "./guardrail.js";
import { gatherGuardrailFacts } from "./guardrailFacts.js";
import { executeAction, type ExecutionResult } from "./executor.js";
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

/**
 * What the case's state should be after an action ran. Kept as a pure
 * function so the mapping is testable in isolation — it decides where a
 * case lands, which is the difference between a recovery being counted
 * and not.
 *
 * An action that did NOT execute (deduped by the idempotency check) must
 * not advance the case as though it had; it goes back to retry_scheduled
 * so a later run can legitimately retry it.
 */
export function outcomeStateFor(
  actionType: ActionType,
  execution: { executed: boolean; detail: Record<string, unknown> }
): "recovered" | "retry_scheduled" | "escalated" | "closed_unrecovered" {
  if (!execution.executed) return "retry_scheduled";

  switch (actionType) {
    case "retry_payment":
      // Only a confirmed capture counts as recovery. 'pending' is an
      // UNKNOWN outcome (§4 "payment gateway timeout"), never a success —
      // the case stays open for reconciliation.
      return execution.detail.status === "succeeded" ? "recovered" : "retry_scheduled";
    case "escalate_to_human":
      return "escalated";
    case "close_case":
      return "closed_unrecovered";
    case "send_message":
    case "schedule_retry":
      return "retry_scheduled";
  }
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
  await runDecisionCycle(caseCtx, event, rootCause);
}

/**
 * Decide → guard → act → measure, for a case already in 'recommending'.
 *
 * Split out from `runPipelineForEvent` so a case can go round the loop
 * more than once (§5's "continue" branch). The first pass arrives here
 * from a webhook; later passes arrive from the sweeper, which resumes
 * cases whose retry interval or cooldown has elapsed. Detection and
 * root-cause analysis are NOT repeated — the diagnosis of why a payment
 * failed doesn't change between attempts, and re-running it would burn a
 * model call per sweep for no new information.
 */
export async function runDecisionCycle(
  initialCaseCtx: CaseContext,
  event: RevenueRiskEvent,
  rootCause: RootCauseResult
): Promise<void> {
  let caseCtx = initialCaseCtx;

  // Policy is fetched once and reused for the fallback, the guardrail, and
  // the executor. It was previously re-queried up to three times per run —
  // invisible against local Postgres, real latency against Supabase.
  const [policy, retryCount] = await Promise.all([
    getPolicyRules(caseCtx.merchant_id, caseCtx.playbook),
    getRetryCount(caseCtx.case_id),
  ]);
  caseCtx = { ...caseCtx, retry_count: retryCount };

  const recommendation = rootCause.model_used === "unavailable"
    ? deterministicFallbackAction(caseCtx, policy)
    : await timedStage(
        caseCtx.case_id,
        "recommend",
        { rootCause },
        () => reasoning.recommend(event, rootCause, caseCtx),
        { model: "reasoning-llm" }
      ).catch(async (err) => {
        await recordDecision({ caseId: caseCtx.case_id, stage: "recommend", input: { rootCause }, output: { error: String(err) } });
        return deterministicFallbackAction(caseCtx, policy);
      });

  // Stage: Guardrail — the one function in this whole loop that can say no.
  // Facts come from a single query; the engine itself is pure and sync.
  const facts = await gatherGuardrailFacts(caseCtx, recommendation.channel);
  const verdict = evaluateGuardrail({ recommendation, caseCtx, policy, facts });
  await recordDecision({
    caseId: caseCtx.case_id,
    stage: "guardrail",
    input: { recommendation, policy, facts },
    output: verdict,
  });

  if (!verdict.approved) {
    caseCtx = await moveTo(caseCtx, "escalated");
    await servicePool.query(`insert into escalations (case_id, reason) values ($1, $2)`, [
      caseCtx.case_id,
      `[${verdict.rule}] ${verdict.reason}`,
    ]);
    await recordDecision({
      caseId: caseCtx.case_id,
      stage: "stop_or_escalate",
      input: { verdict },
      output: { action: "escalated", rule: verdict.rule },
    });
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

  // An exception here (provider SDK throwing, network stack failing) must
  // not strand the case: without this catch it would sit in 'contacting'
  // forever, invisible to the pipeline and to any later retry, with its
  // idempotency key already claimed. Treated as a non-execution so the
  // case falls back to retry_scheduled and stays workable.
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
  ).catch(async (err): Promise<ExecutionResult> => {
    await recordDecision({
      caseId: caseCtx.case_id,
      stage: "execute",
      input: { action: verdict.action },
      output: { error: String(err) },
    });
    return { executed: false, detail: { error: String(err) } };
  });

  // Stage: Observe result + Measure
  const outcomeState = outcomeStateFor(verdict.action.action_type, execution);
  caseCtx = await moveTo(caseCtx, outcomeState);
  await recordDecision({
    caseId: caseCtx.case_id,
    stage: "measure",
    input: { execution },
    output: { outcomeState, executed: execution.executed, skippedReason: execution.skippedReason },
  });

  // Only genuinely terminal outcomes are appended to the experiment
  // record. An escalated case is still open — a human may yet recover it —
  // so recording it now would bias the historical record pessimistically.
  if (outcomeState === "recovered") {
    await recordExperimentOutcome(caseCtx.case_id, true);
  }
}
