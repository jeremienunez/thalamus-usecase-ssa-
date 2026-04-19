/**
 * ResearchGraphService — Phase 3 · Task 3.2 of thalamus agnosticity cleanup.
 *
 * The service stops owning the two SSA-specific concerns (edge cleanOrphans
 * SQL + ENTITY_TABLE_MAP name resolution). Both now go through
 * EntityCatalogPort — the domain adapter on the app side (SSA or other).
 */

import { describe, it, expect } from "vitest";
import { ResearchGraphService } from "../src/services/research-graph.service";
import type {
  FindingsGraphPort,
  EdgesGraphPort,
  CyclesGraphPort,
} from "../src/services/research-graph.service";
import type {
  EntityCatalogPort,
  EntityRef,
} from "../src/ports/entity-catalog.port";
import type { VoyageEmbedder } from "../src/utils/voyage-embedder";

// Minimal embedder stub — these tests never embed anything; a shape cast
// avoids loading the real Voyage adapter (Phase 4 replaces it with a port).
const nullEmbedder = {
  isAvailable: () => false,
  embedQuery: async () => null,
  embedDocuments: async () => [] as (number[] | null)[],
} as unknown as VoyageEmbedder;

function mkFindingRepo(overrides: Partial<FindingsGraphPort> = {}): FindingsGraphPort {
  return {
    upsertByDedupHash: async () => ({
      finding: {} as never,
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
    linkToCycle: async () => undefined,
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

const noCycleRepo: CyclesGraphPort = {
  incrementFindings: async () => undefined,
};

describe("ResearchGraphService.expireAndClean — delegates to EntityCatalogPort", () => {
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
    const svc = new ResearchGraphService(
      findingRepo,
      mkEdgeRepo(),
      noCycleRepo,
      nullEmbedder,
      catalog,
    );
    const res = await svc.expireAndClean();
    expect(res.expired).toBe(7);
    expect(res.orphans).toBe(42);
    expect(portCalls.length).toBe(1);
  });
});

describe("ResearchGraphService.getKnowledgeGraph — delegates name resolution", () => {
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
      findActive: async () => [
        {
          id: 1n,
          researchCycleId: 1n,
          cortex: "fleet_analyst" as never,
          findingType: "insight" as never,
          status: "active" as never,
          urgency: null,
          title: "F1",
          summary: "s",
          evidence: null,
          reasoning: null,
          confidence: 0.9,
          impactScore: null,
          busContext: null,
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
          entityType: "satellite" as never,
          entityId: 1n,
          relation: "about" as never,
          weight: null,
          context: null,
          createdAt: new Date(),
        },
      ],
    });
    const svc = new ResearchGraphService(
      findingRepo,
      edgeRepo,
      noCycleRepo,
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
