import { env } from "../config/env.js";

/**
 * The ONLY code in this codebase that can move money. Called exclusively
 * by pipeline/executor.ts, and only after the guardrail engine has
 * approved an action AND the idempotency check has passed (§5, §13).
 * No RAZORPAY_KEY_ID/SECRET -> logged no-op, exactly as §17 Phase 4
 * specifies for the demo ("Actual SMS/email send can be a logged no-op").
 */
export interface RetryPaymentParams {
  /** Razorpay's own payment reference (`pay_...`), or null if none exists. */
  gatewayRef: string | null;
  amount: number;
  idempotencyKey: string;
}

export interface RetryPaymentResult {
  status: "succeeded" | "failed" | "pending";
  gatewayRef: string;
  mocked: boolean;
  /** Populated on failure so the audit trail records why, not just that. */
  detail?: string;
}

export interface RazorpayAdapter {
  retryPayment(params: RetryPaymentParams): Promise<RetryPaymentResult>;
}

const RAZORPAY_BASE_URL = "https://api.razorpay.com/v1";

/** Razorpay payment ids look like `pay_XXXXXXXXXXXX`. Synthetic seed data does not. */
function isRealGatewayRef(ref: string | null): ref is string {
  return typeof ref === "string" && ref.startsWith("pay_");
}

class LiveRazorpayAdapter implements RazorpayAdapter {
  private authHeader = `Basic ${Buffer.from(`${env.razorpayKeyId}:${env.razorpayKeySecret}`).toString("base64")}`;
  private fallback = new MockRazorpayAdapter();

  async retryPayment(params: RetryPaymentParams): Promise<RetryPaymentResult> {
    // Seeded/demo cases carry synthetic references that don't exist in
    // Razorpay. Calling the real API with one would 4xx every time and
    // make the whole demo look broken the moment test keys are added, so
    // those fall through to the mock. Real `pay_...` references — the ones
    // an actual Razorpay webhook delivers — go to the live API.
    if (!isRealGatewayRef(params.gatewayRef)) {
      return this.fallback.retryPayment(params);
    }

    try {
      const res = await fetch(`${RAZORPAY_BASE_URL}/payments/${params.gatewayRef}/capture`, {
        method: "POST",
        headers: {
          Authorization: this.authHeader,
          // Idempotency at the provider too, so a network-level retry on
          // our side can't double-charge even if our own key check raced.
          "X-Idempotency-Key": params.idempotencyKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ amount: params.amount, currency: "INR" }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        id?: string;
        error?: { description?: string };
      };

      if (!res.ok) {
        return {
          status: "failed",
          gatewayRef: params.gatewayRef,
          mocked: false,
          detail: data.error?.description ?? `HTTP ${res.status}`,
        };
      }

      const status =
        data.status === "captured" ? "succeeded" : data.status === "failed" ? "failed" : "pending";
      return { status, gatewayRef: data.id ?? params.gatewayRef, mocked: false };
    } catch (err) {
      // §4 "Payment gateway timeout": a network failure is an UNKNOWN
      // outcome, not a failed payment. Reporting 'pending' keeps the case
      // open for reconciliation rather than declaring a charge dead that
      // may in fact have gone through.
      return {
        status: "pending",
        gatewayRef: params.gatewayRef,
        mocked: false,
        detail: `network error, outcome unknown: ${String(err)}`,
      };
    }
  }
}

class MockRazorpayAdapter implements RazorpayAdapter {
  async retryPayment(params: RetryPaymentParams): Promise<RetryPaymentResult> {
    if (!params.gatewayRef) {
      // No underlying payment to retry (abandoned checkout / overdue
      // invoice). Honest failure rather than a fake success.
      return { status: "failed", gatewayRef: "none", mocked: true, detail: "no payment reference to retry" };
    }
    // Deterministic in the idempotency key: repeating the same logical
    // retry yields the same outcome, so reruns are reproducible.
    let hash = 0;
    for (const ch of params.idempotencyKey) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const status = hash % 10 < 6 ? "succeeded" : "failed";
    return { status, gatewayRef: `mock_${params.gatewayRef}`, mocked: true };
  }
}

export function createRazorpayAdapter(): RazorpayAdapter {
  return env.razorpayKeyId && env.razorpayKeySecret ? new LiveRazorpayAdapter() : new MockRazorpayAdapter();
}
