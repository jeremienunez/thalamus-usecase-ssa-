/**
 * Sequential turn runner for kinds that advance one actor at a time.
 *
 * One agent speaks per turn, strictly alternating by `turnIndex % agents.length`.
 * Calls the pack-selected cortex, parses the JSON response, writes one
 * sim_turn row + memory rows atomically. Terminal actions mark
 * sim_run.status = 'done'.
 */

import type { TurnAction } from "./types";
import { createLogger, stepLog } from "@interview/shared/observability";
import { MemoryService } from "./memory.service";
import { isTerminal } from "./promote";
import type { SimSubjectSnapshot } from "./ports";
import {
  callTurnAgent,
  createTurnContextLoader,
  loadTurnRunnerAgents,
  type TurnRunnerDeps,
  type TurnRunnerContextInput,
} from "./turn-runner.utils";

const logger = createLogger("sim-sequential");
const SEQUENTIAL_MEMORY_QUERY =
  "recent decisions and observations affecting this negotiation";

export interface SequentialRunnerDeps extends TurnRunnerDeps {
  llmMode: "cloud" | "fixtures" | "record";
  embed?: (text: string) => Promise<number[] | null>;
}

export interface RunTurnOpts {
  simRunId: number;
  turnIndex: number;
  subjectSnapshots?: Map<number, SimSubjectSnapshot>;
  signal?: AbortSignal;
}

export interface RunTurnResult {
  simTurnId: number;
  agentId: number;
  action: TurnAction;
  terminal: boolean;
  promotedFindingId: number | null;
}

export class SequentialTurnRunner {
  private readonly buildContext: (
    args: TurnRunnerContextInput,
  ) => Promise<import("./types").AgentContext>;

  constructor(private readonly deps: SequentialRunnerDeps) {
    this.buildContext = createTurnContextLoader({
      deps,
      memoryQuery: SEQUENTIAL_MEMORY_QUERY,
    });
  }

  /**
   * Run exactly one turn: pick speaker by parity, call LLM, persist,
   * update sim_run.status if terminal.
   */
  async runTurn(opts: RunTurnOpts): Promise<RunTurnResult> {
    stepLog(logger, "fish.turn", "start", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      driver: "sequential",
    });
    try {
    const agents = await loadTurnRunnerAgents(this.deps.store, opts.simRunId);
    if (agents.length === 0) {
      throw new Error(`No agents for sim_run ${opts.simRunId}`);
    }
    const speaker = agents[opts.turnIndex % agents.length];

    const ctx = await this.buildContext({
      simRunId: opts.simRunId,
      agent: speaker,
      turnIndex: opts.turnIndex,
      subjectSnapshot: opts.subjectSnapshots?.get(speaker.id) ?? null,
      signal: opts.signal,
    });

    const response = await this.callAgent(ctx, opts.signal);

    const terminal = isTerminal(response.action);

    const selfMemory = `${response.action.kind} - ${response.rationale}`;
    const batch: Parameters<SequentialRunnerDeps["store"]["persistTurnBatch"]>[0] = {
      agentTurns: [
        {
          simRunId: opts.simRunId,
          turnIndex: opts.turnIndex,
          agentId: speaker.id,
          action: response.action,
          rationale: response.rationale,
          observableSummary: response.observableSummary,
          llmCostUsd: null,
        },
      ],
      memoryRows: [
        {
          simRunId: opts.simRunId,
          agentId: speaker.id,
          turnIndex: opts.turnIndex,
          kind: "self_action",
          content: selfMemory,
          embedding: null,
        },
        ...agents
          .filter((a) => a.id !== speaker.id)
          .map((other) => ({
            simRunId: opts.simRunId,
            agentId: other.id,
            turnIndex: opts.turnIndex,
            kind: "observation" as const,
            content: response.observableSummary,
            embedding: null as number[] | null,
          })),
      ],
    };
    const [simTurnId] = await this.deps.store.persistTurnBatch(batch);
    if (simTurnId === undefined) {
      throw new Error("persistTurnBatch returned no sim_turn id");
    }
    stepLog(logger, "fish.memory.write", "done", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      agentId: speaker.id,
    });

    if (terminal) {
      await this.deps.store.updateRunStatus(opts.simRunId, "done", new Date());
    }

    // KG audit (research_cycle + research_finding + edge) is produced by the
    // swarm aggregator once per swarm, not per fish turn. See
    // emitSuggestionFromModal() in sim/promote.ts.
    const promotedFindingId: number | null = null;

    logger.info(
      {
        simRunId: opts.simRunId,
        turnIndex: opts.turnIndex,
        agentId: speaker.id,
        actionKind: response.action.kind,
        terminal,
      },
      "sequential turn complete",
    );

    stepLog(logger, "fish.turn", "done", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      driver: "sequential",
      agentId: speaker.id,
      actionKind: response.action.kind,
      terminal,
    });

    return {
      simTurnId,
      agentId: speaker.id,
      action: response.action,
      terminal,
      promotedFindingId,
    };
    } catch (err) {
      stepLog(logger, "fish.turn", "error", {
        simRunId: opts.simRunId,
        turn: opts.turnIndex,
        driver: "sequential",
        err: (err as Error)?.message,
      });
      throw err;
    }
  }

  // -------------------------------------------------------------------
  // LLM call + JSON parse + Zod validation
  // -------------------------------------------------------------------

  private async callAgent(ctx: import("./types").AgentContext, signal?: AbortSignal) {
    return callTurnAgent({
      deps: this.deps,
      ctx,
      logger,
      includeValidationSnippet: true,
      signal,
    });
  }

}
