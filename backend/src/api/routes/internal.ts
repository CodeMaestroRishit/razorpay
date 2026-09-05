import { Router } from "express";
import { sweepDueCases } from "../../pipeline/sweeper.js";
import { env, isProduction } from "../../config/env.js";

export const internalRouter = Router();

/**
 * Drives §5's "continue" branch: resumes cases whose retry interval or
 * cooldown has elapsed, and converts overdue promises-to-pay into broken
 * -promise events.
 *
 * Exposed as an endpoint rather than an in-process timer so a scheduler
 * owns the cadence (a Render Cron Job hitting this on a schedule), it
 * doesn't fire once per replica, and it can be triggered on demand in a
 * demo. Authenticated with the same ingest key as the synthetic webhook
 * path — this endpoint spends money (model calls, real recovery actions),
 * so it must never be openly callable.
 */
internalRouter.post("/sweep", async (req, res, next) => {
  try {
    if (env.ingestApiKey) {
      if (req.header("x-ingest-key") !== env.ingestApiKey) {
        return res.status(401).json({ error: "invalid or missing x-ingest-key" });
      }
    } else if (isProduction) {
      return res.status(503).json({ error: "ingest api key not configured" });
    }

    // Bounded per invocation: each resumed case costs a model call, so an
    // unbounded sweep is an unbounded bill. The scheduler's cadence, not
    // the batch size, is what sets throughput.
    const limitParam = Number(req.query.limit);
    const limit = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, 100) : 25;

    const result = await sweepDueCases({ limit });
    res.json(result);
  } catch (err) {
    next(err);
  }
});
