// STUBBED FOR INTERVIEW EXTRACTION — no real auth, grants admin/investment tier by default.
// In production, replace with real JWT/session validation.

import type { FastifyRequest, FastifyReply } from "fastify";

export interface AuthenticatedUser {
  id: number;
  role: string;
  tier: string;
}

declare module "fastify" {
  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

export async function authenticate(
  request: FastifyRequest,
  _reply: FastifyReply,
): Promise<void> {
  request.user = { id: 1, role: "admin", tier: "investment" };
}

export function requireTier(..._tiers: string[]) {
  return async (_req: FastifyRequest, _reply: FastifyReply): Promise<void> => {};
}

export function requireRoles(..._roles: string[]) {
  return async (_req: FastifyRequest, _reply: FastifyReply): Promise<void> => {};
}

export function requireSimKernelSecret() {
  return async (
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> => {
    const expected = process.env.SIM_KERNEL_SHARED_SECRET;
    if (!expected) {
      await reply
        .code(500)
        .send({ error: "SIM_KERNEL_SHARED_SECRET is not configured" });
      return;
    }

    const raw = req.headers["x-sim-kernel-secret"];
    const provided = Array.isArray(raw) ? raw[0] : raw;
    if (provided !== expected) {
      await reply.code(403).send({ error: "forbidden" });
    }
  };
}
