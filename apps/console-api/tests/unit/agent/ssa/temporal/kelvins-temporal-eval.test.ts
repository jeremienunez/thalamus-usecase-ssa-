import { describe, expect, it } from "vitest";
import {
  appendKelvinsOutcomesForLearning,
  limitKelvinsRowsToCompleteEvents,
  loadKelvinsRowsFromCsv,
  parseCsvLine,
  prepareKelvinsTemporalDataset,
  projectKelvinsRowsToTemporalEvents,
  runKelvinsBlindTemporalExperiment,
  runKelvinsTemporalEvaluation,
} from "../../../../../src/agent/ssa/temporal/kelvins-temporal-eval";

const params = {
  pattern_window_ms: 10 * 86_400_000,
  pre_trace_decay_ms: 5 * 86_400_000,
  learning_rate: 0.1,
  activation_threshold: 0.1,
  min_support: 2,
  max_steps: 3,
  pattern_version: "temporal-kelvins-test-v0.1.0",
};

describe("Kelvins temporal evaluation projection", () => {
  it("parses quoted Kelvins CSV cells without splitting embedded commas", () => {
    expect(parseCsvLine('event_id,c_object_type,note\n')).toEqual([
      "event_id",
      "c_object_type",
      "note",
    ]);
    expect(parseCsvLine('1,"PAYLOAD, DEBRIS","a ""quoted"" note"')).toEqual([
      "1",
      "PAYLOAD, DEBRIS",
      'a "quoted" note',
    ]);
  });

  it("projects CDM event series into THL events with final risk outcomes", () => {
    const projection = projectKelvinsRowsToTemporalEvents(fixtureRows(), {
      highRiskThresholdLog10: -5,
    });

    expect(projection.collisionEventCount).toBe(3);
    expect(projection.outcomeCounts).toEqual({ high_risk: 2, low_risk: 1 });
    expect(
      projection.events.some(
        (event) =>
          event.event_type === "kelvins.outcome_high_risk" &&
          event.terminal_status === "high_risk",
      ),
    ).toBe(true);
    expect(
      projection.events.some(
        (event) => event.event_type === "space_weather.ap_high",
      ),
    ).toBe(true);
  });

  it("keeps UNKNOWN object type as metadata but excludes it as a predictive event", () => {
    const projection = projectKelvinsRowsToTemporalEvents(unknownObjectTypeRows(), {
      highRiskThresholdLog10: -5,
    });

    expect(
      projection.events.some(
        (event) => event.event_type === "kelvins.object_type_unknown",
      ),
    ).toBe(false);
    expect(
      projection.events.some(
        (event) => event.metadata?.object_type === "UNKNOWN",
      ),
    ).toBe(true);
  });

  it("compares THL patterns against frequency baselines on grouped event IDs", () => {
    const report = runKelvinsTemporalEvaluation(fixtureRows(), {
      params,
      targetOutcome: "high_risk",
      topK: 5,
      highRiskThresholdLog10: -5,
    });

    expect(report.dataset).toBe("esa-kelvins-collision-avoidance");
    expect(report.splitPolicy).toBe("event_id_grouped_no_row_leakage");
    expect(report.evaluationMode).toBe(
      "projection_smoke_non_blind_outcomes_visible",
    );
    expect(report.evidenceGrade).toBe("smoke_only");
    expect(report.hypothesisOnly).toBe(true);
    expect(report.kgWriteAttempted).toBe(false);
    expect(report.thlPatternCount).toBeGreaterThan(0);
    expect(report.thlTopPatterns[0]).toMatchObject({
      terminal_status: "high_risk",
      hypothesis: true,
      decisionAuthority: false,
    });
    expect(report.frequencyTopPatterns.length).toBeGreaterThan(0);
    expect(
      report.frequencyTopPatterns.some((pattern) =>
        pattern.eventSignature.includes("outcome_"),
      ),
    ).toBe(false);
  });

  it("rejects risk_escalation targets in the non-blind projection evaluation", () => {
    expect(() =>
      runKelvinsTemporalEvaluation(fixtureRows(), {
        params,
        targetOutcome: "risk_escalation",
        topK: 5,
      }),
    ).toThrow(/non-blind high_risk projection smoke test/);
  });

  it("loads minimal Kelvins CSV text into normalized row objects", () => {
    const rows = loadKelvinsRowsFromCsv(minimalCsv());

    expect(rows).toHaveLength(6);
    expect(rows[0]).toMatchObject({
      eventId: "event-a",
      missionId: "mission-1",
      objectType: "DEBRIS",
      riskLog10: -7,
    });
  });

  it("prepares a blind dataset with final CDMs and outcomes separated", () => {
    const dataset = prepareKelvinsTemporalDataset(fixtureRows(), {
      highRiskThresholdLog10: -5,
      splitRatios: { train: 1, validation: 0, test: 0 },
      generatedAt: "2026-04-27T00:00:00.000Z",
    });

    expect(dataset.manifest).toMatchObject({
      projectionVersion: "temporal-kelvins-dataset-v0.2.0",
      splitPolicy: "event_id_grouped_outcome_stratified_hash_no_row_leakage",
      outcomePolicy: "final_cdm_only",
      leakagePolicy: "precursor_events_exclude_final_cdm_and_outcomes",
      hypothesisOnly: true,
      kgWriteAttempted: false,
      outcomeCounts: { high_risk: 2, low_risk: 1 },
    });
    expect(dataset.manifest.splitLock).toMatchObject({
      policy: "event_id_grouped_outcome_stratified_hash_no_row_leakage",
      targetOutcome: "high_risk",
      targetOutcomesBySplit: { train: 2, validation: 0, test: 0 },
      nonTargetOutcomesBySplit: { train: 1, validation: 0, test: 0 },
    });
    expect(
      dataset.precursorEventsBySplit.train.every(
        (event) => event.terminal_status == null,
      ),
    ).toBe(true);

    const eventATimes = dataset.precursorEventsBySplit.train
      .filter((event) => event.entity_id === "event-a")
      .map((event) => event.metadata?.time_to_tca_days);
    expect(eventATimes).toContain(6);
    expect(eventATimes).not.toContain(1);
    expect(dataset.outcomesBySplit.train).toContainEqual(
      expect.objectContaining({
        eventId: "event-a",
        terminalStatus: "high_risk",
        finalRiskLog10: -4.8,
      }),
    );
  });

  it("derives risk_escalation outcomes from initial-to-final risk delta", () => {
    const dataset = prepareKelvinsTemporalDataset(fixtureRows(), {
      targetOutcome: "risk_escalation",
      riskEscalationDeltaLog10: 1,
      splitRatios: { train: 1, validation: 0, test: 0 },
      generatedAt: "2026-04-27T00:00:00.000Z",
    });

    expect(dataset.manifest).toMatchObject({
      targetOutcome: "risk_escalation",
      outcomePolicy: "initial_to_final_risk_delta",
      riskEscalationDeltaLog10: 1,
      outcomeCounts: { risk_escalation: 2, no_risk_escalation: 1 },
    });
    expect(dataset.outcomesBySplit.train).toContainEqual(
      expect.objectContaining({
        eventId: "event-a",
        terminalStatus: "risk_escalation",
        riskDeltaLog10: 2.2,
      }),
    );
    expect(dataset.outcomesBySplit.train).toContainEqual(
      expect.objectContaining({
        eventId: "event-c",
        terminalStatus: "no_risk_escalation",
      }),
    );
  });

  it("keeps event_id groups in one deterministic split", () => {
    const first = prepareKelvinsTemporalDataset(fixtureRows(), {
      generatedAt: "2026-04-27T00:00:00.000Z",
      splitSeed: "stable-test-seed",
    });
    const second = prepareKelvinsTemporalDataset(fixtureRows(), {
      generatedAt: "2026-04-27T00:00:00.000Z",
      splitSeed: "stable-test-seed",
    });

    expect(second.manifest).toEqual(first.manifest);
    expect(second.splits).toEqual(first.splits);
    expect(second.outcomesBySplit).toEqual(first.outcomesBySplit);
    expect(second.precursorEventsBySplit).toEqual(first.precursorEventsBySplit);

    const seen = new Map<string, string>();
    for (const [split, outcomes] of Object.entries(first.outcomesBySplit)) {
      for (const outcome of outcomes) {
        expect(seen.has(outcome.eventId)).toBe(false);
        seen.set(outcome.eventId, split);
      }
    }
    expect(seen.size).toBe(new Set(fixtureRows().map((row) => row.eventId)).size);
  });

  it("stratifies target and non-target outcomes across active blind splits", () => {
    const dataset = prepareKelvinsTemporalDataset(mixedBlindRows(), {
      highRiskThresholdLog10: -5,
      splitRatios: { train: 0.5, validation: 0.25, test: 0.25 },
      generatedAt: "2026-04-27T00:00:00.000Z",
      sourceArtifactHash: "fixture-source-hash",
      evalCommand: "fixture command",
    });

    for (const split of ["train", "validation", "test"] as const) {
      expect(dataset.manifest.splitCounts[split].targetOutcomes).toBeGreaterThan(0);
      expect(dataset.manifest.splitCounts[split].nonTargetOutcomes).toBeGreaterThan(0);
    }
    expect(dataset.manifest.splitLock.eventIdsHash).toMatch(/^[a-f0-9]{64}$/);
    expect(dataset.manifest.evaluationWarnings).toEqual([
      "minLeadTimeDays is 0; blind prediction excludes the final CDM but does not enforce a positive lead-time horizon",
    ]);
  });

  it("limits samples by complete event histories rather than raw rows", () => {
    const rows = limitKelvinsRowsToCompleteEvents(mixedBlindRows(), 3);
    const eventIds = new Set(rows.map((row) => row.eventId));

    expect(eventIds.size).toBe(3);
    for (const eventId of eventIds) {
      expect(rows.filter((row) => row.eventId === eventId)).toHaveLength(2);
    }
  });

  it("adds outcome events only for the training learner input", () => {
    const dataset = prepareKelvinsTemporalDataset(fixtureRows(), {
      highRiskThresholdLog10: -5,
      splitRatios: { train: 1, validation: 0, test: 0 },
    });
    const learningEvents = appendKelvinsOutcomesForLearning({
      precursorEvents: dataset.precursorEventsBySplit.train,
      outcomes: dataset.outcomesBySplit.train,
      patternWindowMs: params.pattern_window_ms,
    });

    expect(
      dataset.precursorEventsBySplit.train.every(
        (event) => event.terminal_status == null,
      ),
    ).toBe(true);
    expect(
      learningEvents.filter((event) => event.terminal_status === "high_risk"),
    ).toHaveLength(2);
    expect(
      learningEvents.some((event) => event.source_table === "esa_kelvins_outcome"),
    ).toBe(true);
  });

  it("runs a blind train/validation/test experiment before revealing test outcomes", () => {
    const report = runKelvinsBlindTemporalExperiment(mixedBlindRows(), {
      params: {
        ...params,
        activation_threshold: 0.01,
        min_support: 2,
      },
      highRiskThresholdLog10: -5,
      splitRatios: { train: 0.5, validation: 0.25, test: 0.25 },
      generatedAt: "2026-04-27T00:00:00.000Z",
    });

    expect(report.blindPolicy).toBe(
      "train_learns_validation_selects_test_outcomes_revealed_after_prediction",
    );
    expect(report.splitPolicy).toBe(
      "event_id_grouped_outcome_stratified_hash_no_row_leakage",
    );
    expect(report.popperManifest).toMatchObject({
      experimentId: "ssa-kelvins-thl-popper-v0.1.0",
      targetOutcome: "high_risk",
      requiredBaselines: [
        "majority_negative",
        "risk_signal_rule",
        "risk_increase_rule",
        "covariance_rule",
        "frequency_single_event",
      ],
    });
    expect(report.trainPatternCount).toBeGreaterThan(0);
    expect(report.selectedPatternCount).toBeGreaterThan(0);
    expect(report.baselineReports.map((baseline) => baseline.name)).toEqual([
      "majority_negative",
      "risk_signal_rule",
      "risk_increase_rule",
      "covariance_rule",
      "frequency_single_event",
    ]);
    expect(["survived", "falsified", "inconclusive"]).toContain(
      report.popperVerdict.status,
    );
    expect(report.popperVerdict.thlTestF1).toBe(report.testMetrics.f1);
    expect(report.popperVerdict.f1LiftBootstrap95CI).toMatchObject({
      metric: "f1_lift_over_best_baseline",
      iterations: 500,
    });
    expect(report.testPredictions).toHaveLength(
      report.manifest.splitCounts.test.eventIds,
    );
    expect(
      report.testPredictions.every(
        (prediction) => prediction.outcomeHiddenDuringPrediction,
      ),
    ).toBe(true);
    expect(report.testMetrics.actualPositiveCount).toBe(
      report.manifest.splitCounts.test.highRiskOutcomes,
    );
    expect(
      report.manifest.splitCounts.test.nonTargetOutcomes,
    ).toBeGreaterThan(0);
    expect(
      report.manifest.splitCounts.validation.nonTargetOutcomes,
    ).toBeGreaterThan(0);
    expect(
      report.manifest.splitCounts.test.targetOutcomes,
    ).toBeGreaterThan(0);
    expect(
      report.manifest.splitCounts.validation.targetOutcomes,
    ).toBeGreaterThan(0);
    expect(
      report.testPredictions.some((prediction) => !prediction.predictedPositive),
    ).toBe(true);
    expect(report.testMetrics.truePositive).toBeGreaterThan(0);
    expect(
      report.manifest.splitCounts.test.eventIds,
    ).toBe(report.testMetrics.eventCount);
    expect(
      report.manifest.splitLock.testEventIdsHash,
    ).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects blind experiments without negative evidence in every split", () => {
    expect(() =>
      runKelvinsBlindTemporalExperiment(allPositiveBlindRows(), {
        params: {
          ...params,
          activation_threshold: 0.01,
          min_support: 2,
        },
        highRiskThresholdLog10: -5,
        splitRatios: { train: 0.5, validation: 0.25, test: 0.25 },
      }),
    ).toThrow(/has no non-high_risk outcomes/);
  });

  it("runs the risk_features_removed Popper variant without direct risk precursor signals", () => {
    const report = runKelvinsBlindTemporalExperiment(mixedBlindRows(), {
      params: {
        ...params,
        activation_threshold: 0.01,
        min_support: 2,
      },
      highRiskThresholdLog10: -5,
      splitRatios: { train: 0.5, validation: 0.25, test: 0.25 },
      generatedAt: "2026-04-27T00:00:00.000Z",
      experimentVariant: "risk_features_removed",
    });

    expect(report.popperManifest).toMatchObject({
      experimentId: "ssa-kelvins-thl-popper-risk-removed-v0.1.0",
      variant: "risk_features_removed",
    });
    expect(report.manifest.excludeRiskFeatureEvents).toBe(true);
    const selectedSignatures = report.selectedPatterns.flatMap((pattern) =>
      pattern.sequence.map((step) => step.event_signature),
    );
    expect(selectedSignatures.length).toBeGreaterThan(0);
    expect(selectedSignatures).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("kelvins.risk_high"),
        expect.stringContaining("kelvins.max_risk_high"),
        expect.stringContaining("kelvins.risk_increased"),
        expect.stringContaining("kelvins.risk_decreased"),
      ]),
    );
  });

  it("runs the physics_only Popper variant with only physical precursor signals", () => {
    const report = runKelvinsBlindTemporalExperiment(mixedBlindRows(), {
      params: {
        ...params,
        activation_threshold: 0.01,
        min_support: 2,
      },
      highRiskThresholdLog10: -5,
      splitRatios: { train: 0.5, validation: 0.25, test: 0.25 },
      generatedAt: "2026-04-27T00:00:00.000Z",
      experimentVariant: "physics_only",
    });

    expect(report.popperManifest).toMatchObject({
      experimentId: "ssa-kelvins-thl-popper-physics-only-v0.1.0",
      variant: "physics_only",
    });
    expect(report.manifest).toMatchObject({
      excludeRiskFeatureEvents: true,
      includeObjectTypeEvents: false,
      includeCdmObservedEvent: false,
    });
    const selectedSignatures = report.selectedPatterns.flatMap((pattern) =>
      pattern.sequence.map((step) => step.event_signature),
    );
    expect(selectedSignatures.length).toBeGreaterThan(0);
    expect(selectedSignatures).not.toEqual(
      expect.arrayContaining([
        expect.stringContaining("kelvins.risk_high"),
        expect.stringContaining("kelvins.max_risk_high"),
        expect.stringContaining("kelvins.risk_increased"),
        expect.stringContaining("kelvins.risk_decreased"),
        expect.stringContaining("kelvins.object_type_"),
        expect.stringContaining("kelvins.cdm_observed"),
      ]),
    );
  });

  it("runs a Popper experiment targeting risk_escalation", () => {
    const report = runKelvinsBlindTemporalExperiment(riskEscalationRows(), {
      params: {
        ...params,
        activation_threshold: 0.01,
        min_support: 2,
      },
      targetOutcome: "risk_escalation",
      riskEscalationDeltaLog10: 1,
      splitRatios: { train: 0.5, validation: 0.25, test: 0.25 },
      generatedAt: "2026-04-27T00:00:00.000Z",
    });

    expect(report.targetOutcome).toBe("risk_escalation");
    expect(report.popperManifest).toMatchObject({
      targetOutcome: "risk_escalation",
      outcomePolicy: "initial_to_final_risk_delta",
    });
    expect(report.manifest.splitCounts.test.riskEscalationOutcomes).toBe(
      report.testMetrics.actualPositiveCount,
    );
    expect(report.baselineReports.map((baseline) => baseline.name)).toContain(
      "risk_increase_rule",
    );
  });

  it("handles risk_escalation threshold boundaries explicitly", () => {
    const dataset = prepareKelvinsTemporalDataset(riskEscalationBoundaryRows(), {
      targetOutcome: "risk_escalation",
      riskEscalationDeltaLog10: 1,
      splitRatios: { train: 1, validation: 0, test: 0 },
      generatedAt: "2026-04-27T00:00:00.000Z",
    });

    expect(dataset.outcomesBySplit.train).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventId: "escalation-at-threshold",
          terminalStatus: "risk_escalation",
          riskDeltaLog10: 1,
        }),
        expect.objectContaining({
          eventId: "escalation-below-threshold",
          terminalStatus: "no_risk_escalation",
          riskDeltaLog10: 0.999,
        }),
        expect.objectContaining({
          eventId: "high-without-escalation",
          terminalStatus: "no_risk_escalation",
        }),
        expect.objectContaining({
          eventId: "escalation-without-high-final-risk",
          terminalStatus: "risk_escalation",
        }),
      ]),
    );
  });
});

function fixtureRows() {
  return loadKelvinsRowsFromCsv(minimalCsv());
}

function unknownObjectTypeRows() {
  return loadKelvinsRowsFromCsv(
    [
      [
        "event_id",
        "time_to_tca",
        "mission_id",
        "risk",
        "max_risk_estimate",
        "miss_distance",
        "relative_speed",
        "mahalanobis_distance",
        "c_object_type",
        "t_obs_used",
        "c_obs_used",
        "t_position_covariance_det",
        "c_position_covariance_det",
        "F10",
        "AP",
      ].join(","),
      "event-unknown,5,mission-1,-7,-6,20000,7800,12,UNKNOWN,20,18,1000,1000,120,10",
      "event-unknown,1,mission-1,-4.8,-4.7,800,13000,2.5,UNKNOWN,20,18,1000,1000,160,60",
    ].join("\n"),
  );
}

function minimalCsv(): string {
  return [
    [
      "event_id",
      "time_to_tca",
      "mission_id",
      "risk",
      "max_risk_estimate",
      "miss_distance",
      "relative_speed",
      "mahalanobis_distance",
      "c_object_type",
      "t_obs_used",
      "c_obs_used",
      "t_position_covariance_det",
      "c_position_covariance_det",
      "F10",
      "AP",
    ].join(","),
    "event-a,6,mission-1,-7,-6,20000,7800,12,DEBRIS,20,18,1000,1000,120,10",
    "event-a,1,mission-1,-4.8,-4.7,800,13000,2.5,DEBRIS,20,18,10000000000000,1000,160,60",
    "event-b,5,mission-1,-6.9,-6.2,18000,7600,10,DEBRIS,16,15,1000,1000,110,8",
    "event-b,1,mission-1,-4.6,-4.5,700,13200,2.1,DEBRIS,16,15,10000000000000,1000,155,55",
    "event-c,4,mission-2,-7.2,-6.8,21000,7900,11,ROCKET BODY,20,18,1000,1000,115,8",
    "event-c,1,mission-2,-6.9,-6.7,15000,8000,8,ROCKET BODY,20,18,1000,1000,118,9",
  ].join("\n");
}

function mixedBlindRows() {
  const header = [
    "event_id",
    "time_to_tca",
    "mission_id",
    "risk",
    "max_risk_estimate",
    "miss_distance",
    "relative_speed",
    "mahalanobis_distance",
    "c_object_type",
    "t_obs_used",
    "c_obs_used",
    "t_position_covariance_det",
    "c_position_covariance_det",
    "F10",
    "AP",
  ].join(",");
  const rows = [header];
  for (let index = 0; index < 24; index += 1) {
    const highRisk = index % 2 === 0;
    rows.push(
      [
        `blind-${index}`,
        6,
        "mission-blind",
        highRisk ? -7 : -7.2,
        highRisk ? -4.6 : -6.7,
        highRisk ? 900 : 20_000,
        highRisk ? 13_000 : 7_800,
        highRisk ? 2.5 : 12,
        highRisk ? "DEBRIS" : "ROCKET BODY",
        20,
        18,
        highRisk ? 10000000000000 : 1000,
        1000,
        120,
        10,
      ].join(","),
    );
    rows.push(
      [
        `blind-${index}`,
        1,
        "mission-blind",
        highRisk ? -4.5 : -6.6,
        highRisk ? -4.4 : -6.5,
        highRisk ? 850 : 19_000,
        highRisk ? 13_100 : 7_900,
        highRisk ? 2.3 : 11,
        highRisk ? "DEBRIS" : "ROCKET BODY",
        20,
        18,
        highRisk ? 10000000000000 : 1000,
        1000,
        160,
        60,
      ].join(","),
    );
  }
  return loadKelvinsRowsFromCsv(rows.join("\n"));
}

function allPositiveBlindRows() {
  const header = [
    "event_id",
    "time_to_tca",
    "mission_id",
    "risk",
    "max_risk_estimate",
    "miss_distance",
    "relative_speed",
    "mahalanobis_distance",
    "c_object_type",
    "t_obs_used",
    "c_obs_used",
    "t_position_covariance_det",
    "c_position_covariance_det",
    "F10",
    "AP",
  ].join(",");
  const rows = [header];
  for (let index = 0; index < 12; index += 1) {
    rows.push(
      [
        `positive-${index}`,
        6,
        "mission-positive",
        -7,
        -4.6,
        900,
        13_000,
        2.5,
        "DEBRIS",
        20,
        18,
        10000000000000,
        1000,
        120,
        10,
      ].join(","),
    );
    rows.push(
      [
        `positive-${index}`,
        1,
        "mission-positive",
        -4.5,
        -4.4,
        850,
        13_100,
        2.3,
        "DEBRIS",
        20,
        18,
        10000000000000,
        1000,
        160,
        60,
      ].join(","),
    );
  }
  return loadKelvinsRowsFromCsv(rows.join("\n"));
}

function riskEscalationRows() {
  const header = [
    "event_id",
    "time_to_tca",
    "mission_id",
    "risk",
    "max_risk_estimate",
    "miss_distance",
    "relative_speed",
    "mahalanobis_distance",
    "c_object_type",
    "t_obs_used",
    "c_obs_used",
    "t_position_covariance_det",
    "c_position_covariance_det",
    "F10",
    "AP",
  ].join(",");
  const rows = [header];
  for (let index = 0; index < 16; index += 1) {
    const escalates = index % 2 === 0;
    rows.push(
      [
        `escalation-${index}`,
        6,
        "mission-escalation",
        escalates ? -8 : -6.5,
        escalates ? -7.5 : -6.3,
        escalates ? 900 : 20_000,
        escalates ? 13_000 : 7_800,
        escalates ? 2.2 : 12,
        "DEBRIS",
        20,
        18,
        escalates ? 10000000000000 : 1000,
        1000,
        120,
        10,
      ].join(","),
    );
    rows.push(
      [
        `escalation-${index}`,
        1,
        "mission-escalation",
        escalates ? -6.4 : -6.2,
        escalates ? -6.2 : -6.1,
        escalates ? 800 : 18_000,
        escalates ? 13_200 : 7_700,
        escalates ? 2 : 11,
        "DEBRIS",
        20,
        18,
        escalates ? 10000000000000 : 1000,
        1000,
        130,
        12,
      ].join(","),
    );
  }
  return loadKelvinsRowsFromCsv(rows.join("\n"));
}

function riskEscalationBoundaryRows() {
  const header = [
    "event_id",
    "time_to_tca",
    "mission_id",
    "risk",
    "max_risk_estimate",
    "miss_distance",
    "relative_speed",
    "mahalanobis_distance",
    "c_object_type",
    "t_obs_used",
    "c_obs_used",
    "t_position_covariance_det",
    "c_position_covariance_det",
    "F10",
    "AP",
  ].join(",");
  return loadKelvinsRowsFromCsv(
    [
      header,
      "escalation-at-threshold,6,mission-boundary,-7,-6.8,20000,7800,12,DEBRIS,20,18,1000,1000,120,10",
      "escalation-at-threshold,1,mission-boundary,-6,-5.8,18000,7900,11,DEBRIS,20,18,1000,1000,120,10",
      "escalation-below-threshold,6,mission-boundary,-7,-6.8,20000,7800,12,DEBRIS,20,18,1000,1000,120,10",
      "escalation-below-threshold,1,mission-boundary,-6.001,-5.9,18000,7900,11,DEBRIS,20,18,1000,1000,120,10",
      "high-without-escalation,6,mission-boundary,-5.2,-5.1,20000,7800,12,DEBRIS,20,18,1000,1000,120,10",
      "high-without-escalation,1,mission-boundary,-4.8,-4.7,18000,7900,11,DEBRIS,20,18,1000,1000,120,10",
      "escalation-without-high-final-risk,6,mission-boundary,-8,-7.8,20000,7800,12,DEBRIS,20,18,1000,1000,120,10",
      "escalation-without-high-final-risk,1,mission-boundary,-6.9,-6.8,18000,7900,11,DEBRIS,20,18,1000,1000,120,10",
    ].join("\n"),
  );
}
