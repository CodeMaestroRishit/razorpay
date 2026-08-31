import { describe, it, expect } from "vitest";
import { createRazorpayAdapter } from "../src/adapters/razorpay.js";

/**
 * Deliberately uses only synthetic references (never `pay_...`), so these
 * assertions hold identically whether or not real Razorpay keys are
 * present in the environment — and so the suite never makes a network
 * call. That routing is itself the behavior under test: seeded demo data
 * must not reach the live payments API.
 */
const adapter = createRazorpayAdapter();

describe("razorpay adapter", () => {
  it("routes a synthetic reference to the mock even when live keys are configured", async () => {
    const result = await adapter.retryPayment({
      gatewayRef: "tx_synthetic_seed_001",
      amount: 1000,
      idempotencyKey: "k0",
    });
    expect(result.mocked).toBe(true);
  });

  it("refuses to retry when there is no payment reference, rather than faking a success", async () => {
    const result = await adapter.retryPayment({ gatewayRef: null, amount: 1000, idempotencyKey: "k1" });
    expect(result.status).toBe("failed");
    expect(result.detail).toMatch(/no payment reference/);
  });

  it("is deterministic in the idempotency key — the same logical retry always yields the same outcome", async () => {
    const params = { gatewayRef: "tx_synthetic_seed_002", amount: 1000, idempotencyKey: "stable-key" };
    const a = await adapter.retryPayment(params);
    const b = await adapter.retryPayment(params);
    expect(a.status).toBe(b.status);
    expect(a.gatewayRef).toBe(b.gatewayRef);
  });

  it("returns a well-formed outcome for every call", async () => {
    const result = await adapter.retryPayment({
      gatewayRef: "tx_synthetic_seed_003",
      amount: 500,
      idempotencyKey: "k2",
    });
    expect(["succeeded", "failed", "pending"]).toContain(result.status);
    expect(typeof result.gatewayRef).toBe("string");
  });
});
