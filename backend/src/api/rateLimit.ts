import type { Request, Response, NextFunction } from "express";

/**
 * Per-IP fixed-window rate limiter (§13: "rate limiting on the AI-facing
 * endpoints — cheap to add, and prevents a runaway loop from becoming a
 * cost incident"). Every accepted webhook runs the full pipeline,
 * including a paid LLM call, so an unthrottled endpoint is a billing
 * hazard as much as a load one.
 *
 * In-memory and per-process on purpose — matching §14's "high-churn
 * ephemeral counters are fine in Postgres at hackathon volume; move to
 * Redis in production". With one backend process this is exact; behind
 * multiple replicas it becomes per-replica, which is a documented
 * limitation, not a silent one.
 */
export function rateLimit(options: { requestsPerMinute: number; windowMs?: number }) {
  const windowMs = options.windowMs ?? 60_000;
  const buckets = new Map<string, { count: number; resetAt: number }>();

  // Bound memory: drop expired buckets rather than retaining an entry per
  // IP forever, which would otherwise be its own slow leak.
  function sweep(now: number) {
    for (const [key, bucket] of buckets) {
      if (bucket.resetAt <= now) buckets.delete(key);
    }
  }

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
    if (options.requestsPerMinute <= 0) return next();

    const now = Date.now();
    if (buckets.size > 10_000) sweep(now);

    const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
    const bucket = buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }

    bucket.count += 1;
    if (bucket.count > options.requestsPerMinute) {
      res.setHeader("Retry-After", Math.ceil((bucket.resetAt - now) / 1000));
      res.status(429).json({ error: "rate limit exceeded" });
      return;
    }
    next();
  };
}
