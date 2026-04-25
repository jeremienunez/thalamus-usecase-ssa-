import type { SimOrchestrator, SwarmService } from "@interview/sweep/internal";
import type { SimAgentService } from "../services/sim-agent.service";
import type { SimGodChannelService } from "../services/sim-god-channel.service";
import type { SimTargetService } from "../services/sim-target.service";
import type { SimFleetService } from "../services/sim-fleet.service";
import type { SimRunService } from "../services/sim-run.service";
import type { SimSwarmService } from "../services/sim-swarm.service";
import type { SimTurnService } from "../services/sim-turn.service";
import type { SimMemoryService } from "../services/sim-memory.service";
import type { SimTerminalService } from "../services/sim-terminal.service";
import type { SimPromotionRoutePort } from "../controllers/sim-promotion.controller";
import type { SimQueueRoutePort } from "../controllers/sim-queue.controller";
import type { SimLauncherRoutePort } from "../controllers/sim-launcher.controller";

type SimOrchestratorRoutePort = Pick<
  SimOrchestrator,
  "pause" | "resume" | "scheduleNext" | "status" | "startStandalone"
>;

type SimSwarmStatusPort = Pick<SwarmService, "status">;

type SimSwarmStoreRoutePort = {
  abortSwarm(swarmId: number): Promise<void>;
  claimPendingFishForSwarm(
    swarmId: number,
    limit: number,
  ): Promise<Array<{ simRunId: number; fishIndex: number }>>;
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
