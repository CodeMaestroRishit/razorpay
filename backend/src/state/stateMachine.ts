import type { CaseState } from "../types/domain.js";

/**
 * The exact transition table behind §10's mermaid stateDiagram. Encoded
 * as data, not scattered `if` checks, so "is X -> Y a legal transition"
 * is one lookup — this is also what lets an out-of-order webhook be
 * *checked* instead of blindly applied (§4 "Webhook out-of-order arrival").
 */
const TRANSITIONS: Record<CaseState, CaseState[]> = {
  // A case can resolve without the agent ever touching it — the customer
  // simply pays, and the success webhook lands. That's the entire premise
  // of the holdout group (§11), so it has to be a legal transition.
  detected: ["diagnosing", "recovered", "closed_unrecovered"],
  diagnosing: ["recommending"],
  recommending: ["awaiting_approval", "escalated"],
  awaiting_approval: ["contacting", "escalated"],
  contacting: ["recovered", "retry_scheduled", "escalated"],
  // 'recovered' here is the customer paying while a retry is still
  // pending — a success webhook can always land on an open case.
  retry_scheduled: ["contacting", "escalated", "closed_unrecovered", "recovered"],
  recovered: [],
  escalated: ["closed_unrecovered", "recovered"],
  closed_unrecovered: [],
};

export function canTransition(from: CaseState, to: CaseState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export class IllegalTransitionError extends Error {
  constructor(from: CaseState, to: CaseState) {
    super(`illegal case state transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

export function assertTransition(from: CaseState, to: CaseState): void {
  if (!canTransition(from, to)) throw new IllegalTransitionError(from, to);
}
