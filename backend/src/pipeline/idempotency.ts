import type { PoolClient } from "pg";
import crypto from "node:crypto";

/**
 * The step between "guardrail said yes" and "safe to actually call the
 * API right now" (§5's one addition to the original loop). Two different
 * questions: guardrail asks "should this happen"; this asks "has this
 * already happened". Collapsing them causes duplicate charges/messages.
 *
 * Caller generates the key deterministically from stable inputs (case +
 * action + a coarse time bucket) so a retried pipeline run for the same
 * logical action reuses the same key instead of minting a new one.
 */
export function buildIdempotencyKey(params: { caseId: string; actionType: string; bucket?: string }): string {
  const bucket = params.bucket ?? new Date().toISOString().slice(0, 13); // hour bucket
  return crypto.createHash("sha256").update(`${params.caseId}:${params.actionType}:${bucket}`).digest("hex");
}

/**
 * Atomically claims a key. Returns false if it was already used — the
 * caller must then skip execution entirely, not retry (§4 "Recovery
 * action executed twice": prevented at the source, not caught after).
 */
export async function claimIdempotencyKey(client: PoolClient, key: string, actionType: string): Promise<boolean> {
  const { rowCount } = await client.query(
    `insert into idempotency_keys (key, action_type) values ($1, $2)
     on conflict (key) do nothing`,
    [key, actionType]
  );
  return (rowCount ?? 0) > 0;
}
