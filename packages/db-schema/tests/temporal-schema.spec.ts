import { getTableColumns, getTableName } from "drizzle-orm";
import {
  temporalProjectionRun,
  temporalEvent,
  temporalLearningRun,
  temporalPatternHypothesis,
  temporalPatternStep,
  temporalPatternEdge,
  temporalPatternExample,
  temporalPatternReview,
  temporalPatternSeededRun,
  temporalPatternQueryLog,
  temporalEvaluationRun,
  temporalEvaluationMetric,
} from "../src/schema/temporal";

describe("Temporal Hypothesis Layer schema contract", () => {
  it("declares every temporal table under the temporal namespace", () => {
    expect(
      [
        temporalProjectionRun,
        temporalEvent,
        temporalLearningRun,
        temporalPatternHypothesis,
        temporalPatternStep,
        temporalPatternEdge,
        temporalPatternExample,
        temporalPatternReview,
        temporalPatternSeededRun,
        temporalPatternQueryLog,
        temporalEvaluationRun,
        temporalEvaluationMetric,
      ].map(getTableName),
    ).toEqual([
      "temporal_projection_run",
      "temporal_event",
      "temporal_learning_run",
      "temporal_pattern_hypothesis",
      "temporal_pattern_step",
      "temporal_pattern_edge",
      "temporal_pattern_example",
      "temporal_pattern_review",
      "temporal_pattern_seeded_run",
      "temporal_pattern_query_log",
      "temporal_evaluation_run",
      "temporal_evaluation_metric",
    ]);
  });

  it("stores patterns as hypotheses with audit score components and no KG facts", () => {
    const columns = getTableColumns(temporalPatternHypothesis);

    expect(columns.patternHash.notNull).toBe(true);
    expect(columns.patternVersion.notNull).toBe(true);
    expect(columns.status.notNull).toBe(true);
    expect(columns.scoreComponentsJson.notNull).toBe(true);
    expect(columns.supportCount.notNull).toBe(true);
    expect(columns.negativeSupportCount.notNull).toBe(true);
    expect(columns.temporalOrderQuality.notNull).toBe(true);
    expect(columns.containsTargetProxy.notNull).toBe(true);
    expect(columns.containsSingletonOnly.notNull).toBe(true);
    expect(columns.patternRate.notNull).toBe(false);
    expect(columns.bestComponentSignature.notNull).toBe(false);
    expect(columns.sequenceLiftOverBestComponent.notNull).toBe(false);
    expect(columns).not.toHaveProperty("researchFindingId");
    expect(columns).not.toHaveProperty("kgEntityId");
  });

  it("records seeded Fish runs in a separate anti-contamination table", () => {
    const columns = getTableColumns(temporalPatternSeededRun);

    expect(columns.patternId.notNull).toBe(true);
    expect(columns.simRunId.notNull).toBe(true);
    expect(columns.seedReason.notNull).toBe(true);
    expect(columns.sourceDomain.notNull).toBe(true);
  });
});
