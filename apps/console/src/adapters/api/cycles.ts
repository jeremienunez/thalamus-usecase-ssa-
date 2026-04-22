import type { ApiFetcher } from "./client";
import type { CycleDto } from "@/dto/http";

export type CycleKind = "thalamus" | "fish" | "both";

export interface CyclesApiPort {
  list(): Promise<{ items: CycleDto[] }>;
  run(kind: CycleKind): Promise<{ cycle: CycleDto }>;
}

export function createCyclesApi(f: ApiFetcher): CyclesApiPort {
  return {
    list: () => f.getJson(`/api/cycles`),
    run: (kind) => f.postJson(`/api/cycles/run`, { kind }),
  };
}
