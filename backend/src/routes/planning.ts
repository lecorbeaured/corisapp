import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query } from "../lib/db.js";

const plugin: FastifyPluginAsync = async (app) => {
    app.get("/windows", async (req: any) => {
        const userId = req.user.id;

    const totals = await query(
      `SELECT * FROM v_paycheck_window_totals WHERE user_id = $1 ORDER BY start_date ASC`,
      [userId]
    );

    const unassigned = await query(
      `SELECT 1 FROM v_unassigned_future_unpaid_occurrences WHERE user_id = $1 LIMIT 1`,
      [userId]
    );

    return { planning_incomplete: unassigned.length > 0, windows: totals };
  });

  app.get("/window/:windowId/items", async (req) => {
    const windowId = z.string().uuid().parse((req.params as any).windowId);
    const userId = (req as any).user.id;
    return await query(
      `SELECT * FROM v_paycheck_window_items WHERE paycheck_window_id = $1 AND user_id = $2 ORDER BY due_date ASC`,
      [windowId, userId]
    );
  });

  app.get("/integrity", async (req: any) => {
        const userId = req.user.id;
    const unassigned = await query(
      `SELECT * FROM v_unassigned_future_unpaid_occurrences WHERE user_id = $1 ORDER BY due_date ASC`,
      [userId]
    );
    const inactive = await query(
      `SELECT * FROM v_occurrences_assigned_to_inactive_windows WHERE user_id = $1`,
      [userId]
    );
    return { unassigned, assigned_to_inactive_windows: inactive };
  });
};

export default plugin;
