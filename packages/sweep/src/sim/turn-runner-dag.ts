/**
 * DAG turn runner — UC1 parallel operator-behavior driver.
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
 * the Sequential driver means one skill serves both paths (fixture cache
 * keys match across drivers, zero duplication).
 *
 * Failure mode: if K of N agents fail JSON validation after retries, the
 * turn is retried as a whole. The orchestrator decides how many whole-turn
 * retries to tolerate before failing the fish.
 */

import { asc, eq, sql } from "drizzle-orm";
import type { Database, NewSimTurn, TurnAction } from "@interview/db-schema";
import { simAgent, simRun, simTurn } from "@interview/db-schema";
import type { CortexRegistry } from "@interview/thalamus";
import { callNanoWithMode, extractJsonObject } from "@interview/thalamus";
import { createLogger, stepLog } from "@interview/shared/observability";
import type {
  AgentContext,
  FleetSnapshot,
  PcEstimatorTarget,
  TelemetryTarget,
  TurnResponse,
} from "./types";
import { buildTurnResponseSchema } from "./schema";
import { MemoryService } from "./memory.service";
import type {
  SimActionSchemaProvider,
  SimCortexSelector,
  SimPromptComposer,
  SimTurnTargetProvider,
} from "./ports";

const logger = createLogger("sim-dag");

const MAX_JSON_RETRIES = 2;

export interface DagRunnerDeps {
  db: Database;
  memory: MemoryService;
  /** Cortex registry — used to resolve skill bodies as nano instructions. */
  cortexRegistry: CortexRegistry;
  llmMode: "cloud" | "fixtures" | "record";
  /** Plan 2 · B.2 — pack-provided turn target loader (telemetry / pc). */
  targets: SimTurnTargetProvider;
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
  /** Optional pre-computed fleet snapshots keyed by agentId. */
  fleetSnapshots?: Map<number, FleetSnapshot>;
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
          fleetSnapshot: opts.fleetSnapshots?.get(agent.id) ?? null,
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
    const persisted = await this.deps.db.transaction(async (tx) => {
      const simTurnIdByAgent = new Map<number, number>();
      for (const s of successes) {
        const insertRow: NewSimTurn = {
          simRunId: BigInt(opts.simRunId),
          turnIndex: opts.turnIndex,
          actorKind: "agent",
          agentId: BigInt(s.agent.id),
          action: s.response.action,
          rationale: s.response.rationale,
          observableSummary: s.response.observableSummary,
          llmCostUsd: null,
        };
        const [turnRow] = await tx
          .insert(simTurn)
          .values(insertRow)
          .returning({ id: simTurn.id });
        if (!turnRow) throw new Error("insert sim_turn returned no row");
        simTurnIdByAgent.set(s.agent.id, Number(turnRow.id));
      }

      // Memory writes: for each success, write one self_action + one
      // observation row for every OTHER agent in the fish (including agents
      // whose own turn failed — they still observe what happened).
      const memoryRows: Array<{
        simRunId: number;
        agentId: number;
        turnIndex: number;
        kind: "self_action" | "observation";
        content: string;
      }> = [];
      for (const s of successes) {
        memoryRows.push({
          simRunId: opts.simRunId,
          agentId: s.agent.id,
          turnIndex: opts.turnIndex,
          kind: "self_action",
          content: `${s.response.action.kind} — ${s.response.rationale}`,
        });
        for (const other of agents) {
          if (other.id === s.agent.id) continue;
          memoryRows.push({
            simRunId: opts.simRunId,
            agentId: other.id,
            turnIndex: opts.turnIndex,
            kind: "observation",
            content: s.response.observableSummary,
          });
        }
      }
      await this.deps.memory.writeMany(memoryRows);
      stepLog(logger, "fish.memory.write", "done", {
        simRunId: opts.simRunId,
        turn: opts.turnIndex,
        rows: memoryRows.length,
      });

      return simTurnIdByAgent;
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
        fleetSnapshot: ctx.fleetSnapshot,
        telemetryTarget: ctx.telemetryTarget,
        pcEstimatorTarget: ctx.pcEstimatorTarget,
      },
      observable: ctx.observable,
      godEvents: ctx.godEvents,
      topMemories: ctx.topMemories,
    });
    const cortexName = this.deps.cortexSelector.pickCortexName({
      simKind: "",
      turnIndex: ctx.turnIndex,
      hints: {
        hasTelemetryTarget: ctx.telemetryTarget !== null,
        hasPcEstimatorTarget: ctx.pcEstimatorTarget !== null,
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
    fleetSnapshot: FleetSnapshot | null;
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
    const targets = await this.deps.targets.loadTargets({
      simRunId: args.simRunId,
      seedHints: {},
    });
    const telemetryTarget = (targets.telemetryTarget as TelemetryTarget | null) ?? null;
    const pcEstimatorTarget =
      (targets.pcEstimatorTarget as PcEstimatorTarget | null) ?? null;

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
        authorLabel: o.operatorName ?? (o.actorKind === "god" ? "GOD" : "SYSTEM"),
        observableSummary: o.observableSummary,
      })),
      godEvents,
      fleetSnapshot: args.fleetSnapshot,
      telemetryTarget,
      pcEstimatorTarget,
    };
  }

  private async loadGodEvents(
    simRunId: number,
    turnIndex: number,
  ): Promise<AgentContext["godEvents"]> {
    const rows = await this.deps.db.execute(sql`
      SELECT turn_index, observable_summary, action
      FROM sim_turn
      WHERE sim_run_id = ${BigInt(simRunId)}
        AND actor_kind = 'god'
        AND turn_index <= ${turnIndex}
      ORDER BY turn_index ASC
      LIMIT 10
    `);
    return (rows.rows as Array<{
      turn_index: number;
      observable_summary: string;
      action: { detail?: string } | null;
    }>).map((r) => ({
      turnIndex: r.turn_index,
      summary: r.observable_summary,
      detail: r.action?.detail,
    }));
  }

  private async loadAgents(simRunId: number): Promise<LoadedAgent[]> {
    const rows = await this.deps.db
      .select({
        id: simAgent.id,
        agentIndex: simAgent.agentIndex,
        persona: simAgent.persona,
        goals: simAgent.goals,
        constraints: simAgent.constraints,
      })
      .from(simAgent)
      .where(eq(simAgent.simRunId, BigInt(simRunId)))
      .orderBy(asc(simAgent.agentIndex));
    return rows.map((r) => ({
      id: Number(r.id),
      agentIndex: r.agentIndex,
      persona: r.persona,
      goals: r.goals as string[],
      constraints: r.constraints as Record<string, unknown>,
    }));
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
    await this.deps.db
      .update(simRun)
      .set({ status: "done", completedAt: new Date() })
      .where(eq(simRun.id, BigInt(opts.simRunId)));
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
