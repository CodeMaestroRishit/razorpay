import crypto from "node:crypto";
import type { Request } from "express";
import { env, isProduction } from "../config/env.js";
import { verifyRazorpaySignature } from "./verifySignature.js";

export type AuthResult = { ok: true } | { ok: false; status: number; error: string };

/**
 * Every inbound webhook must prove it is allowed to write, before a single
 * row is inserted or a single token is spent on the LLM.
 *
 * Razorpay events prove it with an HMAC signature over the raw body.
 * Everything else — the "synthetic" path the demo and seed use, which has
 * no provider signature to check — proves it with a shared secret. Without
 * this, `POST /webhooks/synthetic` is an unauthenticated write into an
 * arbitrary tenant (the body carries its own merchant_id) and an
 * unbounded LLM spend, since every accepted event runs the full pipeline.
 */
export function authenticateWebhook(req: Request, provider: string, rawBody: string): AuthResult {
  if (provider === "razorpay") {
    // Refuse to trust provider events at all unless a secret is
    // configured — an unverified "Razorpay" event is just an anonymous one
    // wearing the provider's name.
    if (!env.razorpayWebhookSecret) {
      return isProduction
        ? { ok: false, status: 503, error: "razorpay webhook secret not configured" }
        : { ok: true };
    }
    const signature = req.header("x-razorpay-signature");
    return verifyRazorpaySignature(rawBody, signature, env.razorpayWebhookSecret)
      ? { ok: true }
      : { ok: false, status: 401, error: "invalid webhook signature" };
  }

  // Non-provider ingest.
  if (!env.ingestApiKey) {
    // Fail closed once deployed; stay frictionless for local dev so the
    // seed script and curl testing work without extra setup.
    return isProduction
      ? { ok: false, status: 503, error: "ingest api key not configured" }
      : { ok: true };
  }

  const presented = req.header("x-ingest-key");
  if (!presented || !timingSafeEquals(presented, env.ingestApiKey)) {
    return { ok: false, status: 401, error: "invalid or missing x-ingest-key" };
  }
  return { ok: true };
}

/** Length-independent constant-time compare — timingSafeEqual throws on length mismatch. */
function timingSafeEquals(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a).digest();
  const hb = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}
