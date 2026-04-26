import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@/adapters/api/ApiClientContext";
import type { ApiClient } from "@/adapters/api";
import type {
  AutonomyStateDto,
  CycleDto,
  FindingDto,
  MissionStateDto,
  StatsDto,
} from "@/dto/http";
import { SseClientProvider } from "@/adapters/sse/SseClientContext";
import type { SseClient } from "@/adapters/sse/client";
import {
  RendererProvider,
  defaultRendererAdapter,
  type RendererAdapter,
} from "@/adapters/renderer/RendererContext";
import {
  PropagatorProvider,
  defaultPropagatorAdapter,
  type PropagatorAdapter,
} from "@/adapters/propagator/PropagatorContext";
import {
  GraphProvider,
  defaultGraphAdapter,
  type GraphAdapter,
} from "@/adapters/graph/GraphContext";

export const EMPTY_FINDING: FindingDto = {
  id: "f:0",
  title: "",
  summary: "",
  cortex: "test",
  status: "pending",
  priority: 0,
  createdAt: "1970-01-01T00:00:00.000Z",
  linkedEntityIds: [],
  evidence: [],
};

export const EMPTY_STATS: StatsDto = {
  satellites: 0,
  conjunctions: 0,
  kgNodes: 0,
  kgEdges: 0,
  findings: 0,
  byStatus: {},
  byCortex: {},
};

export const EMPTY_CYCLE: CycleDto = {
  id: "cycle-0",
  kind: "thalamus",
  startedAt: "1970-01-01T00:00:00.000Z",
  completedAt: "1970-01-01T00:00:00.000Z",
  findingsEmitted: 0,
  cortices: [],
};

export const EMPTY_MISSION_STATE: MissionStateDto = {
  running: false,
  startedAt: null,
  total: 0,
  completed: 0,
  filled: 0,
  unobtainable: 0,
  errors: 0,
  cursor: 0,
  currentTask: null,
  recent: [],
};

export const EMPTY_AUTONOMY_STATE: AutonomyStateDto = {
  running: false,
  intervalMs: 0,
  startedAt: null,
  tickCount: 0,
  currentTick: null,
  history: [],
  dailySpendUsd: 0,
  monthlySpendUsd: 0,
  thalamusCyclesToday: 0,
  stoppedReason: null,
  nextTickInMs: null,
};

/** Minimal stub ApiClient: every port returns an empty-shaped value. */
export function makeStubApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const base: ApiClient = {
    satellites: { list: async () => ({ items: [], count: 0 }) },
    payloads: { listForSatellite: async () => ({ items: [], count: 0 }) },
    conjunctions: { list: async () => ({ items: [], count: 0 }) },
    kg: {
      listNodes: async () => ({ items: [] }),
      listEdges: async () => ({ items: [] }),
    },
    findings: {
      list: async () => ({ items: [], count: 0 }),
      findById: async () => EMPTY_FINDING,
      decide: async () => ({ ok: true, finding: EMPTY_FINDING }),
    },
    stats: { get: async () => EMPTY_STATS },
    cycles: {
      list: async () => ({ items: [] }),
      run: async () => ({ cycle: EMPTY_CYCLE }),
    },
    sweep: {
      listSuggestions: async () => ({ items: [], count: 0 }),
      review: async () => ({ ok: true, reviewed: true, resolution: null }),
    },
    mission: {
      status: async () => EMPTY_MISSION_STATE,
      start: async () => ({ ok: true, state: EMPTY_MISSION_STATE }),
      stop: async () => ({ ok: true, state: EMPTY_MISSION_STATE }),
    },
    autonomy: {
      status: async () => EMPTY_AUTONOMY_STATE,
      start: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
      stop: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
      reset: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
    },
    simOperator: {
      listSwarms: async () => ({ swarms: [], nextCursor: null }),
      getStatus: async () => ({
        swarmId: "0",
        kind: "uc3_conjunction",
        status: "done",
        size: 0,
        done: 0,
        failed: 0,
        timeout: 0,
        running: 0,
        pending: 0,
        reportFindingId: null,
        suggestionId: null,
        aggregateKeys: [],
      }),
      getFishTimeline: async () => ({
        swarmId: "0",
        simRunId: "0",
        fishIndex: 0,
        kind: "uc3_conjunction",
        status: "done",
        seedApplied: {},
        perturbation: { kind: "noop" },
        config: {},
        agents: [],
        turns: [],
        totalLlmCostUsd: null,
        startedAt: "1970-01-01T00:00:00.000Z",
        completedAt: null,
      }),
      getClusters: async () => ({
        swarmId: "0",
        source: null,
        clusters: [],
        summary: {},
      }),
      getFishTrace: async () => ({
        swarmId: "0",
        simRunId: "0",
        fishIndex: 0,
        kind: "uc3_conjunction",
        status: "done",
        seedApplied: {},
        perturbation: { kind: "noop" },
        config: {},
        agents: [],
        turns: [],
        totalLlmCostUsd: null,
        startedAt: "1970-01-01T00:00:00.000Z",
        completedAt: null,
        exportedAt: "1970-01-01T00:00:00.000Z",
      }),
      askQuestion: async (_swarmId, body) => ({
        provider: "fixture",
        evidence: {
          id: "0",
          swarmId: "0",
          simRunId: null,
          scope: body.scope ?? "swarm",
          question: body.question,
          answer: "",
          evidenceRefs: [],
          traceExcerpt: {},
          createdBy: null,
          createdAt: "1970-01-01T00:00:00.000Z",
        },
      }),
      listEvidence: async () => [],
    },
  };
  return { ...base, ...overrides };
}

export const stubSseClient: SseClient = {
  subscribe: () => ({ close: () => {} }),
  subscribeEvents: () => ({ close: () => {} }),
};

export interface WrapDeps {
  api?: ApiClient;
  sse?: SseClient;
  renderer?: RendererAdapter;
  propagator?: PropagatorAdapter;
  graph?: GraphAdapter;
}

export function WrapProviders({
  children,
  deps = {},
}: {
  children: ReactNode;
  deps?: WrapDeps;
}) {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  return (
    <QueryClientProvider client={qc}>
      <ApiClientProvider value={deps.api ?? makeStubApi()}>
        <SseClientProvider value={deps.sse ?? stubSseClient}>
          <RendererProvider value={deps.renderer ?? defaultRendererAdapter}>
            <PropagatorProvider value={deps.propagator ?? defaultPropagatorAdapter}>
              <GraphProvider value={deps.graph ?? defaultGraphAdapter}>
                {children}
              </GraphProvider>
            </PropagatorProvider>
          </RendererProvider>
        </SseClientProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
