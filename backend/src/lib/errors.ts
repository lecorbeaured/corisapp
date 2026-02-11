import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

const plugin: FastifyPluginAsync = async (app) => {
  app.setErrorHandler((err, _req, reply) => {
    // Postgres errors will surface here, keep them readable.
    const msg = err.message || "Unknown error";
    // Basic mapping
    if (msg.toLowerCase().includes("duplicate")) {
      return reply.code(409).send({ error: msg });
    }
    return reply.code(400).send({ error: msg });
  });
};

export default fp(plugin);
