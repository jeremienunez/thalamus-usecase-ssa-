/**
 * Admin Sweep Routes — trimmed for standalone extraction.
 * Original file contained 20+ admin route groups; this keeps only the sweep block.
 */

import type { FastifyInstance } from "fastify";
import { authenticate, requireRoles } from "../middleware/auth.middleware";
import type { AdminSweepController } from "../controllers/admin-sweep.controller";

export interface AdminSweepRouteDeps {
  sweep: AdminSweepController;
}

export async function registerAdminSweepRoutes(
  app: FastifyInstance,
  { sweep }: AdminSweepRouteDeps,
): Promise<void> {
  const guard = [authenticate, requireRoles("admin")];

  app.get("/sweep/suggestions", { preHandler: guard }, sweep.listSuggestions);
  app.get("/sweep/stats", { preHandler: guard }, sweep.getStats);
  app.patch("/sweep/suggestions/:id", { preHandler: guard }, sweep.reviewSuggestion);
  app.post("/sweep/suggestions/:id/resolve", { preHandler: guard }, sweep.resolveSuggestion);
  app.post("/sweep/trigger", { preHandler: guard }, sweep.triggerSweep);
}
