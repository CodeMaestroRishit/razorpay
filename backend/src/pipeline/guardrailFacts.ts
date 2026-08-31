import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import type { CaseContext, Channel, GuardrailFacts } from "../types/domain.js";

/**
 * Gathers every fact `evaluateGuardrail` needs, in ONE round trip.
 *
 * This used to be three separate queries issued from three places
 * (policy lookup, retry count, cooldown) plus a customer fetch later in
 * the pipeline. Against a local Docker Postgres that was invisible;
 * against Supabase over the network each round trip is real latency, and
 * the pipeline runs this per event.
 *
 * Correctness note: all of these must be read fresh, never cached — §4
 * "Merchant config changes mid-campaign" requires that a merchant
 * lowering their retry limit takes effect on the very next decision.
 */
export async function gatherGuardrailFacts(
  caseCtx: CaseContext,
  channel: Channel | undefined,
  client?: PoolClient
): Promise<GuardrailFacts> {
  const db = client ?? servicePool;

  const { rows } = await db.query<{
    cooldown_until: string | null;
    last_retry_at: string | null;
    actions_taken: string;
    contact_opt_out: boolean | null;
    phone: string | null;
    email: string | null;
    root_cause: string | null;
    opened_at: string;
  }>(
    `select
       (select ca.cooldown_until
          from communication_attempts ca
         where ca.case_id = c.id and ca.channel = $2
         order by ca.sent_at desc limit 1)                          as cooldown_until,
       (select max(ra.created_at)
          from recovery_actions ra
         where ra.case_id = c.id
           and ra.action_type = 'retry_payment'
           and ra.status in ('executed', 'failed'))                 as last_retry_at,
       (select count(*)
          from recovery_actions ra
         where ra.case_id = c.id and ra.status in ('executed', 'failed'))::text as actions_taken,
       cust.contact_opt_out,
       cust.phone,
       cust.email,
       (select rca.cause
          from root_cause_analysis rca
         where rca.event_id = c.event_id
         order by rca.created_at desc limit 1)                      as root_cause,
       c.opened_at
     from recovery_cases c
     join customers cust on cust.id = c.customer_id
     where c.id = $1`,
    [caseCtx.case_id, channel ?? null]
  );

  const row = rows[0];
  const now = new Date();

  if (!row) {
    // Fail closed: with no facts we cannot prove an action is safe, so
    // report the most restrictive world we can — an exhausted, opted-out,
    // unreachable case. Every contact rule then rejects.
    return {
      now,
      cooldownActiveUntil: null,
      lastRetryAt: null,
      campaignAgeDays: Number.POSITIVE_INFINITY,
      actionsTakenOnCase: Number.MAX_SAFE_INTEGER,
      customerOptedOut: true,
      reachableChannels: [],
      rootCause: null,
    };
  }

  const reachableChannels: Channel[] = [];
  if (row.email) reachableChannels.push("email");
  if (row.phone) reachableChannels.push("sms", "whatsapp", "voice");

  return {
    now,
    cooldownActiveUntil: row.cooldown_until ? new Date(row.cooldown_until) : null,
    lastRetryAt: row.last_retry_at ? new Date(row.last_retry_at) : null,
    campaignAgeDays: (now.getTime() - new Date(row.opened_at).getTime()) / 86_400_000,
    actionsTakenOnCase: Number(row.actions_taken),
    customerOptedOut: row.contact_opt_out ?? false,
    reachableChannels,
    rootCause: row.root_cause,
  };
}
