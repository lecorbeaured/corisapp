import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query, one } from "../lib/db.js";

const MarkPaid = z.object({
  paid_date: z.string().datetime().optional(),
  amount_paid: z.number().positive().optional()
});

const UpdateAmount = z.object({
  amount: z.number().positive()
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/me", async (req: any) => {
        const userId = req.user.id;
    return await query(
      `SELECT * FROM v_bill_occurrences_status WHERE user_id = $1 ORDER BY due_date ASC`,
      [userId]
    );
  });

  app.patch("/:id/amount", async (req) => {
        const id = z.string().uuid().parse((req.params as any).id);
    const userId = (req as any).user.id;
    const body = UpdateAmount.parse(req.body);

    // DB guards should enforce immutability. This endpoint is for future unpaid variable bills.
        const row = await one(
      `UPDATE bill_occurrences bo
       SET amount = $1, updated_at = NOW()
       FROM bill_templates bt
       WHERE bo.id = $2 AND bo.user_id = $3
         AND bo.template_id = bt.id
         AND bt.is_variable = TRUE
         AND bo.paid_date IS NULL
         AND bo.due_date >= coris_user_today(bo.user_id)
       RETURNING bo.*`,
      [body.amount, id, userId]
    );
    return row;
  });

  app.post("/:id/paid", async (req) => {
        const id = z.string().uuid().parse((req.params as any).id);
    const userId = (req as any).user.id;
    const body = MarkPaid.parse(req.body);

    const row = await one(
      `UPDATE bill_occurrences
       SET paid_date = COALESCE($1::timestamptz, NOW()),
           amount_paid = COALESCE($2::numeric, amount),
           updated_at = NOW()
       WHERE id = $3 AND user_id = $4
       RETURNING *`,
      [body.paid_date ?? null, body.amount_paid ?? null, id, userId]
    );

    // Suppress reminders immediately
    await query(`SELECT coris_cancel_unsent_reminders_for_occurrence($1, 'paid')`, [id]);

    return row;
  });
};

export default plugin;
