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

import type { TurnAction } from "./types";
import type { CortexRegistry } from "@interview/thalamus";
import { callNanoWithMode, extractJsonObject } from "@interview/thalamus";
import { createLogger, stepLog } from "@interview/shared/observability";
import type { AgentContext, TurnResponse } from "./types";
import { buildTurnResponseSchema } from "./schema";
import { MemoryService } from "./memory.service";
import type {
  SimActionSchemaProvider,
  SimCortexSelector,
  SimPromptComposer,
  SimRuntimeStore,
  SimScenarioContextProvider,
  SimSubjectSnapshot,
} from "./ports";

const logger = createLogger("sim-dag");

const MAX_JSON_RETRIES = 2;

export interface DagRunnerDeps {
  store: SimRuntimeStore;
  memory: MemoryService;
  /** Cortex registry — used to resolve skill bodies as nano instructions. */
  cortexRegistry: CortexRegistry;
  llmMode: "cloud" | "fixtures" | "record";
  targets: SimScenarioContextProvider;
  /** Plan 2 · B.4 — pack-provided prompt renderer. */
  prompt: SimPromptComposer;
  /** Plan 2 · B.4 — pack-provided cortex skill selector. */
  cortexSelector: SimCortexSelector;
  /** Plan 2 · B.5 — pack-provided action Zod schema. */
  schemaProvider: SimActionSchemaProvider;
}

export interface DagRunTurnOpts {
  simRunId: number;
  turnIndex: number;
  subjectSnapshots?: Map<number, SimSubjectSnapshot>;
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
  constructor(private readonly deps: DagRunnerDeps) {}

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
    const agents = await this.loadAgents(opts.simRunId);
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
        }),
      ),
    );

    // Fire all agent calls in parallel. allSettled so one bad agent does
    // not take down the whole turn.
    const llmResults = await Promise.allSettled(
      contexts.map((ctx) => this.callAgent(ctx)),
    );

    // Separate successes / failures.
    type Success = { agent: LoadedAgent; response: TurnResponse };
    type Failure = { agent: LoadedAgent; reason: string };
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
    const agentTurns: Parameters<SimRuntimeStore["persistTurnBatch"]>[0]["agentTurns"] =
      successes.map<Parameters<SimRuntimeStore["persistTurnBatch"]>[0]["agentTurns"][number]>(
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
    const memoryRows: Parameters<SimRuntimeStore["persistTurnBatch"]>[0]["memoryRows"] = [];
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

  // -------------------------------------------------------------------
  // LLM call + JSON parse + Zod validation (identical to Sequential —
  // kept inline to avoid a shared-class factory that would complicate DI).
  // -------------------------------------------------------------------

  private async callAgent(ctx: AgentContext): Promise<TurnResponse> {
    const userPrompt = this.deps.prompt.render({
      frame: {
        turnIndex: ctx.turnIndex,
        persona: ctx.persona,
        goals: ctx.goals,
        constraints: ctx.constraints,
      },
      domain: {
        subjectSnapshot: ctx.subjectSnapshot,
        scenarioContext: ctx.scenarioContext,
      },
      observable: ctx.observable,
      godEvents: ctx.godEvents,
      topMemories: ctx.topMemories,
    });
    const cortexName = this.deps.cortexSelector.pickCortexName({
      simKind: "",
      turnIndex: ctx.turnIndex,
      hints: {
        hasScenarioContext: ctx.scenarioContext !== null,
      },
    });
    const skill = this.deps.cortexRegistry.get(cortexName);
    if (!skill) {
      throw new Error(
        `Cortex skill '${cortexName}' not found in registry. Did you discover() skills at boot?`,
      );
    }
    const instructions = skill.body;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
      const res = await callNanoWithMode({
        instructions,
        input: userPrompt,
        enableWebSearch: false,
      });
      if (!res.ok) {
        lastError = new Error(res.error ?? "nano call failed");
        logger.warn(
          { simRunId: ctx.simRunId, agentId: ctx.agentId, turnIndex: ctx.turnIndex, attempt, err: res.error },
          "nano call failed",
        );
        continue;
      }
      try {
        const raw = extractJsonObject(res.text);
        const responseSchema = buildTurnResponseSchema(
          this.deps.schemaProvider.actionSchema(),
        );
        const parsed = responseSchema.parse(raw);
        return parsed as TurnResponse;
      } catch (err) {
        lastError = err as Error;
        logger.warn(
          {
            simRunId: ctx.simRunId,
            agentId: ctx.agentId,
            turnIndex: ctx.turnIndex,
            attempt,
            err: (err as Error).message,
          },
          "agent response failed schema validation",
        );
      }
    }
    throw new Error(
      `${cortexName} response invalid after ${MAX_JSON_RETRIES + 1} attempts: ${lastError?.message}`,
    );
  }

  // -------------------------------------------------------------------
  // Context assembly — shares the pattern with Sequential but uses
  // per-agent lookup (the DAG driver builds N contexts per turn).
  // -------------------------------------------------------------------

  private async buildContext(args: {
    simRunId: number;
    agent: LoadedAgent;
    turnIndex: number;
    subjectSnapshot: SimSubjectSnapshot | null;
  }): Promise<AgentContext> {
    const [topMemories, observable] = await Promise.all([
      this.deps.memory.topK({
        simRunId: args.simRunId,
        agentId: args.agent.id,
        query: "recent decisions and observations affecting my fleet and posture",
        k: 8,
      }),
      this.deps.memory.recentObservable({
        simRunId: args.simRunId,
        sinceTurnIndex: args.turnIndex - 6,
        excludeAgentId: args.agent.id,
        limit: 20,
      }),
    ]);

    const godEvents = await this.loadGodEvents(args.simRunId, args.turnIndex);
    const scenarioContext = await this.deps.targets.loadContext({
      simRunId: args.simRunId,
      seedHints: {},
    });

    return {
      simRunId: args.simRunId,
      agentId: args.agent.id,
      agentIndex: args.agent.agentIndex,
      turnIndex: args.turnIndex,
      persona: args.agent.persona,
      goals: args.agent.goals,
      constraints: args.agent.constraints,
      topMemories: topMemories.map((m) => ({
        turnIndex: m.turnIndex,
        kind: m.kind,
        content: m.content,
      })),
      observable: observable.map((o) => ({
        turnIndex: o.turnIndex,
        actorKind: o.actorKind,
        authorLabel: o.authorLabel ?? (o.actorKind === "god" ? "GOD" : "SYSTEM"),
        observableSummary: o.observableSummary,
      })),
      godEvents,
      subjectSnapshot: args.subjectSnapshot,
      scenarioContext,
    };
  }

  private async loadGodEvents(
    simRunId: number,
    turnIndex: number,
  ): Promise<AgentContext["godEvents"]> {
    const rows = await this.deps.store.listGodEventsAtOrBefore(
      simRunId,
      turnIndex,
      10,
    );
    return rows.map((r) => ({
      turnIndex: r.turnIndex,
      summary: r.observableSummary,
      detail: r.detail,
    }));
  }

  private async loadAgents(simRunId: number): Promise<LoadedAgent[]> {
    return this.deps.store.listAgents(simRunId);
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

interface LoadedAgent {
  id: number;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}
