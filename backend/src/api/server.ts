import express from "express";
import cors from "cors";
import { env } from "../config/env.js";
import { casesRouter } from "./routes/cases.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { webhooksRouter } from "./routes/webhooks.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

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
