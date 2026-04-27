/**
 * DAG turn runner for kinds that advance every actor in parallel.
 *
 * Semantics: every agent decides simultaneously per turn. Each agent's call
 * is independent (no cross-agent dependsOn edges within a turn), so we
 * fire all N agent calls via Promise.allSettled and then reconcile — N
 * sim_turn rows + N*(N-1) observation memories + N self_action memories
 * in a single transaction.
 *
 * Why not ThalamusDAGExecutor.execute(): the executor expects CortexFinding[]
 * output and wraps everything in a research_cycle. We only need the turn
 * response JSON, not findings. Keeping the skill output shape identical to
 * the sequential driver means one skill serves both paths.
 *
 * Failure mode: if K of N agents fail JSON validation after retries, the
 * turn is retried as a whole. The orchestrator decides how many whole-turn
 * retries to tolerate before failing the fish.
 */

import type { TurnAction, TurnResponse } from "./types";
import { createLogger, stepLog } from "@interview/shared/observability";
import { MemoryService } from "./memory.service";
import type { SimSubjectSnapshot } from "./ports";
import {
  callTurnAgent,
  createTurnContextLoader,
  loadTurnRunnerAgents,
  type TurnRunnerDeps,
  type TurnRunnerContextInput,
  type TurnRunnerAgent,
} from "./turn-runner.utils";

const logger = createLogger("sim-dag");
const DAG_MEMORY_QUERY =
  "recent decisions and observations affecting my fleet and posture";

export type DagRunnerDeps = TurnRunnerDeps & {
  llmMode: "cloud" | "fixtures" | "record";
};

export interface DagRunTurnOpts {
  simRunId: number;
  turnIndex: number;
  subjectSnapshots?: Map<number, SimSubjectSnapshot>;
  signal?: AbortSignal;
}

export interface DagRunTurnResult {
  simRunId: number;
  turnIndex: number;
  agentResults: Array<{
    agentId: number;
    simTurnId: number | null;
    action: TurnAction | null;
    error: string | null;
  }>;
  failedAgents: number[];
}

export class DagTurnRunner {
  private readonly buildContext: (
    args: TurnRunnerContextInput,
  ) => Promise<import("./types").AgentContext>;

  constructor(private readonly deps: DagRunnerDeps) {
    this.buildContext = createTurnContextLoader({
      deps,
      memoryQuery: DAG_MEMORY_QUERY,
    });
  }

  /**
   * Run one turn for every agent in the fish, in parallel.
   * Persists all successful turns + memories atomically. Any agent whose
   * call fails validation is reported in `failedAgents`; the orchestrator
   * decides whether to retry the whole turn.
   */
  async runTurn(opts: DagRunTurnOpts): Promise<DagRunTurnResult> {
    stepLog(logger, "fish.turn", "start", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      driver: "dag",
    });
    try {
    const agents = await loadTurnRunnerAgents(this.deps.store, opts.simRunId);
    if (agents.length === 0) {
      throw new Error(`No agents for sim_run ${opts.simRunId}`);
    }

    // Build contexts in parallel (memory lookups + god events).
    const contexts = await Promise.all(
      agents.map((agent) =>
        this.buildContext({
          simRunId: opts.simRunId,
          agent,
          turnIndex: opts.turnIndex,
          subjectSnapshot: opts.subjectSnapshots?.get(agent.id) ?? null,
          signal: opts.signal,
        }),
      ),
    );

    // Fire all agent calls in parallel. allSettled so one bad agent does
    // not take down the whole turn.
    const llmResults = await Promise.allSettled(
      contexts.map((ctx) => this.callAgent(ctx, opts.signal)),
    );

    // Separate successes / failures.
    type Success = { agent: TurnRunnerAgent; response: TurnResponse };
    type Failure = { agent: TurnRunnerAgent; reason: string };
    const successes: Success[] = [];
    const failures: Failure[] = [];
    for (let i = 0; i < agents.length; i++) {
      const r = llmResults[i];
      if (r.status === "fulfilled") {
        successes.push({ agent: agents[i], response: r.value });
      } else {
        failures.push({
          agent: agents[i],
          reason: (r.reason as Error)?.message ?? "unknown",
        });
      }
    }

    if (failures.length > 0) {
      logger.warn(
        {
          simRunId: opts.simRunId,
          turnIndex: opts.turnIndex,
          failedAgents: failures.map((f) => f.agent.id),
          reasons: failures.map((f) => f.reason),
        },
        "DAG turn — some agents failed validation",
      );
    }

    // Atomic persist of all successful agent turns + cross-agent memories.
    const agentTurns: Parameters<DagRunnerDeps["store"]["persistTurnBatch"]>[0]["agentTurns"] =
      successes.map<Parameters<DagRunnerDeps["store"]["persistTurnBatch"]>[0]["agentTurns"][number]>(
        (s) => ({
          simRunId: opts.simRunId,
          turnIndex: opts.turnIndex,
          agentId: s.agent.id,
          action: s.response.action,
          rationale: s.response.rationale,
          observableSummary: s.response.observableSummary,
          llmCostUsd: null as number | null,
        }),
      );
    if (agentTurns.length === 0) {
      throw new Error(
        `DAG turn failed for all agents: ${failures
          .map((f) => `${f.agent.id}:${f.reason}`)
          .join("; ")}`,
      );
    }
    const memoryRows: Parameters<DagRunnerDeps["store"]["persistTurnBatch"]>[0]["memoryRows"] = [];
    for (const s of successes) {
      memoryRows.push({
        simRunId: opts.simRunId,
        agentId: s.agent.id,
        turnIndex: opts.turnIndex,
        kind: "self_action",
        content: `${s.response.action.kind} - ${s.response.rationale}`,
        embedding: null,
      });
      for (const other of agents) {
        if (other.id === s.agent.id) continue;
        memoryRows.push({
          simRunId: opts.simRunId,
          agentId: other.id,
          turnIndex: opts.turnIndex,
          kind: "observation",
          content: s.response.observableSummary,
          embedding: null,
        });
      }
    }
    const persistedIds = await this.deps.store.persistTurnBatch({
      agentTurns,
      memoryRows,
    });
    if (persistedIds.length !== agentTurns.length) {
      throw new Error("persistTurnBatch returned an unexpected sim_turn id count");
    }
    const persisted = new Map<number, number>();
    for (let i = 0; i < agentTurns.length; i++) {
      persisted.set(agentTurns[i]!.agentId, persistedIds[i]!);
    }
    stepLog(logger, "fish.memory.write", "done", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      rows: memoryRows.length,
    });

    const agentResults = agents.map((agent) => {
      const success = successes.find((s) => s.agent.id === agent.id);
      const failure = failures.find((f) => f.agent.id === agent.id);
      return {
        agentId: agent.id,
        simTurnId: success ? persisted.get(agent.id) ?? null : null,
        action: success?.response.action ?? null,
        error: failure?.reason ?? null,
      };
    });

    logger.info(
      {
        simRunId: opts.simRunId,
        turnIndex: opts.turnIndex,
        agentCount: agents.length,
        successCount: successes.length,
        failureCount: failures.length,
      },
      "DAG turn complete",
    );

    stepLog(logger, "fish.turn", "done", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      driver: "dag",
      agentCount: agents.length,
      successCount: successes.length,
      failureCount: failures.length,
    });

    return {
      simRunId: opts.simRunId,
      turnIndex: opts.turnIndex,
      agentResults,
      failedAgents: failures.map((f) => f.agent.id),
    };
    } catch (err) {
      stepLog(logger, "fish.turn", "error", {
        simRunId: opts.simRunId,
        turn: opts.turnIndex,
        driver: "dag",
        err: (err as Error)?.message,
      });
      throw err;
    }
  }

  private async callAgent(ctx: import("./types").AgentContext, signal?: AbortSignal) {
    return callTurnAgent({
      deps: this.deps,
      ctx,
      logger,
      signal,
    });
  }

  /**
   * Advance the fish to done when turn_index reaches maxTurns. Callers
   * (the fish worker) invoke this after runTurn returns to decide whether
   * to schedule the next turn or close out.
   */
  async maybeCloseRun(opts: {
    simRunId: number;
    turnIndex: number;
    maxTurns: number;
  }): Promise<{ closed: boolean }> {
    if (opts.turnIndex + 1 < opts.maxTurns) return { closed: false };
    await this.deps.store.updateRunStatus(opts.simRunId, "done", new Date());
    return { closed: true };
  }
}
