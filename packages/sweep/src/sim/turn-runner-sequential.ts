/**
 * Sequential turn runner — UC3 conjunction negotiation driver.
 *
 * One agent speaks per turn, strictly alternating by `turnIndex % agents.length`.
 * Calls sim_operator_agent via runSkillFreeform, parses the JSON response,
 * writes one sim_turn row + memory rows atomically. Terminal actions (accept /
 * reject) mark sim_run.status = 'done'.
 */

import { asc, eq, sql } from "drizzle-orm";
import type { Database, NewSimTurn, TurnAction } from "@interview/db-schema";
import { simAgent, simRun, simTurn } from "@interview/db-schema";
import type { CortexRegistry } from "@interview/thalamus";
import { callNanoWithMode, extractJsonObject } from "@interview/thalamus";
import { createLogger } from "@interview/shared/observability";
import type { AgentContext, FleetSnapshot, TurnResponse } from "./types";
import { turnResponseSchema } from "./schema";
import { MemoryService } from "./memory.service";
import { renderTurnPrompt } from "./prompt";
import { isTerminal } from "./promote";
import { loadTelemetryTarget } from "./load-telemetry-target";

const logger = createLogger("sim-sequential");

const DEFAULT_CORTEX_NAME = "sim_operator_agent";
const TELEMETRY_CORTEX_NAME = "telemetry_inference_agent";

function pickCortexName(ctx: AgentContext): string {
  return ctx.telemetryTarget ? TELEMETRY_CORTEX_NAME : DEFAULT_CORTEX_NAME;
}
const MAX_JSON_RETRIES = 2;

export interface SequentialRunnerDeps {
  db: Database;
  memory: MemoryService;
  /** Cortex registry — used to resolve the sim_operator_agent skill body as nano instructions. */
  cortexRegistry: CortexRegistry;
  llmMode: "cloud" | "fixtures" | "record";
  embed?: (text: string) => Promise<number[] | null>;
}

export interface RunTurnOpts {
  simRunId: number;
  turnIndex: number;
  /** Optional pre-computed fleet snapshots keyed by agentId (avoids re-query). */
  fleetSnapshots?: Map<number, FleetSnapshot>;
}

export interface RunTurnResult {
  simTurnId: number;
  agentId: number;
  action: TurnAction;
  terminal: boolean;
  promotedFindingId: number | null;
}

export class SequentialTurnRunner {
  constructor(private readonly deps: SequentialRunnerDeps) {}

  /**
   * Run exactly one turn: pick speaker by parity, call LLM, persist,
   * update sim_run.status if terminal.
   */
  async runTurn(opts: RunTurnOpts): Promise<RunTurnResult> {
    const { db } = this.deps;

    const agents = await this.loadAgents(opts.simRunId);
    if (agents.length === 0) {
      throw new Error(`No agents for sim_run ${opts.simRunId}`);
    }
    const speaker = agents[opts.turnIndex % agents.length];

    const ctx = await this.buildContext({
      simRunId: opts.simRunId,
      agent: speaker,
      turnIndex: opts.turnIndex,
      fleetSnapshot: opts.fleetSnapshots?.get(speaker.id) ?? null,
    });

    const response = await this.callAgent(ctx);

    const terminal = isTerminal(response.action);

    const result = await db.transaction(async (tx) => {
      const insertRow: NewSimTurn = {
        simRunId: BigInt(opts.simRunId),
        turnIndex: opts.turnIndex,
        actorKind: "agent",
        agentId: BigInt(speaker.id),
        action: response.action,
        rationale: response.rationale,
        observableSummary: response.observableSummary,
        llmCostUsd: null,
      };
      const [turnRow] = await tx
        .insert(simTurn)
        .values(insertRow)
        .returning({ id: simTurn.id });
      if (!turnRow) throw new Error("insert sim_turn returned no row");
      const simTurnId = Number(turnRow.id);

      // Memory writes piggyback on the same tx.
      const selfMemory = `${response.action.kind} — ${response.rationale}`;
      await this.deps.memory.writeMany([
        {
          simRunId: opts.simRunId,
          agentId: speaker.id,
          turnIndex: opts.turnIndex,
          kind: "self_action",
          content: selfMemory,
        },
        ...agents
          .filter((a) => a.id !== speaker.id)
          .map((other) => ({
            simRunId: opts.simRunId,
            agentId: other.id,
            turnIndex: opts.turnIndex,
            kind: "observation" as const,
            content: response.observableSummary,
          })),
      ]);

      if (terminal) {
        await tx
          .update(simRun)
          .set({ status: "done", completedAt: new Date() })
          .where(eq(simRun.id, BigInt(opts.simRunId)));
      }

      return { simTurnId };
    });

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

    return {
      simTurnId: result.simTurnId,
      agentId: speaker.id,
      action: response.action,
      terminal,
      promotedFindingId,
    };
  }

  // -------------------------------------------------------------------
  // LLM call + JSON parse + Zod validation
  // -------------------------------------------------------------------

  private async callAgent(ctx: AgentContext): Promise<TurnResponse> {
    const userPrompt = renderTurnPrompt(ctx);
    const cortexName = pickCortexName(ctx);
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
        const parsed = turnResponseSchema.parse(raw);
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
            snippet: res.text.slice(0, 200),
          },
          "agent response failed schema validation",
        );
      }
    }
    throw new Error(
      `${pickCortexName(ctx)} response invalid after ${MAX_JSON_RETRIES + 1} attempts: ${lastError?.message}`,
    );
  }

  // -------------------------------------------------------------------
  // Context assembly
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
        query: "recent decisions and observations affecting this negotiation",
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
    const telemetryTarget = await loadTelemetryTarget(
      this.deps.db,
      args.simRunId,
    );

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
}

interface LoadedAgent {
  id: number;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}
