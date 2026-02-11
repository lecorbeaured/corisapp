import "dotenv/config";
import Fastify from "fastify";
import corsPlugin from "./lib/cors.js";
import rateLimit from "@fastify/rate-limit";
import cookieAuth from "./lib/cookieAuth.js";

import errors from "./lib/errors.js";
import templates from "./routes/templates.js";
import occurrences from "./routes/occurrences.js";
import schedule from "./routes/schedule.js";
import planning from "./routes/planning.js";
import reminders from "./routes/reminders.js";
import authRoutes from "./routes/auth.js";
import passwordReset from "./routes/passwordReset.js";

const app = Fastify({ logger: true });

await app.register(errors);
await app.register(corsPlugin);
await app.register(cookieAuth);

await app.register(rateLimit, {
  global: true,
  max: 300,
  timeWindow: '1 minute'
});


app.addHook("onRequest", async (req: any, reply: any) => {
  const url = req.url || "";
  // Auth routes are public and must be reachable without cookies/CSRF.
  if (url.startsWith("/v1/auth/")) return;
  if (url === "/health") return;

  if (url.startsWith("/v1/")) {
    await (app as any).requireCsrf(req, reply);
    return (app as any).requireAuth(req, reply);
  }
});


await app.register(authRoutes, { prefix: "/v1/auth" });
await app.register(passwordReset, { prefix: "/v1/auth" });

await app.register(templates, { prefix: "/v1/templates" });
await app.register(occurrences, { prefix: "/v1/occurrences" });
await app.register(schedule, { prefix: "/v1/schedule" });
await app.register(planning, { prefix: "/v1/planning" });
await app.register(reminders, { prefix: "/v1/reminders" });

app.get("/health", async () => ({ ok: true }));

const port = Number(process.env.PORT || 3000);
await app.listen({ port, host: "0.0.0.0" });
