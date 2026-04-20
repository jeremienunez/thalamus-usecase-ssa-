import type { ApiFetcher } from "./client";
import type { CycleDTO } from "@/transformers/http";

export type CycleKind = "thalamus" | "fish" | "both";

export interface CyclesApiPort {
  list(): Promise<{ items: CycleDTO[] }>;
  run(kind: CycleKind): Promise<{ cycle: CycleDTO }>;
}

export function createCyclesApi(f: ApiFetcher): CyclesApiPort {
  return {
    list: () => f.getJson(`/api/cycles`),
    run: (kind) => f.postJson(`/api/cycles/run`, { kind }),
  };
}
