import type { LaunchSwarmResult, SwarmService } from "@interview/sweep/internal";
import {
  startPcEstimatorSwarm,
  startTelemetrySwarm,
} from "../agent/ssa/sim";
import type {
  TelemetrySwarmOpts,
  TelemetrySwarmTargetReadPort,
} from "../agent/ssa/sim/swarms/telemetry";
import type {
  PcEstimatorSwarmOpts,
  PcSwarmConjunctionReadPort,
} from "../agent/ssa/sim/swarms/pc";

export interface SimLauncherPort {
  startTelemetry(opts: TelemetrySwarmOpts): Promise<LaunchSwarmResult>;
  startPc(
    opts: PcEstimatorSwarmOpts,
  ): Promise<LaunchSwarmResult & { conjunctionId: number }>;
}

export interface SimLauncherDeps {
  satelliteRepo: TelemetrySwarmTargetReadPort;
  conjunctionRepo: PcSwarmConjunctionReadPort;
  swarmService: Pick<SwarmService, "launchSwarm">;
}

export class SimLauncherService implements SimLauncherPort {
  constructor(private readonly deps: SimLauncherDeps) {}

  startTelemetry(opts: TelemetrySwarmOpts): Promise<LaunchSwarmResult> {
    return startTelemetrySwarm(
      {
        satelliteRepo: this.deps.satelliteRepo,
        swarmService: this.deps.swarmService,
      },
      opts,
    );
  }

  startPc(
    opts: PcEstimatorSwarmOpts,
  ): Promise<LaunchSwarmResult & { conjunctionId: number }> {
    return startPcEstimatorSwarm(
      {
        conjunctionRepo: this.deps.conjunctionRepo,
        swarmService: this.deps.swarmService,
      },
      opts,
    );
  }
}
