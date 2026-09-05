import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, IllegalTransitionError, ALL_STATES } from "../src/state/stateMachine.js";

describe("case state machine (§10)", () => {
  it("allows the documented happy path", () => {
    expect(canTransition("detected", "diagnosing")).toBe(true);
    expect(canTransition("diagnosing", "recommending")).toBe(true);
    expect(canTransition("recommending", "awaiting_approval")).toBe(true);
    expect(canTransition("awaiting_approval", "contacting")).toBe(true);
    expect(canTransition("contacting", "recovered")).toBe(true);
  });

  it("rejects skipping into a mid-pipeline stage", () => {
    expect(canTransition("detected", "contacting")).toBe(false);
    expect(canTransition("detected", "recommending")).toBe(false);
    expect(canTransition("diagnosing", "contacting")).toBe(false);
  });

  it("allows a detected case to resolve without agent involvement — the holdout group's only path to recovery (§11)", () => {
    expect(canTransition("detected", "recovered")).toBe(true);
  });

  it("rejects any transition out of a terminal state — this is what catches an out-of-order webhook (§4)", () => {
    expect(canTransition("recovered", "contacting")).toBe(false);
    expect(canTransition("closed_unrecovered", "diagnosing")).toBe(false);
  });

  it("assertTransition throws IllegalTransitionError on an illegal move", () => {
    expect(() => assertTransition("recovered", "contacting")).toThrow(IllegalTransitionError);
  });

  it("loops a scheduled retry back through the DECISION stage, not straight to acting", () => {
    // §5's "continue" arrow. The sweeper wakes the case and it must be
    // re-decided — fresh facts, fresh guardrail evaluation.
    expect(canTransition("retry_scheduled", "recommending")).toBe(true);
  });

  it("never lets a case reach 'contacting' except via guardrail approval", () => {
    // 'awaiting_approval' is the state the guardrail's approval produces,
    // so it must be the ONLY way into 'contacting'. Any other edge would
    // let a second action execute on a stale approval — an action taken
    // without a matching, current authorization.
    const entryPoints = ALL_STATES.filter((s) => canTransition(s, "contacting"));
    expect(entryPoints).toEqual(["awaiting_approval"]);
  });
});
