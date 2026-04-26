import type { FastifyInstance } from "fastify";
import {
  simClaimPendingFishController,
  simCloseSwarmController,
  simCreateSwarmController,
  simFishCountsController,
  simGetSwarmController,
  simLinkOutcomeController,
  simSnapshotAggregateController,
  simSwarmAbortController,
  simSwarmDoneController,
  simSwarmFailedController,
  simSwarmStatusController,
} from "../controllers/sim-swarm.controller";
import {
  simTerminalActionsController,
  simTerminalsController,
} from "../controllers/sim-terminal.controller";
import type { SimRouteServices } from "./sim-route-services";

export function registerSimSwarmRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
): void {
  app.post("/api/sim/swarms", simCreateSwarmController(s.swarm));
  app.get("/api/sim/swarms/:id", simGetSwarmController(s.swarm));
  app.get("/api/sim/swarms/:id/fish-counts", simFishCountsController(s.swarm));
  app.post("/api/sim/swarms/:id/done", simSwarmDoneController(s.swarm));
  app.post("/api/sim/swarms/:id/failed", simSwarmFailedController(s.swarm));
  app.patch("/api/sim/swarms/:id/outcome", simLinkOutcomeController(s.swarm));
  app.patch(
    "/api/sim/swarms/:id/aggregate",
    simSnapshotAggregateController(s.swarmStore),
  );
  app.post(
    "/api/sim/swarms/:id/close",
    simCloseSwarmController(s.swarmStore, s.operator),
  );
  app.get("/api/sim/swarms/:id/terminals", simTerminalsController(s.swarm, s.terminal));
  app.get(
    "/api/sim/swarms/:id/terminal-actions",
    simTerminalActionsController(s.swarm, s.terminal),
  );
  app.get("/api/sim/swarms/:id/status", simSwarmStatusController(s.swarmStatus));
  app.post("/api/sim/swarms/:id/abort", simSwarmAbortController(s.swarmStore));
  app.post(
    "/api/sim/swarms/:id/claim-pending-fish",
    simClaimPendingFishController(s.swarmStore),
  );
}
