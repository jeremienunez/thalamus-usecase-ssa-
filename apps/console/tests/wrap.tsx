import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@/adapters/api/ApiClientContext";
import type { ApiClient } from "@/adapters/api";
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

/** Minimal stub ApiClient: every port returns an empty-shaped value. */
export function makeStubApi(overrides: Partial<ApiClient> = {}): ApiClient {
  const base: ApiClient = {
    satellites: { list: async () => ({ items: [], count: 0 }) },
    conjunctions: { list: async () => ({ items: [], count: 0 }) },
    kg: {
      listNodes: async () => ({ items: [] }),
      listEdges: async () => ({ items: [] }),
    },
    findings: {
      list: async () => ({ items: [], count: 0 }),
      findById: async () => ({}) as never,
      decide: async () => ({ ok: true, finding: {} as never }),
    },
    stats: {
      get: async () => ({
        satellites: 0,
        conjunctions: 0,
        kgNodes: 0,
        kgEdges: 0,
        findings: 0,
        byStatus: {},
        byCortex: {},
      }),
    },
    cycles: {
      list: async () => ({ items: [] }),
      run: async () => ({ cycle: {} as never }),
    },
    sweep: {
      listSuggestions: async () => ({ items: [], count: 0 }),
      review: async () => ({ ok: true, reviewed: true, resolution: null }),
    },
    mission: {
      status: async () => ({
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
      }),
      start: async () => ({ ok: true, state: {} as never }),
      stop: async () => ({ ok: true, state: {} as never }),
    },
    autonomy: {
      status: async () => ({
        running: false,
        intervalMs: 0,
        startedAt: null,
        tickCount: 0,
        currentTick: null,
        history: [],
        nextTickInMs: null,
      }),
      start: async () => ({ ok: true, state: {} as never }),
      stop: async () => ({ ok: true, state: {} as never }),
    },
  };
  return { ...base, ...overrides };
}

export const stubSseClient: SseClient = {
  subscribe: () => ({ close: () => {} }),
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
