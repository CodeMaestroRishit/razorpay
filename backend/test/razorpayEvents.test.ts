import { describe, it, expect } from "vitest";
import { parseRazorpayEvent } from "../src/webhooks/razorpayEvents.js";
import { verifyRazorpaySignature } from "../src/webhooks/verifySignature.js";
import crypto from "node:crypto";

/** A trimmed but structurally real Razorpay `payment.failed` webhook body. */
function razorpayPayload(overrides: Record<string, unknown> = {}) {
  return {
    entity: "event",
    account_id: "acc_TestAccount123",
    event: "payment.failed",
    contains: ["payment"],
    payload: {
      payment: {
        entity: {
          id: "pay_TestPaymentRef1",
          entity: "payment",
          amount: 150000,
          currency: "INR",
          status: "failed",
          email: "customer@example.com",
          contact: "+919999999999",
          error_code: "BAD_REQUEST_ERROR",
          error_reason: "payment_failed",
          ...overrides,
        },
      },
    },
    created_at: 1234567890,
  };
}

describe("parseRazorpayEvent — the real-shape translation layer", () => {
  it("extracts the fields the pipeline needs from a genuine payment.failed body", () => {
    const parsed = parseRazorpayEvent(razorpayPayload());
    expect(parsed).toEqual({
      eventType: "payment.failed",
      accountId: "acc_TestAccount123",
      gatewayRef: "pay_TestPaymentRef1",
      amount: 150000,
      currency: "INR",
      email: "customer@example.com",
      phone: "+919999999999",
      failureCode: "payment_failed",
    });
  });

  it("falls back to error_code when error_reason is absent", () => {
    const parsed = parseRazorpayEvent(razorpayPayload({ error_reason: undefined }));
    expect(parsed?.failureCode).toBe("BAD_REQUEST_ERROR");
  });

  it("returns null for a body with no payment entity — never throws on a malformed webhook", () => {
    expect(parseRazorpayEvent({ event: "payment.failed", payload: {} })).toBeNull();
    expect(parseRazorpayEvent({})).toBeNull();
    expect(parseRazorpayEvent(null)).toBeNull();
    expect(parseRazorpayEvent("not even an object")).toBeNull();
  });

  it("defaults currency to INR when the field is missing", () => {
    const body = razorpayPayload();
    delete (body.payload.payment.entity as Record<string, unknown>).currency;
    expect(parseRazorpayEvent(body)?.currency).toBe("INR");
  });
});

describe("verifyRazorpaySignature — must use the exact signed bytes", () => {
  const secret = "test-secret";

  it("accepts a signature computed over the exact raw body", () => {
    const raw = JSON.stringify(razorpayPayload());
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyRazorpaySignature(raw, signature, secret)).toBe(true);
  });

  it("rejects when the body has been re-serialized differently than what was signed", () => {
    // This is the exact bug that was in receiver.ts: signing over
    // JSON.stringify(JSON.parse(raw)) instead of the original bytes.
    // Any drift between the two — extra whitespace here — must fail.
    const raw = JSON.stringify(razorpayPayload());
    const reserialized = ` ${raw}`; // simulate a body that isn't byte-identical
    const signature = crypto.createHmac("sha256", secret).update(raw).digest("hex");
    expect(verifyRazorpaySignature(reserialized, signature, secret)).toBe(false);
  });

  it("rejects a missing signature header outright", () => {
    expect(verifyRazorpaySignature("{}", undefined, secret)).toBe(false);
  });

  it("rejects a signature computed with the wrong secret", () => {
    const raw = JSON.stringify(razorpayPayload());
    const signature = crypto.createHmac("sha256", "wrong-secret").update(raw).digest("hex");
    expect(verifyRazorpaySignature(raw, signature, secret)).toBe(false);
  });
});
