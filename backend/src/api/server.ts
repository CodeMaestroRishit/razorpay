import express from "express";
import cors from "cors";
import { env } from "../config/env.js";
import { casesRouter } from "./routes/cases.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { webhooksRouter } from "./routes/webhooks.js";

const app = express();

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
app.use(express.json());

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

app.use("/webhooks", webhooksRouter);
app.use("/api/cases", casesRouter);
app.use("/api/dashboard", dashboardRouter);

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error & { status?: number }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

app.listen(env.port, () => {
  console.log(`backend listening on :${env.port}`);
});
