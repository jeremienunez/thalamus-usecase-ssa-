import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@/adapters/api/ApiClientContext";
import { createApiClient, type ApiClient } from "@/adapters/api";
import { SseClientProvider } from "@/adapters/sse/SseClientContext";
import { createSseClient, type SseClient } from "@/adapters/sse/client";
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

export interface AppAdapters {
  api: ApiClient;
  sse: SseClient;
  renderer: RendererAdapter;
  propagator: PropagatorAdapter;
  graph: GraphAdapter;
  queryClient: QueryClient;
}

export function AppProviders({
  adapters,
  children,
}: {
  adapters: AppAdapters;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={adapters.queryClient}>
      <ApiClientProvider value={adapters.api}>
        <SseClientProvider value={adapters.sse}>
          <RendererProvider value={adapters.renderer}>
            <PropagatorProvider value={adapters.propagator}>
              <GraphProvider value={adapters.graph}>{children}</GraphProvider>
            </PropagatorProvider>
          </RendererProvider>
        </SseClientProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

export function buildDefaultAdapters(): AppAdapters {
  return {
    api: createApiClient(),
    sse: createSseClient(),
    renderer: defaultRendererAdapter,
    propagator: defaultPropagatorAdapter,
    graph: defaultGraphAdapter,
    queryClient: new QueryClient({
      defaultOptions: { queries: { refetchOnWindowFocus: false, staleTime: 30_000 } },
    }),
  };
}
