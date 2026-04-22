import type { ApiFetcher } from "./client";
import type { ConjunctionDto } from "@/dto/http";

export interface ConjunctionsApiPort {
  list(minPc?: number): Promise<{ items: ConjunctionDto[]; count: number }>;
}

export function createConjunctionsApi(f: ApiFetcher): ConjunctionsApiPort {
  return {
    list: (minPc = 0) => f.getJson(`/api/conjunctions?minPc=${minPc}`),
  };
}
