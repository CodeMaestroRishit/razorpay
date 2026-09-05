import express from "express";
import cors from "cors";
import { env, isProduction } from "../config/env.js";
import { rateLimit } from "./rateLimit.js";
import { casesRouter } from "./routes/cases.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { internalRouter } from "./routes/internal.js";

const app = express();

// Render (and any PaaS) terminates TLS at a proxy, so req.ip is the proxy
// unless Express is told to read X-Forwarded-For. The rate limiter keys on
// req.ip, so without this every request shares one bucket.
app.set("trust proxy", 1);

// Wide-open CORS is fine for local dev but wrong for a deployed backend.
// Set CORS_ORIGINS to a comma-separated allowlist (e.g. the Vercel URL);
// unset keeps the permissive dev behavior.
app.use(
  cors(
    env.corsOrigins.length > 0
      ? { origin: env.corsOrigins, allowedHeaders: ["Content-Type", "x-merchant-id"] }
      : {}
  )
);
// Capture the exact raw bytes before parsing. Razorpay signs the wire
// payload, not any re-serialization of it — JSON.stringify(req.body) can
// diverge from what was actually sent (key order, number formatting), so
// verifying against anything other than these raw bytes is unreliable.
app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as express.Request).rawBody = buf;
    },
  })
);

app.get("/health", (_req, res) => res.json({ status: "ok" }));

// This is an API-only service — visiting the bare root in a browser (e.g.
// clicking the deploy URL on a host's dashboard) is a normal sanity check,
// not a real client. Answer it usefully instead of a bare 404.
app.get("/", (_req, res) =>
  res.json({
    service: "ai-revenue-recovery-backend",
    status: "ok",
    endpoints: ["/health", "/webhooks/:provider", "/api/cases", "/api/dashboard/funnel", "/api/dashboard/summary"],
  })
);

// Every accepted webhook runs the full pipeline including a paid LLM
// call, so this limit is a cost control as much as a load one (§13).
app.use("/webhooks", rateLimit({ requestsPerMinute: env.webhookRateLimitPerMin }), webhooksRouter);
app.use("/api/cases", casesRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/internal", rateLimit({ requestsPerMinute: 30 }), internalRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  const status = err.status ?? 500;
  // Never surface an internal failure's text to a client — a raw Postgres
  // error leaks table names, column types and query shape. Deliberate
  // 4xx errors thrown by our own routes carry a status and are safe.
  const safeMessage = status < 500 || !isProduction ? err.message : "internal server error";
  res.status(status).json({ error: safeMessage });
});

app.listen(env.port, () => {
  console.log(`backend listening on :${env.port}`);
});
