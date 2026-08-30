import { Router } from "express";
import { withMerchantContext } from "../../db/client.js";

export const casesRouter = Router();

/**
 * Reads go through withMerchantContext -> the RLS-enforced `recovery_app`
 * role, not the service pool — this is the endpoint that actually proves
 * tenant isolation (§13), not just documents it. `x-merchant-id` stands
 * in for what a real auth layer would derive from a session/JWT.
 */
function requireMerchantId(req: { header: (name: string) => string | undefined }): string {
  const merchantId = req.header("x-merchant-id");
  if (!merchantId) throw Object.assign(new Error("x-merchant-id header required"), { status: 400 });
  return merchantId;
}

casesRouter.get("/", async (req, res, next) => {
  try {
    const merchantId = requireMerchantId(req);
    const cases = await withMerchantContext(merchantId, (client) =>
      client.query(
        `select rc.id, rc.playbook, rc.state, rc.holdout, rc.opened_at, rc.closed_at,
                c.name as customer_name, c.phone, c.email,
                coalesce(t.amount, i.amount, 0) as amount,
                (select score from risk_scores rs where rs.event_id = rc.event_id order by scored_at desc limit 1) as risk_score,
                (select cause from root_cause_analysis rca where rca.event_id = rc.event_id order by created_at desc limit 1) as root_cause
         from recovery_cases rc
         join customers c on c.id = rc.customer_id
         join revenue_risk_events rre on rre.id = rc.event_id
         left join transactions t on t.id = rre.transaction_id
         left join invoices i on i.id = rre.invoice_id
         order by rc.opened_at desc
         limit 200`
      )
    );
    res.json(cases.rows);
  } catch (err) {
    next(err);
  }
});

casesRouter.get("/:id/timeline", async (req, res, next) => {
  try {
    const merchantId = requireMerchantId(req);
    const timeline = await withMerchantContext(merchantId, (client) =>
      client.query(
        `select stage, input, output, model, latency_ms, created_at
         from agent_decisions where case_id = $1 order by created_at asc`,
        [req.params.id]
      )
    );
    res.json(timeline.rows);
  } catch (err) {
    next(err);
  }
});
