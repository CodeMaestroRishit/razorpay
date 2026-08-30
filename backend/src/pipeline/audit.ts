import type { PoolClient } from "pg";
import { servicePool } from "../db/client.js";

/**
 * Every pipeline stage calls this exactly once. This table is not an
 * add-on log — it IS the Agent Timeline UI's data source and the
 * observability layer (§12, §14). If a stage runs and doesn't write
 * here, it's invisible to both the judge-facing dashboard and to audit.
 */
export async function recordDecision(params: {
  caseId: string;
  stage: string;
  input: unknown;
  output: unknown;
  model?: string;
  latencyMs?: number;
  client?: PoolClient;
}): Promise<void> {
  const db = params.client ?? servicePool;
  await db.query(
    `insert into agent_decisions (case_id, stage, input, output, model, latency_ms)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      params.caseId,
      params.stage,
      JSON.stringify(params.input),
      JSON.stringify(params.output),
      params.model ?? null,
      params.latencyMs ?? null,
    ]
  );
}

export async function timedStage<T>(
  caseId: string,
  stage: string,
  input: unknown,
  fn: () => Promise<T>,
  extra?: { model?: string; client?: PoolClient }
): Promise<T> {
  const start = Date.now();
  const output = await fn();
  await recordDecision({
    caseId,
    stage,
    input,
    output,
    model: extra?.model,
    latencyMs: Date.now() - start,
    client: extra?.client,
  });
  return output;
}
