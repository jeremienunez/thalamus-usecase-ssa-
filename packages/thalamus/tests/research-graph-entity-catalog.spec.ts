/**
 * Research graph services — Phase 3 · Task 3.2 of thalamus agnosticity cleanup.
 *
 * The service stops owning the two SSA-specific concerns (edge cleanOrphans
 * SQL + ENTITY_TABLE_MAP name resolution). Both now go through
 * EntityCatalogPort — the domain adapter on the app side (SSA or other).
 */

import { describe, it, expect } from "vitest";
import { FindingArchiveService } from "../src/services/finding-archive.service";
import { KgQueryService } from "../src/services/kg-query.service";
import type {
  FindingsGraphPort,
  EdgesGraphPort,
} from "../src/services/research-graph.types";
import type {
  EntityCatalogPort,
  EntityRef,
} from "../src/ports/entity-catalog.port";
import { NullEmbedder } from "../src/entities/null-embedder";
import {
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
} from "@interview/shared/enum";
import type { ResearchFinding } from "../src/types/research.types";

// Phase 4 · Task 4.1: the kernel ships NullEmbedder as the default port
// implementation, so tests can use it directly instead of shape-casting
// a concrete adapter.
const nullEmbedder = new NullEmbedder();

function mkFindingRepo(overrides: Partial<FindingsGraphPort> = {}): FindingsGraphPort {
  return {
    upsertByDedupHash: async () => ({
      finding: {
        id: 1n,
        researchCycleId: 1n,
        cortex: "catalog",
        findingType: ResearchFindingType.Insight,
        status: ResearchStatus.Active,
        urgency: null,
        title: "stub",
        summary: "stub",
        evidence: null,
        reasoning: null,
        confidence: 0.5,
        impactScore: null,
        extensions: null,
        reflexionNotes: null,
        iteration: 0,
        dedupHash: null,
        embedding: null,
        expiresAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      inserted: true,
    }),
    findSimilar: async () => [],
    mergeFinding: async () => undefined,
    findById: async () => null,
    findByEntity: async () => [],
    searchBySimilarity: async () => [],
    findActive: async () => [],
    archive: async () => undefined,
    expireOld: async () => 0,
    countByCortexAndType: async () => [],
    countRecent24h: async () => 0,
    linkToCycle: async () => true,
    ...overrides,
  };
}

function mkEdgeRepo(overrides: Partial<EdgesGraphPort> = {}): EdgesGraphPort {
  return {
    createMany: async () => [],
    findByFinding: async () => [],
    findByFindings: async () => [],
    countByEntityType: async () => [],
    ...overrides,
  };
}

describe("FindingArchiveService.expireAndClean — delegates to EntityCatalogPort", () => {
  it("forwards cleanOrphans to the catalog port, not the edge repo", async () => {
    const portCalls: number[] = [];
    const catalog: EntityCatalogPort = {
      resolveNames: async () => new Map(),
      cleanOrphans: async () => {
        portCalls.push(1);
        return 42;
      },
    };
    const findingRepo = mkFindingRepo({ expireOld: async () => 7 });
    const svc = new FindingArchiveService(
      findingRepo,
      catalog,
    );
    const res = await svc.expireAndClean();
    expect(res.expired).toBe(7);
    expect(res.orphans).toBe(42);
    expect(portCalls.length).toBe(1);
  });
});

describe("KgQueryService.getKnowledgeGraph — delegates name resolution", () => {
  it("calls EntityCatalogPort.resolveNames with the batch of edge refs", async () => {
    let receivedRefs: EntityRef[] = [];
    const catalog: EntityCatalogPort = {
      resolveNames: async (refs) => {
        receivedRefs = refs;
        return new Map([["satellite:1", "TestSat"]]);
      },
      cleanOrphans: async () => 0,
    };
    const findingRepo = mkFindingRepo({
      findActive: async (): Promise<ResearchFinding[]> => [
        {
          id: 1n,
          researchCycleId: 1n,
          cortex: "fleet_analyst",
          findingType: ResearchFindingType.Insight,
          status: ResearchStatus.Active,
          urgency: null,
          title: "F1",
          summary: "s",
          evidence: null,
          reasoning: null,
          confidence: 0.9,
          impactScore: null,
          extensions: null,
          reflexionNotes: null,
          iteration: 0,
          dedupHash: null,
          embedding: null,
          expiresAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ],
    });
    const edgeRepo = mkEdgeRepo({
      findByFindings: async () => [
        {
          id: 1n,
          findingId: 1n,
          entityType: "satellite",
          entityId: 1n,
          relation: ResearchRelation.About,
          weight: null,
          context: null,
          createdAt: new Date(),
        },
      ],
    });
    const svc = new KgQueryService(
      findingRepo,
      edgeRepo,
      nullEmbedder,
      catalog,
    );
    const kg = await svc.getKnowledgeGraph({ limit: 10 });
    expect(receivedRefs).toEqual([{ entityType: "satellite", entityId: 1n }]);
    // Entity node should use the name resolved by the port.
    const entityNode = kg.nodes.find((n) => n.id === "satellite:1");
    expect(entityNode?.label).toBe("TestSat");
  });
});
