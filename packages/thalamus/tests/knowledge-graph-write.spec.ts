import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "@interview/db-schema";
import {
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EntityCatalogPort } from "../src/ports/entity-catalog.port";
import type { EmbedderPort } from "../src/ports/embedder.port";
import {
  ResearchGraphService,
  type CyclesGraphPort,
  type EdgesGraphPort,
  type FindingsGraphPort,
  type ResearchGraphTransactionPort,
  type StoreFindingInput,
} from "../src/services/research-graph.service";
import type { ResearchEdge, ResearchFinding } from "../src/types/research.types";

type Args<T extends (...args: any[]) => any> = Parameters<T>;
type Result<T extends (...args: any[]) => any> = ReturnType<T>;

function sha25632(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

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
    findingType: ResearchFindingType.Anomaly,
    status: ResearchStatus.Active,
    urgency: ResearchUrgency.Medium,
    title: "Nominal finding",
    summary: "Nominal summary",
    evidence: [{ source: "https://example.org/evidence" }],
    reasoning: null,
    confidence: 0.6,
    impactScore: 5,
    extensions: null,
    reflexionNotes: null,
    iteration: 0,
    dedupHash: null,
    embedding: null,
    expiresAt: null,
    createdAt: new Date("2026-04-21T00:00:00.000Z"),
    updatedAt: new Date("2026-04-21T00:00:00.000Z"),
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
    context: { source: "seed" },
  };

  return {
    finding: {
      researchCycleId: 1n,
      cortex: "catalog",
      findingType: ResearchFindingType.Anomaly,
      status: ResearchStatus.Active,
      urgency: ResearchUrgency.Medium,
      title: "Solar panel anomaly",
      summary: "Power draw spiked after eclipse exit.",
      evidence: [{ source: "https://example.org/evidence" }],
      confidence: 0.7,
      impactScore: 4,
      iteration: 0,
      ...overrides.finding,
    },
    edges: overrides.edges
      ? overrides.edges.map((edge) => ({ ...baseEdge, ...edge }))
      : [baseEdge],
  };
}

function createHarness() {
  const insertedFinding = makeStoredFinding();
  const embedQuery = vi.fn<
    Args<EmbedderPort["embedQuery"]>,
    Result<EmbedderPort["embedQuery"]>
  >(async (_text) => TEST_EMBEDDING);
  const upsertByDedupHash = vi.fn<
    Args<FindingsGraphPort["upsertByDedupHash"]>,
    Result<FindingsGraphPort["upsertByDedupHash"]>
  >(
    async (_data) => ({
      finding: insertedFinding,
      inserted: true,
    }),
  );
  const findSimilar = vi.fn<
    Args<FindingsGraphPort["findSimilar"]>,
    Result<FindingsGraphPort["findSimilar"]>
  >(async () => []);
  const mergeFinding = vi.fn<
    Args<FindingsGraphPort["mergeFinding"]>,
    Result<FindingsGraphPort["mergeFinding"]>
  >(
    async (_id, _data) => undefined,
  );
  const findById = vi.fn<
    Args<FindingsGraphPort["findById"]>,
    Result<FindingsGraphPort["findById"]>
  >(async (_id) => null);
  const findByEntity = vi.fn<
    Args<FindingsGraphPort["findByEntity"]>,
    Result<FindingsGraphPort["findByEntity"]>
  >(
    async (_entityType, _entityId, _opts) => [],
  );
  const searchBySimilarity = vi.fn<
    Args<FindingsGraphPort["searchBySimilarity"]>,
    Result<FindingsGraphPort["searchBySimilarity"]>
  >(
    async (_embedding, _limit) => [],
  );
  const findActive = vi.fn<
    Args<FindingsGraphPort["findActive"]>,
    Result<FindingsGraphPort["findActive"]>
  >(async (_opts) => []);
  const archive = vi.fn<
    Args<FindingsGraphPort["archive"]>,
    Result<FindingsGraphPort["archive"]>
  >(async (_id) => undefined);
  const expireOld = vi.fn<
    Args<FindingsGraphPort["expireOld"]>,
    Result<FindingsGraphPort["expireOld"]>
  >(async () => 0);
  const countByCortexAndType = vi.fn<
    Args<FindingsGraphPort["countByCortexAndType"]>,
    Result<FindingsGraphPort["countByCortexAndType"]>
  >(
    async () => [],
  );
  const countRecent24h = vi.fn<
    Args<FindingsGraphPort["countRecent24h"]>,
    Result<FindingsGraphPort["countRecent24h"]>
  >(async () => 0);
  const linkToCycle = vi.fn<
    Args<FindingsGraphPort["linkToCycle"]>,
    Result<FindingsGraphPort["linkToCycle"]>
  >(
    async (_opts) => undefined,
  );
  const createMany = vi.fn<
    Args<EdgesGraphPort["createMany"]>,
    Result<EdgesGraphPort["createMany"]>
  >(async (_edges) => []);
  const findByFinding = vi.fn<
    Args<EdgesGraphPort["findByFinding"]>,
    Result<EdgesGraphPort["findByFinding"]>
  >(
    async (_findingId) => [],
  );
  const findByFindings = vi.fn<
    Args<EdgesGraphPort["findByFindings"]>,
    Result<EdgesGraphPort["findByFindings"]>
  >(
    async (_findingIds) => [],
  );
  const countByEntityType = vi.fn<
    Args<EdgesGraphPort["countByEntityType"]>,
    Result<EdgesGraphPort["countByEntityType"]>
  >(
    async () => [],
  );
  const incrementFindings = vi.fn<
    Args<CyclesGraphPort["incrementFindings"]>,
    Result<CyclesGraphPort["incrementFindings"]>
  >(
    async (_id) => undefined,
  );
  const embedDocuments = vi.fn<
    Args<EmbedderPort["embedDocuments"]>,
    Result<EmbedderPort["embedDocuments"]>
  >(async (texts) => texts.map(() => null));

  const findingRepo: FindingsGraphPort = {
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
  };
  const edgeRepo: EdgesGraphPort = {
    createMany,
    findByFinding,
    findByFindings,
    countByEntityType,
  };
  const cycleRepo: CyclesGraphPort = {
    incrementFindings,
  };
  const embedder: EmbedderPort = {
    isAvailable: () => true,
    embedQuery,
    embedDocuments,
  };
  const entityCatalog: EntityCatalogPort = {
    resolveNames: async () => new Map(),
    cleanOrphans: async () => 0,
  };

  const service = new ResearchGraphService(
    findingRepo,
    edgeRepo,
    cycleRepo,
    embedder,
    entityCatalog,
  );

  return {
    service,
    insertedFinding,
    embedQuery,
    upsertByDedupHash,
    findSimilar,
    mergeFinding,
    linkToCycle,
    createMany,
    incrementFindings,
  };
}

type GraphState = {
  findings: Map<bigint, ResearchFinding>;
  edges: ResearchEdge[];
  cycleCounts: Map<bigint, number>;
  cycleLinks: Array<{
    cycleId: bigint;
    findingId: bigint;
    iteration: number;
    isDedupHit: boolean;
  }>;
};

type FailurePoint = "entity-edge-create" | "cycle-link";

function cloneGraphState(state: GraphState): GraphState {
  return {
    findings: new Map(
      [...state.findings.entries()].map(([id, finding]) => [
        id,
        { ...finding },
      ]),
    ),
    edges: state.edges.map((edge) => ({ ...edge })),
    cycleCounts: new Map(state.cycleCounts),
    cycleLinks: state.cycleLinks.map((link) => ({ ...link })),
  };
}

function replaceGraphState(target: GraphState, source: GraphState): void {
  target.findings = source.findings;
  target.edges = source.edges;
  target.cycleCounts = source.cycleCounts;
  target.cycleLinks = source.cycleLinks;
}

function createTransactionalHarness() {
  const state: GraphState = {
    findings: new Map(),
    edges: [],
    cycleCounts: new Map(),
    cycleLinks: [],
  };
  const tx = { commits: 0, rollbacks: 0 };
  let activeState = state;
  let failurePoint: FailurePoint | null = null;

  const failAt = (point: FailurePoint): void => {
    failurePoint = point;
  };

  const upsertByDedupHash = vi.fn<
    Args<FindingsGraphPort["upsertByDedupHash"]>,
    Result<FindingsGraphPort["upsertByDedupHash"]>
  >(async (data) => {
    const finding = makeStoredFinding({
      researchCycleId: data.researchCycleId,
      cortex: data.cortex,
      findingType: data.findingType,
      status: data.status ?? ResearchStatus.Active,
      urgency: data.urgency ?? null,
      title: data.title,
      summary: data.summary,
      evidence: data.evidence ?? [],
      reasoning: data.reasoning ?? null,
      confidence: data.confidence,
      impactScore: data.impactScore ?? null,
      extensions: data.extensions ?? null,
      reflexionNotes: data.reflexionNotes ?? null,
      iteration: data.iteration ?? 0,
      dedupHash: data.dedupHash ?? null,
      embedding: data.embedding ?? null,
      expiresAt: data.expiresAt ?? null,
    });
    activeState.findings.set(finding.id, finding);
    return { finding, inserted: true };
  });

  const findSimilar = vi.fn<
    Args<FindingsGraphPort["findSimilar"]>,
    Result<FindingsGraphPort["findSimilar"]>
  >(async () => []);
  const mergeFinding = vi.fn<
    Args<FindingsGraphPort["mergeFinding"]>,
    Result<FindingsGraphPort["mergeFinding"]>
  >(async (id, data) => {
    const existing = activeState.findings.get(id);
    if (!existing) return;
    activeState.findings.set(id, {
      ...existing,
      confidence: Math.max(existing.confidence, data.confidence),
      evidence: [
        ...(Array.isArray(existing.evidence) ? existing.evidence : []),
        ...data.evidence,
      ],
      iteration: existing.iteration + 1,
      updatedAt: new Date("2026-04-22T00:00:00.000Z"),
    });
  });
  const findById = vi.fn<
    Args<FindingsGraphPort["findById"]>,
    Result<FindingsGraphPort["findById"]>
  >(async () => null);
  const findByEntity = vi.fn<
    Args<FindingsGraphPort["findByEntity"]>,
    Result<FindingsGraphPort["findByEntity"]>
  >(async () => []);
  const searchBySimilarity = vi.fn<
    Args<FindingsGraphPort["searchBySimilarity"]>,
    Result<FindingsGraphPort["searchBySimilarity"]>
  >(async () => []);
  const findActive = vi.fn<
    Args<FindingsGraphPort["findActive"]>,
    Result<FindingsGraphPort["findActive"]>
  >(async () => []);
  const archive = vi.fn<
    Args<FindingsGraphPort["archive"]>,
    Result<FindingsGraphPort["archive"]>
  >(async () => undefined);
  const expireOld = vi.fn<
    Args<FindingsGraphPort["expireOld"]>,
    Result<FindingsGraphPort["expireOld"]>
  >(async () => 0);
  const countByCortexAndType = vi.fn<
    Args<FindingsGraphPort["countByCortexAndType"]>,
    Result<FindingsGraphPort["countByCortexAndType"]>
  >(async () => []);
  const countRecent24h = vi.fn<
    Args<FindingsGraphPort["countRecent24h"]>,
    Result<FindingsGraphPort["countRecent24h"]>
  >(async () => 0);
  const linkToCycle = vi.fn<
    Args<FindingsGraphPort["linkToCycle"]>,
    Result<FindingsGraphPort["linkToCycle"]>
  >(async (opts) => {
    if (failurePoint === "cycle-link") {
      throw new Error("cycle link failed");
    }
    activeState.cycleLinks.push(opts);
  });

  const createMany = vi.fn<
    Args<EdgesGraphPort["createMany"]>,
    Result<EdgesGraphPort["createMany"]>
  >(async (edges) => {
    if (failurePoint === "entity-edge-create") {
      throw new Error("edge create failed");
    }
    const created = edges.map((edge, index) => ({
      id: BigInt(activeState.edges.length + index + 1),
      findingId: edge.findingId,
      entityType: edge.entityType,
      entityId: edge.entityId,
      relation: edge.relation,
      weight: edge.weight ?? null,
      context: edge.context ?? null,
      createdAt: edge.createdAt ?? new Date("2026-04-22T00:00:00.000Z"),
    }));
    activeState.edges.push(...created);
    return created;
  });
  const findByFinding = vi.fn<
    Args<EdgesGraphPort["findByFinding"]>,
    Result<EdgesGraphPort["findByFinding"]>
  >(async () => []);
  const findByFindings = vi.fn<
    Args<EdgesGraphPort["findByFindings"]>,
    Result<EdgesGraphPort["findByFindings"]>
  >(async () => []);
  const countByEntityType = vi.fn<
    Args<EdgesGraphPort["countByEntityType"]>,
    Result<EdgesGraphPort["countByEntityType"]>
  >(async () => []);

  const incrementFindings = vi.fn<
    Args<CyclesGraphPort["incrementFindings"]>,
    Result<CyclesGraphPort["incrementFindings"]>
  >(async (id) => {
    activeState.cycleCounts.set(id, (activeState.cycleCounts.get(id) ?? 0) + 1);
  });

  const findingRepo: FindingsGraphPort = {
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
  };
  const edgeRepo: EdgesGraphPort = {
    createMany,
    findByFinding,
    findByFindings,
    countByEntityType,
  };
  const cycleRepo: CyclesGraphPort = { incrementFindings };
  const transactionPort: ResearchGraphTransactionPort = {
    runInTransaction: async (work) => {
      const draft = cloneGraphState(state);
      const previous = activeState;
      activeState = draft;
      try {
        const result = await work({ findingRepo, edgeRepo, cycleRepo });
        replaceGraphState(state, draft);
        tx.commits++;
        return result;
      } catch (err) {
        tx.rollbacks++;
        throw err;
      } finally {
        activeState = previous;
      }
    },
  };
  const embedQuery = vi.fn<
    Args<EmbedderPort["embedQuery"]>,
    Result<EmbedderPort["embedQuery"]>
  >(async () => null);
  const embedDocuments = vi.fn<
    Args<EmbedderPort["embedDocuments"]>,
    Result<EmbedderPort["embedDocuments"]>
  >(async (texts) => texts.map(() => null));

  const service = new ResearchGraphService(
    findingRepo,
    edgeRepo,
    cycleRepo,
    {
      isAvailable: () => true,
      embedQuery,
      embedDocuments,
    },
    {
      resolveNames: async () => new Map(),
      cleanOrphans: async () => 0,
    },
    transactionPort,
  );

  return {
    service,
    state,
    tx,
    failAt,
    embedQuery,
    upsertByDedupHash,
    findSimilar,
    mergeFinding,
    createMany,
    incrementFindings,
    linkToCycle,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ResearchGraphService.storeFinding", () => {
  it("computes the anchored dedup hash from cortex + primary edge + finding type", async () => {
    const { service, embedQuery, upsertByDedupHash } = createHarness();
    const input = makeInput({
      finding: {
        cortex: "catalog",
        findingType: ResearchFindingType.Alert,
      },
      edges: [{ entityType: "satellite", entityId: 42n }],
    });

    await service.storeFinding(input);

    expect(embedQuery).toHaveBeenCalledWith(
      "Solar panel anomaly\nPower draw spiked after eclipse exit.",
    );
    expect(upsertByDedupHash).toHaveBeenCalledTimes(1);
    expect(upsertByDedupHash.mock.calls[0]?.[0]).toMatchObject({
      dedupHash: sha25632("catalog:satellite:42:alert"),
      embedding: TEST_EMBEDDING,
    });
  });

  it("merges into an existing finding when semantic dedup finds the same type on the same entity", async () => {
    const {
      service,
      findSimilar,
      mergeFinding,
      upsertByDedupHash,
      createMany,
      incrementFindings,
      linkToCycle,
    } = createHarness();
    const existing = {
      ...makeStoredFinding({
        id: 55n,
        findingType: ResearchFindingType.Anomaly,
        confidence: 0.9,
      }),
      similarity: 0.97,
    };
    const input = makeInput();
    findSimilar.mockResolvedValueOnce([existing]);

    const out = await service.storeFinding(input);

    expect(out).toMatchObject({ id: 55n, findingType: ResearchFindingType.Anomaly });
    expect(mergeFinding).toHaveBeenCalledWith(55n, {
      confidence: 0.9,
      evidence: [{ source: "https://example.org/evidence" }],
    });
    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 55n,
      iteration: 0,
      isDedupHit: true,
    });
    expect(upsertByDedupHash).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
  });

  it("falls back to hash upsert when the nearest semantic match has a different finding type", async () => {
    const {
      service,
      findSimilar,
      mergeFinding,
      upsertByDedupHash,
      linkToCycle,
    } = createHarness();
    findSimilar
      .mockResolvedValueOnce([
        {
          ...makeStoredFinding({
            id: 77n,
            findingType: ResearchFindingType.Insight,
          }),
          similarity: 0.98,
        },
      ])
      .mockResolvedValueOnce([]);

    await service.storeFinding(makeInput());

    expect(mergeFinding).not.toHaveBeenCalled();
    expect(upsertByDedupHash).toHaveBeenCalledTimes(1);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 101n,
      iteration: 0,
      isDedupHit: false,
    });
  });

  it("uses the timestamped fallback bucket for unanchored findings", async () => {
    const { service, embedQuery, findSimilar, upsertByDedupHash } = createHarness();
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    embedQuery.mockResolvedValueOnce(null);
    const input = makeInput({
      edges: [{ entityType: "satellite", entityId: 0n }],
    });

    await service.storeFinding(input);

    expect(findSimilar).not.toHaveBeenCalled();
    expect(upsertByDedupHash.mock.calls[0]?.[0]).toMatchObject({
      dedupHash: sha25632("catalog:1:1700000000000:Solar panel anomaly"),
      embedding: null,
    });
  });

  it("counts and links the cycle on a hash dedup hit while skipping insert-only side effects", async () => {
    const {
      service,
      upsertByDedupHash,
      createMany,
      incrementFindings,
      linkToCycle,
      findSimilar,
    } = createHarness();
    const existing = makeStoredFinding({ id: 88n, iteration: 3 });
    upsertByDedupHash.mockResolvedValueOnce({
      finding: existing,
      inserted: false,
    });
    const callback = vi.fn(async () => undefined);
    service.onFinding(callback);

    const out = await service.storeFinding(makeInput());

    expect(out).toMatchObject({ id: 88n, iteration: 3 });
    expect(findSimilar).toHaveBeenCalledTimes(1);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 88n,
      iteration: 0,
      isDedupHit: true,
    });
    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(createMany).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it("creates only resolved entity edges on insert", async () => {
    const { service, embedQuery, createMany } = createHarness();
    embedQuery.mockResolvedValueOnce(null);

    await service.storeFinding(
      makeInput({
        edges: [
          { entityType: "satellite", entityId: 42n, relation: ResearchRelation.About },
          { entityType: "satellite", entityId: 0n, relation: ResearchRelation.About },
        ],
      }),
    );

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(createMany.mock.calls[0]?.[0]).toEqual([
      {
        findingId: 101n,
        entityType: "satellite",
        entityId: 42n,
        relation: ResearchRelation.About,
        weight: 1,
        context: { source: "seed" },
      },
    ]);
  });

  it("rolls back the inserted finding when entity edge creation fails", async () => {
    const {
      service,
      state,
      tx,
      failAt,
      createMany,
      incrementFindings,
      linkToCycle,
    } = createTransactionalHarness();
    const callback = vi.fn(async () => undefined);
    service.onFinding(callback);
    failAt("entity-edge-create");

    await expect(service.storeFinding(makeInput())).rejects.toThrow(
      "edge create failed",
    );

    expect(tx).toEqual({ commits: 0, rollbacks: 1 });
    expect(state.findings.size).toBe(0);
    expect(state.edges).toEqual([]);
    expect(state.cycleCounts.get(1n) ?? 0).toBe(0);
    expect(state.cycleLinks).toEqual([]);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(incrementFindings).not.toHaveBeenCalled();
    expect(linkToCycle).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });

  it("rolls back finding edges and cycle count when cycle link creation fails", async () => {
    const {
      service,
      state,
      tx,
      failAt,
      createMany,
      incrementFindings,
      linkToCycle,
    } = createTransactionalHarness();
    const callback = vi.fn(async () => undefined);
    service.onFinding(callback);
    failAt("cycle-link");

    await expect(service.storeFinding(makeInput())).rejects.toThrow(
      "cycle link failed",
    );

    expect(tx).toEqual({ commits: 0, rollbacks: 1 });
    expect(state.findings.size).toBe(0);
    expect(state.edges).toEqual([]);
    expect(state.cycleCounts.get(1n) ?? 0).toBe(0);
    expect(state.cycleLinks).toEqual([]);
    expect(createMany).toHaveBeenCalledTimes(1);
    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 101n,
      iteration: 0,
      isDedupHit: false,
    });
    expect(callback).not.toHaveBeenCalled();
  });

  it("rolls back semantic merge and cycle count when cycle link creation fails", async () => {
    const {
      service,
      state,
      tx,
      failAt,
      embedQuery,
      findSimilar,
      mergeFinding,
      incrementFindings,
      linkToCycle,
    } = createTransactionalHarness();
    const existing = makeStoredFinding({
      id: 55n,
      confidence: 0.4,
      evidence: [{ source: "old evidence" }],
      iteration: 2,
    });
    state.findings.set(existing.id, existing);
    embedQuery.mockResolvedValueOnce(TEST_EMBEDDING);
    findSimilar.mockResolvedValueOnce([{ ...existing, similarity: 0.97 }]);
    failAt("cycle-link");

    await expect(service.storeFinding(makeInput())).rejects.toThrow(
      "cycle link failed",
    );

    expect(tx).toEqual({ commits: 0, rollbacks: 1 });
    expect(state.findings.get(55n)).toMatchObject({
      confidence: 0.4,
      evidence: [{ source: "old evidence" }],
      iteration: 2,
    });
    expect(state.cycleCounts.get(1n) ?? 0).toBe(0);
    expect(state.cycleLinks).toEqual([]);
    expect(mergeFinding).toHaveBeenCalledWith(55n, {
      confidence: 0.7,
      evidence: [{ source: "https://example.org/evidence" }],
    });
    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 55n,
      iteration: 0,
      isDedupHit: true,
    });
  });

  it("cross-links inserted findings to related findings with thresholded relations and a hard cap of 3", async () => {
    const { service, insertedFinding, findSimilar, createMany } = createHarness();
    findSimilar
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        { ...insertedFinding, similarity: 0.99 },
        { ...makeStoredFinding({ id: 201n, title: "close A" }), similarity: 0.91 },
        { ...makeStoredFinding({ id: 202n, title: "close B" }), similarity: 0.86 },
        { ...makeStoredFinding({ id: 203n, title: "close C" }), similarity: 0.8 },
        { ...makeStoredFinding({ id: 204n, title: "close D" }), similarity: 0.72 },
      ]);

    await service.storeFinding(makeInput());

    expect(createMany).toHaveBeenCalledTimes(2);
    expect(createMany.mock.calls[1]?.[0]).toEqual([
      {
        findingId: 101n,
        entityType: "finding",
        entityId: 201n,
        relation: ResearchRelation.Supports,
        weight: 0.91,
        context: { similarity: 0.91, relatedTitle: "close A" },
      },
      {
        findingId: 101n,
        entityType: "finding",
        entityId: 202n,
        relation: ResearchRelation.Supports,
        weight: 0.86,
        context: { similarity: 0.86, relatedTitle: "close B" },
      },
      {
        findingId: 101n,
        entityType: "finding",
        entityId: 203n,
        relation: ResearchRelation.SimilarTo,
        weight: 0.8,
        context: { similarity: 0.8, relatedTitle: "close C" },
      },
    ]);
  });

  it("swallows cross-linking failures and still completes the write path", async () => {
    const {
      service,
      insertedFinding,
      findSimilar,
      createMany,
      incrementFindings,
      linkToCycle,
    } = createHarness();
    findSimilar
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          ...makeStoredFinding({ id: 301n, title: "cross-link target" }),
          similarity: 0.83,
        },
      ]);
    createMany
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("hnsw down"));

    const out = await service.storeFinding(makeInput());

    expect(out).toMatchObject({ id: insertedFinding.id });
    expect(createMany).toHaveBeenCalledTimes(2);
    expect(incrementFindings).toHaveBeenCalledWith(1n);
    expect(linkToCycle).toHaveBeenCalledWith({
      cycleId: 1n,
      findingId: 101n,
      iteration: 0,
      isDedupHit: false,
    });
  });

  it("fires every callback after a successful store even if an earlier callback throws", async () => {
    const { service, embedQuery, insertedFinding, linkToCycle } = createHarness();
    embedQuery.mockResolvedValueOnce(null);
    const linkCountsAtCallback: number[] = [];
    const bad = vi.fn(async () => {
      throw new Error("callback failed");
    });
    const good = vi.fn(async () => {
      linkCountsAtCallback.push(linkToCycle.mock.calls.length);
    });
    service.onFinding(bad);
    service.onFinding(good);

    await service.storeFinding(makeInput());

    expect(bad).toHaveBeenCalledWith(insertedFinding);
    expect(good).toHaveBeenCalledWith(insertedFinding);
    expect(linkCountsAtCallback).toEqual([1]);
  });
});
