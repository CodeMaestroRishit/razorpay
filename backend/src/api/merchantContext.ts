import type { Request } from "express";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the tenant for a request. Stands in for what a real auth layer
 * would derive from a session — see README "known gaps".
 *
 * Validating the shape here matters beyond tidiness: an unvalidated value
 * reaches Postgres as a uuid cast, and a malformed one raises a database
 * error that surfaces as a 500 with internal query detail attached,
 * rather than the 400 it actually is.
 */
export function requireMerchantId(req: Request): string {
  const merchantId = req.header("x-merchant-id");
  if (!merchantId) {
    throw Object.assign(new Error("x-merchant-id header required"), { status: 400 });
  }
  if (!UUID_RE.test(merchantId)) {
    throw Object.assign(new Error("x-merchant-id must be a valid UUID"), { status: 400 });
  }
  return merchantId;
}
