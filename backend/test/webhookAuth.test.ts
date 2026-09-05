import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import crypto from "node:crypto";
import type { Request } from "express";

/**
 * These pin the fix for a genuine, verified hole: before it,
 * `POST /webhooks/synthetic` required no credential at all. On a public
 * URL that meant anyone could inject revenue events into ANY tenant
 * (the body carries its own merchant_id) and, because every accepted
 * event runs the full pipeline, burn unbounded LLM spend doing it.
 * Confirmed by injecting a fake 9,99,999 paise event into a real
 * merchant's tenant against the running server.
 */

function fakeRequest(headers: Record<string, string> = {}): Request {
  return {
    header: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

/** env.ts snapshots process.env at import, so each config needs a fresh module. */
async function loadAuth(env: Record<string, string | undefined>) {
  vi.resetModules();
  const saved = { ...process.env };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  const mod = await import("../src/webhooks/auth.js");
  process.env = saved;
  return mod;
}

describe("webhook auth: the synthetic ingest path", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("refuses an unauthenticated synthetic event in production", async () => {
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      INGEST_API_KEY: "the-real-key",
    });
    const result = authenticateWebhook(fakeRequest(), "synthetic", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("refuses a synthetic event presenting the WRONG key", async () => {
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      INGEST_API_KEY: "the-real-key",
    });
    const result = authenticateWebhook(fakeRequest({ "x-ingest-key": "guessed" }), "synthetic", "{}");
    expect(result.ok).toBe(false);
  });

  it("accepts a synthetic event with the correct key", async () => {
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      INGEST_API_KEY: "the-real-key",
    });
    expect(authenticateWebhook(fakeRequest({ "x-ingest-key": "the-real-key" }), "synthetic", "{}").ok).toBe(true);
  });

  it("fails CLOSED in production when no ingest key is configured at all", async () => {
    // The dangerous default: a deployed service with the variable simply
    // forgotten must refuse, not silently accept everything.
    const { authenticateWebhook } = await loadAuth({ NODE_ENV: "production", INGEST_API_KEY: undefined });
    const result = authenticateWebhook(fakeRequest(), "synthetic", "{}");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("stays open in local dev so the seed script and curl testing work", async () => {
    const { authenticateWebhook } = await loadAuth({ NODE_ENV: "development", INGEST_API_KEY: undefined });
    expect(authenticateWebhook(fakeRequest(), "synthetic", "{}").ok).toBe(true);
  });
});

describe("webhook auth: the Razorpay path", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const secret = "whsec_test";
  const body = JSON.stringify({ event: "payment.failed" });
  const goodSig = crypto.createHmac("sha256", secret).update(body).digest("hex");

  it("accepts a correctly signed provider event", async () => {
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      RAZORPAY_WEBHOOK_SECRET: secret,
    });
    expect(authenticateWebhook(fakeRequest({ "x-razorpay-signature": goodSig }), "razorpay", body).ok).toBe(true);
  });

  it("rejects a forged signature", async () => {
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      RAZORPAY_WEBHOOK_SECRET: secret,
    });
    const result = authenticateWebhook(fakeRequest({ "x-razorpay-signature": "deadbeef" }), "razorpay", body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("rejects a provider event with no signature at all", async () => {
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      RAZORPAY_WEBHOOK_SECRET: secret,
    });
    expect(authenticateWebhook(fakeRequest(), "razorpay", body).ok).toBe(false);
  });

  it("refuses provider events in production when no secret is configured", async () => {
    // An unverified event claiming to be from Razorpay is just an
    // anonymous one wearing the provider's name.
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      RAZORPAY_WEBHOOK_SECRET: undefined,
    });
    const result = authenticateWebhook(fakeRequest(), "razorpay", body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(503);
  });

  it("cannot be bypassed by choosing a different provider name", async () => {
    // Guards against "razorpay is signature-checked, so I'll POST to
    // /webhooks/razorpayx instead" — anything not exactly "razorpay"
    // falls to the ingest-key path, which is also authenticated.
    const { authenticateWebhook } = await loadAuth({
      NODE_ENV: "production",
      INGEST_API_KEY: "the-real-key",
      RAZORPAY_WEBHOOK_SECRET: secret,
    });
    for (const provider of ["razorpayx", "RAZORPAY", "razorpay ", "synthetic", "anything"]) {
      expect(authenticateWebhook(fakeRequest(), provider, body).ok).toBe(false);
    }
  });
});
