import type {
  SimFishTerminalActionRow,
  SimFishTerminalRow,
} from "../types/sim-terminal.types";

export interface SimTerminalReadPort {
  listTerminalsForSwarm(swarmId: bigint): Promise<SimFishTerminalRow[]>;
  listTerminalActionsForSwarm(
    swarmId: bigint,
  ): Promise<SimFishTerminalActionRow[]>;
}

export class SimTerminalService {
  constructor(private readonly terminalRepo: SimTerminalReadPort) {}

  listTerminalsForSwarm(swarmId: bigint): Promise<SimFishTerminalRow[]> {
    return this.terminalRepo.listTerminalsForSwarm(swarmId);
  }

  listTerminalActionsForSwarm(
    swarmId: bigint,
  ): Promise<SimFishTerminalActionRow[]> {
    return this.terminalRepo.listTerminalActionsForSwarm(swarmId);
  }
}
