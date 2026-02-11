import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import cors from "@fastify/cors";

const plugin: FastifyPluginAsync = async (app) => {
  const allowAll = (process.env.CORS_ALLOW_ALL || "false").toLowerCase() === "true";
  const raw = (process.env.CORS_ALLOWED_ORIGINS || "").trim();

  const allowed = raw
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin or server-to-server requests may have no Origin header.
      if (!origin) return cb(null, true);

      if (allowAll) return cb(null, true);

      if (allowed.includes(origin)) return cb(null, true);

      return cb(new Error("CORS blocked for origin: " + origin), false);
    },
    credentials: false
  });
};

export default fp(plugin);
