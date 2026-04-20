import type { ApiFetcher } from "./client";
import type { KgNodeDTO, KgEdgeDTO } from "@/transformers/http";

export interface KgApiPort {
  listNodes(): Promise<{ items: KgNodeDTO[] }>;
  listEdges(): Promise<{ items: KgEdgeDTO[] }>;
}

export function createKgApi(f: ApiFetcher): KgApiPort {
  return {
    listNodes: () => f.getJson(`/api/kg/nodes`),
    listEdges: () => f.getJson(`/api/kg/edges`),
  };
}
