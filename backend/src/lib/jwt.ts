import fp from "fastify-plugin";
import type { FastifyPluginAsync } from "fastify";
import fastifyJwt from "@fastify/jwt";

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: { sub: string };
    user: { id: string };
  }
}

const plugin: FastifyPluginAsync = async (app) => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET in environment");
  }

  await app.register(fastifyJwt, { secret });

  // Decorate a helper to require auth
  app.decorate("requireAuth", async (req: any, reply: any) => {
    try {
      await req.jwtVerify();
      // Map JWT subject to a stable user object
      const sub = (req.user as any)?.sub;
      (req as any).user = { id: sub };
      return;
    } catch {
      return reply.code(401).send({ error: "Unauthorized" });
    }
  });
};

export default fp(plugin);
