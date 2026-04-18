import type {
  SimFishTerminalActionRow,
  SimFishTerminalRow,
  SimTerminalRepository,
} from "../repositories/sim-terminal.repository";

export class SimTerminalService {
  constructor(
    private readonly terminalRepo: Pick<
      SimTerminalRepository,
      "listTerminalsForSwarm" | "listTerminalActionsForSwarm"
    >,
  ) {}

  listTerminalsForSwarm(swarmId: bigint): Promise<SimFishTerminalRow[]> {
    return this.terminalRepo.listTerminalsForSwarm(swarmId);
  }

  listTerminalActionsForSwarm(
    swarmId: bigint,
  ): Promise<SimFishTerminalActionRow[]> {
    return this.terminalRepo.listTerminalActionsForSwarm(swarmId);
  }
}
