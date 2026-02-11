import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { query } from "../lib/db.js";

const plugin: FastifyPluginAsync = async (app) => {
  app.post("/generate", async (req) => {
        const userId = (req as any).user.id;
    await query(`SELECT coris_generate_default_reminders_for_user($1, 120)`, [userId]);
    return { ok: true };
  });

  app.get("/pending", async (req) => {
        const userId = (req as any).user.id;
    return await query(`SELECT * FROM v_pending_reminder_events WHERE user_id = $1`, [userId]);
  });

  app.get("/upcoming", async (req) => {
        const userId = (req as any).user.id;
    return await query(`SELECT * FROM v_upcoming_reminder_events WHERE user_id = $1`, [userId]);
  });
};

export default plugin;
