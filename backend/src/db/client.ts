import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

// Local Docker Postgres doesn't speak TLS; a real Supabase host (direct
// or pooler) requires it. `rejectUnauthorized: false` skips CA validation
// rather than bundling Supabase's CA chain — acceptable for this build,
// revisit before anything beyond a hackathon/demo depends on it.
function sslFor(connectionString: string) {
  const isLocal = /localhost|127\.0\.0\.1/.test(connectionString);
  return isLocal ? undefined : { rejectUnauthorized: false };
}

// Supabase's free-tier pooler caps concurrent client connections, and we
// open two pools against it. Keeping each modest leaves headroom for the
// dashboard, psql, and the Supabase UI rather than exhausting the quota
// under a burst of webhook traffic. `idleTimeoutMillis` returns idle
// connections to the pooler instead of holding them open indefinitely.
const POOL_TUNING = {
  max: 8,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
};

// The pipeline's own connection — BYPASSRLS, equivalent to a Supabase
// service-role client. This is the only pool that may write.
export const servicePool = new Pool({
  ...POOL_TUNING,
  connectionString: env.serviceDatabaseUrl,
  ssl: sslFor(env.serviceDatabaseUrl),
});

// RLS-enforced connection, for anything simulating a tenant-scoped,
// frontend-facing read (never used for pipeline writes).
export const appPool = new Pool({
  ...POOL_TUNING,
  connectionString: env.appDatabaseUrl,
  ssl: sslFor(env.appDatabaseUrl),
});

// A pool emits 'error' for problems on IDLE clients (e.g. the pooler
// dropping a connection). Without a listener, Node treats it as an
// unhandled 'error' event and crashes the whole backend.
servicePool.on("error", (err) => console.error("[db] idle client error (service pool)", err));
appPool.on("error", (err) => console.error("[db] idle client error (app pool)", err));

/**
 * Run `fn` against the app pool with RLS scoped to one merchant, in a
 * single transaction (SET LOCAL only applies within one). This is the
 * local equivalent of a Supabase request running as an authenticated user.
 */
export async function withMerchantContext<T>(
  merchantId: string,
  fn: (client: pg.PoolClient) => Promise<T>
): Promise<T> {
  const client = await appPool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.current_merchant_id', $1, true)", [merchantId]);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
