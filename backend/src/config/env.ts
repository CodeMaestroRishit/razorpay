import "dotenv/config";

// `??` only falls back on null/undefined — an env var present but set to
// "" (e.g. a blank OPENAI_MODEL= line left in .env) is neither, so `??`
// would pass the empty string straight through instead of the default.
// This treats "unset" and "blank" the same, which is what every caller
// below actually wants.
function withDefault(name: string, fallback: string): string {
  const value = process.env[name];
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),

  // Comma-separated allowlist of browser origins permitted to call the
  // API. Empty = permissive (dev). Set this on a deployed backend.
  corsOrigins: (process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  // Service connection: bypasses RLS, used by the pipeline itself.
  serviceDatabaseUrl: withDefault(
    "SERVICE_DATABASE_URL",
    "postgres://recovery_service:recovery_service@localhost:5432/revenue_recovery"
  ),
  // App connection: RLS-enforced, stands in for a Supabase anon-key client.
  appDatabaseUrl: withDefault(
    "APP_DATABASE_URL",
    "postgres://recovery_app:recovery_app@localhost:5432/revenue_recovery"
  ),

  // External services — all optional. Absence means the corresponding
  // adapter falls back to a deterministic mock (see adapters/*.ts and
  // §4/§8/§14 of the architecture doc, which explicitly call this out
  // as the designed degraded-mode behavior, not a hack).
  openaiApiKey: process.env.OPENAI_API_KEY,
  // Overridable since model availability varies by account; see
  // adapters/llm.ts for what this needs to support (structured JSON output
  // via chat.completions.parse + zodResponseFormat).
  openaiModel: withDefault("OPENAI_MODEL", "gpt-5.5"),
  sarvamApiKey: process.env.SARVAM_API_KEY,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
};
