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
  channel?: "sms" | "email" | "voice" | "whatsapp";
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
}

export type GuardrailVerdict =
  | { approved: true; action: AiRecommendation }
  | { approved: false; reason: string; fallback?: AiRecommendation };

export interface CaseContext {
  case_id: string;
  merchant_id: string;
  playbook: Playbook;
  state: CaseState;
  holdout: boolean;
  retry_count: number;
  opened_at: string;
  original_amount: number;
}
