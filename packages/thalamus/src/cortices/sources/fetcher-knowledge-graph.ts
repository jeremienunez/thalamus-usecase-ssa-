/**
 * Knowledge Graph Source Fetcher
 *
 * Injects KG findings into content cortices via the source registry.
 * Uses semantic search (Voyage embeddings + HNSW) and entity queries.
 * DI: call setGraphService() from container at startup.
 */

import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";
import type { ResearchGraphService } from "../../services/research-graph.service";
import { ResearchEntityType } from "@interview/shared/enum";

const logger = createLogger("source-knowledge-graph");

let graphService: ResearchGraphService | null = null;

export function setGraphService(svc: ResearchGraphService): void {
  graphService = svc;
  logger.info("Knowledge graph source fetcher wired");
}

async function fetchKGFindings(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  if (!graphService) {
    logger.debug("GraphService not wired, skipping KG fetch");
    return [];
  }

  const start = Date.now();
  const results: SourceResult[] = [];

  // 1. Entity-specific findings
  const entityType = params.entityType as string | undefined;
  const entityId = params.entityId as number | undefined;

  if (entityType && entityId) {
    const validTypes = Object.values(ResearchEntityType) as string[];
    if (validTypes.includes(entityType)) {
      try {
        const findings = await graphService.queryByEntity(
          entityType as ResearchEntityType,
          BigInt(entityId),
          { minConfidence: 0.5, limit: 15 },
        );

        for (const f of findings) {
          results.push({
            type: "knowledge_graph",
            source: `kg:entity:${entityType}:${entityId}`,
            data: {
              findingId: String(f.id),
              cortex: f.cortex,
              title: f.title,
              summary: f.summary,
              confidence: f.confidence,
              findingType: f.findingType,
              evidence: f.evidence,
              impactScore: f.impactScore,
            },
            fetchedAt: new Date().toISOString(),
            latencyMs: Date.now() - start,
          });
        }

        logger.info(
          { entityType, entityId, found: findings.length },
          "KG entity findings fetched",
        );
      } catch (err) {
        logger.debug({ entityType, entityId, err }, "KG entity query failed");
      }
    }
  }

  // 2. Semantic search
  const searchQuery = buildSearchQuery(params);
  if (searchQuery) {
    try {
      const similar = await graphService.semanticSearch(searchQuery, 10);

      for (const f of similar) {
        const alreadyIncluded = results.some(
          (r) => (r.data as Record<string, unknown>).findingId === String(f.id),
        );
        if (alreadyIncluded) continue;

        results.push({
          type: "knowledge_graph_semantic",
          source: `kg:semantic:${searchQuery.slice(0, 50)}`,
          data: {
            findingId: String(f.id),
            cortex: f.cortex,
            title: f.title,
            summary: f.summary,
            confidence: f.confidence,
            findingType: f.findingType,
            evidence: f.evidence,
            impactScore: f.impactScore,
            similarity: f.similarity,
          },
          fetchedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
        });
      }

      logger.info(
        { query: searchQuery.slice(0, 80), found: similar.length },
        "KG semantic search completed",
      );
    } catch (err) {
      logger.debug({ query: searchQuery, err }, "KG semantic search failed");
    }
  }

  return results;
}

function buildSearchQuery(params: Record<string, unknown>): string | null {
  const parts: string[] = [];

  if (params.contentType) {
    const typeLabels: Record<string, string> = {
      operator_country_guide: "operator country orbit regime doctrine payloads",
      payload_profile: "payload instrument spectrum band characterization",
      mission_satellite_pairing: "mission satellite payload fit assignment",
      satellite_review: "satellite telemetry review status anomaly",
      thematic_article: "launch market trends analysis",
    };
    parts.push(typeLabels[params.contentType as string] ?? "satellite");
  }

  if (params.query) parts.push(String(params.query));
  if (params.entityName) parts.push(String(params.entityName));

  return parts.length > 0 ? parts.join(" ") : null;
}

registerSource(
  [
    "content_producer",
    "mission_copywriter",
    "seo_strategist",
    "space_educator",
    "social_media",
    "mission_planner",
  ],
  fetchKGFindings,
  "knowledge-graph",
);
