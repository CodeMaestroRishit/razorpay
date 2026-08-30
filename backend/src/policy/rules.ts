import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import type { ActionType, PolicyRules, Playbook } from "../types/domain.js";

/**
 * Default limits per playbook, straight from §10. These are the values
 * seeded into `policy_rules` for a new merchant; a merchant can override
 * any of them via the merchants.config / policy_rules table, and the
 * guardrail engine always reads fresh (never caches) so an override
 * takes effect immediately (§4 "Merchant config changes mid-campaign").
 */
export const DEFAULT_POLICY_RULES: Record<Playbook, PolicyRules> = {
  failed_subscription: {
    max_retry_count: 3,
    min_retry_interval_hours: 24,
    max_campaign_duration_days: 14,
    cooldown_hours: 24,
    amount_cap: 0,
    allowed_action_types: ["retry_payment", "send_message", "schedule_retry", "escalate_to_human", "close_case"],
  },
  checkout_abandonment: {
    max_retry_count: 0, // "one message per abandonment, no repeat nagging"
    min_retry_interval_hours: 0,
    max_campaign_duration_days: 2, // 48h
    cooldown_hours: 48,
    amount_cap: 0,
    allowed_action_types: ["send_message", "escalate_to_human", "close_case"],
  },
  b2b_receivables: {
    max_retry_count: 2, // escalate after 2 broken promises
    min_retry_interval_hours: 72,
    max_campaign_duration_days: 60,
    cooldown_hours: 72,
    amount_cap: 0,
    allowed_action_types: ["send_message", "schedule_retry", "escalate_to_human", "close_case"],
  },
};

/**
 * Reads merchant-specific overrides fresh from `policy_rules` every call —
 * deliberately not cached, and deliberately not passed through the LLM.
 * Falls back to the playbook default per rule_type when a merchant hasn't
 * overridden it.
 */
export async function getPolicyRules(merchantId: string, playbook: Playbook, client?: PoolClient): Promise<PolicyRules> {
  const db = client ?? servicePool;
  const { rows } = await db.query<{ rule_type: string; params: Record<string, unknown> }>(
    "select rule_type, params from policy_rules where merchant_id = $1",
    [merchantId]
  );

  const merged: PolicyRules = { ...DEFAULT_POLICY_RULES[playbook] };
  for (const row of rows) {
    switch (row.rule_type) {
      case "max_retry_count":
        merged.max_retry_count = Number(row.params.value);
        break;
      case "min_retry_interval_hours":
        merged.min_retry_interval_hours = Number(row.params.value);
        break;
      case "max_campaign_duration_days":
        merged.max_campaign_duration_days = Number(row.params.value);
        break;
      case "cooldown_hours":
        merged.cooldown_hours = Number(row.params.value);
        break;
      case "amount_cap":
        merged.amount_cap = Number(row.params.value);
        break;
      case "allowed_action_types":
        merged.allowed_action_types = row.params.value as ActionType[];
        break;
    }
  }
  return merged;
}
