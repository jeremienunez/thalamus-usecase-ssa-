import { describe, expect, it, vi } from "vitest";
import {
  TEMPORAL_SHADOW_DEFAULT_PARAMS,
  TemporalShadowRunService,
  type TemporalShadowRunServiceDeps,
} from "../../../src/services/temporal-shadow-run.service";

const from = new Date("2026-04-27T10:00:00Z");
const to = new Date("2026-04-27T11:00:00Z");

describe("TemporalShadowRunService", () => {
  it("projects a closed window before learning temporal hypotheses", async () => {
    const calls: string[] = [];
    const deps = makeDeps(calls);
    const service = new TemporalShadowRunService(deps);

    const summary = await service.runClosedWindow({
      from,
      to,
      sourceDomain: "simulation",
      targetOutcomes: ["resolved"],
      params: { min_support: 2, activation_threshold: 0.25 },
    });

    expect(calls).toEqual(["projection", "learning"]);
    expect(deps.projection.projectClosedWindow).toHaveBeenCalledWith({
      from,
      to,
      sourceScope: "temporal-shadow-run",
      projectionVersion: undefined,
    });
    expect(deps.learning.runClosedWindowLearning).toHaveBeenCalledWith({
      from,
      to,
      sourceDomain: "simulation",
      targetOutcomes: ["resolved"],
      params: {
        ...TEMPORAL_SHADOW_DEFAULT_PARAMS,
        min_support: 2,
        activation_threshold: 0.25,
      },
    });
    expect(summary).toMatchObject({
      mode: "shadow",
      sourceDomain: "simulation",
      projection: {
        projectionRunId: "900",
        eventCount: 4,
        insertedEventCount: 4,
      },
      learning: {
        learningRunId: "700",
        eventCount: 4,
        patternCount: 1,
        persistedPatternCount: 1,
      },
      kgWriteAttempted: false,
      actionAuthority: false,
    });
  });

  it("defaults to simulation shadow learning with versioned scorer params", async () => {
    const deps = makeDeps([]);
    const service = new TemporalShadowRunService(deps);

    await service.runClosedWindow({ from, to });

    expect(deps.learning.runClosedWindowLearning).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDomain: "simulation",
        params: TEMPORAL_SHADOW_DEFAULT_PARAMS,
      }),
    );
  });

  it("rejects inverted windows before projection starts", async () => {
    const deps = makeDeps([]);
    const service = new TemporalShadowRunService(deps);

    await expect(service.runClosedWindow({ from: to, to: from })).rejects.toThrow(
      "from < to",
    );
    expect(deps.projection.projectClosedWindow).not.toHaveBeenCalled();
    expect(deps.learning.runClosedWindowLearning).not.toHaveBeenCalled();
  });

  it("does not learn when projection fails", async () => {
    const deps = makeDeps([]);
    deps.projection.projectClosedWindow = vi.fn(async () => {
      throw new Error("projection failed");
    });
    const service = new TemporalShadowRunService(deps);

    await expect(service.runClosedWindow({ from, to })).rejects.toThrow(
      "projection failed",
    );
    expect(deps.learning.runClosedWindowLearning).not.toHaveBeenCalled();
  });
});

function makeDeps(calls: string[]): TemporalShadowRunServiceDeps {
  return {
    projection: {
      projectClosedWindow: vi.fn(async () => {
        calls.push("projection");
        return {
          projectionRunId: 900n,
          projectionVersion: "temporal-projection-v0.2.0",
          sourceScope: "temporal-shadow-run",
          inputSnapshotHash: "projection-snapshot",
          reviewEvidenceCount: 2,
          simRunCount: 2,
          eventCount: 4,
          insertedEventCount: 4,
        };
      }),
    },
    learning: {
      runClosedWindowLearning: vi.fn(async () => {
        calls.push("learning");
        return {
          learningRunId: 700n,
          sourceDomain: "simulation" as const,
          inputSnapshotHash: "learning-snapshot",
          eventCount: 4,
          patternCount: 1,
          persistedPatternCount: 1,
        };
      }),
    },
  };
}
