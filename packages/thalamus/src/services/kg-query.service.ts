import { createLogger } from "@interview/shared/observability";
import { assertEmbeddingDimension } from "../errors/embedding";
import type { EmbedderPort } from "../ports/embedder.port";
import type { EntityCatalogPort } from "../ports/entity-catalog.port";
import type { ResearchFinding } from "../types/research.types";
import type {
  EdgesGraphPort,
  FindingsGraphPort,
  KnowledgeGraphLink,
  KnowledgeGraphNode,
  QueryFindingsOptions,
} from "./research-graph.types";

const logger = createLogger("kg-query");

export class KgQueryService {
  constructor(
    private readonly findingRepo: FindingsGraphPort,
    private readonly edgeRepo: EdgesGraphPort,
    private readonly embedder: EmbedderPort,
    private readonly entityCatalog: EntityCatalogPort,
  ) {}

  async queryByEntity(
    entityType: string,
    entityId: bigint,
    opts?: { minConfidence?: number; limit?: number },
  ): Promise<ResearchFinding[]> {
    return this.findingRepo.findByEntity(entityType, entityId, opts);
  }

  async semanticSearch(
    query: string,
    limit = 10,
  ): Promise<Array<ResearchFinding & { similarity: number }>> {
    const embedding = assertEmbeddingDimension(
      await this.embedder.embedQuery(query),
      {
        embedderName: this.embedderName(),
        operation: "semanticSearch",
      },
    );
    if (!embedding) return [];
    return this.findingRepo.searchBySimilarity(embedding, limit);
  }

  async listFindings(
    opts: QueryFindingsOptions = {},
  ): Promise<ResearchFinding[]> {
    return this.findingRepo.findActive(opts);
  }

  async getFindingWithEdges(id: bigint) {
    const finding = await this.findingRepo.findById(id);
    if (!finding) return null;
    const edges = await this.edgeRepo.findByFinding(id);
    return { ...finding, edges };
  }

  async getKnowledgeGraph(opts: QueryFindingsOptions = {}): Promise<{
    nodes: KnowledgeGraphNode[];
    links: KnowledgeGraphLink[];
  }> {
    const findings = await this.findingRepo.findActive({
      ...opts,
      limit: opts.limit ?? 100,
    });
    if (findings.length === 0) return { nodes: [], links: [] };

    const findingIds = findings.map((f) => f.id);
    const edges = await this.edgeRepo.findByFindings(findingIds);
    const entityRefs = edges.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
    }));
    const nameMap = await this.entityCatalog.resolveNames(entityRefs);

    const nodes: KnowledgeGraphNode[] = findings.map((f) => ({
      id: `finding:${f.id}`,
      label: f.title,
      type: "finding" as const,
      cortex: f.cortex,
      findingType: f.findingType,
      confidence: f.confidence,
      urgency: f.urgency ?? undefined,
      summary: f.summary,
    }));

    const entityNodeMap = new Map<string, KnowledgeGraphNode>();
    for (const edge of edges) {
      const key = `${edge.entityType}:${edge.entityId}`;
      if (!entityNodeMap.has(key)) {
        entityNodeMap.set(key, {
          id: key,
          label: nameMap.get(key) ?? `${edge.entityType} #${edge.entityId}`,
          type: edge.entityType,
        });
      }
    }
    nodes.push(...entityNodeMap.values());

    const links: KnowledgeGraphLink[] = edges.map((e) => ({
      source: `finding:${e.findingId}`,
      target: `${e.entityType}:${e.entityId}`,
      relation: e.relation,
      weight: e.weight ?? 1.0,
    }));

    logger.info(
      { nodes: nodes.length, links: links.length },
      "Knowledge graph assembled",
    );
    return { nodes, links };
  }

  async getGraphStats(): Promise<{
    totalFindings: number;
    totalEdges: number;
    byCortex: Record<string, number>;
    byFindingType: Record<string, number>;
    byEntityType: Record<string, number>;
    recentCount24h: number;
  }> {
    const [findingStats, edgeStats, recentCount24h] = await Promise.all([
      this.findingRepo.countByCortexAndType(),
      this.edgeRepo.countByEntityType(),
      this.findingRepo.countRecent24h(),
    ]);

    const byCortex: Record<string, number> = {};
    const byFindingType: Record<string, number> = {};
    let totalFindings = 0;

    for (const row of findingStats) {
      byCortex[row.cortex] = (byCortex[row.cortex] ?? 0) + row.cnt;
      byFindingType[row.finding_type] =
        (byFindingType[row.finding_type] ?? 0) + row.cnt;
      totalFindings += row.cnt;
    }

    const byEntityType: Record<string, number> = {};
    let totalEdges = 0;
    for (const row of edgeStats) {
      byEntityType[row.entity_type] = row.cnt;
      totalEdges += row.cnt;
    }

    return {
      totalFindings,
      totalEdges,
      byCortex,
      byFindingType,
      byEntityType,
      recentCount24h,
    };
  }

  private embedderName(): string {
    const name = this.embedder.constructor?.name;
    return name && name !== "Object" ? name : "EmbedderPort";
  }
}
