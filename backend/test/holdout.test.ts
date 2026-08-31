import { describe, it, expect } from "vitest";
import { assignHoldout } from "../src/pipeline/holdout.js";
import { scoreRisk } from "../src/pipeline/riskScoring.js";

describe("holdout assignment (§11)", () => {
  it("is deterministic — reprocessing the same event never flips its group", () => {
    // If this were Math.random(), a replayed event could move between arms
    // and silently corrupt the incrementality measurement.
    const id = "3f2504e0-4f89-11d3-9a0c-0305e82c3301";
    const first = assignHoldout(id);
    for (let i = 0; i < 50; i++) expect(assignHoldout(id)).toBe(first);
  });

  it("splits roughly at the intended 20% rate over a large sample", () => {
    let holdout = 0;
    const n = 5000;
    for (let i = 0; i < n; i++) {
      if (assignHoldout(`00000000-0000-0000-0000-${String(i).padStart(12, "0")}`)) holdout++;
    }
    const rate = holdout / n;
    // Wide band: this asserts "the split is real and roughly right",
    // not an exact constant that would make the test brittle.
    expect(rate).toBeGreaterThan(0.15);
    expect(rate).toBeLessThan(0.25);
  });

  it("assigns different events independently rather than in blocks", () => {
    const ids = Array.from({ length: 200 }, (_, i) => `evt-${i}`);
    const assignments = ids.map(assignHoldout);
    expect(assignments.some(Boolean)).toBe(true);
    expect(assignments.some((a) => !a)).toBe(true);
  });
});

describe("risk scoring stays bounded", () => {
  it("never exceeds 1 regardless of how many factors stack", () => {
    const event = {
      id: "e",
      merchant_id: "m",
      type: "payment_failed" as const,
      transaction_id: null,
      invoice_id: null,
      customer_id: null,
      payload: {},
      detected_at: new Date().toISOString(),
    };
    const result = scoreRisk(event, { amount: 999999999, failureCode: "bank_decline", retryCount: 1000 });
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
  });
});
