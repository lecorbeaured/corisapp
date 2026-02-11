import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query, one } from "../lib/db.js";
import { DB_FUNCS } from "../lib/dbfuncs.js";

const SetSchedule = z.object({
  frequency: z.enum(["weekly","biweekly","monthly"]),
  next_paycheck_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  typical_net_pay: z.number().positive().optional()
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/me", async (req: any) => {
    const userId = req.user.id;
    const schedule = await one(
      `SELECT * FROM pay_schedules WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );
    return schedule;
  });

  // Create a new schedule and activate it (deactivates old schedule for user)
  app.post("/set", async (req) => {
    const body = SetSchedule.parse(req.body);
    const userId = (req as any).user.id;

    // transaction
    const rows = await query(
      `WITH deact AS (
         UPDATE pay_schedules SET is_active = FALSE, updated_at = NOW()
         WHERE user_id = $1 AND is_active = TRUE
         RETURNING id
       ),
       ins AS (
         INSERT INTO pay_schedules (user_id, frequency, next_paycheck_date, typical_net_pay, is_active)
         VALUES ($1,$2,$3,$4,TRUE)
         RETURNING *
       )
       SELECT * FROM ins`,
      [userId, body.frequency, body.next_paycheck_date, body.typical_net_pay ?? null]
    );

    const schedule = rows[0];

    // Generate windows and assign occurrences using Phase 2 functions if present.
    // These function names may differ in your Phase 2 set, adjust if needed.
    await query(`SELECT ${DB_FUNCS.generateWindowsForSchedule}($1, 180)`, [schedule.id]);
    await query(`SELECT ${DB_FUNCS.assignToActiveWindowsForUser}($1)`, [userId]);

    return schedule;
  });

  // Regenerate windows and reassign (idempotent)
  app.post("/regenerate", async (req: any) => {
    const userId = req.user.id;

    const schedule = await one(
      `SELECT * FROM pay_schedules WHERE user_id = $1 AND is_active = TRUE`,
      [userId]
    );

    await query(`SELECT ${DB_FUNCS.generateWindowsForSchedule}($1, 180)`, [schedule.id]);
    await query(`SELECT ${DB_FUNCS.assignToActiveWindowsForUser}($1)`, [userId]);

    return { ok: true };
  });
};

export default plugin;
