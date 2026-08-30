import pg from "pg";
import { env } from "../config/env.js";

const { Pool } = pg;

// The pipeline's own connection — BYPASSRLS, equivalent to a Supabase
// service-role client. This is the only pool that may write.
export const servicePool = new Pool({ connectionString: env.serviceDatabaseUrl });

// RLS-enforced connection, for anything simulating a tenant-scoped,
// frontend-facing read (never used for pipeline writes).
export const appPool = new Pool({ connectionString: env.appDatabaseUrl });

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
