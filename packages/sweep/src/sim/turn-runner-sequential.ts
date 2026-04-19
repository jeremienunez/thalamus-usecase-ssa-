/**
 * Sequential turn runner for kinds that advance one actor at a time.
 *
 * One agent speaks per turn, strictly alternating by `turnIndex % agents.length`.
 * Calls the pack-selected cortex, parses the JSON response, writes one
 * sim_turn row + memory rows atomically. Terminal actions mark
 * sim_run.status = 'done'.
 */

import type { TurnAction } from "./types";
import type { CortexRegistry } from "@interview/thalamus";
import { callNanoWithMode, extractJsonObject } from "@interview/thalamus";
import { getSimFishConfig } from "../config/sim-fish-config";
import { createLogger, stepLog } from "@interview/shared/observability";
import type { AgentContext, TurnResponse } from "./types";
import { buildTurnResponseSchema } from "./schema";
import { MemoryService } from "./memory.service";
import { isTerminal } from "./promote";
import type {
  SimActionSchemaProvider,
  SimCortexSelector,
  SimPromptComposer,
  SimRuntimeStore,
  SimScenarioContextProvider,
  SimSubjectSnapshot,
} from "./ports";

const logger = createLogger("sim-sequential");

const MAX_JSON_RETRIES = 2;

export interface SequentialRunnerDeps {
  store: SimRuntimeStore;
  memory: MemoryService;
  /** Cortex registry — used to resolve skill bodies as nano instructions. */
  cortexRegistry: CortexRegistry;
  llmMode: "cloud" | "fixtures" | "record";
  embed?: (text: string) => Promise<number[] | null>;
  targets: SimScenarioContextProvider;
  /** Plan 2 · B.4 — pack-provided prompt renderer. */
  prompt: SimPromptComposer;
  /** Plan 2 · B.4 — pack-provided cortex skill selector. */
  cortexSelector: SimCortexSelector;
  /** Plan 2 · B.5 — pack-provided action Zod schema. */
  schemaProvider: SimActionSchemaProvider;
}

export interface RunTurnOpts {
  simRunId: number;
  turnIndex: number;
  subjectSnapshots?: Map<number, SimSubjectSnapshot>;
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
    stepLog(logger, "fish.turn", "start", {
      simRunId: opts.simRunId,
      turn: opts.turnIndex,
      driver: "sequential",
    });
    try {
    const agents = await this.loadAgents(opts.simRunId);
    if (agents.length === 0) {
      throw new Error(`No agents for sim_run ${opts.simRunId}`);
    }
    const speaker = agents[opts.turnIndex % agents.length];

    const ctx = await this.buildContext({
      simRunId: opts.simRunId,
      agent: speaker,
      turnIndex: opts.turnIndex,
      subjectSnapshot: opts.subjectSnapshots?.get(speaker.id) ?? null,
    });

    const response = await this.callAgent(ctx);

    const terminal = isTerminal(response.action);

    const selfMemory = `${response.action.kind} - ${response.rationale}`;
    const batch: Parameters<SimRuntimeStore["persistTurnBatch"]>[0] = {
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

    const fishCfg = await getSimFishConfig();
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
      const res = await callNanoWithMode({
        instructions,
        input: userPrompt,
        enableWebSearch: false,
        overrides: {
          model: fishCfg.model || undefined,
          reasoningEffort: fishCfg.reasoningEffort,
          maxOutputTokens: fishCfg.maxOutputTokens,
          temperature: fishCfg.temperature,
        },
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
            snippet: res.text.slice(0, 200),
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
  // Context assembly
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
}

interface LoadedAgent {
  id: number;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}
