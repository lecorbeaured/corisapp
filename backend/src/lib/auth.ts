import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";

const plugin: FastifyPluginAsync = async (app) => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    throw new Error("Missing API_KEY in environment");
  }

  app.addHook("onRequest", async (req, reply) => {
    const key = req.headers["x-api-key"];
    if (key !== apiKey) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
};

export default fp(plugin);
