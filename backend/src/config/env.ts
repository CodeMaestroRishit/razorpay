import "dotenv/config";

function required(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),

  // Service connection: bypasses RLS, used by the pipeline itself.
  serviceDatabaseUrl: required(
    "SERVICE_DATABASE_URL",
    "postgres://recovery_service:recovery_service@localhost:5432/revenue_recovery"
  ),
  // App connection: RLS-enforced, stands in for a Supabase anon-key client.
  appDatabaseUrl: required(
    "APP_DATABASE_URL",
    "postgres://recovery_app:recovery_app@localhost:5432/revenue_recovery"
  ),

  // External services — all optional. Absence means the corresponding
  // adapter falls back to a deterministic mock (see adapters/*.ts and
  // §4/§8/§14 of the architecture doc, which explicitly call this out
  // as the designed degraded-mode behavior, not a hack).
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  sarvamApiKey: process.env.SARVAM_API_KEY,
  razorpayKeyId: process.env.RAZORPAY_KEY_ID,
  razorpayKeySecret: process.env.RAZORPAY_KEY_SECRET,
  razorpayWebhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
};
