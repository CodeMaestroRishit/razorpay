import { Router } from "express";
import { servicePool } from "../../db/client.js";

export const merchantsRouter = Router();

/**
 * Lists merchants that actually have cases, so the console can offer a
 * picker instead of demanding a pasted UUID.
 *
 * Deliberately NOT tenant-scoped, and deliberately the only such
 * endpoint: it exists because `x-merchant-id` is a stand-in for real auth
 * (see README "known gaps"). Once a real session exists, the tenant comes
 * from the session and this endpoint goes away rather than becoming a
 * tenant-enumeration hole. Returns only id/name/counts — never any
 * customer or transaction data, which stays behind RLS.
 */
merchantsRouter.get("/", async (_req, res, next) => {
  try {
    const { rows } = await servicePool.query(
      `select m.id, m.name,
              count(rc.id)::int          as case_count,
              max(rc.opened_at)          as latest_activity
         from merchants m
         join recovery_cases rc on rc.merchant_id = m.id
        group by m.id, m.name
        order by max(rc.opened_at) desc nulls last
        limit 25`
    );
    res.json(rows);
  } catch (err) {
    next(err);
  }
});
