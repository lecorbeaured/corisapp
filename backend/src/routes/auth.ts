import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { query, one } from "../lib/db.js";

const Signup = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

const Login = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const plugin: FastifyPluginAsync = async (app) => {
  app.post("/signup", async (req, reply) => {
    const body = Signup.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const hash = await bcrypt.hash(body.password, 12);

    const user = await one(
      `INSERT INTO users (email, password_hash, created_at)
       VALUES ($1, $2, NOW())
       RETURNING id, email`,
      [email, hash]
    );

    await (app as any).setSessionCookie(reply, user.id);
    const csrf = await (app as any).issueCsrfCookie(reply);
    return { user, csrf };
  });

  app.post("/login", async (req, reply) => {
    const body = Login.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const rows = await query<{ id: string; email: string; password_hash: string }>(
      `SELECT id, email, password_hash FROM users WHERE email = $1`,
      [email]
    );

    if (!rows.length) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    const u = rows[0];
    const ok = await bcrypt.compare(body.password, u.password_hash);
    if (!ok) {
      return reply.code(401).send({ error: "Invalid credentials" });
    }

    await (app as any).setSessionCookie(reply, u.id);
    const csrf = await (app as any).issueCsrfCookie(reply);
    return { user: { id: u.id, email: u.email }, csrf };
  });

  app.post("/logout", async (_req, reply) => {
    await (app as any).clearSessionCookie(reply);
    // also clear csrf
    reply.clearCookie("coris_csrf", { path: "/" });
    return { ok: true };
  });

  app.get("/csrf", async (_req, reply) => {
    const csrf = await (app as any).issueCsrfCookie(reply);
    return { csrf };
  });

  app.get("/me", { preHandler: (app as any).requireAuth }, async (req: any) => {
    return { user: { id: req.user.id } };
  });
};

export default plugin;
