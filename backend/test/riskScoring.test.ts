import { describe, it, expect } from "vitest";
import { scoreRisk } from "../src/pipeline/riskScoring.js";
import type { RevenueRiskEvent } from "../src/types/domain.js";

function event(type: RevenueRiskEvent["type"]): RevenueRiskEvent {
  return {
    id: "evt-1",
    merchant_id: "m-1",
    type,
    transaction_id: null,
    invoice_id: null,
    customer_id: "c-1",
    payload: {},
    detected_at: new Date().toISOString(),
  };
}

describe("deterministic risk scoring (§9: same inputs always produce the same segment)", () => {
  it("is deterministic — identical inputs always produce identical output", () => {
    const a = scoreRisk(event("payment_failed"), { amount: 10000, failureCode: "bank_decline", retryCount: 1 });
    const b = scoreRisk(event("payment_failed"), { amount: 10000, failureCode: "bank_decline", retryCount: 1 });
    expect(a).toEqual(b);
  });

  it("caps the score at 1 even with many stacked factors", () => {
    const result = scoreRisk(event("payment_failed"), { amount: 10000, failureCode: "bank_decline", retryCount: 10 });
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("scores a broken promise-to-pay higher than a fresh customer response", () => {
    const broken = scoreRisk(event("promise_to_pay_broken"), { amount: 10000 });
    const responded = scoreRisk(event("customer_responded"), { amount: 10000 });
    expect(broken.score).toBeGreaterThan(responded.score);
  });
});
