import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    requireAuth: (req: any, reply: any) => Promise<void>;
  }
}

import "fastify";

declare module "fastify" {
  interface FastifyInstance {
    setSessionCookie: (reply: any, userId: string) => Promise<string>;
    clearSessionCookie: (reply: any) => Promise<void>;
    issueCsrfCookie: (reply: any) => Promise<string>;
    requireAuth: (req: any, reply: any) => Promise<void>;
    requireCsrf: (req: any, reply: any) => Promise<void>;
  }
}
