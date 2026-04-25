import { describe, expect, it, vi } from "vitest";
import { EMBEDDING_DIMENSIONS } from "@interview/db-schema";
import {
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import { InvalidEmbeddingDimensionError } from "../src/errors/embedding";
import type { EmbedderPort } from "../src/ports/embedder.port";
import type { EntityCatalogPort } from "../src/ports/entity-catalog.port";
import {
  ResearchGraphService,
  type CyclesGraphPort,
  type EdgesGraphPort,
  type FindingsGraphPort,
  type StoreFindingInput,
} from "../src/services/research-graph.service";
import type { ResearchFinding, ResearchEdge } from "../src/types/research.types";

type SimilarFinding = ResearchFinding & { similarity: number };

function makeEmbedding(head: number[] = [0.11, 0.22]): number[] {
  return [...head, ...Array(EMBEDDING_DIMENSIONS - head.length).fill(0)];
}

const TEST_EMBEDDING = makeEmbedding();

function makeStoredFinding(
  overrides: Partial<ResearchFinding> = {},
): ResearchFinding {
  return {
    id: 101n,
    researchCycleId: 1n,
    cortex: "catalog",
    findingType: ResearchFindingType.Insight,
    status: ResearchStatus.Active,
    urgency: ResearchUrgency.Medium,
    title: "Nominal finding",
    summary: "Nominal summary",
    evidence: [{ source: "fixture" }],
    reasoning: null,
    confidence: 0.6,
    impactScore: 5,
    extensions: null,
    reflexionNotes: null,
    iteration: 2,
    dedupHash: null,
    embedding: null,
    expiresAt: null,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    ...overrides,
  };
}

function makeEdge(
  overrides: Partial<ResearchEdge> = {},
): ResearchEdge {
  return {
    id: 1n,
    findingId: 101n,
    entityType: "satellite",
    entityId: 42n,
    relation: ResearchRelation.About,
    weight: 1,
    context: null,
    createdAt: new Date("2026-04-22T00:00:00.000Z"),
    ...overrides,
  };
}

function makeInput(
  overrides: {
    finding?: Partial<StoreFindingInput["finding"]>;
    edges?: Array<Partial<StoreFindingInput["edges"][number]>>;
  } = {},
): StoreFindingInput {
  const baseEdge: StoreFindingInput["edges"][number] = {
    entityType: "satellite",
    entityId: 42n,
    relation: ResearchRelation.About,
    weight: 1,
    context: { source: "fixture" },
  };

  return {
    finding: {
      researchCycleId: 1n,
      cortex: "catalog",
      findingType: ResearchFindingType.Insight,
      status: ResearchStatus.Active,
      urgency: ResearchUrgency.Medium,
      title: "Solar panel anomaly",
      summary: "Power draw spiked after eclipse exit.",
      evidence: [{ source: "https://example.org/evidence" }],
      confidence: 0.7,
      impactScore: 4,
      ...overrides.finding,
    },
    edges: overrides.edges
      ? overrides.edges.map((edge) => ({ ...baseEdge, ...edge }))
      : [baseEdge],
  };
}

function createHarness() {
  const insertedFinding = makeStoredFinding();
  const upsertByDedupHash = vi.fn<
    FindingsGraphPort["upsertByDedupHash"]
  >(async () => ({ finding: insertedFinding, inserted: true }));
  const findSimilar = vi.fn<
    FindingsGraphPort["findSimilar"]
  >(async () => []);
  const mergeFinding = vi.fn<
    FindingsGraphPort["mergeFinding"]
  >(async () => undefined);
  const findById = vi.fn<
    FindingsGraphPort["findById"]
  >(async () => null);
  const findByEntity = vi.fn<
    FindingsGraphPort["findByEntity"]
  >(async () => []);
  const searchBySimilarity = vi.fn<
    FindingsGraphPort["searchBySimilarity"]
  >(async () => []);
  const findActive = vi.fn<
    FindingsGraphPort["findActive"]
  >(async () => []);
  const archive = vi.fn<
    FindingsGraphPort["archive"]
  >(async () => undefined);
  const expireOld = vi.fn<
    FindingsGraphPort["expireOld"]
  >(async () => 0);
  const countByCortexAndType = vi.fn<
    FindingsGraphPort["countByCortexAndType"]
  >(async () => []);
  const countRecent24h = vi.fn<
    FindingsGraphPort["countRecent24h"]
  >(async () => 0);
  const linkToCycle = vi.fn<
    FindingsGraphPort["linkToCycle"]
  >(async () => true);

  const createMany = vi.fn<
    EdgesGraphPort["createMany"]
  >(async () => []);
  const findByFinding = vi.fn<
    EdgesGraphPort["findByFinding"]
  >(async () => []);
  const findByFindings = vi.fn<
    EdgesGraphPort["findByFindings"]
  >(async () => []);
  const countByEntityType = vi.fn<
    EdgesGraphPort["countByEntityType"]
  >(async () => []);

  const incrementFindings = vi.fn<
    CyclesGraphPort["incrementFindings"]
  >(async () => undefined);

  const embedQuery = vi.fn<
    EmbedderPort["embedQuery"]
  >(async () => TEST_EMBEDDING);
  const embedDocuments = vi.fn<
    EmbedderPort["embedDocuments"]
  >(async (texts) => texts.map(() => null));

  const resolveNames = vi.fn<
    EntityCatalogPort["resolveNames"]
  >(async () => new Map());
  const cleanOrphans = vi.fn<
    EntityCatalogPort["cleanOrphans"]
  >(async () => 0);

  const service = new ResearchGraphService(
    {
      upsertByDedupHash,
      findSimilar,
      mergeFinding,
      findById,
      findByEntity,
      searchBySimilarity,
      findActive,
      archive,
      expireOld,
      countByCortexAndType,
      countRecent24h,
      linkToCycle,
    },
    {
      createMany,
      findByFinding,
      findByFindings,
      countByEntityType,
    },
    {
      incrementFindings,
    },
    {
      isAvailable: () => true,
      embedQuery,
      embedDocuments,
    },
    {
      resolveNames,
      cleanOrphans,
    },
  );

  return {
    service,
    insertedFinding,
    upsertByDedupHash,
    findSimilar,
    mergeFinding,
    findById,
    findByEntity,
    searchBySimilarity,
    findActive,
    archive,
    countByCortexAndType,
    countRecent24h,
    linkToCycle,
    createMany,
    findByFinding,
    findByFindings,
    countByEntityType,
    incrementFindings,
    embedQuery,
    resolveNames,
  };
}

describe("ResearchGraphService", () => {
  it("merges with empty evidence when semantic dedup receives a non-array evidence payload", async () => {
    const {
      service,
      findSimilar,
      mergeFinding,
      linkToCycle,
      upsertByDedupHash,
    } = createHarness();
    const existing: SimilarFinding = {
      ...makeStoredFinding({
        id: 55n,
        confidence: 0.9,
      }),
      similarity: 0.97,
    };
    findSimilar.mockResolvedValueOnce([existing]);

    const out = await service.storeFinding(
      makeInput({
        finding: {
          evidence: { source: "not-an-array" },
        },
      }),
    );

    expect(out.id).toBe(55n);
    expect(mergeFinding).toHaveBeenCalledWith(55n, {
      confidence: 0.9,
      evidence: [],
    });
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 55n,
      iteration: 0,
      isDedupHit: true,
    });
    expect(upsertByDedupHash).not.toHaveBeenCalled();
  });

  it("links inserted findings with iteration zero when the input omits iteration and edges", async () => {
    const {
      service,
      createMany,
      embedQuery,
      findSimilar,
      incrementFindings,
      linkToCycle,
    } = createHarness();
    embedQuery.mockResolvedValueOnce(null);

    const out = await service.storeFinding(
      makeInput({
        finding: {
          iteration: undefined,
        },
        edges: [],
      }),
    );

    expect(out.id).toBe(101n);
    expect(findSimilar).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 101n,
      iteration: 0,
      isDedupHit: false,
    });
  });

  it("links hash dedup hits with iteration zero when the input omits iteration", async () => {
    const {
      service,
      upsertByDedupHash,
      incrementFindings,
      linkToCycle,
    } = createHarness();
    upsertByDedupHash.mockResolvedValueOnce({
      finding: makeStoredFinding({ id: 88n }),
      inserted: false,
    });

    await service.storeFinding(
      makeInput({
        finding: {
          iteration: undefined,
        },
      }),
    );

    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 88n,
      iteration: 0,
      isDedupHit: true,
    });
  });

  it("does not increment the cycle count when the cycle link already exists", async () => {
    const { service, embedQuery, linkToCycle, incrementFindings } =
      createHarness();
    embedQuery.mockResolvedValueOnce(null);
    linkToCycle.mockResolvedValueOnce(false);

    await service.storeFinding(makeInput({ edges: [] }));

    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 101n,
      iteration: 0,
      isDedupHit: false,
    });
    expect(incrementFindings).not.toHaveBeenCalled();
  });

  it("forwards queryByEntity to the repository", async () => {
    const { service, findByEntity } = createHarness();
    const findings = [makeStoredFinding({ id: 201n })];
    findByEntity.mockResolvedValueOnce(findings);

    await expect(
      service.queryByEntity("satellite", 42n, { minConfidence: 0.8, limit: 3 }),
    ).resolves.toEqual(findings);

    expect(findByEntity).toHaveBeenCalledWith("satellite", 42n, {
      minConfidence: 0.8,
      limit: 3,
    });
  });

  it("returns an empty semantic search result when embeddings are unavailable", async () => {
    const { service, embedQuery, searchBySimilarity } = createHarness();
    embedQuery.mockResolvedValueOnce(null);

    await expect(service.semanticSearch("missing embedding")).resolves.toEqual([]);
    expect(searchBySimilarity).not.toHaveBeenCalled();
  });

  it("forwards semantic search with the provided embedding and limit", async () => {
    const { service, searchBySimilarity } = createHarness();
    const similar: SimilarFinding[] = [
      { ...makeStoredFinding({ id: 202n }), similarity: 0.88 },
    ];
    searchBySimilarity.mockResolvedValueOnce(similar);

    await expect(service.semanticSearch("find similar", 7)).resolves.toEqual(
      similar,
    );
    expect(searchBySimilarity).toHaveBeenCalledWith(TEST_EMBEDDING, 7);
  });

  it("rejects storeFinding before repository writes when the embedder returns the wrong dimension", async () => {
    const {
      service,
      embedQuery,
      upsertByDedupHash,
      findSimilar,
      createMany,
      incrementFindings,
      linkToCycle,
    } = createHarness();
    embedQuery.mockResolvedValueOnce([0.11, 0.22]);

    const result = service.storeFinding(makeInput());

    await expect(result).rejects.toThrow(
      InvalidEmbeddingDimensionError,
    );
    await expect(result).rejects.toThrow("EmbedderPort");
    expect(upsertByDedupHash).not.toHaveBeenCalled();
    expect(findSimilar).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(incrementFindings).not.toHaveBeenCalled();
    expect(linkToCycle).not.toHaveBeenCalled();
  });

  it("rejects semanticSearch before repository lookup when the embedder returns the wrong dimension", async () => {
    const { service, embedQuery, searchBySimilarity } = createHarness();
    embedQuery.mockResolvedValueOnce([0.11, 0.22]);

    const result = service.semanticSearch("bad vector");

    await expect(result).rejects.toThrow(
      InvalidEmbeddingDimensionError,
    );
    await expect(result).rejects.toThrow("EmbedderPort");
    expect(searchBySimilarity).not.toHaveBeenCalled();
  });

  it("forwards listFindings with the default empty filter object", async () => {
    const { service, findActive } = createHarness();
    const findings = [makeStoredFinding({ id: 203n })];
    findActive.mockResolvedValueOnce(findings);

    await expect(service.listFindings()).resolves.toEqual(findings);
    expect(findActive).toHaveBeenCalledWith({});
  });

  it("returns null when getFindingWithEdges cannot find a finding", async () => {
    const { service, findById, findByFinding } = createHarness();
    findById.mockResolvedValueOnce(null);

    await expect(service.getFindingWithEdges(404n)).resolves.toBeNull();
    expect(findByFinding).not.toHaveBeenCalled();
  });

  it("returns the finding with its edges when present", async () => {
    const { service, findById, findByFinding } = createHarness();
    const finding = makeStoredFinding({ id: 204n });
    const edges = [makeEdge({ findingId: 204n })];
    findById.mockResolvedValueOnce(finding);
    findByFinding.mockResolvedValueOnce(edges);

    await expect(service.getFindingWithEdges(204n)).resolves.toEqual({
      ...finding,
      edges,
    });
  });

  it("forwards archiveFinding to the repository", async () => {
    const { service, archive } = createHarness();

    await service.archiveFinding(205n);

    expect(archive).toHaveBeenCalledWith(205n);
  });

  it("returns an empty knowledge graph and applies the default limit when no findings are active", async () => {
    const { service, findActive, findByFindings } = createHarness();

    await expect(service.getKnowledgeGraph()).resolves.toEqual({
      nodes: [],
      links: [],
    });
    expect(findActive).toHaveBeenCalledWith({ limit: 100 });
    expect(findByFindings).not.toHaveBeenCalled();
  });

  it("falls back to entity ids when the catalog cannot resolve names and deduplicates entity nodes", async () => {
    const { service, findActive, findByFindings, resolveNames } = createHarness();
    findActive.mockResolvedValueOnce([
      makeStoredFinding({
        id: 301n,
        title: "Named finding",
        cortex: "strategist",
      }),
    ]);
    findByFindings.mockResolvedValueOnce([
      makeEdge({ findingId: 301n, entityId: 42n }),
      makeEdge({ id: 2n, findingId: 301n, entityId: 42n }),
    ]);
    resolveNames.mockResolvedValueOnce(new Map());

    const graph = await service.getKnowledgeGraph({ limit: 2 });

    expect(graph.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "finding:301",
          label: "Named finding",
        }),
        {
          id: "satellite:42",
          label: "satellite #42",
          type: "satellite",
        },
      ]),
    );
    expect(graph.nodes.filter((node) => node.id === "satellite:42")).toHaveLength(1);
    expect(graph.links).toHaveLength(2);
  });

  it("aggregates graph stats across finding and entity buckets", async () => {
    const {
      service,
      countByCortexAndType,
      countByEntityType,
      countRecent24h,
    } = createHarness();
    countByCortexAndType.mockResolvedValueOnce([
      { cortex: "strategist", finding_type: "insight", cnt: 2 },
      { cortex: "strategist", finding_type: "alert", cnt: 1 },
      { cortex: "curator", finding_type: "alert", cnt: 3 },
    ]);
    countByEntityType.mockResolvedValueOnce([
      { entity_type: "satellite", cnt: 4 },
      { entity_type: "operator", cnt: 2 },
    ]);
    countRecent24h.mockResolvedValueOnce(5);

    await expect(service.getGraphStats()).resolves.toEqual({
      totalFindings: 6,
      totalEdges: 6,
      byCortex: {
        strategist: 3,
        curator: 3,
      },
      byFindingType: {
        insight: 2,
        alert: 4,
      },
      byEntityType: {
        satellite: 4,
        operator: 2,
      },
      recentCount24h: 5,
    });
  });
});
