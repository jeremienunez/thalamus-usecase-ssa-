import type { ApiFetcher } from "./client";
import type { KgNodeDto, KgEdgeDto } from "@/dto/http";

export interface KgApiPort {
  listNodes(): Promise<{ items: KgNodeDto[] }>;
  listEdges(): Promise<{ items: KgEdgeDto[] }>;
}

export function createKgApi(f: ApiFetcher): KgApiPort {
  return {
    listNodes: () => f.getJson(`/api/kg/nodes`),
    listEdges: () => f.getJson(`/api/kg/edges`),
  };
}
