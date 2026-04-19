import type { ApiFetcher } from "./client";
import type { ConjunctionDTO } from "@/shared/types";

export interface ConjunctionsApiPort {
  list(minPc?: number): Promise<{ items: ConjunctionDTO[]; count: number }>;
}

export function createConjunctionsApi(f: ApiFetcher): ConjunctionsApiPort {
  return {
    list: (minPc = 0) => f.getJson(`/api/conjunctions?minPc=${minPc}`),
  };
}
