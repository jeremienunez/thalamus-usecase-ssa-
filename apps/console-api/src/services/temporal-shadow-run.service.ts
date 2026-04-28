import type { STDPParams } from "@interview/temporal";
import type {
  RunTemporalShadowInput,
  TemporalLearningSummary,
  TemporalShadowRunSummary,
} from "../types/temporal.types";
import type {
  ProjectClosedWindowInput,
  TemporalProjectionSummary,
} from "./temporal-projection.service";
import type { RunTemporalLearningInput } from "../types/temporal.types";

const DEFAULT_SHADOW_PARAMS: STDPParams = {
  pattern_window_ms: 900_000,
  pre_trace_decay_ms: 900_000,
  learning_rate: 0.1,
  activation_threshold: 0.65,
  min_support: 5,
  max_steps: 3,
  pattern_version: "temporal-v0.2.0",
};

export interface TemporalShadowRunServiceDeps {
  projection: {
    projectClosedWindow(
      input: ProjectClosedWindowInput,
    ): Promise<TemporalProjectionSummary>;
  };
  learning: {
    runClosedWindowLearning(
      input: RunTemporalLearningInput,
    ): Promise<TemporalLearningSummary>;
  };
}

export class TemporalShadowRunService {
  constructor(private readonly deps: TemporalShadowRunServiceDeps) {}

  async runClosedWindow(
    input: RunTemporalShadowInput,
  ): Promise<TemporalShadowRunSummary> {
    assertShadowWindow(input.from, input.to);
    const sourceDomain = input.sourceDomain ?? "simulation";
    const params = normalizeParams(input.params);
    const projection = await this.deps.projection.projectClosedWindow({
      from: input.from,
      to: input.to,
      sourceScope: input.sourceScope ?? "temporal-shadow-run",
      projectionVersion: input.projectionVersion,
    });
    const learning = await this.deps.learning.runClosedWindowLearning({
      from: input.from,
      to: input.to,
      sourceDomain,
      params,
      targetOutcomes: input.targetOutcomes,
    });

    return toSummary({
      from: input.from,
      to: input.to,
      sourceDomain,
      params,
      projection,
      learning,
    });
  }
}

function normalizeParams(overrides: Partial<STDPParams> | undefined): STDPParams {
  return {
    ...DEFAULT_SHADOW_PARAMS,
    ...overrides,
  };
}

function toSummary(input: {
  from: Date;
  to: Date;
  sourceDomain: TemporalShadowRunSummary["sourceDomain"];
  params: STDPParams;
  projection: TemporalProjectionSummary;
  learning: TemporalLearningSummary;
}): TemporalShadowRunSummary {
  return {
    mode: "shadow",
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    sourceDomain: input.sourceDomain,
    params: input.params,
    projection: {
      projectionRunId: input.projection.projectionRunId.toString(),
      projectionVersion: input.projection.projectionVersion,
      sourceScope: input.projection.sourceScope,
      inputSnapshotHash: input.projection.inputSnapshotHash,
      reviewEvidenceCount: input.projection.reviewEvidenceCount,
      simRunCount: input.projection.simRunCount,
      eventCount: input.projection.eventCount,
      insertedEventCount: input.projection.insertedEventCount,
    },
    learning: {
      learningRunId: input.learning.learningRunId.toString(),
      inputSnapshotHash: input.learning.inputSnapshotHash,
      eventCount: input.learning.eventCount,
      patternCount: input.learning.patternCount,
      persistedPatternCount: input.learning.persistedPatternCount,
    },
    kgWriteAttempted: false,
    actionAuthority: false,
  };
}

function assertShadowWindow(from: Date, to: Date): void {
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime())) {
    throw new Error("temporal shadow run requires valid dates");
  }
  if (from.getTime() >= to.getTime()) {
    throw new Error("temporal shadow run requires from < to");
  }
}

export const TEMPORAL_SHADOW_DEFAULT_PARAMS = DEFAULT_SHADOW_PARAMS;
