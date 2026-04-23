import { afterEach, describe, expect, it, vi } from "vitest";
import { fakePort, typedSpy } from "@interview/test-kit";
import {
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import type { CortexFinding, DAGPlan } from "../src/cortices/types";
import type { ResearchFinding } from "../src/types/research.types";
import { FindingPersister } from "../src/services/finding-persister.service";
import type { ResearchGraphService } from "../src/services/research-graph.service";

function makePlan(cortices: string[]): DAGPlan {
  return {
    intent: "test intent",
    complexity: "moderate",
    nodes: cortices.map((cortex) => ({
      cortex,
      params: {},
      dependsOn: [],
    })),
  };
}

function makeFinding(
  overrides: Partial<CortexFinding> = {},
): CortexFinding {
  return {
    title: "Nominal finding",
    summary: "Nominal summary",
    findingType: ResearchFindingType.Insight,
    urgency: ResearchUrgency.Low,
    evidence: [{ source: "fixture", data: { id: 1 }, weight: 1 }],
    confidence: 0.8,
    impactScore: 4,
    edges: [
      {
        entityType: "satellite",
        entityId: 7,
        relation: ResearchRelation.About,
        context: { source: "fixture" },
      },
    ],
    ...overrides,
  };
}

function makeStoredFinding(
  overrides: Partial<ResearchFinding> = {},
): ResearchFinding {
  return {
    id: 101n,
    researchCycleId: 11n,
    cortex: "strategist",
    findingType: ResearchFindingType.Insight,
    status: ResearchStatus.Active,
    urgency: ResearchUrgency.Low,
    title: "Stored finding",
    summary: "Stored summary",
    evidence: [],
    reasoning: null,
    confidence: 0.8,
    impactScore: 4,
    extensions: null,
    reflexionNotes: null,
    iteration: 2,
    dedupHash: null,
    embedding: null,
    expiresAt: null,
    createdAt: new Date("2026-04-22T10:00:00.000Z"),
    updatedAt: new Date("2026-04-22T10:00:00.000Z"),
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("FindingPersister.persist", () => {
  it("stores stamped cortices and assigns TTL buckets at the confidence boundaries", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-22T10:00:00.000Z"));

    const storeFinding = typedSpy<ResearchGraphService["storeFinding"]>();
    storeFinding.mockResolvedValue(makeStoredFinding());

    const persister = new FindingPersister(
      fakePort<ResearchGraphService>({ storeFinding }),
    );

    const storedCount = await persister.persist(
      [
        makeFinding({
          sourceCortex: "scout",
          confidence: 0.49,
          extensions: { severity: "watch" },
        }),
        makeFinding({ sourceCortex: "scout", confidence: 0.5 }),
        makeFinding({ sourceCortex: "scout", confidence: 0.7 }),
        makeFinding({ sourceCortex: "scout", confidence: 0.85 }),
      ],
      {
        cycleId: 11n,
        iteration: 2,
        plan: makePlan(["fallback"]),
      },
    );

    expect(storedCount).toBe(4);
    expect(
      storeFinding.mock.calls.map(
        ([input]) => input.finding.expiresAt?.toISOString(),
      ),
    ).toEqual([
      "2026-05-06T10:00:00.000Z",
      "2026-05-22T10:00:00.000Z",
      "2026-06-21T10:00:00.000Z",
      "2026-07-21T10:00:00.000Z",
    ]);
    expect(storeFinding.mock.calls[0]?.[0]).toMatchObject({
      finding: {
        cortex: "scout",
        extensions: { severity: "watch" },
        status: ResearchStatus.Active,
      },
      edges: [
        {
          entityType: "satellite",
          entityId: 7n,
          relation: ResearchRelation.About,
          weight: 1,
          context: { source: "fixture" },
        },
      ],
    });
  });

  it("falls back to the first plan cortex when a finding is not stamped", async () => {
    const storeFinding = typedSpy<ResearchGraphService["storeFinding"]>();
    storeFinding.mockResolvedValue(makeStoredFinding());

    const persister = new FindingPersister(
      fakePort<ResearchGraphService>({ storeFinding }),
    );

    const storedCount = await persister.persist(
      [
        makeFinding({
          title: "Unstamped finding",
          sourceCortex: undefined,
          edges: [
            {
              entityType: "payload",
              entityId: 12,
              relation: ResearchRelation.About,
              context: { lane: "leo" },
            },
          ],
        }),
      ],
      {
        cycleId: 11n,
        iteration: 3,
        plan: makePlan(["curator", "strategist"]),
      },
    );

    expect(storedCount).toBe(1);
    expect(storeFinding.mock.calls[0]?.[0]).toMatchObject({
      finding: {
        cortex: "curator",
        iteration: 3,
      },
      edges: [
        {
          entityType: "payload",
          entityId: 12n,
          relation: ResearchRelation.About,
          weight: 1,
          context: { lane: "leo" },
        },
      ],
    });
  });

  it("maps a missing edge context to null on the normal edge path", async () => {
    const storeFinding = typedSpy<ResearchGraphService["storeFinding"]>();
    storeFinding.mockResolvedValue(makeStoredFinding());

    const persister = new FindingPersister(
      fakePort<ResearchGraphService>({ storeFinding }),
    );

    const storedCount = await persister.persist(
      [
        makeFinding({
          sourceCortex: "curator",
          edges: [
            {
              entityType: "payload",
              entityId: 33,
              relation: ResearchRelation.About,
            },
          ],
        }),
      ],
      {
        cycleId: 11n,
        iteration: 3,
        plan: makePlan(["curator"]),
      },
    );

    expect(storedCount).toBe(1);
    expect(storeFinding.mock.calls[0]?.[0]).toMatchObject({
      edges: [
        {
          entityType: "payload",
          entityId: 33n,
          relation: ResearchRelation.About,
          weight: 1,
          context: null,
        },
      ],
    });
  });

  it("uses the entity override and the unknown fallback when the plan has no nodes", async () => {
    const storeFinding = typedSpy<ResearchGraphService["storeFinding"]>();
    storeFinding.mockResolvedValue(makeStoredFinding());

    const persister = new FindingPersister(
      fakePort<ResearchGraphService>({ storeFinding }),
    );

    const storedCount = await persister.persist(
      [
        makeFinding({
          sourceCortex: undefined,
          edges: [
            {
              entityType: "should",
              entityId: 999,
              relation: ResearchRelation.RelatedTo,
            },
          ],
        }),
      ],
      {
        cycleId: 11n,
        iteration: 4,
        plan: makePlan([]),
        entityOverride: {
          entityType: "satellite",
          entityId: 42n,
        },
      },
    );

    expect(storedCount).toBe(1);
    expect(storeFinding.mock.calls[0]?.[0]).toEqual({
      finding: expect.objectContaining({
        cortex: "unknown",
      }),
      edges: [
        {
          entityType: "satellite",
          entityId: 42n,
          relation: ResearchRelation.About,
          weight: 1,
          context: null,
        },
      ],
    });
  });

  it("treats blank cortex names as missing and falls back to unknown", async () => {
    const storeFinding = typedSpy<ResearchGraphService["storeFinding"]>();
    storeFinding.mockResolvedValue(makeStoredFinding());

    const persister = new FindingPersister(
      fakePort<ResearchGraphService>({ storeFinding }),
    );

    const storedCount = await persister.persist(
      [
        makeFinding({
          sourceCortex: "",
        }),
      ],
      {
        cycleId: 11n,
        iteration: 4,
        plan: makePlan([""]),
      },
    );

    expect(storedCount).toBe(1);
    expect(storeFinding.mock.calls[0]?.[0]).toMatchObject({
      finding: {
        cortex: "unknown",
      },
    });
  });

  it("swallows per-finding storage errors and keeps persisting later findings", async () => {
    const storeFinding = typedSpy<ResearchGraphService["storeFinding"]>();
    storeFinding
      .mockRejectedValueOnce(new Error("write failed"))
      .mockResolvedValueOnce(makeStoredFinding({ id: 202n }));

    const persister = new FindingPersister(
      fakePort<ResearchGraphService>({ storeFinding }),
    );

    const storedCount = await persister.persist(
      [
        makeFinding({ title: "first finding" }),
        makeFinding({ title: "second finding" }),
      ],
      {
        cycleId: 11n,
        iteration: 5,
        plan: makePlan(["strategist"]),
      },
    );

    expect(storedCount).toBe(1);
    expect(storeFinding).toHaveBeenCalledTimes(2);
  });
});
