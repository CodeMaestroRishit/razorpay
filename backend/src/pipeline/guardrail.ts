import { z } from "zod/v4";
import type {
  ActionType,
  AiRecommendation,
  CaseContext,
  Channel,
  GuardrailFacts,
  GuardrailVerdict,
  PolicyRules,
} from "../types/domain.js";

/**
 * THE security boundary against the AI (§13).
 *
 * Three properties make this file the actual boundary rather than a
 * decorative one:
 *
 *  1. **No model call, ever.** Nothing in here is async, network-bound, or
 *     model-driven. Every fact it needs is passed in (see `GuardrailFacts`,
 *     gathered by `gatherGuardrailFacts`), so the whole engine is a pure
 *     function: same inputs, same verdict, fully unit-testable with no DB.
 *  2. **It does not trust its input.** `AiRecommendation` is a TypeScript
 *     type, which is a compile-time fiction — at runtime the object came
 *     from a model. Check 1 re-validates the structure against a Zod schema
 *     before any other check reads a field.
 *  3. **It returns a normalized action, not the model's object.** An
 *     approved verdict carries a rebuilt, clamped `action` — unknown fields
 *     dropped, amount defaulted and bounded, message truncated. The
 *     executor never sees raw model output.
 *
 * Checks run in a fixed order, fail-closed, most fundamental first, and
 * every rejection names the rule that fired (`verdict.rule`) so the audit
 * trail can show a merchant exactly which limit stopped an action.
 */

/** Hard structural bounds. Not merchant-configurable — these are sanity, not policy. */
const MAX_MESSAGE_CHARS = 1000;
const CONFIDENCE_FLOOR = 0.3;
/**
 * Total actions of any kind on one case. Backstop against a runaway loop
 * that alternates action types to sidestep the per-type retry budget —
 * `max_retry_count` alone doesn't bound "message, schedule, message, …".
 */
const MAX_ACTIONS_PER_CASE = 10;

const CHANNELS = ["sms", "email", "voice", "whatsapp"] as const;
const ACTION_TYPES = [
  "retry_payment",
  "send_message",
  "schedule_retry",
  "escalate_to_human",
  "close_case",
] as const;

/**
 * Runtime shape check on model output. `strict()` rejects unknown keys
 * outright: a model that invents `{"execute_now": true}` or
 * `{"override_limit": ...}` is refused at the door rather than having the
 * extra field silently ignored.
 */
const RecommendationSchema = z
  .object({
    action_type: z.enum(ACTION_TYPES),
    channel: z.enum(CHANNELS).optional(),
    tone: z.string().max(120).optional(),
    message_draft: z.string().optional(),
    language: z.string().max(32).optional(),
    // Paise. Must be a positive whole number — no floats, no NaN/Infinity
    // (z.number() already rejects both), no negatives, no fractional paise.
    amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    reasoning: z.string().min(1),
    confidence: z.number().min(0).max(1),
  })
  .strict();

/** Actions that reach out to a customer — the ones opt-out and cooldown govern. */
const CONTACT_ACTIONS: ActionType[] = ["send_message", "retry_payment"];
/** Actions that only ever wind a case down. Always permitted, so a case can always terminate. */
const TERMINATING_ACTIONS: ActionType[] = ["escalate_to_human", "close_case"];

export interface GuardrailInput {
  recommendation: AiRecommendation;
  caseCtx: CaseContext;
  policy: PolicyRules;
  facts: GuardrailFacts;
}

type CheckResult = { rule: string; reason: string; fallback?: AiRecommendation } | null;

/**
 * The ordered rule list. Data, not nested `if`s — the order is visible,
 * each rule is independently testable, and adding one can't accidentally
 * bypass another. First non-null result wins; the action is rejected.
 */
const CHECKS: ReadonlyArray<{ rule: string; run: (i: GuardrailInput) => CheckResult }> = [
  { rule: "schema", run: checkSchema },
  { rule: "holdout", run: checkHoldout },
  { rule: "terminal_state", run: checkTerminalState },
  { rule: "suspected_fraud", run: checkFraud },
  { rule: "customer_opt_out", run: checkOptOut },
  { rule: "action_allowlist", run: checkActionAllowlist },
  { rule: "state_machine", run: checkActionAgainstState },
  { rule: "action_budget", run: checkActionBudget },
  { rule: "retry_budget", run: checkRetryBudget },
  { rule: "retry_interval", run: checkRetryInterval },
  { rule: "campaign_duration", run: checkCampaignDuration },
  { rule: "amount", run: checkAmount },
  { rule: "channel", run: checkChannel },
  { rule: "cooldown", run: checkCooldown },
  { rule: "confidence_floor", run: checkConfidenceFloor },
];

export function evaluateGuardrail(input: GuardrailInput): GuardrailVerdict {
  for (const check of CHECKS) {
    const result = check.run(input);
    if (result) {
      return { approved: false, rule: result.rule, reason: result.reason, fallback: result.fallback };
    }
  }
  return { approved: true, action: normalize(input) };
}

/**
 * Rebuild the action from validated fields only. What the executor
 * receives is constructed here, never passed through from the model —
 * so an unexpected field can't ride along into execution.
 */
function normalize({ recommendation, caseCtx }: GuardrailInput): AiRecommendation {
  const action: AiRecommendation = {
    action_type: recommendation.action_type,
    reasoning: recommendation.reasoning,
    confidence: recommendation.confidence,
  };
  if (recommendation.action_type === "retry_payment") {
    // Default to the original amount; never carry a larger one (checkAmount
    // has already rejected those, this is belt-and-braces).
    action.amount = Math.min(recommendation.amount ?? caseCtx.original_amount, caseCtx.original_amount);
  }
  if (recommendation.action_type === "send_message") {
    if (recommendation.channel) action.channel = recommendation.channel;
    if (recommendation.tone) action.tone = recommendation.tone;
    if (recommendation.language) action.language = recommendation.language;
    if (recommendation.message_draft) {
      action.message_draft = recommendation.message_draft.slice(0, MAX_MESSAGE_CHARS);
    }
  }
  return action;
}

// ---------------------------------------------------------------------------
// Checks. Each returns null to pass, or a named rejection.
// ---------------------------------------------------------------------------

/** 1. Structural validation. The boundary does not trust its caller. */
function checkSchema({ recommendation }: GuardrailInput): CheckResult {
  const parsed = RecommendationSchema.safeParse(recommendation);
  if (parsed.success) return null;
  const detail = parsed.error.issues
    .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("; ");
  return {
    rule: "schema",
    reason: `proposal failed structural validation and was never evaluated further — ${detail}`,
    fallback: escalate("guardrail fallback: malformed AI proposal"),
  };
}

/**
 * 2. Holdout cases get no intervention, full stop (§11). The pipeline
 * already returns early for these; this is defense in depth, so a future
 * caller can't accidentally act on a holdout case and silently corrupt the
 * incrementality measurement.
 */
function checkHoldout({ caseCtx }: GuardrailInput): CheckResult {
  if (!caseCtx.holdout) return null;
  return {
    rule: "holdout",
    reason: "case is in the holdout group — no agent intervention is permitted, so the §11 baseline stays a real measurement",
  };
}

/** 3. A resolved case is closed to all further action. */
function checkTerminalState({ caseCtx }: GuardrailInput): CheckResult {
  const terminal: CaseContext["state"][] = ["recovered", "closed_unrecovered"];
  if (!terminal.includes(caseCtx.state)) return null;
  return {
    rule: "terminal_state",
    reason: `case is already in terminal state '${caseCtx.state}' — no action can be taken`,
  };
}

/**
 * 4. Suspected fraud is an unconditional escalation (§10) — it outranks
 * every other consideration, including a confident AI proposal to retry.
 */
function checkFraud({ recommendation, facts }: GuardrailInput): CheckResult {
  if (facts.rootCause !== "suspected_fraud") return null;
  if (recommendation.action_type === "escalate_to_human") return null;
  return {
    rule: "suspected_fraud",
    reason: `root cause is 'suspected_fraud' — automation is not permitted on this case; only human escalation`,
    fallback: escalate("guardrail fallback: suspected fraud requires a human"),
  };
}

/**
 * 5. Customer opt-out (§10 stopping condition, §4 "customer asks for a
 * human"). Blocks contact, never blocks winding the case down.
 */
function checkOptOut({ recommendation, facts }: GuardrailInput): CheckResult {
  if (!facts.customerOptedOut) return null;
  if (TERMINATING_ACTIONS.includes(recommendation.action_type)) return null;
  return {
    rule: "customer_opt_out",
    reason: `customer has opted out of contact — '${recommendation.action_type}' is not permitted`,
    fallback: { action_type: "close_case", reasoning: "guardrail fallback: customer opted out", confidence: 1 },
  };
}

/** 6. Per-playbook action allowlist (§4 "AI hallucinates ... action"). */
function checkActionAllowlist({ recommendation, caseCtx, policy }: GuardrailInput): CheckResult {
  if (policy.allowed_action_types.includes(recommendation.action_type)) return null;
  return {
    rule: "action_allowlist",
    reason: `action_type '${recommendation.action_type}' is not in the allowed set for playbook '${caseCtx.playbook}': [${policy.allowed_action_types.join(", ")}]`,
  };
}

/**
 * 7. The action must be legal from the case's current state (§4 "Incorrect
 * recovery action chosen"). The guardrail runs while the case is still in
 * 'recommending' — approval IS what produces the move to
 * 'awaiting_approval' (§5/§10). 'retry_scheduled' covers a case looping
 * back for another cycle via §5's "continue" branch.
 */
function checkActionAgainstState({ recommendation, caseCtx }: GuardrailInput): CheckResult {
  const preActionStates: CaseContext["state"][] = ["recommending", "retry_scheduled"];
  if (!CONTACT_ACTIONS.includes(recommendation.action_type)) return null;
  if (preActionStates.includes(caseCtx.state)) return null;
  return {
    rule: "state_machine",
    reason: `${recommendation.action_type} is not valid from state '${caseCtx.state}'`,
  };
}

/** 8. Runaway backstop across all action types, not just retries. */
function checkActionBudget({ recommendation, facts }: GuardrailInput): CheckResult {
  if (TERMINATING_ACTIONS.includes(recommendation.action_type)) return null;
  if (facts.actionsTakenOnCase < MAX_ACTIONS_PER_CASE) return null;
  return {
    rule: "action_budget",
    reason: `case has already had ${facts.actionsTakenOnCase} actions (cap ${MAX_ACTIONS_PER_CASE}) — refusing further automation regardless of type`,
    fallback: escalate("guardrail fallback: per-case action budget exhausted"),
  };
}

/** 9. Retry count limit — deterministic code, not a prompt (§4 "infinite retry loops"). */
function checkRetryBudget({ recommendation, caseCtx, policy }: GuardrailInput): CheckResult {
  if (recommendation.action_type !== "retry_payment") return null;
  if (caseCtx.retry_count < policy.max_retry_count) return null;
  return {
    rule: "retry_budget",
    reason: `retry_payment rejected: case has already used ${caseCtx.retry_count}/${policy.max_retry_count} allowed retries for playbook '${caseCtx.playbook}'`,
    fallback: escalate("guardrail fallback: max retries exhausted"),
  };
}

/**
 * 10. Minimum spacing between retries (§10: "minimum 24h between
 * retries"). Distinct from the count cap: three retries are allowed, three
 * retries in the same minute are not — that's how a customer's card gets
 * hammered and a merchant gets flagged by their bank.
 */
function checkRetryInterval({ recommendation, policy, facts }: GuardrailInput): CheckResult {
  if (recommendation.action_type !== "retry_payment") return null;
  if (!facts.lastRetryAt || policy.min_retry_interval_hours <= 0) return null;
  const elapsedHours = (facts.now.getTime() - facts.lastRetryAt.getTime()) / 3_600_000;
  if (elapsedHours >= policy.min_retry_interval_hours) return null;
  const readyAt = new Date(facts.lastRetryAt.getTime() + policy.min_retry_interval_hours * 3_600_000);
  return {
    rule: "retry_interval",
    reason: `retry_payment rejected: last retry was ${elapsedHours.toFixed(1)}h ago, policy requires ${policy.min_retry_interval_hours}h between retries (next eligible ${readyAt.toISOString()})`,
    fallback: {
      action_type: "schedule_retry",
      reasoning: "guardrail fallback: too soon to retry, scheduling instead",
      confidence: 1,
    },
  };
}

/** 11. Campaign duration cap — a case cannot be worked forever. */
function checkCampaignDuration({ recommendation, caseCtx, policy, facts }: GuardrailInput): CheckResult {
  if (TERMINATING_ACTIONS.includes(recommendation.action_type)) return null;
  if (facts.campaignAgeDays <= policy.max_campaign_duration_days) return null;
  return {
    rule: "campaign_duration",
    reason: `case has been open ${facts.campaignAgeDays.toFixed(1)}d, exceeding max_campaign_duration_days (${policy.max_campaign_duration_days}) for playbook '${caseCtx.playbook}'`,
    fallback: { action_type: "close_case", reasoning: "guardrail fallback: campaign duration exceeded", confidence: 1 },
  };
}

/**
 * 12. Money bounds. The AI can never move more than the customer
 * originally owed, no matter how it justifies the number.
 */
function checkAmount({ recommendation, caseCtx, policy }: GuardrailInput): CheckResult {
  if (recommendation.action_type !== "retry_payment") return null;
  const requested = recommendation.amount ?? caseCtx.original_amount;
  if (requested > caseCtx.original_amount) {
    return {
      rule: "amount",
      reason: `retry_payment amount ${requested} exceeds the case's original transaction amount ${caseCtx.original_amount} — never allowed regardless of AI reasoning`,
    };
  }
  if (policy.amount_cap > 0 && requested > policy.amount_cap) {
    return {
      rule: "amount",
      reason: `retry_payment amount ${requested} exceeds merchant amount_cap ${policy.amount_cap}`,
    };
  }
  return null;
}

/** 13. A message needs a channel the merchant permits and the customer is reachable on. */
function checkChannel({ recommendation, policy, facts }: GuardrailInput): CheckResult {
  if (recommendation.action_type !== "send_message") return null;
  const channel = recommendation.channel;
  if (!channel) {
    return { rule: "channel", reason: "send_message rejected: no channel specified" };
  }
  if (!policy.allowed_channels.includes(channel)) {
    return {
      rule: "channel",
      reason: `channel '${channel}' is not enabled for this merchant: [${policy.allowed_channels.join(", ")}]`,
    };
  }
  if (!facts.reachableChannels.includes(channel)) {
    return {
      rule: "channel",
      reason: `customer has no contact details for channel '${channel}' — sending would be a guaranteed no-op counted as an attempt`,
    };
  }
  return null;
}

/** 14. Per-channel cooldown (§4 "repeated customer messaging"). */
function checkCooldown({ recommendation, facts }: GuardrailInput): CheckResult {
  if (recommendation.action_type !== "send_message") return null;
  if (!facts.cooldownActiveUntil) return null;
  if (facts.cooldownActiveUntil.getTime() <= facts.now.getTime()) return null;
  return {
    rule: "cooldown",
    reason: `send_message rejected: channel '${recommendation.channel}' is in cooldown until ${facts.cooldownActiveUntil.toISOString()}`,
  };
}

/**
 * 15. Confidence floor. Whether a situation is ambiguous is an AI judgment
 * call (§5); the threshold at which ambiguity means "stop" is not — it's a
 * fixed number the model cannot argue past.
 */
function checkConfidenceFloor({ recommendation }: GuardrailInput): CheckResult {
  if (TERMINATING_ACTIONS.includes(recommendation.action_type)) return null;
  if (recommendation.confidence >= CONFIDENCE_FLOOR) return null;
  return {
    rule: "confidence_floor",
    reason: `confidence ${recommendation.confidence} is below the floor (${CONFIDENCE_FLOOR}) — escalating instead of acting on a low-confidence proposal`,
    fallback: escalate("guardrail fallback: low AI confidence"),
  };
}

function escalate(reasoning: string): AiRecommendation {
  return { action_type: "escalate_to_human", reasoning, confidence: 1 };
}

/**
 * Deterministic fallback playbook for an AI-provider outage (§4, §14): a
 * safe default action chosen with no model call at all, so a case never
 * stalls just because the LLM is down. Still goes through
 * `evaluateGuardrail` like any other proposal — nothing skips the boundary.
 */
export function deterministicFallbackAction(caseCtx: CaseContext, policy: PolicyRules): AiRecommendation {
  if (caseCtx.retry_count >= policy.max_retry_count) {
    return escalate("AI unavailable; default playbook escalates after retry budget exhausted");
  }
  if (policy.allowed_action_types.includes("retry_payment")) {
    return { action_type: "retry_payment", reasoning: "AI unavailable; default retry schedule applied", confidence: 1 };
  }
  const channel: Channel = policy.allowed_channels.includes("email") ? "email" : policy.allowed_channels[0] ?? "email";
  return {
    action_type: "send_message",
    channel,
    language: "en",
    message_draft: "We noticed an issue with your recent transaction — please check your account.",
    reasoning: "AI unavailable; default template message",
    confidence: 1,
  };
}
