import type { FastifyInstance } from "fastify";
import {
  simCreateAgentController,
  simListAgentsController,
} from "../controllers/sim-agent.controller";
import {
  simAgentCountController,
  simAgentTurnCountController,
  simCreateRunController,
  simGetRunController,
  simSeedController,
  simUpdateRunStatusController,
} from "../controllers/sim-run.controller";
import {
  simGodEventsController,
  simInsertAgentTurnController,
  simInsertGodTurnController,
  simLastTurnAtController,
  simObservableController,
  simPersistTurnBatchController,
} from "../controllers/sim-turn.controller";
import {
  simMemoryBatchController,
  simMemoryRecentController,
  simMemorySearchController,
} from "../controllers/sim-memory.controller";
import type { SimRouteServices } from "./sim-route-services";

export function registerSimRunRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
): void {
  app.post("/api/sim/runs", simCreateRunController(s.run));
  app.get("/api/sim/runs/:id", simGetRunController(s.run));
  app.patch("/api/sim/runs/:id/status", simUpdateRunStatusController(s.run));
  app.get("/api/sim/runs/:id/agent-count", simAgentCountController(s.run));
  app.get(
    "/api/sim/runs/:id/agent-turn-count",
    simAgentTurnCountController(s.run),
  );
  app.get("/api/sim/runs/:id/seed", simSeedController(s.run));
  app.post("/api/sim/runs/:id/agents", simCreateAgentController(s.run, s.agent));
  app.get("/api/sim/runs/:id/agents", simListAgentsController(s.run, s.agent));
  app.post("/api/sim/runs/:id/turns", simInsertAgentTurnController(s.run, s.turn));
  app.post(
    "/api/sim/runs/:id/turns/batch",
    simPersistTurnBatchController(s.run, s.turn),
  );
  app.post("/api/sim/runs/:id/god-turns", simInsertGodTurnController(s.run, s.turn));
  app.get("/api/sim/runs/:id/god-events", simGodEventsController(s.run, s.turn));
  app.get("/api/sim/runs/:id/last-turn-at", simLastTurnAtController(s.run, s.turn));
  app.post("/api/sim/runs/:id/memory/batch", simMemoryBatchController(s.run, s.memory));
  app.post(
    "/api/sim/runs/:id/memory/search",
    simMemorySearchController(s.run, s.memory),
  );
  app.get("/api/sim/runs/:id/memory/recent", simMemoryRecentController(s.run, s.memory));
  app.get("/api/sim/runs/:id/observable", simObservableController(s.run, s.turn));
}
