import { env } from "../config/env.js";

/**
 * The ONLY code in this codebase that can move money. Called exclusively
 * by pipeline/executor.ts, and only after the guardrail engine has
 * approved an action AND the idempotency check has passed (§5, §13).
 * No RAZORPAY_KEY_ID/SECRET -> logged no-op, exactly as §17 Phase 4
 * specifies for the demo ("Actual SMS/email send can be a logged no-op").
 */
export interface RazorpayAdapter {
  retryPayment(params: { transactionId: string; amount: number; idempotencyKey: string }): Promise<{
    status: "succeeded" | "failed" | "pending";
    gatewayRef: string;
    mocked: boolean;
  }>;
}

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

class LiveRazorpayAdapter implements RazorpayAdapter {
  private authHeader = `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64")}`;

  async retryPayment(params: { transactionId: string; amount: number; idempotencyKey: string }) {
    // Razorpay test-mode API call. Idempotency key is sent as a header so
    // a network retry on our side can't double-charge even if our own
    // idempotency_keys table check somehow raced (belt and suspenders).
    const res = await fetch(`${RAZORPAY_BASE_URL}/payments/${params.transactionId}/capture`, {
      method: "POST",
      headers: {
        Authorization: this.authHeader,
        "X-Idempotency-Key": params.idempotencyKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: params.amount, currency: "INR" }),
    });
    if (!res.ok) {
      return { status: "failed" as const, gatewayRef: params.idempotencyKey, mocked: false };
    }
    const data = (await res.json()) as { status?: string; id?: string };
    const status = data.status === "captured" ? "succeeded" : data.status === "failed" ? "failed" : "pending";
    return { status: status as "succeeded" | "failed" | "pending", gatewayRef: data.id ?? params.idempotencyKey, mocked: false };
  }
}

class MockRazorpayAdapter implements RazorpayAdapter {
  async retryPayment(params: { transactionId: string; amount: number; idempotencyKey: string }) {
    // Deterministic-ish mock: succeed 60% of the time, seeded by the
    // idempotency key so repeated calls with the same key are stable.
    let hash = 0;
    for (const ch of params.idempotencyKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const status = hash % 10 < 6 ? "succeeded" : "failed";
    return { status: status as "succeeded" | "failed", gatewayRef: `mock_${params.idempotencyKey}`, mocked: true };
  }
}

export function createRazorpayAdapter(): RazorpayAdapter {
  return env.razorpayKeyId && env.razorpayKeySecret ? new LiveRazorpayAdapter() : new MockRazorpayAdapter();
}
