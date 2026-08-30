import type { PoolClient } from "pg";
import type { AiRecommendation, CaseContext, GuardrailVerdict, PolicyRules } from "../types/domain.js";
import { servicePool } from "../db/client.js";

/**
 * THE security boundary against the AI (§13). Plain, synchronous,
 * unit-testable TypeScript — no model call inside this file, ever.
 *
 * An `AiRecommendation` is not permission to act; it is one input this
 * function evaluates against case state, policy limits, and cooldown
 * history, all read fresh from Postgres. The LLM has no credential and
 * no code path to a payment or messaging provider (§5, §9) — this
 * function is the only gate between "proposed" and "approved", and the
 * executor (pipeline/executor.ts) refuses to run anything this function
 * did not explicitly approve.
 *
 * Every rejection reason is a specific, named check — not a catch-all
 * "no" — so the audit trail (agent_decisions) can show a judge or a
 * merchant exactly which rule fired.
 */

export interface GuardrailInput {
  recommendation: AiRecommendation;
  caseCtx: CaseContext;
  policy: PolicyRules;
  cooldownActiveUntil: Date | null; // null = no active cooldown for this (case, channel)
  campaignAgeDays: number;
}

export function evaluateGuardrail(input: GuardrailInput): GuardrailVerdict {
  const { recommendation, caseCtx, policy, cooldownActiveUntil, campaignAgeDays } = input;

  // 1. Action-type allowlist — anything outside the enum for this playbook
  //    is auto-rejected, never executed (§4 "AI hallucinates ... action").
  if (!policy.allowed_action_types.includes(recommendation.action_type)) {
    return reject(
      `action_type '${recommendation.action_type}' is not in the allowed set for playbook '${caseCtx.playbook}': [${policy.allowed_action_types.join(", ")}]`
    );
  }

  // 2. Action must be legal given current case state (§4 "Incorrect
  //    recovery action chosen" — e.g. can't retry a case already recovered).
  const stateCheck = checkActionAgainstState(recommendation.action_type, caseCtx.state);
  if (!stateCheck.ok) return reject(stateCheck.reason);

  // 3. Retry limits are deterministic code, not a prompt (§4 "Infinite
  //    retry loops", §5).
  if (recommendation.action_type === "retry_payment") {
    if (caseCtx.retry_count >= policy.max_retry_count) {
      return reject(
        `retry_payment rejected: case has already used ${caseCtx.retry_count}/${policy.max_retry_count} allowed retries for playbook '${caseCtx.playbook}'`,
        { action_type: "escalate_to_human", reasoning: "guardrail fallback: max retries exhausted", confidence: 1 }
      );
    }
  }

  // 4. Campaign duration cap.
  if (campaignAgeDays > policy.max_campaign_duration_days) {
    return reject(
      `case has been open ${campaignAgeDays}d, exceeding max_campaign_duration_days (${policy.max_campaign_duration_days}) for playbook '${caseCtx.playbook}'`,
      { action_type: "close_case", reasoning: "guardrail fallback: campaign duration exceeded", confidence: 1 }
    );
  }

  // 5. Amount cap — a recommendation can never exceed the case's original
  //    transaction amount, and never a merchant-configured hard cap.
  if (recommendation.action_type === "retry_payment") {
    const requested = recommendation.amount ?? caseCtx.original_amount;
    if (requested > caseCtx.original_amount) {
      return reject(
        `retry_payment amount ${requested} exceeds the case's original transaction amount ${caseCtx.original_amount} — never allowed regardless of AI reasoning`
      );
    }
    if (policy.amount_cap > 0 && requested > policy.amount_cap) {
      return reject(`retry_payment amount ${requested} exceeds merchant amount_cap ${policy.amount_cap}`);
    }
  }

  // 6. Communication cooldown (§4 "Repeated customer messaging").
  if (recommendation.action_type === "send_message") {
    if (cooldownActiveUntil && cooldownActiveUntil.getTime() > Date.now()) {
      return reject(
        `send_message rejected: channel is in cooldown until ${cooldownActiveUntil.toISOString()}`
      );
    }
    if (!recommendation.channel) {
      return reject("send_message rejected: no channel specified");
    }
  }

  // 7. Confidence floor — a low-confidence proposal escalates rather than
  //    executing on a guess (§5 "whether the situation looks unusual
  //    enough to escalate" is an AI judgment call, but the floor itself
  //    is a deterministic threshold, not something the AI can talk itself
  //    past).
  const CONFIDENCE_FLOOR = 0.3;
  if (recommendation.confidence < CONFIDENCE_FLOOR) {
    return reject(
      `confidence ${recommendation.confidence} is below the floor (${CONFIDENCE_FLOOR}) — escalating instead of acting on a low-confidence proposal`,
      { action_type: "escalate_to_human", reasoning: "guardrail fallback: low AI confidence", confidence: 1 }
    );
  }

  return { approved: true, action: recommendation };
}

function checkActionAgainstState(actionType: AiRecommendation["action_type"], state: CaseContext["state"]) {
  const terminal: CaseContext["state"][] = ["recovered", "closed_unrecovered"];
  if (terminal.includes(state)) {
    return { ok: false as const, reason: `case is already in terminal state '${state}' — no action can be taken` };
  }
  // The guardrail runs while the case is still in 'recommending' — per
  // §5/§10, approval IS what produces the transition to 'awaiting_approval'
  // (then 'contacting'). 'retry_scheduled' is included for a case looping
  // back through another recommendation cycle (§5's "continue" branch).
  const preActionStates: CaseContext["state"][] = ["recommending", "retry_scheduled"];
  if (actionType === "retry_payment" && !preActionStates.includes(state)) {
    return { ok: false as const, reason: `retry_payment is not valid from state '${state}'` };
  }
  if (actionType === "send_message" && !preActionStates.includes(state)) {
    return { ok: false as const, reason: `send_message is not valid from state '${state}'` };
  }
  return { ok: true as const };
}

function reject(reason: string, fallback?: AiRecommendation): GuardrailVerdict {
  return { approved: false, reason, fallback };
}

/**
 * Deterministic fallback playbook for an AI-provider outage (§4, §14):
 * the guardrail engine can propose a safe default action itself, with no
 * model call at all, so a case never stalls just because the LLM is down.
 */
export function deterministicFallbackAction(caseCtx: CaseContext, policy: PolicyRules): AiRecommendation {
  if (caseCtx.retry_count >= policy.max_retry_count) {
    return { action_type: "escalate_to_human", reasoning: "AI unavailable; default playbook escalates after retry budget exhausted", confidence: 1 };
  }
  if (policy.allowed_action_types.includes("retry_payment")) {
    return { action_type: "retry_payment", reasoning: "AI unavailable; default retry schedule applied", confidence: 1 };
  }
  return { action_type: "send_message", channel: "email", language: "en", message_draft: "We noticed an issue with your recent transaction — please check your account.", reasoning: "AI unavailable; default template message", confidence: 1 };
}

/** Reads the active cooldown, if any, for (case, channel) — fresh, not cached. */
export async function getActiveCooldown(caseId: string, channel: string, client?: PoolClient): Promise<Date | null> {
  const db = client ?? servicePool;
  const { rows } = await db.query<{ cooldown_until: string }>(
    `select cooldown_until from communication_attempts
     where case_id = $1 and channel = $2
     order by sent_at desc limit 1`,
    [caseId, channel]
  );
  if (rows.length === 0) return null;
  const until = new Date(rows[0].cooldown_until);
  return until.getTime() > Date.now() ? until : null;
}
