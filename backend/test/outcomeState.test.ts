import { describe, it, expect } from "vitest";
import { outcomeStateFor } from "../src/pipeline/pipeline.js";
import { canTransition } from "../src/state/stateMachine.js";
import type { ActionType } from "../src/types/domain.js";

const ran = (detail: Record<string, unknown> = {}) => ({ executed: true, detail });
const didNotRun = (detail: Record<string, unknown> = {}) => ({ executed: false, detail });

describe("outcomeStateFor: where a case lands after an action", () => {
  it("counts a confirmed capture as recovered", () => {
    expect(outcomeStateFor("retry_payment", ran({ status: "succeeded" }))).toBe("recovered");
  });

  it("does NOT count a failed retry as recovered", () => {
    expect(outcomeStateFor("retry_payment", ran({ status: "failed" }))).toBe("retry_scheduled");
  });

  it("does NOT count a PENDING retry as recovered — an unknown outcome is not a success (§4)", () => {
    // A gateway timeout returns 'pending'. Treating that as recovery would
    // book revenue that may never have moved.
    expect(outcomeStateFor("retry_payment", ran({ status: "pending" }))).toBe("retry_scheduled");
  });

  it("does not advance a case when the action was deduped and never actually ran", () => {
    // The loophole this pins: executeAction returns executed:false when the
    // idempotency key was already claimed. Previously the pipeline ignored
    // that flag and moved the case on as though the action had happened —
    // so a suppressed duplicate still looked like real work in the audit
    // trail, and a retry_payment could even be scored as 'recovered'.
    expect(outcomeStateFor("retry_payment", didNotRun({ status: "succeeded" }))).toBe("retry_scheduled");
    expect(outcomeStateFor("escalate_to_human", didNotRun())).toBe("retry_scheduled");
    expect(outcomeStateFor("close_case", didNotRun())).toBe("retry_scheduled");
  });

  it("maps close_case to a closed state rather than silently contradicting the DB", () => {
    // Previously the executor wrote state='closed_unrecovered' directly
    // while the pipeline separately transitioned to 'retry_scheduled' —
    // two writers, one row, disagreeing.
    expect(outcomeStateFor("close_case", ran())).toBe("closed_unrecovered");
  });

  it("maps escalation to escalated", () => {
    expect(outcomeStateFor("escalate_to_human", ran())).toBe("escalated");
  });

  it("every outcome it can produce is a legal transition from 'contacting'", () => {
    // The pipeline always executes from 'contacting'. If this mapping can
    // name a state the machine won't accept, the run dies at the final
    // transition with the action already performed — the worst possible
    // moment to fail.
    const actions: ActionType[] = [
      "retry_payment",
      "send_message",
      "schedule_retry",
      "escalate_to_human",
      "close_case",
    ];
    const executions = [ran({ status: "succeeded" }), ran({ status: "failed" }), ran(), didNotRun()];
    for (const action of actions) {
      for (const execution of executions) {
        const outcome = outcomeStateFor(action, execution);
        expect(
          canTransition("contacting", outcome),
          `contacting -> ${outcome} (from ${action}, executed=${execution.executed}) must be legal`
        ).toBe(true);
      }
    }
  });
});
