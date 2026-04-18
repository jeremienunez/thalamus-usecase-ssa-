import type { FastifyInstance } from "fastify";
import type { RuntimeConfigService } from "../services/runtime-config.service";
import {
  listRuntimeConfigController,
  getRuntimeConfigController,
  patchRuntimeConfigController,
  resetRuntimeConfigController,
} from "../controllers/runtime-config.controller";

export function registerRuntimeConfigRoutes(
  app: FastifyInstance,
  service: RuntimeConfigService,
): void {
  app.get("/api/config/runtime", listRuntimeConfigController(service));
  app.get<{ Params: { domain: string } }>(
    "/api/config/runtime/:domain",
    getRuntimeConfigController(service),
  );
  app.patch<{
    Params: { domain: string };
    Body: Record<string, unknown>;
  }>("/api/config/runtime/:domain", patchRuntimeConfigController(service));
  app.delete<{ Params: { domain: string } }>(
    "/api/config/runtime/:domain",
    resetRuntimeConfigController(service),
  );
}
