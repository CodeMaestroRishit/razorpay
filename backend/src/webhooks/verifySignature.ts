import crypto from "node:crypto";

/**
 * Razorpay webhook signature check (§13: "before it's trusted enough to
 * become a revenue_risk_events row"). Without RAZORPAY_WEBHOOK_SECRET set
 * (dev/demo mode), verification is skipped and the caller must mark the
 * event as `provider: "synthetic"` — real provider webhooks are refused
 * once a secret is configured.
 */
export function verifyRazorpaySignature(rawBody: string, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
