import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import type { CaseContext, CaseState, Playbook, RevenueRiskEvent } from "../types/domain.js";
import { assertTransition, statesThatCanReach } from "../state/stateMachine.js";
import { assignHoldout } from "./holdout.js";
import { recordExperimentOutcome } from "./measurement.js";

export function playbookForEvent(eventType: RevenueRiskEvent["type"]): Playbook {
  switch (eventType) {
    case "payment_failed":
    case "customer_responded":
      return "failed_subscription";
    case "checkout_abandoned":
      return "checkout_abandonment";
    case "invoice_overdue":
    // A promise to pay is something only the B2B receivables playbook
    // ever collects (§10), so a broken one must be worked under B2B
    // rules — 72h spacing, email only, escalate after two. Routing it to
    // failed_subscription would have applied 24h spacing and, worse,
    // permitted `retry_payment` against an invoice that has no card
    // mandate behind it.
    case "promise_to_pay_broken":
      return "b2b_receivables";
  }
}

export async function openCase(
  event: RevenueRiskEvent,
  originalAmount: number,
  client?: PoolClient
): Promise<CaseContext> {
  const db = client ?? servicePool;
  const playbook = playbookForEvent(event.type);
  const holdout = assignHoldout(event.id);

  // Resolve the provider's payment reference in the same statement that
  // opens the case — a retry must be issued against `gateway_ref`, never
  // against an internal id.
  const { rows } = await db.query<{ id: string; opened_at: string; gateway_ref: string | null }>(
    `with new_case as (
       insert into recovery_cases (event_id, merchant_id, customer_id, playbook, state, holdout)
       values ($1, $2, $3, $4, 'detected', $5)
       returning id, opened_at, event_id
     )
     select nc.id, nc.opened_at, t.gateway_ref
       from new_case nc
       join revenue_risk_events rre on rre.id = nc.event_id
       left join transactions t on t.id = rre.transaction_id`,
    [event.id, event.merchant_id, event.customer_id, playbook, holdout]
  );

  return {
    case_id: rows[0].id,
    merchant_id: event.merchant_id,
    playbook,
    state: "detected",
    holdout,
    retry_count: 0,
    opened_at: rows[0].opened_at,
    original_amount: originalAmount,
    gateway_ref: rows[0].gateway_ref,
  };
}

export class ConcurrentModificationError extends Error {
  constructor(caseId: string, from: CaseState, to: CaseState) {
    super(
      `case ${caseId} was not in expected state '${from}' when transitioning to '${to}' — ` +
        `another process modified it concurrently`
    );
    this.name = "ConcurrentModificationError";
  }
}

/**
 * Moves a case between states, guarded two ways: `assertTransition`
 * rejects an illegal edge, and the `and state = $3` predicate makes the
 * write optimistic-concurrency safe.
 *
 * The rowCount check is the part that matters. Without it a lost race is
 * indistinguishable from success: the UPDATE quietly matches zero rows,
 * the caller believes the case moved, and every later decision is made
 * against a state the database does not agree with. Failing loudly here
 * is what keeps the state machine a real invariant rather than an
 * intention.
 */
export async function transitionCase(
  caseId: string,
  from: CaseState,
  to: CaseState,
  client?: PoolClient
): Promise<void> {
  assertTransition(from, to);
  const db = client ?? servicePool;
  const closedAt = to === "recovered" || to === "closed_unrecovered" ? ", closed_at = now()" : "";
  const { rowCount } = await db.query(
    `update recovery_cases set state = $1${closedAt} where id = $2 and state = $3`,
    [to, caseId, from]
  );
  if (rowCount === 0) throw new ConcurrentModificationError(caseId, from, to);
}

/**
 * A payment success observed from outside the agent loop — the customer
 * simply paid. Applies to treated and holdout cases alike; for holdout
 * cases this is the ONLY way they can reach 'recovered', which is what
 * makes the §11 baseline a real measurement rather than a hardcoded zero.
 *
 * The state change is a single conditional UPDATE rather than
 * read-then-write: two success webhooks for the same payment can arrive
 * together, and a read-then-write would let both proceed and record the
 * recovery twice — inflating the very number §11 exists to keep honest.
 * Exactly one caller wins the UPDATE, and only that one records.
 */
export async function observeExternalRecovery(caseId: string, client?: PoolClient): Promise<boolean> {
  const db = client ?? servicePool;
  const recoverableFrom = statesThatCanReach("recovered");

  const { rowCount } = await db.query(
    `update recovery_cases set state = 'recovered', closed_at = now()
      where id = $1 and state = any($2::text[])`,
    [caseId, recoverableFrom]
  );
  if (rowCount === 0) return false;

  await recordExperimentOutcome(caseId);
  return true;
}

export async function getRetryCount(caseId: string, client?: PoolClient): Promise<number> {
  const db = client ?? servicePool;
  const { rows } = await db.query<{ count: string }>(
    `select count(*)::int as count from recovery_actions where case_id = $1 and action_type = 'retry_payment' and status in ('executed', 'failed')`,
    [caseId]
  );
  return Number(rows[0]?.count ?? 0);
}
