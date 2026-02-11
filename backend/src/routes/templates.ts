import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query, one } from "../lib/db.js";
import { DB_FUNCS } from "../lib/dbfuncs.js";

const CreateTemplate = z.object({
  bill_name: z.string().min(1),
  category: z.string().min(1),
  frequency: z.enum(["weekly","biweekly","monthly","quarterly","yearly"]),
  due_day: z.number().int().min(1).max(31).optional(),
  default_amount: z.number().positive(),
  is_variable: z.boolean().default(false),
  notes: z.string().optional().default("")
});

const UpdateTemplate = z.object({
  bill_name: z.string().min(1).optional(),
  category: z.string().min(1).optional(),
  frequency: z.enum(["weekly","biweekly","monthly","quarterly","yearly"]).optional(),
  due_day: z.number().int().min(1).max(31).optional(),
  default_amount: z.number().positive().optional(),
  is_variable: z.boolean().optional(),
  notes: z.string().optional()
});

const plugin: FastifyPluginAsync = async (app) => {
  app.get("/me", async (req: any) => {
    const userId = req.user.id;
    return await query(
      `SELECT * FROM bill_templates WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId]
    );
  });

  app.post("/", async (req: any) => {
    const userId = req.user.id;
    const body = CreateTemplate.parse(req.body);

    const row = await one(
      `INSERT INTO bill_templates (user_id, bill_name, category, frequency, due_day, default_amount, is_variable, notes, is_active, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, TRUE, NOW(), NOW())
       RETURNING *`,
      [userId, body.bill_name, body.category, body.frequency, body.due_day ?? null, body.default_amount, body.is_variable, body.notes]
    );

    // Best-effort: generate and assign occurrences for planning stability (idempotent)
    try {
      await query(`SELECT ${DB_FUNCS.generateOccurrencesForUser}($1, 180)`, [userId]);
      await query(`SELECT ${DB_FUNCS.assignToActiveWindowsForUser}($1)`, [userId]);
    } catch {
      // ignore, UI will show planning_incomplete banner if needed
    }

    return row;
  });

  app.patch("/:id", async (req: any) => {
    const userId = req.user.id;
    const id = z.string().uuid().parse((req.params as any).id);
    const body = UpdateTemplate.parse(req.body);

    const row = await one(
      `UPDATE bill_templates
       SET bill_name = COALESCE($1, bill_name),
           category = COALESCE($2, category),
           frequency = COALESCE($3, frequency),
           due_day = COALESCE($4, due_day),
           default_amount = COALESCE($5, default_amount),
           is_variable = COALESCE($6, is_variable),
           notes = COALESCE($7, notes),
           updated_at = NOW()
       WHERE id = $8 AND user_id = $9
       RETURNING *`,
      [
        body.bill_name ?? null,
        body.category ?? null,
        body.frequency ?? null,
        body.due_day ?? null,
        body.default_amount ?? null,
        body.is_variable ?? null,
        body.notes ?? null,
        id,
        userId
      ]
    );
    return row;
  });

  app.post("/:id/deactivate", async (req: any) => {
    const userId = req.user.id;
    const id = z.string().uuid().parse((req.params as any).id);

    const row = await one(
      `UPDATE bill_templates
       SET is_active = FALSE,
           updated_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );

    return row;
  });
};

export default plugin;
