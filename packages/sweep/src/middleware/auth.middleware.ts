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
