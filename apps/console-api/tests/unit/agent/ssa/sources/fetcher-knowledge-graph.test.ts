import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakePort, typedSpy } from "@interview/test-kit";
import type { ResearchGraphService } from "@interview/thalamus";
import type { SourceKind as RegisteredSourceKind } from "../../../../../src/agent/ssa/sources/types";
import {
  ResearchEntityType,
  ResearchFindingType,
  ResearchStatus,
} from "@interview/shared/enum";

type GraphFinding = Awaited<
  ReturnType<ResearchGraphService["queryByEntity"]>
>[number];

async function loadFetcher(
  kind: RegisteredSourceKind,
  modulePath: string,
) {
  vi.resetModules();
  const mod = await import(modulePath);
  const { getFetcherByKind } = await import(
    "../../../../../src/agent/ssa/sources/registry"
  );
  const fetcher = getFetcherByKind(kind);
  expect(fetcher).toBeTypeOf("function");
  if (!fetcher) throw new Error(`missing fetcher for ${kind}`);
  return { fetcher, mod };
}

function makeFinding(id: bigint, overrides: Partial<{
  title: string;
  summary: string;
  confidence: number;
  impactScore: number | null;
  cortex: string;
  findingType: ResearchFindingType;
}> = {}): GraphFinding {
  return {
    id,
    researchCycleId: 10n,
    cortex: overrides.cortex ?? "content_producer",
    findingType: overrides.findingType ?? ResearchFindingType.Insight,
    status: ResearchStatus.Active,
    urgency: null,
    title: overrides.title ?? `Finding ${id}`,
    summary: overrides.summary ?? `Summary ${id}`,
    evidence: ["e1"],
    reasoning: null,
    confidence: overrides.confidence ?? 0.8,
    impactScore: overrides.impactScore ?? 12,
    extensions: null,
    reflexionNotes: null,
    iteration: 0,
    dedupHash: null,
    embedding: null,
    expiresAt: null,
    createdAt: new Date("2026-04-01T00:00:00.000Z"),
    updatedAt: new Date("2026-04-01T00:00:00.000Z"),
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("knowledge-graph fetcher", () => {
  it("returns [] when the graph service has not been wired", async () => {
    const { fetcher } = await loadFetcher(
      "knowledge-graph",
      "../../../../../src/agent/ssa/sources/fetcher-knowledge-graph",
    );

    await expect(fetcher({ query: "satellite anomalies" })).resolves.toEqual([]);
  });

  it("combines entity findings with semantic matches and de-duplicates repeated finding ids", async () => {
    const queryByEntity = typedSpy<ResearchGraphService["queryByEntity"]>();
    const semanticSearch = typedSpy<ResearchGraphService["semanticSearch"]>();
    queryByEntity.mockResolvedValue([
      makeFinding(1n, {
        title: "Entity finding",
        summary: "Entity summary",
        confidence: 0.91,
        impactScore: 15,
      }),
    ]);
    semanticSearch.mockResolvedValue([
      {
        ...makeFinding(1n, {
          title: "Entity finding",
          summary: "Entity summary",
          confidence: 0.91,
          impactScore: 15,
        }),
        similarity: 0.99,
      },
      {
        ...makeFinding(2n, {
          title: "Semantic finding",
          summary: "Semantic summary",
          confidence: 0.72,
          impactScore: 9,
        }),
        similarity: 0.81,
      },
    ]);

    const { fetcher, mod } = await loadFetcher(
      "knowledge-graph",
      "../../../../../src/agent/ssa/sources/fetcher-knowledge-graph",
    );
    mod.setGraphService(
      fakePort<ResearchGraphService>({
        queryByEntity,
        semanticSearch,
      }),
    );

    const out = await fetcher({
      entityType: ResearchEntityType.Satellite,
      entityId: 25544,
      contentType: "thematic_article",
      query: "launch trends",
      entityName: "STARLINK",
    });

    expect(queryByEntity).toHaveBeenCalledWith(
      ResearchEntityType.Satellite,
      25544n,
      { minConfidence: 0.5, limit: 15 },
    );
    expect(semanticSearch).toHaveBeenCalledWith(
      "launch market trends analysis launch trends STARLINK",
      10,
    );
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({
      type: "knowledge_graph",
      source: "kg:entity:satellite:25544",
      data: expect.objectContaining({
        findingId: "1",
        title: "Entity finding",
        summary: "Entity summary",
      }),
    });
    expect(out[1]).toMatchObject({
      type: "knowledge_graph_semantic",
      source: "kg:semantic:launch market trends analysis launch trends STARLI",
      data: expect.objectContaining({
        findingId: "2",
        title: "Semantic finding",
        similarity: 0.81,
      }),
    });
  });

  it("keeps semantic matches when the entity query fails for a valid entity", async () => {
    const queryByEntity = typedSpy<ResearchGraphService["queryByEntity"]>();
    const semanticSearch = typedSpy<ResearchGraphService["semanticSearch"]>();
    queryByEntity.mockRejectedValue(new Error("kg entity query failed"));
    semanticSearch.mockResolvedValue([
      {
        ...makeFinding(3n, {
          title: "Fallback semantic finding",
          summary: "Semantic fallback summary",
          confidence: 0.67,
          impactScore: 6,
        }),
        similarity: 0.73,
      },
    ]);

    const { fetcher, mod } = await loadFetcher(
      "knowledge-graph",
      "../../../../../src/agent/ssa/sources/fetcher-knowledge-graph",
    );
    mod.setGraphService(
      fakePort<ResearchGraphService>({
        queryByEntity,
        semanticSearch,
      }),
    );

    const out = await fetcher({
      entityType: ResearchEntityType.Satellite,
      entityId: 101,
      query: "thermal drift",
    });

    expect(queryByEntity).toHaveBeenCalledWith(
      ResearchEntityType.Satellite,
      101n,
      { minConfidence: 0.5, limit: 15 },
    );
    expect(semanticSearch).toHaveBeenCalledWith("thermal drift", 10);
    expect(out).toEqual([
      expect.objectContaining({
        type: "knowledge_graph_semantic",
        source: "kg:semantic:thermal drift",
        data: expect.objectContaining({
          findingId: "3",
          title: "Fallback semantic finding",
          similarity: 0.73,
        }),
      }),
    ]);
  });

  it("skips invalid entity types, falls back to the generic satellite query label, and swallows graph errors", async () => {
    const queryByEntity = typedSpy<ResearchGraphService["queryByEntity"]>();
    const semanticSearch = typedSpy<ResearchGraphService["semanticSearch"]>();
    semanticSearch.mockRejectedValue(new Error("embeddings down"));

    const { fetcher, mod } = await loadFetcher(
      "knowledge-graph",
      "../../../../../src/agent/ssa/sources/fetcher-knowledge-graph",
    );
    mod.setGraphService(
      fakePort<ResearchGraphService>({
        queryByEntity,
        semanticSearch,
      }),
    );

    await expect(
      fetcher({
        entityType: "not-valid",
        entityId: 99,
        contentType: "unexpected-type",
      }),
    ).resolves.toEqual([]);

    expect(queryByEntity).not.toHaveBeenCalled();
    expect(semanticSearch).toHaveBeenCalledWith("satellite", 10);
  });

  it("returns [] when no entity and no search inputs are provided", async () => {
    const queryByEntity = typedSpy<ResearchGraphService["queryByEntity"]>();
    const semanticSearch = typedSpy<ResearchGraphService["semanticSearch"]>();

    const { fetcher, mod } = await loadFetcher(
      "knowledge-graph",
      "../../../../../src/agent/ssa/sources/fetcher-knowledge-graph",
    );
    mod.setGraphService(
      fakePort<ResearchGraphService>({
        queryByEntity,
        semanticSearch,
      }),
    );

    await expect(fetcher({})).resolves.toEqual([]);
    expect(queryByEntity).not.toHaveBeenCalled();
    expect(semanticSearch).not.toHaveBeenCalled();
  });
});
