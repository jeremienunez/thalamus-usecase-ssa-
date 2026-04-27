// apps/console-api/src/routes/research-write.routes.ts
//
// Kernel-only HTTP surface for `research_*` table writes (Sprint 5 / C1).
// The kernel consumes these routes; in-process callers go through the
// `ResearchWriterPort` directly via the container. There is exactly one
// public contract per CLAUDE.md §1 / §3.2.
import type { FastifyInstance } from "fastify";
import type { ResearchWriterPort } from "@interview/thalamus";
import { requireSimKernelSecret } from "../middleware/auth.middleware";
import {
  postResearchCycleController,
  postResearchFindingEmissionsController,
  postIncrementCycleFindingsController,
} from "../controllers/research-write.controller";

type ResearchWriteRouteConfig = {
  simKernelSharedSecret?: string;
};

export function registerResearchWriteRoutes(
  app: FastifyInstance,
  writer: ResearchWriterPort,
  config: ResearchWriteRouteConfig = {},
): void {
  app.register((researchApp, _opts, done) => {
    researchApp.addHook(
      "preHandler",
      requireSimKernelSecret(config.simKernelSharedSecret),
    );
    researchApp.post("/api/research/cycles", postResearchCycleController(writer));
    researchApp.post(
      "/api/research/finding-emissions",
      postResearchFindingEmissionsController(writer),
    );
    researchApp.post(
      "/api/research/cycles/:id/increment-findings",
      postIncrementCycleFindingsController(writer),
    );
    done();
  });
}
