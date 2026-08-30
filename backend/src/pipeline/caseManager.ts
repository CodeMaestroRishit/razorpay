import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";
import type { CaseContext, CaseState, Playbook, RevenueRiskEvent } from "../types/domain.js";
import { assertTransition, canTransition } from "../state/stateMachine.js";
import { assignHoldout } from "./holdout.js";

export function playbookForEvent(eventType: RevenueRiskEvent["type"]): Playbook {
  switch (eventType) {
    case "payment_failed":
    case "promise_to_pay_broken":
    case "customer_responded":
      return "failed_subscription";
    case "checkout_abandoned":
      return "checkout_abandonment";
    case "invoice_overdue":
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

  const { rows } = await db.query<{ id: string; opened_at: string }>(
    `insert into recovery_cases (event_id, merchant_id, customer_id, playbook, state, holdout)
     values ($1, $2, $3, $4, 'detected', $5)
     returning id, opened_at`,
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
  };
}

export async function transitionCase(caseId: string, from: CaseState, to: CaseState, client?: PoolClient): Promise<void> {
  assertTransition(from, to);
  const db = client ?? servicePool;
  const closedAt = to === "recovered" || to === "closed_unrecovered" ? ", closed_at = now()" : "";
  await db.query(`update recovery_cases set state = $1${closedAt} where id = $2 and state = $3`, [to, caseId, from]);
}

/**
 * A payment success observed from outside the agent loop — the customer
 * simply paid. Applies to treated and holdout cases alike; for holdout
 * cases this is the ONLY way they can reach 'recovered', which is what
 * makes the §11 baseline a real measurement rather than a hardcoded zero.
 */
export async function observeExternalRecovery(caseId: string, client?: PoolClient): Promise<boolean> {
  const db = client ?? servicePool;
  const { rows } = await db.query<{ state: CaseState }>("select state from recovery_cases where id = $1", [caseId]);
  const current = rows[0]?.state;
  if (!current || !canTransition(current, "recovered")) return false;
  await transitionCase(caseId, current, "recovered", client);
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

export function campaignAgeDays(openedAt: string): number {
  return (Date.now() - new Date(openedAt).getTime()) / (1000 * 3600 * 24);
}
