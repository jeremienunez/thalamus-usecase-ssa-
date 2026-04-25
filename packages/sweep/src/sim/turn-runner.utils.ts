import type { CortexRegistry } from "@interview/thalamus";
import { callNanoWithMode } from "@interview/thalamus";
import { extractJsonObject } from "@interview/shared/utils";
import { getSimFishConfig } from "../config/sim-fish-config";
import type { MemoryService } from "./memory.service";
import type { AgentContext, TurnResponse } from "./types";
import { buildTurnResponseSchema } from "./schema";
import type {
  SimActionSchemaProvider,
  SimCortexSelector,
  SimPromptComposer,
  SimRuntimeStore,
  SimScenarioContextProvider,
  SimSubjectSnapshot,
} from "./ports";

const MAX_JSON_RETRIES = 2;

export interface TurnRunnerAgent {
  id: number;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}

type LoggerLike = {
  warn(payload: Record<string, unknown>, message: string): void;
};

export interface TurnRunnerDeps {
  store: SimRuntimeStore;
  memory: MemoryService;
  cortexRegistry: CortexRegistry;
  targets: SimScenarioContextProvider;
  prompt: SimPromptComposer;
  cortexSelector: SimCortexSelector;
  schemaProvider: SimActionSchemaProvider;
}

export interface TurnRunnerContextInput {
  simRunId: number;
  agent: TurnRunnerAgent;
  turnIndex: number;
  subjectSnapshot: SimSubjectSnapshot | null;
  signal?: AbortSignal;
}

function abortError(message: string): Error {
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  const reason = signal.reason;
  if (reason instanceof Error) throw reason;
  throw abortError(typeof reason === "string" ? reason : "Operation aborted");
}

export async function callTurnAgent(args: {
  deps: Pick<
    TurnRunnerDeps,
    "cortexRegistry" | "prompt" | "cortexSelector" | "schemaProvider"
  >;
  ctx: AgentContext;
  logger: LoggerLike;
  includeValidationSnippet?: boolean;
  simKind?: string;
  signal?: AbortSignal;
}): Promise<TurnResponse> {
  throwIfAborted(args.signal);
  const userPrompt = args.deps.prompt.render({
    frame: {
      turnIndex: args.ctx.turnIndex,
      persona: args.ctx.persona,
      goals: args.ctx.goals,
      constraints: args.ctx.constraints,
    },
    domain: {
      subjectSnapshot: args.ctx.subjectSnapshot,
      scenarioContext: args.ctx.scenarioContext,
    },
    observable: args.ctx.observable,
    godEvents: args.ctx.godEvents,
    topMemories: args.ctx.topMemories,
  });

  const cortexName = args.deps.cortexSelector.pickCortexName({
    simKind: args.simKind ?? "",
    turnIndex: args.ctx.turnIndex,
    hints: {
      hasScenarioContext: args.ctx.scenarioContext !== null,
    },
  });
  const skill = args.deps.cortexRegistry.get(cortexName);
  if (!skill) {
    throw new Error(
      `Cortex skill '${cortexName}' not found in registry. Did you discover() skills at boot?`,
    );
  }

  const fishCfg = await getSimFishConfig();
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= MAX_JSON_RETRIES; attempt++) {
    throwIfAborted(args.signal);
    const res = await callNanoWithMode({
      instructions: skill.body,
      input: userPrompt,
      enableWebSearch: false,
      signal: args.signal,
      overrides: {
        model: fishCfg.model || undefined,
        reasoningEffort: fishCfg.reasoningEffort,
        maxOutputTokens: fishCfg.maxOutputTokens,
        temperature: fishCfg.temperature,
      },
    });

    if (!res.ok) {
      throwIfAborted(args.signal);
      lastError = new Error(res.error ?? "nano call failed");
      args.logger.warn(
        {
          simRunId: args.ctx.simRunId,
          agentId: args.ctx.agentId,
          turnIndex: args.ctx.turnIndex,
          attempt,
          err: res.error,
        },
        "nano call failed",
      );
      continue;
    }

    try {
      const raw = extractJsonObject(res.text);
      const responseSchema = buildTurnResponseSchema(
        args.deps.schemaProvider.actionSchema(),
      );
      const parsed = responseSchema.parse(raw);
      return parsed as TurnResponse;
    } catch (err) {
      throwIfAborted(args.signal);
      lastError = err as Error;
      args.logger.warn(
        {
          simRunId: args.ctx.simRunId,
          agentId: args.ctx.agentId,
          turnIndex: args.ctx.turnIndex,
          attempt,
          err: (err as Error).message,
          ...(args.includeValidationSnippet
            ? { snippet: res.text.slice(0, 200) }
            : {}),
        },
        "agent response failed schema validation",
      );
    }
  }

  throw new Error(
    `${cortexName} response invalid after ${MAX_JSON_RETRIES + 1} attempts: ${lastError?.message}`,
  );
}

export async function buildTurnAgentContext(args: {
  deps: Pick<TurnRunnerDeps, "memory" | "store" | "targets">;
  simRunId: number;
  agent: TurnRunnerAgent;
  turnIndex: number;
  subjectSnapshot: SimSubjectSnapshot | null;
  memoryQuery: string;
  signal?: AbortSignal;
}): Promise<AgentContext> {
  throwIfAborted(args.signal);
  const [topMemories, observable, godEvents, scenarioContext] =
    await Promise.all([
      args.deps.memory.topK({
        simRunId: args.simRunId,
        agentId: args.agent.id,
        query: args.memoryQuery,
        k: 8,
      }),
      args.deps.memory.recentObservable({
        simRunId: args.simRunId,
        sinceTurnIndex: args.turnIndex - 6,
        excludeAgentId: args.agent.id,
        limit: 20,
      }),
      loadGodEvents(args.deps.store, args.simRunId, args.turnIndex),
      args.deps.targets.loadContext({
        simRunId: args.simRunId,
        seedHints: {},
      }),
    ]);
  throwIfAborted(args.signal);

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

export function createTurnContextLoader(args: {
  deps: Pick<TurnRunnerDeps, "memory" | "store" | "targets">;
  memoryQuery: string;
}) {
  return (input: TurnRunnerContextInput) =>
    buildTurnAgentContext({
      deps: args.deps,
      simRunId: input.simRunId,
      agent: input.agent,
      turnIndex: input.turnIndex,
      subjectSnapshot: input.subjectSnapshot,
      memoryQuery: args.memoryQuery,
      signal: input.signal,
    });
}

export function loadTurnRunnerAgents(
  store: SimRuntimeStore,
  simRunId: number,
): Promise<TurnRunnerAgent[]> {
  return store.listAgents(simRunId);
}

export async function loadGodEvents(
  store: SimRuntimeStore,
  simRunId: number,
  turnIndex: number,
): Promise<AgentContext["godEvents"]> {
  const rows = await store.listGodEventsAtOrBefore(simRunId, turnIndex, 10);
  return rows.map((r) => ({
    turnIndex: r.turnIndex,
    summary: r.observableSummary,
    detail: r.detail,
  }));
}
