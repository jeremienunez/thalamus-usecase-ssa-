import type { FastifyInstance } from "fastify";
import type { SimOrchestrator, SwarmService } from "@interview/sweep";
import type { SimAgentService } from "../services/sim-agent.service";
import type { SimGodChannelService } from "../services/sim-god-channel.service";
import type { SimTargetService } from "../services/sim-target.service";
import type { SimFleetService } from "../services/sim-fleet.service";
import type { SimRunService } from "../services/sim-run.service";
import type { SimSwarmService } from "../services/sim-swarm.service";
import type { SimTurnService } from "../services/sim-turn.service";
import type { SimMemoryService } from "../services/sim-memory.service";
import type { SimTerminalService } from "../services/sim-terminal.service";
import {
  authenticate,
  requireSimKernelSecret,
  requireTier,
} from "../middleware/auth.middleware";
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
  simPauseController,
  simResumeController,
  simScheduleNextController,
  simStatusController,
} from "../controllers/sim-orchestrator.controller";
import {
  simGodEventsController,
  simInsertAgentTurnController,
  simInsertGodTurnController,
  simLastTurnAtController,
  simObservableController,
  simPersistTurnBatchController,
} from "../controllers/sim-turn.controller";
import { simInjectController } from "../controllers/sim-god-channel.controller";
import {
  simMemoryBatchController,
  simMemoryRecentController,
  simMemorySearchController,
} from "../controllers/sim-memory.controller";
import { simTargetsController } from "../controllers/sim-target.controller";
import {
  simAgentSubjectController,
  simAuthorLabelsController,
} from "../controllers/sim-fleet.controller";
import {
  simPromotionFromModalController,
  simPromotionTelemetryController,
  type SimPromotionRoutePort,
} from "../controllers/sim-promotion.controller";
import {
  simTerminalActionsController,
  simTerminalsController,
} from "../controllers/sim-terminal.controller";
import type { SimQueueRoutePort } from "../controllers/sim-queue.controller";
import {
  simQueueSwarmAggregateController,
  simQueueSwarmFishController,
  simQueueTurnController,
} from "../controllers/sim-queue.controller";
import type { SimLauncherRoutePort } from "../controllers/sim-launcher.controller";
import {
  simStartPcController,
  simStartStandaloneController,
  simStartTelemetryController,
} from "../controllers/sim-launcher.controller";

type SimOrchestratorRoutePort = Pick<
  SimOrchestrator,
  "pause" | "resume" | "scheduleNext" | "status" | "startStandalone"
>;
type SimSwarmStatusPort = Pick<SwarmService, "status">;
type SimSwarmStoreRoutePort = {
  abortSwarm(swarmId: number): Promise<void>;
  snapshotAggregate(input: {
    swarmId: number;
    key: string;
    value: Record<string, unknown>;
  }): Promise<void>;
  closeSwarm(input: {
    swarmId: number;
    status: "done" | "failed";
    suggestionId?: number | null;
    reportFindingId?: number | null;
    completedAt?: Date;
  }): Promise<void>;
};

export interface SimRouteServices {
  orchestrator: SimOrchestratorRoutePort;
  swarmStatus: SimSwarmStatusPort;
  swarmStore: SimSwarmStoreRoutePort;
  run: SimRunService;
  agent: SimAgentService;
  swarm: SimSwarmService;
  turn: SimTurnService;
  memory: SimMemoryService;
  terminal: SimTerminalService;
  queue: SimQueueRoutePort;
  launcher: SimLauncherRoutePort;
  godChannel: SimGodChannelService;
  target: SimTargetService;
  fleet: SimFleetService;
  promotion: SimPromotionRoutePort;
}

export function registerSimRoutes(
  app: FastifyInstance,
  s: SimRouteServices,
): void {
  app.register((simApp, _opts, done) => {
    simApp.addHook("preHandler", authenticate);
    simApp.addHook("preHandler", requireTier("investment", "franchise"));

    simApp.post("/api/sim/runs", simCreateRunController(s.run));
    simApp.get("/api/sim/runs/:id", simGetRunController(s.run));
    simApp.patch(
      "/api/sim/runs/:id/status",
      simUpdateRunStatusController(s.run),
    );
    simApp.get(
      "/api/sim/runs/:id/agent-count",
      simAgentCountController(s.run),
    );
    simApp.get(
      "/api/sim/runs/:id/agent-turn-count",
      simAgentTurnCountController(s.run),
    );
    simApp.get("/api/sim/runs/:id/seed", simSeedController(s.run));
    simApp.post(
      "/api/sim/runs/:id/agents",
      simCreateAgentController(s.run, s.agent),
    );
    simApp.get(
      "/api/sim/runs/:id/agents",
      simListAgentsController(s.run, s.agent),
    );
    simApp.post(
      "/api/sim/runs/:id/turns",
      simInsertAgentTurnController(s.run, s.turn),
    );
    simApp.post(
      "/api/sim/runs/:id/turns/batch",
      simPersistTurnBatchController(s.run, s.turn),
    );
    simApp.post(
      "/api/sim/runs/:id/god-turns",
      simInsertGodTurnController(s.run, s.turn),
    );
    simApp.get(
      "/api/sim/runs/:id/god-events",
      simGodEventsController(s.run, s.turn),
    );
    simApp.get(
      "/api/sim/runs/:id/last-turn-at",
      simLastTurnAtController(s.run, s.turn),
    );
    simApp.post(
      "/api/sim/runs/:id/memory/batch",
      simMemoryBatchController(s.run, s.memory),
    );
    simApp.post(
      "/api/sim/runs/:id/memory/search",
      simMemorySearchController(s.run, s.memory),
    );
    simApp.get(
      "/api/sim/runs/:id/memory/recent",
      simMemoryRecentController(s.run, s.memory),
    );
    simApp.get(
      "/api/sim/runs/:id/observable",
      simObservableController(s.run, s.turn),
    );

    simApp.post("/api/sim/swarms", simCreateSwarmController(s.swarm));
    simApp.get("/api/sim/swarms/:id", simGetSwarmController(s.swarm));
    simApp.get(
      "/api/sim/swarms/:id/fish-counts",
      simFishCountsController(s.swarm),
    );
    simApp.post("/api/sim/swarms/:id/done", simSwarmDoneController(s.swarm));
    simApp.post(
      "/api/sim/swarms/:id/failed",
      simSwarmFailedController(s.swarm),
    );
    simApp.patch(
      "/api/sim/swarms/:id/outcome",
      simLinkOutcomeController(s.swarm),
    );
    simApp.patch(
      "/api/sim/swarms/:id/aggregate",
      simSnapshotAggregateController(s.swarmStore),
    );
    simApp.post(
      "/api/sim/swarms/:id/close",
      simCloseSwarmController(s.swarmStore),
    );
    simApp.get(
      "/api/sim/swarms/:id/terminals",
      simTerminalsController(s.swarm, s.terminal),
    );
    simApp.get(
      "/api/sim/swarms/:id/terminal-actions",
      simTerminalActionsController(s.swarm, s.terminal),
    );
    simApp.get(
      "/api/sim/swarms/:id/status",
      simSwarmStatusController(s.swarmStatus),
    );
    simApp.post(
      "/api/sim/swarms/:id/abort",
      simSwarmAbortController(s.swarmStore),
    );

    simApp.post(
      "/api/sim/telemetry/start",
      simStartTelemetryController(s.launcher),
    );
    simApp.post("/api/sim/pc/start", simStartPcController(s.launcher));
    simApp.post(
      "/api/sim/standalone/start",
      simStartStandaloneController(s.orchestrator),
    );

    simApp.post("/api/sim/runs/:id/pause", simPauseController(s.orchestrator));
    simApp.post("/api/sim/runs/:id/resume", simResumeController(s.orchestrator));
    simApp.post(
      "/api/sim/runs/:id/schedule-next",
      simScheduleNextController(s.orchestrator),
    );
    simApp.get("/api/sim/runs/:id/status", simStatusController(s.orchestrator));
    simApp.post("/api/sim/runs/:id/inject", simInjectController(s.godChannel));
    simApp.get("/api/sim/runs/:id/targets", simTargetsController(s.target));
    simApp.get("/api/sim/subjects/:kind/:id", simAgentSubjectController(s.fleet));
    simApp.post("/api/sim/subjects/author-labels", simAuthorLabelsController(s.fleet));
    done();
  });

  app.register((queueApp, _opts, done) => {
    queueApp.addHook("preHandler", requireSimKernelSecret());
    queueApp.post("/api/sim/queue/sim-turn", simQueueTurnController(s.queue));
    queueApp.post(
      "/api/sim/queue/swarm-fish",
      simQueueSwarmFishController(s.queue),
    );
    queueApp.post(
      "/api/sim/queue/swarm-aggregate",
      simQueueSwarmAggregateController(s.queue),
    );
    queueApp.post(
      "/api/sim/promotions/modal",
      simPromotionFromModalController(s.promotion),
    );
    queueApp.post(
      "/api/sim/promotions/scalars",
      simPromotionTelemetryController(s.promotion),
    );
    done();
  });
}
