import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import { query, one } from "../lib/db.js";
import { createMailer } from "../lib/mailer.js";

const RequestBody = z.object({
  email: z.string().email()
});

const ConfirmBody = z.object({
  token: z.string().min(20),
  new_password: z.string().min(8)
});

function cryptoRandomToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

const plugin: FastifyPluginAsync = async (app) => {
  const mailer = createMailer();

  // Rate limit this endpoint harder than normal traffic
  app.post("/password-reset/request", {
    config: { rateLimit: { max: 10, timeWindow: "1 hour" } }
  }, async (req, reply) => {
    const body = RequestBody.parse(req.body);
    const email = body.email.toLowerCase().trim();

    const users = await query<{ id: string; email: string }>(
      `SELECT id, email FROM users WHERE email = $1`,
      [email]
    );

    // Always return the same response to prevent account enumeration.
    const okResponse = { ok: true, message: "If an account exists, a reset email will be sent." };

    if (!users.length) return okResponse;

    const user = users[0];

    // Invalidate older reset tokens for this user (optional cleanup)
    await query(
      `UPDATE password_resets SET used_at = NOW()
       WHERE user_id = $1 AND used_at IS NULL`,
      [user.id]
    );

    const rawToken = cryptoRandomToken();
    const tokenHash = sha256(rawToken);

    const reset = await one(
      `INSERT INTO password_resets (user_id, token_hash, expires_at, created_at)
       VALUES ($1, $2, NOW() + INTERVAL '30 minutes', NOW())
       RETURNING id`,
      [user.id, tokenHash]
    );

    const publicUrl = (process.env.APP_PUBLIC_URL ?? "http://localhost:5173").replace(/\/$/, "");
    const link = `${publicUrl}/app/reset-password.html?token=${rawToken}`;

    const subject = "Reset your CORIS password";
    const text = [
      "You requested a password reset for CORIS.",
      "",
      "Use this link to set a new password (valid for 30 minutes):",
      link,
      "",
      "If you did not request this, you can ignore this email."
    ].join("\n");

    await mailer.send(email, subject, text);

    return okResponse;
  });

  app.post("/password-reset/confirm", {
    config: { rateLimit: { max: 20, timeWindow: "1 hour" } }
  }, async (req, reply) => {
    const body = ConfirmBody.parse(req.body);

    const tokenHash = sha256(body.token);

    const rows = await query<{
      id: string;
      user_id: string;
      expires_at: string;
      used_at: string | null;
    }>(
      `SELECT id, user_id, expires_at, used_at
       FROM password_resets
       WHERE token_hash = $1
       LIMIT 1`,
      [tokenHash]
    );

    if (!rows.length) return reply.code(400).send({ error: "Invalid or expired token" });

    const pr = rows[0];
    if (pr.used_at) return reply.code(400).send({ error: "Invalid or expired token" });

    const exp = new Date(pr.expires_at);
    if (Number.isNaN(exp.getTime()) || exp.getTime() < Date.now()) {
      return reply.code(400).send({ error: "Invalid or expired token" });
    }

    const hash = await bcrypt.hash(body.new_password, 12);

    // Update password and bump auth_version to invalidate existing sessions.
    await query(
      `UPDATE users
       SET password_hash = $1,
           auth_version = auth_version + 1
       WHERE id = $2`,
      [hash, pr.user_id]
    );

    // Mark token used (single use)
    await query(
      `UPDATE password_resets
       SET used_at = NOW()
       WHERE id = $1`,
      [pr.id]
    );

    // Clear any existing cookies for safety.
    await (app as any).clearSessionCookie(reply);
    reply.clearCookie("coris_csrf", { path: "/" });

    return { ok: true };
  });
};

export default plugin;
