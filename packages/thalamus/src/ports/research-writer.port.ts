/**
 * Port: ResearchWriterPort — single writer surface for `research_*` tables.
 *
 * Kernel repositories used to call `db.insert(researchX)` directly. They now
 * delegate to this port so all `research_*` writes funnel through one
 * implementation in the app layer (`apps/console-api/src/services/research-write.service.ts`).
 *
 * Sim-promotion and any other app-side caller consume the same writer
 * through this port — there is no second contract.
 */
import type {
  NewResearchCycle,
  ResearchCycle,
  NewResearchEdge,
  ResearchEdge,
  NewResearchFinding,
  ResearchFinding,
} from "../types/research.types";

export interface ResearchFindingEmissionInput {
  finding: NewResearchFinding;
  link: {
    cycleId: bigint;
    iteration?: number;
  };
  edges?: Array<Omit<NewResearchEdge, "findingId">>;
}

export interface ResearchFindingEmissionResult {
  finding: ResearchFinding;
  inserted: boolean;
  linked: boolean;
  edges: ResearchEdge[];
}

export interface ResearchWriterPort {
  createCycle(value: NewResearchCycle): Promise<ResearchCycle>;
  incrementCycleFindings(cycleId: bigint): Promise<void>;
  updateCycleFindingsCount(
    cycleId: bigint,
    findingsCount: number,
  ): Promise<void>;
  createEdges(
    values: NewResearchEdge[],
  ): Promise<ResearchEdge[]>;
  createFinding(value: NewResearchFinding): Promise<ResearchFinding>;
  upsertFindingByDedupHash(
    value: NewResearchFinding,
  ): Promise<{ row: ResearchFinding; inserted: boolean }>;
  linkFindingToCycle(opts: {
    cycleId: bigint;
    findingId: bigint;
    iteration: number;
    isDedupHit: boolean;
  }): Promise<boolean>;
  emitFindingTransactional(
    input: ResearchFindingEmissionInput,
  ): Promise<ResearchFindingEmissionResult>;
}
