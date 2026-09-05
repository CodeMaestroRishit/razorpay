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
  // 'closed_unrecovered' covers a guardrail-approved close_case action,
  // which executes from 'contacting' like any other action.
  contacting: ["recovered", "retry_scheduled", "escalated", "closed_unrecovered"],
  // 'recommending' is §5's "continue" arrow: the sweeper wakes a case
  // whose interval has elapsed and sends it back through the DECISION
  // stage, not straight to acting. There is deliberately no
  // retry_scheduled -> contacting edge: 'contacting' must only ever be
  // reached via 'awaiting_approval', which is to say only after the
  // guardrail has approved this specific attempt. Allowing a case to
  // re-enter 'contacting' directly would let a second action run on a
  // stale approval.
  // 'recovered' here is the customer paying while a retry is still
  // pending — a success webhook can always land on an open case.
  retry_scheduled: ["recommending", "escalated", "closed_unrecovered", "recovered"],
  recovered: [],
  escalated: ["closed_unrecovered", "recovered"],
  closed_unrecovered: [],
};

/** Every state, derived from the transition table so the two cannot drift. */
export const ALL_STATES = Object.keys(TRANSITIONS) as CaseState[];

export function canTransition(from: CaseState, to: CaseState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

/** The states from which `to` is reachable in one step. */
export function statesThatCanReach(to: CaseState): CaseState[] {
  return ALL_STATES.filter((from) => canTransition(from, to));
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
