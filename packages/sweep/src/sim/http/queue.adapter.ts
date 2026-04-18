import type { SimQueuePort } from "../ports/queue.port";
import { SimHttpClient } from "./client";

export interface SimQueueHttpAdapterOpts {
  kernelSecret?: string;
}

export class SimQueueHttpAdapter implements SimQueuePort {
  private readonly headers: Record<string, string> | undefined;

  constructor(
    private readonly http: SimHttpClient,
    opts: SimQueueHttpAdapterOpts = {},
  ) {
    this.headers = opts.kernelSecret
      ? { "x-sim-kernel-secret": opts.kernelSecret }
      : undefined;
  }

  async enqueueSimTurn(input: Parameters<SimQueuePort["enqueueSimTurn"]>[0]) {
    await this.http.post(
      "/api/sim/queue/sim-turn",
      {
        simRunId: String(input.simRunId),
        turnIndex: input.turnIndex,
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      },
      { headers: this.headers },
    );
  }

  async enqueueSwarmFish(
    input: Parameters<SimQueuePort["enqueueSwarmFish"]>[0],
  ) {
    await this.http.post(
      "/api/sim/queue/swarm-fish",
      {
        swarmId: String(input.swarmId),
        simRunId: String(input.simRunId),
        fishIndex: input.fishIndex,
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      },
      { headers: this.headers },
    );
  }

  async enqueueSwarmAggregate(
    input: Parameters<SimQueuePort["enqueueSwarmAggregate"]>[0],
  ) {
    await this.http.post(
      "/api/sim/queue/swarm-aggregate",
      {
        swarmId: String(input.swarmId),
        ...(input.jobId === undefined ? {} : { jobId: input.jobId }),
      },
      { headers: this.headers },
    );
  }
}
