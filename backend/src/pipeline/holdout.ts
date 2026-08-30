import crypto from "node:crypto";

/**
 * §11: a fixed percentage of at-risk cases get NO agent intervention, so
 * "recovered anyway" can be measured instead of asserted. Deterministic
 * (hash of the event id) so re-running detection on the same event always
 * assigns the same group — never a `Math.random()` call, which would let
 * the same case flip groups across a reprocessing run.
 */
const HOLDOUT_RATE = 0.2;

export function assignHoldout(eventId: string): boolean {
  const hash = crypto.createHash("sha256").update(eventId).digest();
  const bucket = hash.readUInt32BE(0) / 0xffffffff; // uniform in [0, 1)
  return bucket < HOLDOUT_RATE;
}
