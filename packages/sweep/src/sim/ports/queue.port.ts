export interface SimQueuePort {
  enqueueSimTurn(input: {
    simRunId: number;
    turnIndex: number;
    jobId?: string;
  }): Promise<void>;
  enqueueSwarmFish(input: {
    swarmId: number;
    simRunId: number;
    fishIndex: number;
    jobId?: string;
  }): Promise<void>;
  enqueueSwarmAggregate(input: {
    swarmId: number;
    jobId?: string;
  }): Promise<void>;
}
