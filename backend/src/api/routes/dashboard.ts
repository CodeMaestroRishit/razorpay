import { Router } from "express";
import { computeFunnel } from "../../pipeline/measurement.js";
import { withMerchantContext } from "../../db/client.js";
import { requireMerchantId } from "../merchantContext.js";

export const dashboardRouter = Router();

dashboardRouter.get("/funnel", async (req, res, next) => {
  try {
    const funnel = await computeFunnel(requireMerchantId(req));
    res.json(funnel);
  } catch (err) {
    next(err);
  }
});

dashboardRouter.get("/summary", async (req, res, next) => {
  try {
    const summary = await withMerchantContext(requireMerchantId(req), (client) =>
      client.query(
        `select
           count(*) filter (where state not in ('recovered','closed_unrecovered')) as active_cases,
           count(*) filter (where state = 'escalated') as escalated_cases,
           count(*) as total_cases
         from recovery_cases`
      )
    );
    res.json(summary.rows[0]);
  } catch (err) {
    next(err);
  }
});
