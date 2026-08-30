import { describe, it, expect } from "vitest";
import { canTransition, assertTransition, IllegalTransitionError } from "../src/state/stateMachine.js";

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

  it("allows retry_scheduled to loop back to contacting", () => {
    expect(canTransition("retry_scheduled", "contacting")).toBe(true);
  });
});
