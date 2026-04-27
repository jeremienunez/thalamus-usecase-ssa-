import { describe, expect, it, vi } from "vitest";
import type { SimReviewEvidenceRow } from "../../../src/types/sim-review-evidence.types";
import type { SimRunRow } from "../../../src/types/sim-run.types";
import type {
  InsertTemporalEventInput,
  TemporalProjectionRunRow,
} from "../../../src/types/temporal.types";
import {
  TemporalProjectionService,
  type TemporalProjectionServiceDeps,
} from "../../../src/services/temporal-projection.service";

const from = new Date("2026-04-27T10:00:00Z");
const to = new Date("2026-04-27T11:00:00Z");
const projectionRun: TemporalProjectionRunRow = {
  id: 900n,
  projectionVersion: "temporal-projection-v0.2.0",
  sourceScope: "closed-window",
  fromTs: from,
  toTs: to,
  inputSnapshotHash: "snapshot",
  status: "running",
  metricsJson: {},
  createdAt: from,
  completedAt: null,
};

describe("TemporalProjectionService", () => {
  it("projects review evidence and terminal sim runs into canonical temporal events", async () => {
    const insertedEvents: InsertTemporalEventInput[] = [];
    const deps = makeDeps({
      reviewEvidence: [
        reviewEvidenceRow({
          answer: "The missing relative velocity keeps this estimate uncertain.",
        }),
      ],
      simRuns: [simRunRow({ status: "done" })],
      insertMany: async (events) => {
        insertedEvents.push(...events);
        return events.length;
      },
    });
    const service = new TemporalProjectionService(deps);

    const summary = await service.projectClosedWindow({ from, to });

    expect(summary).toMatchObject({
      projectionRunId: 900n,
      reviewEvidenceCount: 1,
      simRunCount: 1,
      eventCount: 2,
      insertedEventCount: 2,
    });
    expect(deps.projectionRunRepo.complete).toHaveBeenCalledWith(
      900n,
      expect.objectContaining({ eventCount: 2, insertedEventCount: 2 }),
    );
    const reviewEvent = insertedEvents.find(
      (event) => event.sourceTable === "sim_review_evidence",
    );
    expect(reviewEvent).toMatchObject({
      eventType: "review.missing_relative_velocity",
      eventSource: "review",
      entityId: "sim_swarm:23",
      simRunId: 10n,
      sourceDomain: "simulation",
      canonicalSignature: "review.missing_relative_velocity|review|none|none",
    });
    expect(reviewEvent?.id).toHaveLength(64);
    expect(reviewEvent?.metadataJson).not.toHaveProperty("answer");

    const runEvent = insertedEvents.find((event) => event.sourceTable === "sim_run");
    expect(runEvent).toMatchObject({
      eventType: "fish.sim_run_completed",
      eventSource: "fish",
      simRunId: 10n,
      fishIndex: 7,
      terminalStatus: "resolved",
      sourceDomain: "simulation",
      canonicalSignature: "fish.sim_run_completed|fish|none|resolved",
    });
  });

  it("marks the projection run failed when temporal event persistence rejects", async () => {
    const deps = makeDeps({
      reviewEvidence: [reviewEvidenceRow()],
      simRuns: [],
      insertMany: async () => {
        throw new Error("temporal_event insert failed");
      },
    });
    const service = new TemporalProjectionService(deps);

    await expect(service.projectClosedWindow({ from, to })).rejects.toThrow(
      "temporal_event insert failed",
    );
    expect(deps.projectionRunRepo.fail).toHaveBeenCalledWith(
      900n,
      expect.objectContaining({ error: "temporal_event insert failed" }),
    );
  });

  it("tags pattern-seeded sim runs as simulation_seeded events", async () => {
    const insertedEvents: InsertTemporalEventInput[] = [];
    const deps = makeDeps({
      reviewEvidence: [],
      simRuns: [
        simRunRow({
          seedApplied: { seeded_by_pattern_id: "pattern-hash-1" },
        }),
      ],
      insertMany: async (events) => {
        insertedEvents.push(...events);
        return events.length;
      },
    });
    const service = new TemporalProjectionService(deps);

    await service.projectClosedWindow({ from, to });

    expect(insertedEvents[0]).toMatchObject({
      sourceDomain: "simulation_seeded",
      seededByPatternId: "pattern-hash-1",
    });
  });

  it("rejects non-closed projection windows before source reads", async () => {
    const deps = makeDeps({ reviewEvidence: [], simRuns: [] });
    const service = new TemporalProjectionService(deps);

    await expect(service.projectClosedWindow({ from: to, to: from })).rejects.toThrow(
      "from < to",
    );
    expect(deps.reviewEvidenceRepo.listCreatedBetween).not.toHaveBeenCalled();
    expect(deps.simRunRepo.listTerminalCompletedBetween).not.toHaveBeenCalled();
  });
});

function makeDeps(input: {
  reviewEvidence: SimReviewEvidenceRow[];
  simRuns: SimRunRow[];
  insertMany?: (events: InsertTemporalEventInput[]) => Promise<number>;
}): TemporalProjectionServiceDeps {
  return {
    projectionRunRepo: {
      create: vi.fn(async () => projectionRun),
      complete: vi.fn(async () => undefined),
      fail: vi.fn(async () => undefined),
    },
    eventRepo: {
      insertMany: vi.fn(input.insertMany ?? (async (events) => events.length)),
    },
    reviewEvidenceRepo: {
      listCreatedBetween: vi.fn(async () => input.reviewEvidence),
    },
    simRunRepo: {
      listTerminalCompletedBetween: vi.fn(async () => input.simRuns),
    },
  };
}

function reviewEvidenceRow(
  overrides: Partial<SimReviewEvidenceRow> = {},
): SimReviewEvidenceRow {
  return {
    id: 500n,
    swarmId: 23n,
    simRunId: 10n,
    scope: "fish",
    question: "What input is missing?",
    answer: "Relative velocity is missing.",
    evidenceRefs: [{ kind: "sim_run", id: "10" }],
    traceExcerpt: { fishIndex: 7 },
    createdBy: 1n,
    createdAt: new Date("2026-04-27T10:10:00Z"),
    ...overrides,
  };
}

function simRunRow(overrides: Partial<SimRunRow> = {}): SimRunRow {
  return {
    id: 10n,
    swarmId: 23n,
    fishIndex: 7,
    kind: "uc_pc_estimator",
    seedApplied: { conjunctionId: 99 },
    perturbation: { kind: "pc" },
    config: {
      turnsPerDay: 1,
      maxTurns: 1,
      llmMode: "fixtures",
      seed: 123,
      nanoModel: "stub",
    },
    status: "done",
    reportFindingId: null,
    llmCostUsd: null,
    startedAt: new Date("2026-04-27T10:00:00Z"),
    completedAt: new Date("2026-04-27T10:20:00Z"),
    ...overrides,
  };
}
