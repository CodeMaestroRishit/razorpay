// Shared domain types for the Architecture-D pipeline. Kept deliberately
// close to the §6 schema so a row read from Postgres and a value passed
// between pipeline stages are the same shape.

export type Playbook = "failed_subscription" | "checkout_abandonment" | "b2b_receivables";

export type CaseState =
  | "detected"
  | "diagnosing"
  | "recommending"
  | "awaiting_approval"
  | "contacting"
  | "retry_scheduled"
  | "recovered"
  | "escalated"
  | "closed_unrecovered";

export type ActionType =
  | "retry_payment"
  | "send_message"
  | "schedule_retry"
  | "escalate_to_human"
  | "close_case";

export type Channel = "sms" | "email" | "voice" | "whatsapp";

export interface RevenueRiskEvent {
  id: string;
  merchant_id: string;
  type: "payment_failed" | "checkout_abandoned" | "invoice_overdue" | "customer_responded" | "promise_to_pay_broken";
  transaction_id: string | null;
  invoice_id: string | null;
  customer_id: string | null;
  payload: Record<string, unknown>;
  detected_at: string;
}

export interface RiskScore {
  score: number; // 0..1
  factors: Record<string, number>;
}

export interface RootCauseResult {
  cause: string;
  confidence: number;
  model_used: string;
  raw_output: unknown;
}

/**
 * The ONLY thing an LLM is ever allowed to produce. Note there is no
 * field here that can execute anything — no API client, no credential,
 * just data. §9: "the model is architecturally incapable of taking an
 * action, not merely told not to."
 */
export interface AiRecommendation {
  action_type: ActionType;
  channel?: Channel;
  tone?: string;
  message_draft?: string;
  language?: string;
  amount?: number; // paise, only relevant for retry_payment
  reasoning: string;
  confidence: number;
}

export interface PolicyRules {
  max_retry_count: number;
  min_retry_interval_hours: number;
  max_campaign_duration_days: number;
  cooldown_hours: number;
  amount_cap: number; // paise; 0 = no cap beyond the original transaction amount
  allowed_action_types: ActionType[];
  allowed_channels: Channel[];
}

/**
 * Everything the guardrail engine needs to know about the world, read
 * fresh from Postgres by `gatherGuardrailFacts` before evaluation. Passing
 * these in (rather than letting the engine query) is what keeps
 * `evaluateGuardrail` pure, synchronous, and testable without a database.
 */
export interface GuardrailFacts {
  /** Injected rather than read from the clock, so time-based rules are testable. */
  now: Date;
  cooldownActiveUntil: Date | null;
  lastRetryAt: Date | null;
  campaignAgeDays: number;
  actionsTakenOnCase: number;
  customerOptedOut: boolean;
  reachableChannels: Channel[];
  rootCause: string | null;
}

export type GuardrailVerdict =
  | { approved: true; action: AiRecommendation }
  /** `rule` names the specific check that fired — surfaced in the audit trail and UI. */
  | { approved: false; rule: string; reason: string; fallback?: AiRecommendation };

export interface CaseContext {
  case_id: string;
  merchant_id: string;
  playbook: Playbook;
  state: CaseState;
  holdout: boolean;
  retry_count: number;
  opened_at: string;
  original_amount: number;
  /**
   * The payment provider's own reference for the failed charge (Razorpay
   * `pay_...`), or null for a case with no underlying payment (an
   * abandoned checkout, an overdue invoice). This — never `case_id` — is
   * what a retry is issued against.
   */
  gateway_ref: string | null;
}
