import type { ResearchFindingType } from "@interview/shared/enum";
import type {
  NewResearchEdge,
  NewResearchFinding,
  ResearchEdge,
  ResearchFinding,
} from "../types/research.types";

export interface FindingsGraphPort {
  upsertByDedupHash(
    data: NewResearchFinding,
  ): Promise<{ finding: ResearchFinding; inserted: boolean }>;
  findSimilar(
    embedding: number[],
    threshold: number,
    limit: number,
    entityFilter?: { entityType: string; entityId: number | bigint },
  ): Promise<Array<ResearchFinding & { similarity: number }>>;
  mergeFinding(
    id: bigint,
    data: { confidence: number; evidence: unknown[] },
  ): Promise<void>;
  findById(id: bigint): Promise<ResearchFinding | null>;
  findByEntity(
    entityType: string,
    entityId: bigint,
    opts?: { minConfidence?: number; limit?: number },
  ): Promise<ResearchFinding[]>;
  searchBySimilarity(
    embedding: number[],
    limit?: number,
  ): Promise<Array<ResearchFinding & { similarity: number }>>;
  findActive(opts?: {
    cortex?: string;
    findingType?: ResearchFindingType;
    minConfidence?: number;
    limit?: number;
    offset?: number;
  }): Promise<ResearchFinding[]>;
  archive(id: bigint): Promise<void>;
  expireOld(): Promise<number>;
  countByCortexAndType(): Promise<
    Array<{ cortex: string; finding_type: string; cnt: number }>
  >;
  countRecent24h(): Promise<number>;
  linkToCycle(opts: {
    cycleId: bigint;
    findingId: bigint;
    iteration: number;
    isDedupHit: boolean;
  }): Promise<boolean>;
}

export interface EdgesGraphPort {
  createMany(edges: NewResearchEdge[]): Promise<ResearchEdge[]>;
  findByFinding(findingId: bigint): Promise<ResearchEdge[]>;
  findByFindings(findingIds: bigint[]): Promise<ResearchEdge[]>;
  countByEntityType(): Promise<Array<{ entity_type: string; cnt: number }>>;
}

export interface CyclesGraphPort {
  incrementFindings(id: bigint): Promise<void>;
}

export interface ResearchGraphUnitOfWork {
  findingRepo: FindingsGraphPort;
  edgeRepo: EdgesGraphPort;
  cycleRepo: CyclesGraphPort;
}

export interface ResearchGraphTransactionPort {
  runInTransaction<T>(
    work: (uow: ResearchGraphUnitOfWork) => Promise<T>,
  ): Promise<T>;
}

export interface StoreFindingInput {
  finding: Omit<NewResearchFinding, "embedding" | "dedupHash">;
  edges: Omit<NewResearchEdge, "findingId">[];
}

export interface QueryFindingsOptions {
  cortex?: string;
  findingType?: ResearchFindingType;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export type FindingCallback = (finding: ResearchFinding) => Promise<void>;

export interface KnowledgeGraphNode {
  id: string;
  label: string;
  type: string;
  cortex?: string;
  findingType?: string;
  confidence?: number;
  urgency?: string;
  summary?: string;
}

export interface KnowledgeGraphLink {
  source: string;
  target: string;
  relation: string;
  weight: number;
}

export interface FindingStorePort {
  storeFinding(input: StoreFindingInput): Promise<ResearchFinding>;
  onFinding(cb: FindingCallback): void;
}

export interface KgQueryPort {
  queryByEntity(
    entityType: string,
    entityId: bigint,
    opts?: { minConfidence?: number; limit?: number },
  ): Promise<ResearchFinding[]>;
  semanticSearch(
    query: string,
    limit?: number,
  ): Promise<Array<ResearchFinding & { similarity: number }>>;
  listFindings(opts?: QueryFindingsOptions): Promise<ResearchFinding[]>;
  getFindingWithEdges(
    id: bigint,
  ): Promise<(ResearchFinding & { edges: ResearchEdge[] }) | null>;
  getKnowledgeGraph(opts?: QueryFindingsOptions): Promise<{
    nodes: KnowledgeGraphNode[];
    links: KnowledgeGraphLink[];
  }>;
  getGraphStats(): Promise<{
    totalFindings: number;
    totalEdges: number;
    byCortex: Record<string, number>;
    byFindingType: Record<string, number>;
    byEntityType: Record<string, number>;
    recentCount24h: number;
  }>;
}

export interface FindingArchivePort {
  archiveFinding(id: bigint): Promise<void>;
  expireAndClean(): Promise<{ expired: number; orphans: number }>;
}

export type ResearchGraphServicePort =
  & FindingStorePort
  & KgQueryPort
  & FindingArchivePort;
