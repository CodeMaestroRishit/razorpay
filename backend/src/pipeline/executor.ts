import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import type { RazorpayAdapter } from "../adapters/razorpay.js";
import type { MessagingAdapter } from "../adapters/messaging.js";
import type { SarvamAdapter } from "../adapters/sarvam.js";
import type { AiRecommendation, CaseContext, PolicyRules } from "../types/domain.js";
import { buildIdempotencyKey, claimIdempotencyKey } from "./idempotency.js";

export interface ExecutionResult {
  executed: boolean;
  skippedReason?: "duplicate" | "cooldown_race";
  detail: Record<string, unknown>;
}

/**
 * Runs exactly one guardrail-approved action. This function must never be
 * called with a raw AiRecommendation — only with the `action` field of an
 * `{ approved: true }` GuardrailVerdict, enforced by the type signature
 * (`action` here is deliberately untyped as "recommendation", it's the
 * post-guardrail value) and by pipeline.ts never calling this on a
 * rejected verdict.
 */
export async function executeAction(params: {
  caseCtx: CaseContext;
  action: AiRecommendation;
  policy: PolicyRules;
  razorpay: RazorpayAdapter;
  messaging: MessagingAdapter;
  sarvam: SarvamAdapter;
  customerContact: { phone: string | null; email: string | null; language_pref: string };
  client?: PoolClient;
}): Promise<ExecutionResult> {
  const db = params.client ?? servicePool;
  const idempotencyKey = buildIdempotencyKey({ caseId: params.caseCtx.case_id, actionType: params.action.action_type });

  const claimed = await claimIdempotencyKey(db as PoolClient, idempotencyKey, params.action.action_type);
  if (!claimed) {
    return { executed: false, skippedReason: "duplicate", detail: { idempotencyKey } };
  }

  switch (params.action.action_type) {
    case "retry_payment": {
      const result = await params.razorpay.retryPayment({
        // The provider's own payment reference — never an internal id.
        // Null for a case with no underlying payment (abandoned checkout,
        // overdue invoice); the adapter treats that as unretryable.
        gatewayRef: params.caseCtx.gateway_ref,
        amount: params.action.amount ?? params.caseCtx.original_amount,
        idempotencyKey,
      });
      await db.query(
        `insert into recovery_actions (case_id, action_type, proposed_by, status, payload)
         values ($1, 'retry_payment', 'ai', $2, $3)`,
        [params.caseCtx.case_id, result.status === "succeeded" ? "executed" : "failed", JSON.stringify(result)]
      );
      return { executed: true, detail: { ...result, idempotencyKey } };
    }

    case "send_message": {
      const channel = params.action.channel ?? "email";
      const to = channel === "sms" || channel === "whatsapp" || channel === "voice"
        ? params.customerContact.phone
        : params.customerContact.email;

      // The customer's stored language_pref is authoritative, not the
      // model's own guess (§8: language_pref "drives Sarvam routing"). The
      // reasoning LLM has no reliable signal about which language a
      // customer actually reads, and its free-text field isn't
      // constrained to a code — a genuine run returned "English" here,
      // which doesn't match the "en" check downstream and triggered a
      // pointless (and failing) translation of already-English text.
      // action.language is a fallback only for the case where the
      // customer record somehow has none (language_pref is NOT NULL with
      // a default, so in practice this fallback is never reached).
      const language = params.customerContact.language_pref || params.action.language || "en";
      const englishDraft = params.action.message_draft ?? "";
      const localized = await params.sarvam.generateLocalizedMessage(englishDraft, language, params.action.tone);

      const sendResult = to
        ? await params.messaging.send({ channel, to, text: localized.text })
        : { sent: false, providerRef: "no_contact_info" };

      const policy = params.policy;
      const cooldownUntil = new Date(Date.now() + policy.cooldown_hours * 3600_000);
      await db.query(
        `insert into communication_attempts (case_id, channel, language, message_text, cooldown_until)
         values ($1, $2, $3, $4, $5)`,
        [params.caseCtx.case_id, channel, language, localized.text, cooldownUntil.toISOString()]
      );
      await db.query(
        `insert into recovery_actions (case_id, action_type, proposed_by, status, payload)
         values ($1, 'send_message', 'ai', $2, $3)`,
        [params.caseCtx.case_id, sendResult.sent ? "executed" : "failed", JSON.stringify({ ...sendResult, degraded: localized.degraded, idempotencyKey })]
      );
      return { executed: sendResult.sent, detail: { ...sendResult, degraded: localized.degraded, idempotencyKey } };
    }

    case "schedule_retry": {
      await db.query(
        `insert into recovery_actions (case_id, action_type, proposed_by, status, payload)
         values ($1, 'schedule_retry', 'ai', 'executed', $2)`,
        [params.caseCtx.case_id, JSON.stringify({ idempotencyKey })]
      );
      return { executed: true, detail: { idempotencyKey } };
    }

    case "escalate_to_human": {
      await db.query(`insert into escalations (case_id, reason) values ($1, $2)`, [
        params.caseCtx.case_id,
        params.action.reasoning,
      ]);
      await db.query(
        `insert into recovery_actions (case_id, action_type, proposed_by, status, payload)
         values ($1, 'escalate_to_human', 'ai', 'executed', $2)`,
        [params.caseCtx.case_id, JSON.stringify({ idempotencyKey })]
      );
      return { executed: true, detail: { idempotencyKey } };
    }

    case "close_case": {
      await db.query(`update recovery_cases set state = 'closed_unrecovered', closed_at = now() where id = $1`, [
        params.caseCtx.case_id,
      ]);
      await db.query(
        `insert into recovery_actions (case_id, action_type, proposed_by, status, payload)
         values ($1, 'close_case', 'ai', 'executed', $2)`,
        [params.caseCtx.case_id, JSON.stringify({ idempotencyKey })]
      );
      return { executed: true, detail: { idempotencyKey } };
    }
  }
}
