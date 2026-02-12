import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import fastifyJwt from "@fastify/jwt";
import cookie from "@fastify/cookie";
import crypto from "crypto";
import { query } from "./db.js";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string; v: number; typ?: "access" };
    user: { id: string };
  }
}

const ACCESS_COOKIE = "coris_session";
const CSRF_COOKIE = "coris_csrf";

function isProd(){
  return process.env.NODE_ENV === "production";
}

function cookieOpts(){
  const secure = (process.env.COOKIE_SECURE ?? String(isProd())) === "true";
  const domain = (process.env.COOKIE_DOMAIN ?? "").trim() || undefined;
  return { secure, domain };
}

const plugin: FastifyPluginAsync = async (app) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error("Missing JWT_SECRET in environment");

  await app.register(cookie);
  await app.register(fastifyJwt, { secret, cookie: { cookieName: ACCESS_COOKIE, signed: false } });

    app.decorate("setSessionCookie", async (reply: any, userId: string) => {
    const rows = await query<{ auth_version: number }>(
      `SELECT auth_version FROM users WHERE id = $1`,
      [userId]
    );
    const v = rows.length ? Number(rows[0].auth_version) : 1;

    const token = app.jwt.sign({ sub: userId, v, typ: "access" }, { expiresIn: "7d" });
    const { secure, domain } = cookieOpts();
    reply.setCookie(ACCESS_COOKIE, token, {
      httpOnly: true,
      secure,
      sameSite: "lax",
      path: "/",
      domain,
      maxAge: 60 * 60 * 24 * 7
    });
    return token;
  });


  app.decorate("clearSessionCookie", async (reply: any) => {
    const { secure, domain } = cookieOpts();
    reply.clearCookie(ACCESS_COOKIE, { path: "/", domain, secure, sameSite: "lax" });
  });

  app.decorate("issueCsrfCookie", async (reply: any) => {
    const { secure, domain } = cookieOpts();
    // simple random token, not JWT
    const token = cryptoRandom();
    reply.setCookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure,
      sameSite: "lax",
      path: "/",
      domain,
      maxAge: 60 * 60 * 24 * 7
    });
    return token;
  });

    app.decorate("requireAuth", async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
      const payload = req.user; // { sub, v, typ }
      if (!payload || !payload.sub) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      const rows = await query<{ auth_version: number }>(
        `SELECT auth_version FROM users WHERE id = $1`,
        [payload.sub]
      );
      const current = rows.length ? Number(rows[0].auth_version) : 1;

      if (Number(payload.v) !== current) {
        return reply.code(401).send({ error: "Unauthorized" });
      }

      req.user = { id: payload.sub };
      return;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });

  app.decorate("requireCsrf", async (req: any, reply: any) => {
    const enabled = (process.env.CSRF_ENABLED ?? "true") === "true";
    if(!enabled) return;
    const method = (req.method || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;

    const header = (req.headers["x-csrf-token"] ?? "").toString();
    const cookieVal = (req.cookies && req.cookies[CSRF_COOKIE]) ? req.cookies[CSRF_COOKIE] : "";
    if (!header || !cookieVal || header !== cookieVal) {
      return reply.code(403).send({ error: "CSRF token missing or invalid" });
    }
  });
};

function cryptoRandom(){
  return crypto.randomBytes(24).toString("hex");
}

export default fp(plugin);

export const COOKIE_NAMES = { ACCESS_COOKIE, CSRF_COOKIE };
