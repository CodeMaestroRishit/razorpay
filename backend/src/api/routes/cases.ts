import { Router } from "express";
import { withMerchantContext } from "../../db/client.js";
import { requireMerchantId } from "../merchantContext.js";

export const casesRouter = Router();

/**
 * Reads go through withMerchantContext -> the RLS-enforced `recovery_app`
 * role, not the service pool — this is the endpoint that actually proves
 * tenant isolation (§13), not just documents it. `x-merchant-id` stands
 * in for what a real auth layer would derive from a session/JWT.
 */

casesRouter.get("/", async (req, res, next) => {
  try {
    const merchantId = requireMerchantId(req);
    // LATERAL joins rather than correlated scalar subqueries: the planner
    // runs each once per row against the (event_id, created_at desc)
    // indexes from migration 0010, instead of re-planning a subquery per
    // output column per row.
    const cases = await withMerchantContext(merchantId, (client) =>
      client.query(
        `select rc.id, rc.playbook, rc.state, rc.holdout, rc.opened_at, rc.closed_at,
                c.name as customer_name, c.phone, c.email, c.contact_opt_out,
                coalesce(t.amount, i.amount, 0) as amount,
                rs.score as risk_score,
                rca.cause as root_cause
         from recovery_cases rc
         join customers c on c.id = rc.customer_id
         join revenue_risk_events rre on rre.id = rc.event_id
         left join transactions t on t.id = rre.transaction_id
         left join invoices i on i.id = rre.invoice_id
         left join lateral (
           select score from risk_scores
            where event_id = rc.event_id order by scored_at desc limit 1
         ) rs on true
         left join lateral (
           select cause from root_cause_analysis
            where event_id = rc.event_id order by created_at desc limit 1
         ) rca on true
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
