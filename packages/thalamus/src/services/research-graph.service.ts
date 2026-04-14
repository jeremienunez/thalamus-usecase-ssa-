/**
 * Research Graph Service — Knowledge graph orchestration for Thalamus
 * Ties together finding + edge + cycle repos with embedding generation
 */

import { createLogger } from "@interview/shared/observability";
import { createHash } from "node:crypto";
import type { ResearchFindingRepository } from "../repositories/research-finding.repository";
import type { ResearchEdgeRepository } from "../repositories/research-edge.repository";
import type { ResearchCycleRepository } from "../repositories/research-cycle.repository";
import type { VoyageEmbedder } from "../utils/voyage-embedder";
import type {
  ResearchFinding,
  NewResearchFinding,
  NewResearchEdge,
} from "../entities/research.entity";
import { ResearchEntityType, ResearchRelation } from "@interview/shared/enum";
import type { ResearchCortex, ResearchFindingType } from "@interview/shared/enum";
import type { EntityNameResolver } from "../repositories/entity-name-resolver";

const logger = createLogger("research-graph");

export interface StoreFindingInput {
  finding: Omit<NewResearchFinding, "embedding" | "dedupHash">;
  edges: Omit<NewResearchEdge, "findingId">[];
}

export interface QueryFindingsOptions {
  cortex?: ResearchCortex;
  findingType?: ResearchFindingType;
  minConfidence?: number;
  limit?: number;
  offset?: number;
}

export type FindingCallback = (finding: ResearchFinding) => Promise<void>;

export class ResearchGraphService {
  private onFindingStored: FindingCallback[] = [];

  constructor(
    private findingRepo: ResearchFindingRepository,
    private edgeRepo: ResearchEdgeRepository,
    private cycleRepo: ResearchCycleRepository,
    private embedder: VoyageEmbedder,
    private entityResolver?: EntityNameResolver,
  ) {}

  /**
   * Register a callback fired after each finding is stored.
   * Used by notification service to dispatch admin alerts for anomalies.
   */
  onFinding(cb: FindingCallback): void {
    this.onFindingStored.push(cb);
  }

  /**
   * Store a finding with its edges, computing embedding + dedup hash.
   * Semantic dedup: cosine >= 0.92 → merge into existing finding.
   * Cross-linking: cosine 0.7–0.92 → create finding→finding edges.
   * Falls back to hash dedup if no semantic match.
   */
  async storeFinding(input: StoreFindingInput): Promise<ResearchFinding> {
    // 1. Compute embedding from title + summary
    const text = `${input.finding.title}\n${input.finding.summary}`;
    const embedding = await this.embedder.embedQuery(text);

    // 2. Semantic dedup: cosine >= 0.92 AND same primary entity
    //    Two findings about different entities never merge, regardless of structural similarity
    const primaryEdgeForDedup = input.edges[0];
    if (embedding) {
      const nearDuplicates = await this.findingRepo.findSimilar(
        embedding,
        0.92,
        1,
        primaryEdgeForDedup
          ? {
              entityType: primaryEdgeForDedup.entityType,
              entityId: primaryEdgeForDedup.entityId,
            }
          : undefined,
      );
      if (nearDuplicates.length > 0) {
        const existing = nearDuplicates[0];
        logger.info(
          {
            existingId: String(existing.id),
            similarity: nearDuplicates[0].similarity,
            newTitle: input.finding.title,
          },
          "Semantic dedup: merging into existing finding",
        );
        await this.findingRepo.mergeFinding(existing.id, {
          confidence: Math.max(existing.confidence, input.finding.confidence),
          evidence: Array.isArray(input.finding.evidence)
            ? input.finding.evidence
            : [],
        });
        // Still count it for the cycle
        await this.cycleRepo.incrementFindings(input.finding.researchCycleId);
        return existing;
      }
    }

    // 3. Hash dedup + insert (existing logic)
    const primaryEdge = input.edges[0];
    const dedupKey = primaryEdge
      ? `${input.finding.cortex}:${primaryEdge.entityType}:${primaryEdge.entityId}:${input.finding.findingType}`
      : `${input.finding.cortex}:${input.finding.researchCycleId}:${Date.now()}`;
    const dedupHash = createHash("sha256")
      .update(dedupKey)
      .digest("hex")
      .slice(0, 32);

    const finding = await this.findingRepo.upsertByDedupHash({
      ...input.finding,
      embedding,
      dedupHash,
    });

    // 4. Create entity edges
    if (input.edges.length > 0) {
      const edges = input.edges.map((e) => ({
        ...e,
        findingId: finding.id,
      }));
      await this.edgeRepo.createMany(edges);
    }

    // 5. Cross-link: find related findings (cosine 0.7–0.92) → create finding→finding edges
    if (embedding) {
      try {
        const related = await this.findingRepo.findSimilar(embedding, 0.7, 5);
        const crossLinks = related
          .filter((r) => r.id !== finding.id && r.similarity < 0.92)
          .slice(0, 3);

        if (crossLinks.length > 0) {
          const linkEdges = crossLinks.map((r) => ({
            findingId: finding.id,
            entityType: ResearchEntityType.Finding as string,
            entityId: r.id,
            relation: (r.similarity > 0.85
              ? ResearchRelation.Supports
              : ResearchRelation.SimilarTo) as string,
            weight: r.similarity,
            context: {
              similarity: r.similarity,
              relatedTitle: r.title,
            },
          }));
          await this.edgeRepo.createMany(linkEdges);
          logger.info(
            {
              findingId: String(finding.id),
              crossLinks: crossLinks.length,
            },
            "Cross-linked to related findings",
          );
        }
      } catch (err) {
        // Cross-linking is best-effort — don't fail the finding
        logger.debug(
          { findingId: String(finding.id), err },
          "Cross-linking failed",
        );
      }
    }

    // 6. Increment cycle finding count
    await this.cycleRepo.incrementFindings(input.finding.researchCycleId);

    logger.info(
      {
        findingId: String(finding.id),
        cortex: input.finding.cortex,
        dedupHash,
      },
      "Finding stored",
    );

    // 7. Fire callbacks (notifications, admin alerts, etc.)
    for (const cb of this.onFindingStored) {
      try {
        await cb(finding);
      } catch (err) {
        logger.error(
          { findingId: String(finding.id), err },
          "Finding callback failed",
        );
      }
    }

    return finding;
  }

  /**
   * Query findings linked to a specific entity via knowledge graph edges
   */
  async queryByEntity(
    entityType: ResearchEntityType,
    entityId: bigint,
    opts?: { minConfidence?: number; limit?: number },
  ): Promise<ResearchFinding[]> {
    return this.findingRepo.findByEntity(entityType, entityId, opts);
  }

  /**
   * Semantic search: embed query, then HNSW cosine on findings
   */
  async semanticSearch(
    query: string,
    limit = 10,
  ): Promise<Array<ResearchFinding & { similarity: number }>> {
    const embedding = await this.embedder.embedQuery(query);
    if (!embedding) return [];
    return this.findingRepo.searchBySimilarity(embedding, limit);
  }

  /**
   * List active findings with filters
   */
  async listFindings(
    opts: QueryFindingsOptions = {},
  ): Promise<ResearchFinding[]> {
    return this.findingRepo.findActive(opts);
  }

  /**
   * Get finding with its edges
   */
  async getFindingWithEdges(id: bigint) {
    const finding = await this.findingRepo.findById(id);
    if (!finding) return null;
    const edges = await this.edgeRepo.findByFinding(id);
    return { ...finding, edges };
  }

  /**
   * Archive a single finding by ID.
   */
  async archiveFinding(id: bigint): Promise<void> {
    await this.findingRepo.archive(id);
  }

  /**
   * Expire old findings + clean orphan edges (daemon job)
   */
  async expireAndClean(): Promise<{ expired: number; orphans: number }> {
    const expired = await this.findingRepo.expireOld();
    const orphans = await this.edgeRepo.cleanOrphans();
    logger.info({ expired, orphans }, "Expire and clean completed");
    return { expired, orphans };
  }

  /**
   * Build full knowledge graph (nodes + links) for react-force-graph consumption.
   * Resolves entity names via batch joins across 7 entity tables.
   */
  async getKnowledgeGraph(opts: QueryFindingsOptions = {}): Promise<{
    nodes: KnowledgeGraphNode[];
    links: KnowledgeGraphLink[];
  }> {
    if (!this.entityResolver) {
      throw new Error("EntityNameResolver not wired");
    }

    // 1. Fetch active findings
    const findings = await this.findingRepo.findActive({
      ...opts,
      limit: opts.limit ?? 100,
    });
    if (findings.length === 0) return { nodes: [], links: [] };

    // 2. Batch-fetch all edges for these findings
    const findingIds = findings.map((f) => f.id);
    const edges = await this.edgeRepo.findByFindings(findingIds);

    // 3. Collect unique entity refs from edges
    const entityRefs = edges.map((e) => ({
      entityType: e.entityType,
      entityId: e.entityId,
    }));

    // 4. Resolve entity names
    const nameMap = await this.entityResolver.resolve(entityRefs);

    // 5. Build finding nodes
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

    // 6. Build entity nodes (deduplicated)
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

    // 7. Build links
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

  /**
   * Aggregate stats for admin graph toolbar.
   * 3 lightweight GROUP BY queries — no graph assembly.
   */
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
}

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

// Note: `wireFindingNotifications` was removed during extraction — it pulled in
// a cross-package `MessagingService` and a `finding-routing` helper that live
// outside the artifact. Re-introduce via a thin adapter if the inbox channel
// is ever wired back in.
