import { createHash } from "node:crypto";
import {
  canonicalEventSignature,
  learnTemporalPatterns,
  sortTemporalEventsStable,
  type STDPParams,
  type TemporalEvent,
  type TemporalPatternHypothesis,
  type TemporalSourceDomain,
} from "@interview/temporal";

export interface KelvinsCdmRow {
  eventId: string;
  timeToTcaDays: number;
  missionId: string;
  riskLog10: number;
  maxRiskEstimateLog10: number;
  missDistanceM: number;
  relativeSpeedMs: number;
  mahalanobisDistance: number;
  objectType: string;
  targetObsUsed: number | null;
  chaserObsUsed: number | null;
  targetPositionCovarianceDet: number | null;
  chaserPositionCovarianceDet: number | null;
  f10: number | null;
  ap: number | null;
}

export interface KelvinsProjectionOptions {
  projectionRunId?: string;
  sourceDomain?: Exclude<TemporalSourceDomain, "mixed">;
  highRiskThresholdLog10?: number;
  riskEscalationDeltaLog10?: number;
  riskIncreaseDeltaLog10?: number;
  closeMissDistanceM?: number;
  lowMahalanobisDistance?: number;
  highRelativeSpeedMs?: number;
  sparseObservationCount?: number;
  highAp?: number;
  highF10?: number;
  includeCdmObservedEvent?: boolean;
  includeObjectTypeEvents?: boolean;
  includeUnknownObjectTypeEvent?: boolean;
  excludeRiskFeatureEvents?: boolean;
  eventGapMs?: number;
}

type ResolvedKelvinsProjectionOptions = Required<KelvinsProjectionOptions> & {
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
};

export interface KelvinsProjectionResult {
  events: TemporalEvent[];
  collisionEventCount: number;
  outcomeCounts: Record<string, number>;
}

export interface FrequencyBaselinePattern {
  eventSignature: string;
  supportCount: number;
  negativeSupportCount: number;
  precision: number;
  lift: number;
}

export interface KelvinsTemporalEvaluationOptions extends KelvinsProjectionOptions {
  params: STDPParams;
  targetOutcome?: KelvinsTargetOutcome;
  topK?: number;
}

export interface KelvinsTemporalEvaluationReport {
  dataset: "esa-kelvins-collision-avoidance";
  collisionEventCount: number;
  temporalEventCount: number;
  targetOutcome: string;
  outcomeCounts: Record<string, number>;
  thlPatternCount: number;
  thlPrecisionAtK: number;
  frequencyPrecisionAtK: number;
  thlTopPatterns: TemporalPatternHypothesis[];
  frequencyTopPatterns: FrequencyBaselinePattern[];
  splitPolicy: "event_id_grouped_no_row_leakage";
  evaluationMode: "projection_smoke_non_blind_outcomes_visible";
  evidenceGrade: "smoke_only";
  hypothesisOnly: true;
  kgWriteAttempted: false;
}

export type KelvinsTemporalSplitName = "train" | "validation" | "test";

export type KelvinsTargetOutcome = "high_risk" | "risk_escalation";

export type KelvinsOutcomeStatus =
  | KelvinsTargetOutcome
  | "low_risk"
  | "no_risk_escalation";

export interface KelvinsTemporalSplitRatios {
  train: number;
  validation: number;
  test: number;
}

export interface KelvinsTemporalDatasetOptions extends KelvinsProjectionOptions {
  datasetId?: string;
  splitSeed?: string;
  splitRatios?: Partial<KelvinsTemporalSplitRatios>;
  minLeadTimeDays?: number;
  targetOutcome?: KelvinsTargetOutcome;
  generatedAt?: string;
  stratifySplitsByOutcome?: boolean;
  sourceArtifactHash?: string;
  sourceArtifactDescription?: string;
  evalCommand?: string;
  gitCommit?: string;
  sampleEventLimit?: number;
}

export interface KelvinsTemporalOutcome {
  eventId: string;
  split: KelvinsTemporalSplitName;
  terminalStatus: KelvinsOutcomeStatus;
  finalRiskLog10: number;
  initialRiskLog10: number;
  riskDeltaLog10: number;
  finalTimeToTcaDays: number;
  cdmCount: number;
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
  payloadHash: string;
}

export interface KelvinsTemporalSplitCounts {
  eventIds: number;
  rows: number;
  precursorEvents: number;
  outcomes: number;
  targetOutcomes: number;
  nonTargetOutcomes: number;
  highRiskOutcomes: number;
  lowRiskOutcomes: number;
  riskEscalationOutcomes: number;
  noRiskEscalationOutcomes: number;
}

export interface KelvinsTemporalSplitLock {
  policy: "event_id_grouped_outcome_stratified_hash_no_row_leakage";
  splitSeed: string;
  splitRatios: KelvinsTemporalSplitRatios;
  targetOutcome: KelvinsTargetOutcome;
  eventIdsHash: string;
  trainEventIdsHash: string;
  validationEventIdsHash: string;
  testEventIdsHash: string;
  targetOutcomesBySplit: Record<KelvinsTemporalSplitName, number>;
  nonTargetOutcomesBySplit: Record<KelvinsTemporalSplitName, number>;
}

export interface KelvinsTemporalDatasetManifest {
  datasetId: string;
  sourceDatasetId: "esa-kelvins-collision-avoidance";
  projectionVersion: "temporal-kelvins-dataset-v0.2.0";
  generatedAt: string;
  splitPolicy: "event_id_grouped_outcome_stratified_hash_no_row_leakage";
  splitLock: KelvinsTemporalSplitLock;
  outcomePolicy: "final_cdm_only" | "initial_to_final_risk_delta";
  leakagePolicy: "precursor_events_exclude_final_cdm_and_outcomes";
  hypothesisOnly: true;
  kgWriteAttempted: false;
  sourceArtifactHash?: string;
  sourceArtifactDescription?: string;
  evalCommand?: string;
  gitCommit?: string;
  sampleEventLimit?: number;
  evaluationWarnings: string[];
  targetOutcome: KelvinsTargetOutcome;
  riskEscalationDeltaLog10: number;
  highRiskThresholdLog10: number;
  minLeadTimeDays: number;
  splitSeed: string;
  splitRatios: KelvinsTemporalSplitRatios;
  eventGapMs: number;
  includeCdmObservedEvent: boolean;
  includeObjectTypeEvents: boolean;
  includeUnknownObjectTypeEvent: boolean;
  excludeRiskFeatureEvents: boolean;
  inputHash: string;
  rowCount: number;
  eventIdCount: number;
  temporalEventCount: number;
  outcomeCount: number;
  splitCounts: Record<KelvinsTemporalSplitName, KelvinsTemporalSplitCounts>;
  outcomeCounts: Record<string, number>;
}

export interface KelvinsTemporalDataset {
  manifest: KelvinsTemporalDatasetManifest;
  splits: Record<KelvinsTemporalSplitName, string[]>;
  precursorEventsBySplit: Record<KelvinsTemporalSplitName, TemporalEvent[]>;
  outcomesBySplit: Record<KelvinsTemporalSplitName, KelvinsTemporalOutcome[]>;
}

export interface KelvinsBlindTemporalExperimentOptions
  extends KelvinsTemporalDatasetOptions {
  params: STDPParams;
  targetOutcome?: KelvinsTargetOutcome;
  maxCandidatePatterns?: number;
  experimentVariant?: KelvinsPopperExperimentVariant;
}

export interface KelvinsBlindTemporalPrediction {
  eventId: string;
  split: "validation" | "test";
  targetOutcome: KelvinsTargetOutcome;
  predictedPositive: boolean;
  matchedPatternIds: string[];
  maxPatternScore: number;
  matchedPatternCount: number;
  outcomeHiddenDuringPrediction: true;
}

export interface KelvinsBlindTemporalMetrics {
  eventCount: number;
  actualPositiveCount: number;
  predictedPositiveCount: number;
  truePositive: number;
  falsePositive: number;
  trueNegative: number;
  falseNegative: number;
  precision: number;
  recall: number;
  f1: number;
  accuracy: number;
}

export type KelvinsBaselineName =
  | "majority_negative"
  | "risk_signal_rule"
  | "risk_increase_rule"
  | "covariance_rule"
  | "frequency_single_event";

export interface KelvinsBaselineReport {
  name: KelvinsBaselineName;
  description: string;
  validationMetrics: KelvinsBlindTemporalMetrics;
  testMetrics: KelvinsBlindTemporalMetrics;
  selectedScoreThreshold?: number;
  selectedEventSignatures?: string[];
  validationPredictions: KelvinsBlindTemporalPrediction[];
  testPredictions: KelvinsBlindTemporalPrediction[];
}

export interface KelvinsPopperCriteria {
  minTestPrecision: number;
  minTestF1: number;
  minF1LiftOverBestBaseline: number;
}

export type KelvinsPopperExperimentVariant =
  | "default"
  | "risk_features_removed"
  | "physics_only";

export interface KelvinsPopperManifest {
  experimentId:
    | "ssa-kelvins-thl-popper-v0.1.0"
    | "ssa-kelvins-thl-popper-risk-removed-v0.1.0"
    | "ssa-kelvins-thl-popper-physics-only-v0.1.0";
  variant: KelvinsPopperExperimentVariant;
  hypothesis: string;
  nullHypothesis: string;
  targetOutcome: KelvinsTargetOutcome;
  forbiddenSignals: string[];
  requiredBaselines: KelvinsBaselineName[];
  criteria: KelvinsPopperCriteria;
  outcomePolicy: "final_cdm_only" | "initial_to_final_risk_delta";
  blindPolicy: "train_learns_validation_selects_test_outcomes_revealed_after_prediction";
}

export type KelvinsPopperVerdictStatus =
  | "survived"
  | "falsified"
  | "inconclusive";

export interface KelvinsPopperVerdict {
  status: KelvinsPopperVerdictStatus;
  reasons: string[];
  bestBaselineName: KelvinsBaselineName;
  thlTestPrecision: number;
  thlTestF1: number;
  bestBaselineTestPrecision: number;
  bestBaselineTestF1: number;
  f1LiftOverBestBaseline: number;
  f1LiftBootstrap95CI: KelvinsBootstrapConfidenceInterval;
}

export interface KelvinsBootstrapConfidenceInterval {
  metric: "f1_lift_over_best_baseline";
  iterations: number;
  seed: string;
  mean: number;
  lower95: number;
  upper95: number;
}

export interface KelvinsBlindTemporalExperimentReport {
  dataset: "esa-kelvins-collision-avoidance";
  manifest: KelvinsTemporalDatasetManifest;
  popperManifest: KelvinsPopperManifest;
  targetOutcome: KelvinsTargetOutcome;
  trainPatternCount: number;
  candidatePatternCount: number;
  selectedPatternCount: number;
  selectedPatternScoreThreshold: number | null;
  selectionPolicy: "validation_max_f1_score_threshold";
  validationMetrics: KelvinsBlindTemporalMetrics;
  testMetrics: KelvinsBlindTemporalMetrics;
  selectedPatterns: TemporalPatternHypothesis[];
  baselineReports: KelvinsBaselineReport[];
  popperVerdict: KelvinsPopperVerdict;
  validationPredictions: KelvinsBlindTemporalPrediction[];
  testPredictions: KelvinsBlindTemporalPrediction[];
  blindPolicy: "train_learns_validation_selects_test_outcomes_revealed_after_prediction";
  splitPolicy: "event_id_grouped_outcome_stratified_hash_no_row_leakage";
  hypothesisOnly: true;
  kgWriteAttempted: false;
}

type ResolvedKelvinsTemporalDatasetOptions =
  Required<
    Omit<
      KelvinsTemporalDatasetOptions,
      | "sourceDomain"
      | "sourceArtifactHash"
      | "sourceArtifactDescription"
      | "evalCommand"
      | "gitCommit"
      | "sampleEventLimit"
    >
  > & {
    sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
    splitRatios: KelvinsTemporalSplitRatios;
    sourceArtifactHash?: string;
    sourceArtifactDescription?: string;
    evalCommand?: string;
    gitCommit?: string;
    sampleEventLimit?: number;
  };

const DAY_MS = 86_400_000;

const DEFAULT_PROJECTION_OPTIONS = {
  projectionRunId: "ssa-kelvins-eval",
  sourceDomain: "production" as const,
  highRiskThresholdLog10: -5,
  riskEscalationDeltaLog10: 1,
  riskIncreaseDeltaLog10: 0.05,
  closeMissDistanceM: 1_000,
  lowMahalanobisDistance: 3,
  highRelativeSpeedMs: 12_000,
  sparseObservationCount: 5,
  highAp: 50,
  highF10: 150,
  includeCdmObservedEvent: true,
  includeObjectTypeEvents: true,
  includeUnknownObjectTypeEvent: false,
  excludeRiskFeatureEvents: false,
  eventGapMs: DAY_MS,
};

const DEFAULT_TEMPORAL_DATASET_OPTIONS = {
  datasetId: "esa-kelvins-collision-avoidance-temporal-v0.1.0",
  splitSeed: "temporal-kelvins-v0.1.0",
  splitRatios: { train: 0.6, validation: 0.2, test: 0.2 },
  minLeadTimeDays: 0,
  targetOutcome: "high_risk" as const,
  generatedAt: "1970-01-01T00:00:00.000Z",
  stratifySplitsByOutcome: true,
};

const SPLIT_NAMES: KelvinsTemporalSplitName[] = ["train", "validation", "test"];

const POPPER_CRITERIA: KelvinsPopperCriteria = {
  minTestPrecision: 0.2,
  minTestF1: 0.2,
  minF1LiftOverBestBaseline: 0.02,
};

const REQUIRED_BASELINES: KelvinsBaselineName[] = [
  "majority_negative",
  "risk_signal_rule",
  "risk_increase_rule",
  "covariance_rule",
  "frequency_single_event",
];

export function runKelvinsTemporalEvaluation(
  rows: KelvinsCdmRow[],
  options: KelvinsTemporalEvaluationOptions,
): KelvinsTemporalEvaluationReport {
  const targetOutcome = options.targetOutcome ?? "high_risk";
  if (targetOutcome !== "high_risk") {
    throw new Error(
      "runKelvinsTemporalEvaluation is a non-blind high_risk projection smoke test only; use runKelvinsBlindTemporalExperiment for target outcomes.",
    );
  }
  const topK = Math.max(1, Math.trunc(options.topK ?? 10));
  const projection = projectKelvinsRowsToTemporalEvents(rows, {
    ...options,
    eventGapMs: options.eventGapMs ?? options.params.pattern_window_ms + DAY_MS,
  });
  const thlTopPatterns = learnTemporalPatterns({
    events: projection.events,
    params: options.params,
    source_domain: options.sourceDomain ?? DEFAULT_PROJECTION_OPTIONS.sourceDomain,
    target_outcomes: [targetOutcome],
  }).slice(0, topK);
  const frequencyTopPatterns = buildFrequencyBaseline({
    events: projection.events,
    targetOutcome,
    patternWindowMs: options.params.pattern_window_ms,
    topK,
  });

  return {
    dataset: "esa-kelvins-collision-avoidance",
    collisionEventCount: projection.collisionEventCount,
    temporalEventCount: projection.events.length,
    targetOutcome,
    outcomeCounts: projection.outcomeCounts,
    thlPatternCount: thlTopPatterns.length,
    thlPrecisionAtK: meanPrecision(
      thlTopPatterns.map((pattern) => ({
        supportCount: pattern.support_count,
        negativeSupportCount: pattern.negative_support_count,
      })),
    ),
    frequencyPrecisionAtK: meanPrecision(frequencyTopPatterns),
    thlTopPatterns,
    frequencyTopPatterns,
    splitPolicy: "event_id_grouped_no_row_leakage",
    evaluationMode: "projection_smoke_non_blind_outcomes_visible",
    evidenceGrade: "smoke_only",
    hypothesisOnly: true,
    kgWriteAttempted: false,
  };
}

export function prepareKelvinsTemporalDataset(
  rows: KelvinsCdmRow[],
  options: KelvinsTemporalDatasetOptions = {},
): KelvinsTemporalDataset {
  const opts = resolveDatasetOptions(options);
  const groups = groupRowsByEventId(rows);
  const splits = splitKelvinsEventIds(rows, {
    splitSeed: opts.splitSeed,
    splitRatios: opts.splitRatios,
    targetOutcome: opts.targetOutcome,
    highRiskThresholdLog10: opts.highRiskThresholdLog10,
    riskEscalationDeltaLog10: opts.riskEscalationDeltaLog10,
    stratifyByOutcome: opts.stratifySplitsByOutcome,
  });
  const precursorEventsBySplit = emptySplitRecord<TemporalEvent>();
  const outcomesBySplit = emptySplitRecord<KelvinsTemporalOutcome>();
  const splitCounts = emptySplitCounts();
  const outcomeCounts: Record<string, number> = {};

  for (const split of SPLIT_NAMES) {
    let baseTimestamp = 0;
    for (const eventId of splits[split]) {
      const eventRows = groups.get(eventId) ?? [];
      const orderedRows = sortKelvinsEventRows(eventRows);
      if (orderedRows.length === 0) continue;

      const outcome = makeKelvinsOutcome({
        eventId,
        split,
        orderedRows,
        options: opts,
      });
      outcomesBySplit[split].push(outcome);
      outcomeCounts[outcome.terminalStatus] =
        (outcomeCounts[outcome.terminalStatus] ?? 0) + 1;

      const projection = projectKelvinsPrecursorEventsForEvent({
        eventId,
        orderedRows,
        options: opts,
        baseTimestamp,
      });
      precursorEventsBySplit[split].push(...projection.events);
      baseTimestamp = projection.latestTimestamp + opts.eventGapMs;

      splitCounts[split].eventIds += 1;
      splitCounts[split].rows += orderedRows.length;
      splitCounts[split].precursorEvents += projection.events.length;
      splitCounts[split].outcomes += 1;
      if (outcome.terminalStatus === opts.targetOutcome) {
        splitCounts[split].targetOutcomes += 1;
      } else {
        splitCounts[split].nonTargetOutcomes += 1;
      }
      if (outcome.terminalStatus === "high_risk") {
        splitCounts[split].highRiskOutcomes += 1;
      } else if (outcome.terminalStatus === "low_risk") {
        splitCounts[split].lowRiskOutcomes += 1;
      } else if (outcome.terminalStatus === "risk_escalation") {
        splitCounts[split].riskEscalationOutcomes += 1;
      } else {
        splitCounts[split].noRiskEscalationOutcomes += 1;
      }
    }
  }

  const temporalEventCount = SPLIT_NAMES.reduce(
    (sum, split) => sum + precursorEventsBySplit[split].length,
    0,
  );
  const outcomeCount = SPLIT_NAMES.reduce(
    (sum, split) => sum + outcomesBySplit[split].length,
    0,
  );

  return {
    manifest: {
      datasetId: opts.datasetId,
      sourceDatasetId: "esa-kelvins-collision-avoidance",
      projectionVersion: "temporal-kelvins-dataset-v0.2.0",
      generatedAt: opts.generatedAt,
      splitPolicy: "event_id_grouped_outcome_stratified_hash_no_row_leakage",
      splitLock: buildKelvinsSplitLock({
        splits,
        splitSeed: opts.splitSeed,
        splitRatios: opts.splitRatios,
        targetOutcome: opts.targetOutcome,
        splitCounts,
      }),
      outcomePolicy:
        opts.targetOutcome === "risk_escalation"
          ? "initial_to_final_risk_delta"
          : "final_cdm_only",
      leakagePolicy: "precursor_events_exclude_final_cdm_and_outcomes",
      hypothesisOnly: true,
      kgWriteAttempted: false,
      sourceArtifactHash: opts.sourceArtifactHash,
      sourceArtifactDescription: opts.sourceArtifactDescription,
      evalCommand: opts.evalCommand,
      gitCommit: opts.gitCommit,
      sampleEventLimit: opts.sampleEventLimit,
      evaluationWarnings: buildKelvinsEvaluationWarnings(opts),
      targetOutcome: opts.targetOutcome,
      riskEscalationDeltaLog10: opts.riskEscalationDeltaLog10,
      highRiskThresholdLog10: opts.highRiskThresholdLog10,
      minLeadTimeDays: opts.minLeadTimeDays,
      splitSeed: opts.splitSeed,
      splitRatios: opts.splitRatios,
      eventGapMs: opts.eventGapMs,
      includeCdmObservedEvent: opts.includeCdmObservedEvent,
      includeObjectTypeEvents: opts.includeObjectTypeEvents,
      includeUnknownObjectTypeEvent: opts.includeUnknownObjectTypeEvent,
      excludeRiskFeatureEvents: opts.excludeRiskFeatureEvents,
      inputHash: buildKelvinsInputHash(rows, opts),
      rowCount: rows.length,
      eventIdCount: groups.size,
      temporalEventCount,
      outcomeCount,
      splitCounts,
      outcomeCounts,
    },
    splits,
    precursorEventsBySplit,
    outcomesBySplit,
  };
}

export function splitKelvinsEventIds(
  rows: KelvinsCdmRow[],
  options: {
    splitSeed?: string;
    splitRatios?: Partial<KelvinsTemporalSplitRatios>;
    targetOutcome?: KelvinsTargetOutcome;
    highRiskThresholdLog10?: number;
    riskEscalationDeltaLog10?: number;
    stratifyByOutcome?: boolean;
  } = {},
): Record<KelvinsTemporalSplitName, string[]> {
  const splitSeed = options.splitSeed ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.splitSeed;
  const splitRatios = resolveSplitRatios(options.splitRatios);
  const groups = groupRowsByEventId(rows);
  const eventIds = sortKelvinsEventIdsForSplit([...groups.keys()], splitSeed);

  if (options.stratifyByOutcome === false) {
    return splitSortedEventIds(eventIds, splitRatios);
  }

  const targetOptions = {
    targetOutcome: options.targetOutcome ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.targetOutcome,
    highRiskThresholdLog10:
      options.highRiskThresholdLog10 ??
      DEFAULT_PROJECTION_OPTIONS.highRiskThresholdLog10,
    riskEscalationDeltaLog10:
      options.riskEscalationDeltaLog10 ??
      DEFAULT_PROJECTION_OPTIONS.riskEscalationDeltaLog10,
  };
  const targetEventIds: string[] = [];
  const nonTargetEventIds: string[] = [];
  for (const eventId of eventIds) {
    const orderedRows = sortKelvinsEventRows(groups.get(eventId) ?? []);
    if (orderedRows.length === 0) continue;
    const initialRow = orderedRows[0]!;
    const finalRow = orderedRows.at(-1)!;
    const terminalStatus = kelvinsTerminalStatus({
      targetOutcome: targetOptions.targetOutcome,
      finalRiskLog10: finalRow.riskLog10,
      riskDeltaLog10: round(finalRow.riskLog10 - initialRow.riskLog10),
      highRiskThresholdLog10: targetOptions.highRiskThresholdLog10,
      riskEscalationDeltaLog10: targetOptions.riskEscalationDeltaLog10,
    });
    if (terminalStatus === targetOptions.targetOutcome) {
      targetEventIds.push(eventId);
    } else {
      nonTargetEventIds.push(eventId);
    }
  }

  const targetSplits = splitSortedEventIds(targetEventIds, splitRatios);
  const nonTargetSplits = splitSortedEventIds(nonTargetEventIds, splitRatios);
  return {
    train: [...targetSplits.train, ...nonTargetSplits.train].sort(),
    validation: [
      ...targetSplits.validation,
      ...nonTargetSplits.validation,
    ].sort(),
    test: [...targetSplits.test, ...nonTargetSplits.test].sort(),
  };
}

export function limitKelvinsRowsToCompleteEvents(
  rows: KelvinsCdmRow[],
  limitEvents: number,
): KelvinsCdmRow[] {
  if (!Number.isInteger(limitEvents) || limitEvents <= 0) {
    throw new Error("limitEvents must be a positive integer");
  }
  const selectedEventIds = new Set<string>();
  for (const row of rows) {
    if (selectedEventIds.size >= limitEvents && !selectedEventIds.has(row.eventId)) {
      continue;
    }
    selectedEventIds.add(row.eventId);
  }
  return rows.filter((row) => selectedEventIds.has(row.eventId));
}

function sortKelvinsEventIdsForSplit(
  eventIds: string[],
  splitSeed: string,
): string[] {
  return eventIds
    .map((eventId) => ({
      eventId,
      sortHash: stableHash(`${splitSeed}:${eventId}`),
    }))
    .sort(
      (left, right) =>
        left.sortHash.localeCompare(right.sortHash) ||
        left.eventId.localeCompare(right.eventId),
    )
    .map((entry) => entry.eventId);
}

function splitSortedEventIds(
  eventIds: string[],
  splitRatios: KelvinsTemporalSplitRatios,
): Record<KelvinsTemporalSplitName, string[]> {
  const trainCount = Math.floor(eventIds.length * splitRatios.train);
  const validationCount = Math.floor(eventIds.length * splitRatios.validation);
  const counts: Record<KelvinsTemporalSplitName, number> = {
    train: trainCount,
    validation: validationCount,
    test: eventIds.length - trainCount - validationCount,
  };
  const activeSplits = SPLIT_NAMES.filter((split) => splitRatios[split] > 0);
  if (eventIds.length >= activeSplits.length) {
    for (const split of activeSplits) {
      if (counts[split] > 0) continue;
      const donor = [...activeSplits]
        .filter((candidate) => counts[candidate] > 1)
        .sort(
          (left, right) =>
            counts[right] - counts[left] ||
            SPLIT_NAMES.indexOf(left) - SPLIT_NAMES.indexOf(right),
        )[0];
      if (!donor) continue;
      counts[donor] -= 1;
      counts[split] += 1;
    }
  }

  const train = eventIds.slice(0, counts.train);
  const validation = eventIds.slice(
    counts.train,
    counts.train + counts.validation,
  );
  const test = eventIds.slice(counts.train + counts.validation);
  return {
    train: train.sort(),
    validation: validation.sort(),
    test: test.sort(),
  };
}

export function runKelvinsBlindTemporalExperiment(
  rows: KelvinsCdmRow[],
  options: KelvinsBlindTemporalExperimentOptions,
): KelvinsBlindTemporalExperimentReport {
  const targetOutcome = options.targetOutcome ?? "high_risk";
  const experimentVariant = options.experimentVariant ?? "default";
  const riskRemoved =
    experimentVariant === "risk_features_removed" ||
    experimentVariant === "physics_only";
  const physicsOnly = experimentVariant === "physics_only";
  const dataset = prepareKelvinsTemporalDataset(rows, {
    ...options,
    excludeRiskFeatureEvents: riskRemoved
      ? true
      : options.excludeRiskFeatureEvents,
    includeObjectTypeEvents: physicsOnly
      ? false
      : options.includeObjectTypeEvents,
    includeCdmObservedEvent: physicsOnly
      ? false
      : options.includeCdmObservedEvent,
    eventGapMs: options.eventGapMs ?? options.params.pattern_window_ms + DAY_MS,
  });
  assertBlindExperimentDataset({ dataset, targetOutcome });
  const trainEvents = appendKelvinsOutcomesForLearning({
    precursorEvents: dataset.precursorEventsBySplit.train,
    outcomes: dataset.outcomesBySplit.train,
    patternWindowMs: options.params.pattern_window_ms,
  });
  const trainPatterns = learnTemporalPatterns({
    events: trainEvents,
    params: options.params,
    source_domain: options.sourceDomain ?? DEFAULT_PROJECTION_OPTIONS.sourceDomain,
    target_outcomes: [targetOutcome],
  });
  const maxCandidatePatterns = Math.max(
    1,
    Math.trunc(options.maxCandidatePatterns ?? 50),
  );
  const candidatePatterns = trainPatterns.slice(0, maxCandidatePatterns);
  const threshold = chooseValidationScoreThreshold({
    patterns: candidatePatterns,
    events: dataset.precursorEventsBySplit.validation,
    outcomes: dataset.outcomesBySplit.validation,
    targetOutcome,
  });
  const selectedPatterns =
    threshold == null
      ? []
      : candidatePatterns.filter(
          (pattern) => pattern.pattern_score >= threshold,
        );
  const validationPredictions = predictKelvinsOutcomesFromPatterns({
    split: "validation",
    eventIds: dataset.splits.validation,
    events: dataset.precursorEventsBySplit.validation,
    patterns: selectedPatterns,
    targetOutcome,
  });
  const testPredictions = predictKelvinsOutcomesFromPatterns({
    split: "test",
    eventIds: dataset.splits.test,
    events: dataset.precursorEventsBySplit.test,
    patterns: selectedPatterns,
    targetOutcome,
  });
  const validationMetrics = evaluateKelvinsPredictions({
    predictions: validationPredictions,
    outcomes: dataset.outcomesBySplit.validation,
    targetOutcome,
  });
  const testMetrics = evaluateKelvinsPredictions({
    predictions: testPredictions,
    outcomes: dataset.outcomesBySplit.test,
    targetOutcome,
  });
  const baselineReports = buildKelvinsBaselineReports({
    dataset,
    targetOutcome,
  });
  const popperManifest = buildKelvinsPopperManifest({
    targetOutcome,
    variant: experimentVariant,
  });
  const popperVerdict = evaluateKelvinsPopperVerdict({
    thlMetrics: testMetrics,
    thlTestPredictions: testPredictions,
    testOutcomes: dataset.outcomesBySplit.test,
    targetOutcome,
    baselineReports,
    criteria: popperManifest.criteria,
    selectedPatternCount: selectedPatterns.length,
  });

  return {
    dataset: "esa-kelvins-collision-avoidance",
    manifest: dataset.manifest,
    popperManifest,
    targetOutcome,
    trainPatternCount: trainPatterns.length,
    candidatePatternCount: candidatePatterns.length,
    selectedPatternCount: selectedPatterns.length,
    selectedPatternScoreThreshold: threshold,
    selectionPolicy: "validation_max_f1_score_threshold",
    validationMetrics,
    testMetrics,
    selectedPatterns,
    baselineReports,
    popperVerdict,
    validationPredictions,
    testPredictions,
    blindPolicy: "train_learns_validation_selects_test_outcomes_revealed_after_prediction",
    splitPolicy: "event_id_grouped_outcome_stratified_hash_no_row_leakage",
    hypothesisOnly: true,
    kgWriteAttempted: false,
  };
}

export function appendKelvinsOutcomesForLearning(input: {
  precursorEvents: TemporalEvent[];
  outcomes: KelvinsTemporalOutcome[];
  patternWindowMs: number;
}): TemporalEvent[] {
  const eventTimestamps = new Map<string, number>();
  for (const event of input.precursorEvents) {
    if (!event.entity_id) continue;
    eventTimestamps.set(
      event.entity_id,
      Math.max(
        eventTimestamps.get(event.entity_id) ?? Number.NEGATIVE_INFINITY,
        event.timestamp,
      ),
    );
  }

  const outcomeEvents = input.outcomes.map((outcome, index) => {
    const latestTimestamp = eventTimestamps.get(outcome.eventId);
    const timestamp =
      latestTimestamp == null || !Number.isFinite(latestTimestamp)
        ? index * (input.patternWindowMs + DAY_MS)
        : latestTimestamp + 1;
    return makeKelvinsTerminalEvent({ outcome, timestamp });
  });

  return sortTemporalEventsStable([...input.precursorEvents, ...outcomeEvents]);
}

export function predictKelvinsOutcomesFromPatterns(input: {
  split: "validation" | "test";
  eventIds?: string[];
  events: TemporalEvent[];
  patterns: TemporalPatternHypothesis[];
  targetOutcome: KelvinsTargetOutcome;
}): KelvinsBlindTemporalPrediction[] {
  const groupedEvents = groupTemporalEventsByEntityId(input.events);
  const eventIds = [
    ...new Set(input.eventIds ?? [...groupedEvents.keys()]),
  ].sort((left, right) => left.localeCompare(right));
  return eventIds.map((eventId) => {
    const events = groupedEvents.get(eventId) ?? [];
    const matchedPatterns = input.patterns.filter(
      (pattern) =>
        pattern.terminal_status === input.targetOutcome &&
        containsOrderedEpisodeWithinWindow(
          events,
          pattern.sequence.map((step) => step.event_signature),
          pattern.pattern_window_ms,
        ),
    );
    return {
      eventId,
      split: input.split,
      targetOutcome: input.targetOutcome,
      predictedPositive: matchedPatterns.length > 0,
      matchedPatternIds: matchedPatterns.map((pattern) => pattern.pattern_id),
      maxPatternScore: round(
        Math.max(0, ...matchedPatterns.map((pattern) => pattern.pattern_score)),
      ),
      matchedPatternCount: matchedPatterns.length,
      outcomeHiddenDuringPrediction: true,
    };
  });
}

export function projectKelvinsRowsToTemporalEvents(
  rows: KelvinsCdmRow[],
  options: KelvinsProjectionOptions = {},
): KelvinsProjectionResult {
  const opts = resolveProjectionOptions(options);
  const groups = groupRowsByEventId(rows);
  const events: TemporalEvent[] = [];
  const outcomeCounts: Record<string, number> = {};
  let baseTimestamp = 0;

  for (const [eventId, eventRows] of groups) {
    const orderedRows = sortKelvinsEventRows(eventRows);
    const maxTimeToTca = Math.max(
      ...orderedRows.map((row) => row.timeToTcaDays),
    );
    let previousRisk: number | null = null;
    let latestTimestamp = baseTimestamp;

    orderedRows.forEach((row, rowIndex) => {
      const timestamp =
        baseTimestamp + Math.round((maxTimeToTca - row.timeToTcaDays) * DAY_MS);
      latestTimestamp = Math.max(latestTimestamp, timestamp);
      const rowEvents = classifyCdmRow({
        row,
        previousRisk,
        options: opts,
      });
      rowEvents.forEach((eventType, eventIndex) => {
        events.push(
          makeTemporalEvent({
            projectionRunId: opts.projectionRunId,
            eventType,
            eventId,
            sourceDomain: opts.sourceDomain,
            timestamp: timestamp + eventIndex,
            rowIndex,
            row,
          }),
        );
      });
      previousRisk = row.riskLog10;
    });

    const finalRisk = orderedRows.at(-1)?.riskLog10 ?? Number.NEGATIVE_INFINITY;
    const terminalStatus =
      finalRisk >= opts.highRiskThresholdLog10 ? "high_risk" : "low_risk";
    outcomeCounts[terminalStatus] = (outcomeCounts[terminalStatus] ?? 0) + 1;
    events.push(
      makeTemporalEvent({
        projectionRunId: opts.projectionRunId,
        eventType: `kelvins.outcome_${terminalStatus}`,
        eventId,
        sourceDomain: opts.sourceDomain,
        timestamp: latestTimestamp + 1,
        rowIndex: orderedRows.length,
        row: orderedRows.at(-1) ?? eventRows[0]!,
        terminalStatus,
      }),
    );

    baseTimestamp = latestTimestamp + opts.eventGapMs;
  }

  return {
    events,
    collisionEventCount: groups.size,
    outcomeCounts,
  };
}

export function loadKelvinsRowsFromCsv(csvText: string): KelvinsCdmRow[] {
  const lines = csvText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!);
  return lines.slice(1).map((line) => kelvinsRowFromRecord(header, parseCsvLine(line)));
}

export function parseCsvLine(line: string): string[] {
  const normalizedLine = line.replace(/\r?\n$/, "");
  const values: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < normalizedLine.length; index += 1) {
    const char = normalizedLine[index]!;
    if (char === '"') {
      if (inQuotes && normalizedLine[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  values.push(current);
  return values;
}

export function kelvinsRowFromRecord(
  header: string[],
  values: string[],
): KelvinsCdmRow {
  const record = new Map<string, string>();
  header.forEach((name, index) => record.set(name, values[index] ?? ""));
  return {
    eventId: required(record, "event_id"),
    timeToTcaDays: requiredNumber(record, "time_to_tca"),
    missionId: required(record, "mission_id"),
    riskLog10: requiredNumber(record, "risk"),
    maxRiskEstimateLog10: requiredNumber(record, "max_risk_estimate"),
    missDistanceM: requiredNumber(record, "miss_distance"),
    relativeSpeedMs: requiredNumber(record, "relative_speed"),
    mahalanobisDistance: requiredNumber(record, "mahalanobis_distance"),
    objectType: optionalText(record, "c_object_type") ?? "UNKNOWN",
    targetObsUsed: optionalNumber(record, "t_obs_used"),
    chaserObsUsed: optionalNumber(record, "c_obs_used"),
    targetPositionCovarianceDet: optionalNumber(record, "t_position_covariance_det"),
    chaserPositionCovarianceDet: optionalNumber(record, "c_position_covariance_det"),
    f10: optionalNumber(record, "F10"),
    ap: optionalNumber(record, "AP"),
  };
}

function projectKelvinsPrecursorEventsForEvent(input: {
  eventId: string;
  orderedRows: KelvinsCdmRow[];
  options: ResolvedKelvinsTemporalDatasetOptions;
  baseTimestamp: number;
}): { events: TemporalEvent[]; latestTimestamp: number } {
  const maxTimeToTca = Math.max(
    ...input.orderedRows.map((row) => row.timeToTcaDays),
  );
  const precursorRows = selectKelvinsPrecursorRows(
    input.orderedRows,
    input.options.minLeadTimeDays,
  );
  const events: TemporalEvent[] = [];
  let previousRisk: number | null = null;
  let latestTimestamp = input.baseTimestamp;

  for (const precursor of precursorRows) {
    const timestamp =
      input.baseTimestamp +
      Math.round((maxTimeToTca - precursor.row.timeToTcaDays) * DAY_MS);
    latestTimestamp = Math.max(latestTimestamp, timestamp);
    const rowEvents = classifyCdmRow({
      row: precursor.row,
      previousRisk,
      options: input.options,
    });
    rowEvents.forEach((eventType, eventIndex) => {
      events.push(
        makeTemporalEvent({
          projectionRunId: input.options.projectionRunId,
          eventType,
          eventId: input.eventId,
          sourceDomain: input.options.sourceDomain,
          timestamp: timestamp + eventIndex,
          rowIndex: precursor.rowIndex,
          row: precursor.row,
        }),
      );
    });
    previousRisk = precursor.row.riskLog10;
  }

  return { events, latestTimestamp };
}

function selectKelvinsPrecursorRows(
  orderedRows: KelvinsCdmRow[],
  minLeadTimeDays: number,
): Array<{ row: KelvinsCdmRow; rowIndex: number }> {
  const finalRow = orderedRows.at(-1);
  if (!finalRow) return [];
  return orderedRows
    .slice(0, -1)
    .map((row, rowIndex) => ({ row, rowIndex }))
    .filter(
      (entry) =>
        entry.row.timeToTcaDays - finalRow.timeToTcaDays >= minLeadTimeDays,
    );
}

function makeKelvinsOutcome(input: {
  eventId: string;
  split: KelvinsTemporalSplitName;
  orderedRows: KelvinsCdmRow[];
  options: ResolvedKelvinsTemporalDatasetOptions;
}): KelvinsTemporalOutcome {
  const initialRow = input.orderedRows[0]!;
  const finalRow = input.orderedRows.at(-1)!;
  const riskDeltaLog10 = round(finalRow.riskLog10 - initialRow.riskLog10);
  const terminalStatus = kelvinsTerminalStatus({
    targetOutcome: input.options.targetOutcome,
    finalRiskLog10: finalRow.riskLog10,
    riskDeltaLog10,
    highRiskThresholdLog10: input.options.highRiskThresholdLog10,
    riskEscalationDeltaLog10: input.options.riskEscalationDeltaLog10,
  });

  return {
    eventId: input.eventId,
    split: input.split,
    terminalStatus,
    finalRiskLog10: finalRow.riskLog10,
    initialRiskLog10: initialRow.riskLog10,
    riskDeltaLog10,
    finalTimeToTcaDays: finalRow.timeToTcaDays,
    cdmCount: input.orderedRows.length,
    sourceDomain: input.options.sourceDomain,
    payloadHash: stableHash(
      JSON.stringify({
        eventId: input.eventId,
        terminalStatus,
        finalRiskLog10: finalRow.riskLog10,
        initialRiskLog10: initialRow.riskLog10,
        riskDeltaLog10,
        highRiskThresholdLog10: input.options.highRiskThresholdLog10,
        riskEscalationDeltaLog10: input.options.riskEscalationDeltaLog10,
      }),
    ),
  };
}

function kelvinsTerminalStatus(input: {
  targetOutcome: KelvinsTargetOutcome;
  finalRiskLog10: number;
  riskDeltaLog10: number;
  highRiskThresholdLog10: number;
  riskEscalationDeltaLog10: number;
}): KelvinsOutcomeStatus {
  if (input.targetOutcome === "risk_escalation") {
    return input.riskDeltaLog10 >= input.riskEscalationDeltaLog10
      ? "risk_escalation"
      : "no_risk_escalation";
  }
  return input.finalRiskLog10 >= input.highRiskThresholdLog10
    ? "high_risk"
    : "low_risk";
}

function makeKelvinsTerminalEvent(input: {
  outcome: KelvinsTemporalOutcome;
  timestamp: number;
}): TemporalEvent {
  const eventType = `kelvins.outcome_${input.outcome.terminalStatus}`;
  const sourcePk = `${input.outcome.eventId}:outcome:${input.outcome.terminalStatus}`;
  return {
    id: stableHash(`kelvins-outcome:${sourcePk}`),
    projection_run_id: "ssa-kelvins-temporal-learning",
    event_type: eventType,
    event_source: "ssa_kelvins",
    entity_id: input.outcome.eventId,
    timestamp: input.timestamp,
    action_kind: "outcome_projection",
    confidence_after: input.outcome.finalRiskLog10,
    terminal_status: input.outcome.terminalStatus,
    source_domain: input.outcome.sourceDomain,
    source_table: "esa_kelvins_outcome",
    source_pk: sourcePk,
    payload_hash: input.outcome.payloadHash,
    metadata: {
      split: input.outcome.split,
      final_time_to_tca_days: input.outcome.finalTimeToTcaDays,
      initial_risk_log10: input.outcome.initialRiskLog10,
      final_risk_log10: input.outcome.finalRiskLog10,
      risk_delta_log10: input.outcome.riskDeltaLog10,
      cdm_count: input.outcome.cdmCount,
    },
  };
}

function buildKelvinsBaselineReports(input: {
  dataset: KelvinsTemporalDataset;
  targetOutcome: KelvinsTargetOutcome;
}): KelvinsBaselineReport[] {
  const targetLabel =
    input.targetOutcome === "risk_escalation" ? "risk-escalation" : "high-risk";
  return [
    buildStaticBaselineReport({
      name: "majority_negative",
      description: `Predict no ${targetLabel} events.`,
      dataset: input.dataset,
      targetOutcome: input.targetOutcome,
      predicate: () => false,
    }),
    buildStaticBaselineReport({
      name: "risk_signal_rule",
      description: `Predict ${targetLabel} when a precursor risk_high or max_risk_high signal exists.`,
      dataset: input.dataset,
      targetOutcome: input.targetOutcome,
      predicate: (events) =>
        events.some((event) =>
          ["kelvins.risk_high", "kelvins.max_risk_high"].includes(event.event_type),
        ),
    }),
    buildStaticBaselineReport({
      name: "risk_increase_rule",
      description: `Predict ${targetLabel} when a precursor risk_increased signal exists.`,
      dataset: input.dataset,
      targetOutcome: input.targetOutcome,
      predicate: (events) =>
        events.some((event) => event.event_type === "kelvins.risk_increased"),
    }),
    buildStaticBaselineReport({
      name: "covariance_rule",
      description: `Predict ${targetLabel} when a precursor target/chaser covariance high signal exists.`,
      dataset: input.dataset,
      targetOutcome: input.targetOutcome,
      predicate: (events) =>
        events.some((event) =>
          [
            "kelvins.target_covariance_high",
            "kelvins.chaser_covariance_high",
          ].includes(event.event_type),
        ),
    }),
    buildFrequencySingleEventBaselineReport(input),
  ];
}

function buildStaticBaselineReport(input: {
  name: KelvinsBaselineName;
  description: string;
  dataset: KelvinsTemporalDataset;
  targetOutcome: KelvinsTargetOutcome;
  predicate: (events: TemporalEvent[]) => boolean;
}): KelvinsBaselineReport {
  const validationPredictions = predictKelvinsOutcomesWithPredicate({
    split: "validation",
    eventIds: input.dataset.splits.validation,
    events: input.dataset.precursorEventsBySplit.validation,
    targetOutcome: input.targetOutcome,
    predicate: input.predicate,
  });
  const testPredictions = predictKelvinsOutcomesWithPredicate({
    split: "test",
    eventIds: input.dataset.splits.test,
    events: input.dataset.precursorEventsBySplit.test,
    targetOutcome: input.targetOutcome,
    predicate: input.predicate,
  });

  return {
    name: input.name,
    description: input.description,
    validationMetrics: evaluateKelvinsPredictions({
      predictions: validationPredictions,
      outcomes: input.dataset.outcomesBySplit.validation,
      targetOutcome: input.targetOutcome,
    }),
    testMetrics: evaluateKelvinsPredictions({
      predictions: testPredictions,
      outcomes: input.dataset.outcomesBySplit.test,
      targetOutcome: input.targetOutcome,
    }),
    validationPredictions,
    testPredictions,
  };
}

function buildFrequencySingleEventBaselineReport(input: {
  dataset: KelvinsTemporalDataset;
  targetOutcome: KelvinsTargetOutcome;
}): KelvinsBaselineReport {
  const candidates = learnFrequencySingleEventCandidates({
    events: input.dataset.precursorEventsBySplit.train,
    outcomes: input.dataset.outcomesBySplit.train,
    targetOutcome: input.targetOutcome,
  });
  const threshold = chooseFrequencyBaselineThreshold({
    candidates,
    events: input.dataset.precursorEventsBySplit.validation,
    outcomes: input.dataset.outcomesBySplit.validation,
    targetOutcome: input.targetOutcome,
  });
  const selected =
    threshold == null
      ? []
      : candidates.filter((candidate) => candidate.score >= threshold);
  const selectedSignatures = selected.map((candidate) => candidate.eventSignature);
  const validationPredictions = predictKelvinsOutcomesWithSignatures({
    split: "validation",
    eventIds: input.dataset.splits.validation,
    events: input.dataset.precursorEventsBySplit.validation,
    targetOutcome: input.targetOutcome,
    eventSignatures: selectedSignatures,
  });
  const testPredictions = predictKelvinsOutcomesWithSignatures({
    split: "test",
    eventIds: input.dataset.splits.test,
    events: input.dataset.precursorEventsBySplit.test,
    targetOutcome: input.targetOutcome,
    eventSignatures: selectedSignatures,
  });

  return {
    name: "frequency_single_event",
    description: "Train single-event signature precision on train, select score threshold on validation.",
    validationMetrics: evaluateKelvinsPredictions({
      predictions: validationPredictions,
      outcomes: input.dataset.outcomesBySplit.validation,
      targetOutcome: input.targetOutcome,
    }),
    testMetrics: evaluateKelvinsPredictions({
      predictions: testPredictions,
      outcomes: input.dataset.outcomesBySplit.test,
      targetOutcome: input.targetOutcome,
    }),
    selectedScoreThreshold: threshold ?? undefined,
    selectedEventSignatures: selectedSignatures.slice(0, 25),
    validationPredictions,
    testPredictions,
  };
}

interface FrequencySingleEventCandidate {
  eventSignature: string;
  score: number;
  supportCount: number;
  negativeSupportCount: number;
  precision: number;
  lift: number;
}

function learnFrequencySingleEventCandidates(input: {
  events: TemporalEvent[];
  outcomes: KelvinsTemporalOutcome[];
  targetOutcome: KelvinsTargetOutcome;
}): FrequencySingleEventCandidate[] {
  const signaturesByEventId = eventSignatureSetsByEntity(input.events);
  const baselineRate =
    input.outcomes.filter((outcome) => outcome.terminalStatus === input.targetOutcome).length /
    Math.max(1, input.outcomes.length);
  const counts = new Map<string, { positive: number; negative: number }>();

  for (const outcome of input.outcomes) {
    const signatures = signaturesByEventId.get(outcome.eventId) ?? new Set<string>();
    for (const signature of signatures) {
      const count = counts.get(signature) ?? { positive: 0, negative: 0 };
      if (outcome.terminalStatus === input.targetOutcome) {
        count.positive += 1;
      } else {
        count.negative += 1;
      }
      counts.set(signature, count);
    }
  }

  return [...counts.entries()]
    .map(([eventSignature, count]) => {
      const precision = count.positive / Math.max(1, count.positive + count.negative);
      const lift = precision / Math.max(0.000001, baselineRate);
      const supportFactor = Math.min(1, count.positive / 5);
      return {
        eventSignature,
        score: round(precision * Math.log1p(lift) * supportFactor),
        supportCount: count.positive,
        negativeSupportCount: count.negative,
        precision: round(precision),
        lift: round(lift),
      };
    })
    .filter((candidate) => candidate.supportCount > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        right.supportCount - left.supportCount ||
        left.eventSignature.localeCompare(right.eventSignature),
    );
}

function chooseFrequencyBaselineThreshold(input: {
  candidates: FrequencySingleEventCandidate[];
  events: TemporalEvent[];
  outcomes: KelvinsTemporalOutcome[];
  targetOutcome: KelvinsTargetOutcome;
}): number | null {
  const thresholds = [...new Set(input.candidates.map((candidate) => candidate.score))]
    .sort((left, right) => right - left);
  let best:
    | { threshold: number; metrics: KelvinsBlindTemporalMetrics }
    | null = null;

  for (const threshold of thresholds) {
    const signatures = input.candidates
      .filter((candidate) => candidate.score >= threshold)
      .map((candidate) => candidate.eventSignature);
    const predictions = predictKelvinsOutcomesWithSignatures({
      split: "validation",
      eventIds: input.outcomes.map((outcome) => outcome.eventId),
      events: input.events,
      targetOutcome: input.targetOutcome,
      eventSignatures: signatures,
    });
    const metrics = evaluateKelvinsPredictions({
      predictions,
      outcomes: input.outcomes,
      targetOutcome: input.targetOutcome,
    });
    if (
      best == null ||
      metrics.f1 > best.metrics.f1 ||
      (metrics.f1 === best.metrics.f1 && metrics.precision > best.metrics.precision) ||
      (metrics.f1 === best.metrics.f1 &&
        metrics.precision === best.metrics.precision &&
        threshold > best.threshold)
    ) {
      best = { threshold, metrics };
    }
  }

  return best?.threshold ?? null;
}

function predictKelvinsOutcomesWithPredicate(input: {
  split: "validation" | "test";
  eventIds: string[];
  events: TemporalEvent[];
  targetOutcome: KelvinsTargetOutcome;
  predicate: (events: TemporalEvent[]) => boolean;
}): KelvinsBlindTemporalPrediction[] {
  const groupedEvents = groupTemporalEventsByEntityId(input.events);
  return [...input.eventIds].sort((left, right) => left.localeCompare(right)).map(
    (eventId) => {
      const events = groupedEvents.get(eventId) ?? [];
      return {
        eventId,
        split: input.split,
        targetOutcome: input.targetOutcome,
        predictedPositive: input.predicate(events),
        matchedPatternIds: [] as string[],
        maxPatternScore: 0,
        matchedPatternCount: 0,
        outcomeHiddenDuringPrediction: true,
      };
    },
  );
}

function predictKelvinsOutcomesWithSignatures(input: {
  split: "validation" | "test";
  eventIds: string[];
  events: TemporalEvent[];
  targetOutcome: KelvinsTargetOutcome;
  eventSignatures: string[];
}): KelvinsBlindTemporalPrediction[] {
  const signatures = new Set(input.eventSignatures);
  const signaturesByEventId = eventSignatureSetsByEntity(input.events);
  return [...input.eventIds].sort((left, right) => left.localeCompare(right)).map(
    (eventId) => {
      const eventSignatures = signaturesByEventId.get(eventId) ?? new Set<string>();
      const predictedPositive = [...eventSignatures].some((signature) =>
        signatures.has(signature),
      );
      return {
        eventId,
        split: input.split,
        targetOutcome: input.targetOutcome,
        predictedPositive,
        matchedPatternIds: [] as string[],
        maxPatternScore: 0,
        matchedPatternCount: predictedPositive ? 1 : 0,
        outcomeHiddenDuringPrediction: true,
      };
    },
  );
}

function buildKelvinsPopperManifest(input: {
  targetOutcome: KelvinsTargetOutcome;
  variant: KelvinsPopperExperimentVariant;
}): KelvinsPopperManifest {
  const riskRemoved =
    input.variant === "risk_features_removed" || input.variant === "physics_only";
  const physicsOnly = input.variant === "physics_only";
  const targetDescription =
    input.targetOutcome === "risk_escalation"
      ? "risk escalation"
      : "high-risk";
  return {
    experimentId: physicsOnly
      ? "ssa-kelvins-thl-popper-physics-only-v0.1.0"
      : riskRemoved
        ? "ssa-kelvins-thl-popper-risk-removed-v0.1.0"
        : "ssa-kelvins-thl-popper-v0.1.0",
    variant: input.variant,
    hypothesis: physicsOnly
      ? `Temporal episode patterns learned only from non-categorical physical precursor events improve blind ${targetDescription} prediction over non-temporal baselines.`
      : riskRemoved
      ? `Temporal episode patterns learned without direct risk feature events improve blind ${targetDescription} prediction over non-temporal baselines.`
      : `Temporal episode patterns learned on train improve blind ${targetDescription} prediction over fixed and frequency baselines.`,
    nullHypothesis:
      "Temporal Hypothesis Layer does not outperform simple non-temporal baselines on blind test events.",
    targetOutcome: input.targetOutcome,
    forbiddenSignals: [
      "test outcomes during prediction",
      "final CDM row as precursor",
      "raw UNKNOWN object type as predictive event",
      "KG writes",
      ...(riskRemoved
        ? [
            "kelvins.risk_high as precursor",
            "kelvins.max_risk_high as precursor",
            "kelvins.risk_increased as precursor",
            "kelvins.risk_decreased as precursor",
          ]
        : []),
      ...(physicsOnly
        ? [
            "kelvins.object_type_* as precursor",
            "kelvins.cdm_observed as precursor",
          ]
        : []),
    ],
    requiredBaselines: REQUIRED_BASELINES,
    criteria: POPPER_CRITERIA,
    outcomePolicy:
      input.targetOutcome === "risk_escalation"
        ? "initial_to_final_risk_delta"
        : "final_cdm_only",
    blindPolicy: "train_learns_validation_selects_test_outcomes_revealed_after_prediction",
  };
}

function evaluateKelvinsPopperVerdict(input: {
  thlMetrics: KelvinsBlindTemporalMetrics;
  thlTestPredictions: KelvinsBlindTemporalPrediction[];
  testOutcomes: KelvinsTemporalOutcome[];
  targetOutcome: KelvinsTargetOutcome;
  baselineReports: KelvinsBaselineReport[];
  criteria: KelvinsPopperCriteria;
  selectedPatternCount: number;
}): KelvinsPopperVerdict {
  const bestBaseline = bestBaselineByF1(input.baselineReports);
  const f1LiftOverBestBaseline = round(
    input.thlMetrics.f1 - bestBaseline.testMetrics.f1,
  );
  const f1LiftBootstrap95CI = bootstrapF1LiftOverBaseline({
    outcomes: input.testOutcomes,
    targetOutcome: input.targetOutcome,
    thlPredictions: input.thlTestPredictions,
    baselinePredictions: bestBaseline.testPredictions,
    seed: `kelvins-popper:${bestBaseline.name}:${input.targetOutcome}`,
    iterations: 500,
  });
  const reasons: string[] = [];

  if (input.thlMetrics.actualPositiveCount === 0) {
    reasons.push("test split has no positive outcomes");
  }
  if (input.selectedPatternCount === 0) {
    reasons.push("THL selected no validation-backed patterns");
  }
  if (input.thlMetrics.precision < input.criteria.minTestPrecision) {
    reasons.push(
      `test precision ${input.thlMetrics.precision} below ${input.criteria.minTestPrecision}`,
    );
  }
  if (input.thlMetrics.f1 < input.criteria.minTestF1) {
    reasons.push(`test f1 ${input.thlMetrics.f1} below ${input.criteria.minTestF1}`);
  }
  if (f1LiftOverBestBaseline < input.criteria.minF1LiftOverBestBaseline) {
    reasons.push(
      `test f1 lift ${f1LiftOverBestBaseline} below baseline threshold ${input.criteria.minF1LiftOverBestBaseline}`,
    );
  }
  if (f1LiftBootstrap95CI.lower95 < input.criteria.minF1LiftOverBestBaseline) {
    reasons.push(
      `bootstrap f1 lift lower95 ${f1LiftBootstrap95CI.lower95} below baseline threshold ${input.criteria.minF1LiftOverBestBaseline}`,
    );
  }

  const status: KelvinsPopperVerdictStatus =
    input.thlMetrics.actualPositiveCount === 0
      ? "inconclusive"
      : reasons.length === 0
        ? "survived"
        : "falsified";

  return {
    status,
    reasons,
    bestBaselineName: bestBaseline.name,
    thlTestPrecision: input.thlMetrics.precision,
    thlTestF1: input.thlMetrics.f1,
    bestBaselineTestPrecision: bestBaseline.testMetrics.precision,
    bestBaselineTestF1: bestBaseline.testMetrics.f1,
    f1LiftOverBestBaseline,
    f1LiftBootstrap95CI,
  };
}

function bestBaselineByF1(reports: KelvinsBaselineReport[]): KelvinsBaselineReport {
  const [best] = [...reports].sort(
    (left, right) =>
      right.testMetrics.f1 - left.testMetrics.f1 ||
      right.testMetrics.precision - left.testMetrics.precision ||
      left.name.localeCompare(right.name),
  );
  if (!best) {
    throw new Error("at least one baseline report is required");
  }
  return best;
}

function chooseValidationScoreThreshold(input: {
  patterns: TemporalPatternHypothesis[];
  events: TemporalEvent[];
  outcomes: KelvinsTemporalOutcome[];
  targetOutcome: KelvinsTargetOutcome;
}): number | null {
  const thresholds = [...new Set(input.patterns.map((pattern) => pattern.pattern_score))]
    .sort((left, right) => right - left);
  if (thresholds.length === 0) return null;

  let best:
    | { threshold: number; metrics: KelvinsBlindTemporalMetrics }
    | null = null;
  for (const threshold of thresholds) {
    const patterns = input.patterns.filter(
      (pattern) => pattern.pattern_score >= threshold,
    );
    const predictions = predictKelvinsOutcomesFromPatterns({
      split: "validation",
      eventIds: input.outcomes.map((outcome) => outcome.eventId),
      events: input.events,
      patterns,
      targetOutcome: input.targetOutcome,
    });
    const metrics = evaluateKelvinsPredictions({
      predictions,
      outcomes: input.outcomes,
      targetOutcome: input.targetOutcome,
    });
    if (
      best == null ||
      metrics.f1 > best.metrics.f1 ||
      (metrics.f1 === best.metrics.f1 &&
        metrics.precision > best.metrics.precision) ||
      (metrics.f1 === best.metrics.f1 &&
        metrics.precision === best.metrics.precision &&
        threshold > best.threshold)
    ) {
      best = { threshold, metrics };
    }
  }

  return best?.threshold ?? null;
}

function evaluateKelvinsPredictions(input: {
  predictions: KelvinsBlindTemporalPrediction[];
  outcomes: KelvinsTemporalOutcome[];
  targetOutcome: KelvinsTargetOutcome;
}): KelvinsBlindTemporalMetrics {
  const predictionsByEventId = new Map(
    input.predictions.map((prediction) => [prediction.eventId, prediction]),
  );
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;

  for (const outcome of input.outcomes) {
    const actualPositive = outcome.terminalStatus === input.targetOutcome;
    const predictedPositive =
      predictionsByEventId.get(outcome.eventId)?.predictedPositive ?? false;
    if (actualPositive && predictedPositive) truePositive += 1;
    else if (!actualPositive && predictedPositive) falsePositive += 1;
    else if (!actualPositive && !predictedPositive) trueNegative += 1;
    else falseNegative += 1;
  }

  const predictedPositiveCount = truePositive + falsePositive;
  const actualPositiveCount = truePositive + falseNegative;
  const precision =
    truePositive / Math.max(1, predictedPositiveCount);
  const recall = truePositive / Math.max(1, actualPositiveCount);
  const f1 =
    precision + recall === 0
      ? 0
      : (2 * precision * recall) / (precision + recall);
  const accuracy =
    (truePositive + trueNegative) / Math.max(1, input.outcomes.length);

  return {
    eventCount: input.outcomes.length,
    actualPositiveCount,
    predictedPositiveCount,
    truePositive,
    falsePositive,
    trueNegative,
    falseNegative,
    precision: round(precision),
    recall: round(recall),
    f1: round(f1),
    accuracy: round(accuracy),
  };
}

function bootstrapF1LiftOverBaseline(input: {
  outcomes: KelvinsTemporalOutcome[];
  targetOutcome: KelvinsTargetOutcome;
  thlPredictions: KelvinsBlindTemporalPrediction[];
  baselinePredictions: KelvinsBlindTemporalPrediction[];
  seed: string;
  iterations: number;
}): KelvinsBootstrapConfidenceInterval {
  const sortedOutcomes = [...input.outcomes].sort((left, right) =>
    left.eventId.localeCompare(right.eventId),
  );
  const thlByEventId = new Map(
    input.thlPredictions.map((prediction) => [prediction.eventId, prediction]),
  );
  const baselineByEventId = new Map(
    input.baselinePredictions.map((prediction) => [
      prediction.eventId,
      prediction,
    ]),
  );
  const deltas: number[] = [];
  const random = seededRandom(input.seed);

  for (let iteration = 0; iteration < input.iterations; iteration += 1) {
    let thlTruePositive = 0;
    let thlFalsePositive = 0;
    let thlFalseNegative = 0;
    let baselineTruePositive = 0;
    let baselineFalsePositive = 0;
    let baselineFalseNegative = 0;

    for (let draw = 0; draw < sortedOutcomes.length; draw += 1) {
      const outcome = sortedOutcomes[
        Math.floor(random() * sortedOutcomes.length)
      ]!;
      const actualPositive = outcome.terminalStatus === input.targetOutcome;
      const thlPositive =
        thlByEventId.get(outcome.eventId)?.predictedPositive ?? false;
      const baselinePositive =
        baselineByEventId.get(outcome.eventId)?.predictedPositive ?? false;

      if (actualPositive && thlPositive) thlTruePositive += 1;
      else if (!actualPositive && thlPositive) thlFalsePositive += 1;
      else if (actualPositive && !thlPositive) thlFalseNegative += 1;

      if (actualPositive && baselinePositive) baselineTruePositive += 1;
      else if (!actualPositive && baselinePositive) baselineFalsePositive += 1;
      else if (actualPositive && !baselinePositive) baselineFalseNegative += 1;
    }

    deltas.push(
      f1FromCounts(thlTruePositive, thlFalsePositive, thlFalseNegative) -
        f1FromCounts(
          baselineTruePositive,
          baselineFalsePositive,
          baselineFalseNegative,
        ),
    );
  }

  deltas.sort((left, right) => left - right);
  const mean =
    deltas.reduce((sum, delta) => sum + delta, 0) / Math.max(1, deltas.length);
  return {
    metric: "f1_lift_over_best_baseline",
    iterations: input.iterations,
    seed: input.seed,
    mean: round(mean),
    lower95: round(percentile(deltas, 0.025)),
    upper95: round(percentile(deltas, 0.975)),
  };
}

function f1FromCounts(
  truePositive: number,
  falsePositive: number,
  falseNegative: number,
): number {
  const precision = truePositive / Math.max(1, truePositive + falsePositive);
  const recall = truePositive / Math.max(1, truePositive + falseNegative);
  return precision + recall === 0
    ? 0
    : (2 * precision * recall) / (precision + recall);
}

function percentile(values: number[], quantile: number): number {
  if (values.length === 0) return 0;
  const index = Math.min(
    values.length - 1,
    Math.max(0, Math.floor((values.length - 1) * quantile)),
  );
  return values[index]!;
}

function seededRandom(seed: string): () => number {
  let state = Number.parseInt(stableHash(seed).slice(0, 8), 16) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function assertBlindExperimentDataset(input: {
  dataset: KelvinsTemporalDataset;
  targetOutcome: KelvinsTargetOutcome;
}): void {
  assertNoSplitOverlap(input.dataset.splits);
  for (const split of SPLIT_NAMES) {
    assertNoOutcomeLeakageInPrecursors(
      input.dataset.precursorEventsBySplit[split],
      split,
    );
  }

  for (const split of SPLIT_NAMES) {
    const counts = input.dataset.manifest.splitCounts[split];
    if (counts.eventIds === 0) {
      throw new Error(`blind experiment split ${split} has no event IDs`);
    }
    if (counts.targetOutcomes === 0) {
      throw new Error(
        `blind experiment split ${split} has no ${input.targetOutcome} outcomes`,
      );
    }
    if (counts.nonTargetOutcomes === 0) {
      throw new Error(
        `blind experiment split ${split} has no non-${input.targetOutcome} outcomes`,
      );
    }
  }
}

function assertNoSplitOverlap(
  splits: Record<KelvinsTemporalSplitName, string[]>,
): void {
  const seen = new Map<string, KelvinsTemporalSplitName>();
  for (const split of SPLIT_NAMES) {
    for (const eventId of splits[split]) {
      const previous = seen.get(eventId);
      if (previous != null) {
        throw new Error(
          `event_id ${eventId} appears in both ${previous} and ${split}`,
        );
      }
      seen.set(eventId, split);
    }
  }
}

function assertNoOutcomeLeakageInPrecursors(
  events: TemporalEvent[],
  split: KelvinsTemporalSplitName,
): void {
  const leakingEvent = events.find(
    (event) =>
      event.terminal_status != null ||
      event.source_table === "esa_kelvins_outcome" ||
      event.event_type.startsWith("kelvins.outcome_"),
  );
  if (leakingEvent) {
    throw new Error(
      `blind experiment precursor leakage in ${split}: ${leakingEvent.event_type}`,
    );
  }
}

function groupTemporalEventsByEntityId(
  events: TemporalEvent[],
): Map<string, TemporalEvent[]> {
  const groups = new Map<string, TemporalEvent[]>();
  for (const event of events) {
    if (!event.entity_id) continue;
    const group = groups.get(event.entity_id) ?? [];
    group.push(event);
    groups.set(event.entity_id, group);
  }
  return groups;
}

function eventSignatureSetsByEntity(
  events: TemporalEvent[],
): Map<string, Set<string>> {
  const groups = new Map<string, Set<string>>();
  for (const event of events) {
    if (!event.entity_id || event.terminal_status != null) continue;
    const group = groups.get(event.entity_id) ?? new Set<string>();
    group.add(canonicalEventSignature(event));
    groups.set(event.entity_id, group);
  }
  return groups;
}

function containsOrderedEpisodeWithinWindow(
  events: TemporalEvent[],
  sequence: string[],
  patternWindowMs: number,
): boolean {
  if (sequence.length === 0) return false;
  const sortedEvents = sortTemporalEventsStable(events).filter(
    (event) => event.terminal_status == null,
  );

  for (let startIndex = 0; startIndex < sortedEvents.length; startIndex += 1) {
    if (canonicalEventSignature(sortedEvents[startIndex]!) !== sequence[0]) {
      continue;
    }
    let sequenceIndex = 1;
    const startTimestamp = sortedEvents[startIndex]!.timestamp;
    let endTimestamp = startTimestamp;
    for (
      let eventIndex = startIndex + 1;
      eventIndex < sortedEvents.length && sequenceIndex < sequence.length;
      eventIndex += 1
    ) {
      const event = sortedEvents[eventIndex]!;
      if (event.timestamp - startTimestamp > patternWindowMs) break;
      if (canonicalEventSignature(event) !== sequence[sequenceIndex]) continue;
      sequenceIndex += 1;
      endTimestamp = event.timestamp;
    }
    if (
      sequenceIndex === sequence.length &&
      endTimestamp - startTimestamp <= patternWindowMs
    ) {
      return true;
    }
  }

  return false;
}

function classifyCdmRow(input: {
  row: KelvinsCdmRow;
  previousRisk: number | null;
  options: ResolvedKelvinsProjectionOptions;
}): string[] {
  const events = input.options.includeCdmObservedEvent
    ? ["kelvins.cdm_observed"]
    : [];
  const { row, options } = input;

  if (!options.excludeRiskFeatureEvents) {
    if (row.riskLog10 >= options.highRiskThresholdLog10) {
      events.push("kelvins.risk_high");
    }
    if (row.maxRiskEstimateLog10 >= options.highRiskThresholdLog10) {
      events.push("kelvins.max_risk_high");
    }
  }
  if (!options.excludeRiskFeatureEvents && input.previousRisk != null) {
    const delta = row.riskLog10 - input.previousRisk;
    if (delta >= options.riskIncreaseDeltaLog10) {
      events.push("kelvins.risk_increased");
    } else if (delta <= -options.riskIncreaseDeltaLog10) {
      events.push("kelvins.risk_decreased");
    }
  }
  if (row.missDistanceM <= options.closeMissDistanceM) {
    events.push("kelvins.miss_distance_low");
  }
  if (row.mahalanobisDistance <= options.lowMahalanobisDistance) {
    events.push("kelvins.mahalanobis_low");
  }
  if (row.relativeSpeedMs >= options.highRelativeSpeedMs) {
    events.push("kelvins.relative_speed_high");
  }
  if (
    row.targetObsUsed != null &&
    row.chaserObsUsed != null &&
    Math.min(row.targetObsUsed, row.chaserObsUsed) <= options.sparseObservationCount
  ) {
    events.push("kelvins.observations_sparse");
  }
  if (isHighCovariance(row.targetPositionCovarianceDet)) {
    events.push("kelvins.target_covariance_high");
  }
  if (isHighCovariance(row.chaserPositionCovarianceDet)) {
    events.push("kelvins.chaser_covariance_high");
  }
  if (row.ap != null && row.ap >= options.highAp) {
    events.push("space_weather.ap_high");
  }
  if (row.f10 != null && row.f10 >= options.highF10) {
    events.push("space_weather.f10_high");
  }
  if (options.includeObjectTypeEvents) {
    const objectTypeToken = sanitizeObjectType(row.objectType);
    if (objectTypeToken !== "unknown" || options.includeUnknownObjectTypeEvent) {
      events.push(`kelvins.object_type_${objectTypeToken}`);
    }
  }

  return events;
}

function buildFrequencyBaseline(input: {
  events: TemporalEvent[];
  targetOutcome: string;
  patternWindowMs: number;
  topK: number;
}): FrequencyBaselinePattern[] {
  const terminalEvents = input.events.filter((event) => event.terminal_status != null);
  const targetOutcomes = terminalEvents.filter(
    (event) => event.terminal_status === input.targetOutcome,
  );
  const baselineRate = targetOutcomes.length / Math.max(1, terminalEvents.length);
  const accumulators = new Map<
    string,
    { positiveWindows: Set<string>; negativeWindows: Set<string> }
  >();

  for (const outcome of terminalEvents) {
    const signatures = new Set(
      input.events
        .filter(
          (event) =>
            event.terminal_status == null &&
            event.timestamp >= outcome.timestamp - input.patternWindowMs &&
            event.timestamp < outcome.timestamp,
        )
        .map(canonicalEventSignature),
    );
    for (const signature of signatures) {
      const accumulator =
        accumulators.get(signature) ??
        { positiveWindows: new Set<string>(), negativeWindows: new Set<string>() };
      if (outcome.terminal_status === input.targetOutcome) {
        accumulator.positiveWindows.add(outcome.id);
      } else {
        accumulator.negativeWindows.add(outcome.id);
      }
      accumulators.set(signature, accumulator);
    }
  }

  return [...accumulators.entries()]
    .map(([eventSignature, accumulator]) => {
      const supportCount = accumulator.positiveWindows.size;
      const negativeSupportCount = accumulator.negativeWindows.size;
      const precision =
        supportCount / Math.max(1, supportCount + negativeSupportCount);
      return {
        eventSignature,
        supportCount,
        negativeSupportCount,
        precision: round(precision),
        lift: round(precision / Math.max(0.000001, baselineRate)),
      };
    })
    .filter((pattern) => pattern.supportCount > 0)
    .sort(
      (left, right) =>
        right.supportCount - left.supportCount ||
        right.precision - left.precision ||
        left.eventSignature.localeCompare(right.eventSignature),
    )
    .slice(0, input.topK);
}

function makeTemporalEvent(input: {
  projectionRunId: string;
  eventType: string;
  eventId: string;
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
  timestamp: number;
  rowIndex: number;
  row: KelvinsCdmRow;
  terminalStatus?: string;
}): TemporalEvent {
  const sourcePk = `${input.eventId}:${input.rowIndex}:${input.eventType}`;
  return {
    id: stableHash(`kelvins-event:${sourcePk}`),
    projection_run_id: input.projectionRunId,
    event_type: input.eventType,
    event_source: input.eventType.startsWith("space_weather")
      ? "space_weather"
      : "ssa_kelvins",
    entity_id: input.eventId,
    timestamp: input.timestamp,
    action_kind: "cdm_projection",
    confidence_after: input.row.riskLog10,
    terminal_status: input.terminalStatus,
    source_domain: input.sourceDomain,
    source_table: "esa_kelvins_cdm",
    source_pk: sourcePk,
    payload_hash: stableHash(
      JSON.stringify({
        eventId: input.eventId,
        rowIndex: input.rowIndex,
        eventType: input.eventType,
        risk: input.row.riskLog10,
      }),
    ),
    metadata: {
      mission_id: input.row.missionId,
      time_to_tca_days: input.row.timeToTcaDays,
      object_type: input.row.objectType,
    },
  };
}

function resolveProjectionOptions(
  options: KelvinsProjectionOptions,
): ResolvedKelvinsProjectionOptions {
  return {
    projectionRunId:
      options.projectionRunId ?? DEFAULT_PROJECTION_OPTIONS.projectionRunId,
    sourceDomain: options.sourceDomain ?? DEFAULT_PROJECTION_OPTIONS.sourceDomain,
    highRiskThresholdLog10:
      options.highRiskThresholdLog10 ??
      DEFAULT_PROJECTION_OPTIONS.highRiskThresholdLog10,
    riskEscalationDeltaLog10:
      options.riskEscalationDeltaLog10 ??
      DEFAULT_PROJECTION_OPTIONS.riskEscalationDeltaLog10,
    riskIncreaseDeltaLog10:
      options.riskIncreaseDeltaLog10 ??
      DEFAULT_PROJECTION_OPTIONS.riskIncreaseDeltaLog10,
    closeMissDistanceM:
      options.closeMissDistanceM ?? DEFAULT_PROJECTION_OPTIONS.closeMissDistanceM,
    lowMahalanobisDistance:
      options.lowMahalanobisDistance ??
      DEFAULT_PROJECTION_OPTIONS.lowMahalanobisDistance,
    highRelativeSpeedMs:
      options.highRelativeSpeedMs ?? DEFAULT_PROJECTION_OPTIONS.highRelativeSpeedMs,
    sparseObservationCount:
      options.sparseObservationCount ??
      DEFAULT_PROJECTION_OPTIONS.sparseObservationCount,
    highAp: options.highAp ?? DEFAULT_PROJECTION_OPTIONS.highAp,
    highF10: options.highF10 ?? DEFAULT_PROJECTION_OPTIONS.highF10,
    includeCdmObservedEvent:
      options.includeCdmObservedEvent ??
      DEFAULT_PROJECTION_OPTIONS.includeCdmObservedEvent,
    includeObjectTypeEvents:
      options.includeObjectTypeEvents ??
      DEFAULT_PROJECTION_OPTIONS.includeObjectTypeEvents,
    includeUnknownObjectTypeEvent:
      options.includeUnknownObjectTypeEvent ??
      DEFAULT_PROJECTION_OPTIONS.includeUnknownObjectTypeEvent,
    excludeRiskFeatureEvents:
      options.excludeRiskFeatureEvents ??
      DEFAULT_PROJECTION_OPTIONS.excludeRiskFeatureEvents,
    eventGapMs: options.eventGapMs ?? DEFAULT_PROJECTION_OPTIONS.eventGapMs,
  };
}

function resolveDatasetOptions(
  options: KelvinsTemporalDatasetOptions,
): ResolvedKelvinsTemporalDatasetOptions {
  const projectionOptions = resolveProjectionOptions(options);
  const minLeadTimeDays =
    options.minLeadTimeDays ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.minLeadTimeDays;
  if (!Number.isFinite(minLeadTimeDays) || minLeadTimeDays < 0) {
    throw new Error("minLeadTimeDays must be a finite non-negative number");
  }
  if (
    options.sampleEventLimit != null &&
    (!Number.isInteger(options.sampleEventLimit) || options.sampleEventLimit <= 0)
  ) {
    throw new Error("sampleEventLimit must be a positive integer when provided");
  }
  const targetOutcome =
    options.targetOutcome ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.targetOutcome;

  return {
    ...projectionOptions,
    datasetId:
      options.datasetId ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.datasetId,
    splitSeed:
      options.splitSeed ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.splitSeed,
    splitRatios: resolveSplitRatios(options.splitRatios),
    minLeadTimeDays,
    targetOutcome,
    generatedAt:
      options.generatedAt ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.generatedAt,
    stratifySplitsByOutcome:
      options.stratifySplitsByOutcome ??
      DEFAULT_TEMPORAL_DATASET_OPTIONS.stratifySplitsByOutcome,
    sourceArtifactHash: options.sourceArtifactHash,
    sourceArtifactDescription: options.sourceArtifactDescription,
    evalCommand: options.evalCommand,
    gitCommit: options.gitCommit,
    sampleEventLimit: options.sampleEventLimit,
  };
}

function buildKelvinsSplitLock(input: {
  splits: Record<KelvinsTemporalSplitName, string[]>;
  splitSeed: string;
  splitRatios: KelvinsTemporalSplitRatios;
  targetOutcome: KelvinsTargetOutcome;
  splitCounts: Record<KelvinsTemporalSplitName, KelvinsTemporalSplitCounts>;
}): KelvinsTemporalSplitLock {
  return {
    policy: "event_id_grouped_outcome_stratified_hash_no_row_leakage",
    splitSeed: input.splitSeed,
    splitRatios: input.splitRatios,
    targetOutcome: input.targetOutcome,
    eventIdsHash: hashEventIds(SPLIT_NAMES.flatMap((split) => input.splits[split])),
    trainEventIdsHash: hashEventIds(input.splits.train),
    validationEventIdsHash: hashEventIds(input.splits.validation),
    testEventIdsHash: hashEventIds(input.splits.test),
    targetOutcomesBySplit: {
      train: input.splitCounts.train.targetOutcomes,
      validation: input.splitCounts.validation.targetOutcomes,
      test: input.splitCounts.test.targetOutcomes,
    },
    nonTargetOutcomesBySplit: {
      train: input.splitCounts.train.nonTargetOutcomes,
      validation: input.splitCounts.validation.nonTargetOutcomes,
      test: input.splitCounts.test.nonTargetOutcomes,
    },
  };
}

function buildKelvinsEvaluationWarnings(
  options: ResolvedKelvinsTemporalDatasetOptions,
): string[] {
  const warnings: string[] = [];
  if (options.sampleEventLimit != null) {
    warnings.push(
      "sampleEventLimit is set; this artifact is a smoke sample, not evidence for a Popper claim",
    );
  }
  if (options.minLeadTimeDays === 0) {
    warnings.push(
      "minLeadTimeDays is 0; blind prediction excludes the final CDM but does not enforce a positive lead-time horizon",
    );
  }
  if (!options.sourceArtifactHash) {
    warnings.push("sourceArtifactHash is missing; raw source provenance is incomplete");
  }
  if (!options.evalCommand) {
    warnings.push("evalCommand is missing; run reproduction metadata is incomplete");
  }
  return warnings;
}

function hashEventIds(eventIds: string[]): string {
  return stableHash(JSON.stringify([...eventIds].sort()));
}

function resolveSplitRatios(
  ratios?: Partial<KelvinsTemporalSplitRatios>,
): KelvinsTemporalSplitRatios {
  const raw = {
    train: ratios?.train ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.splitRatios.train,
    validation:
      ratios?.validation ??
      DEFAULT_TEMPORAL_DATASET_OPTIONS.splitRatios.validation,
    test: ratios?.test ?? DEFAULT_TEMPORAL_DATASET_OPTIONS.splitRatios.test,
  };
  const total = raw.train + raw.validation + raw.test;
  if (
    !Number.isFinite(total) ||
    total <= 0 ||
    Object.values(raw).some((value) => !Number.isFinite(value) || value < 0)
  ) {
    throw new Error("splitRatios must be finite non-negative numbers with a positive sum");
  }
  return {
    train: raw.train / total,
    validation: raw.validation / total,
    test: raw.test / total,
  };
}

function groupRowsByEventId(rows: KelvinsCdmRow[]): Map<string, KelvinsCdmRow[]> {
  const groups = new Map<string, KelvinsCdmRow[]>();
  for (const row of rows) {
    const group = groups.get(row.eventId) ?? [];
    group.push(row);
    groups.set(row.eventId, group);
  }
  return new Map([...groups.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function sortKelvinsEventRows(rows: KelvinsCdmRow[]): KelvinsCdmRow[] {
  return [...rows].sort(
    (left, right) =>
      right.timeToTcaDays - left.timeToTcaDays ||
      left.riskLog10 - right.riskLog10 ||
      left.missionId.localeCompare(right.missionId) ||
      left.objectType.localeCompare(right.objectType),
  );
}

function emptySplitRecord<T>(): Record<KelvinsTemporalSplitName, T[]> {
  return { train: [], validation: [], test: [] };
}

function emptySplitCounts(): Record<KelvinsTemporalSplitName, KelvinsTemporalSplitCounts> {
  return {
    train: emptySplitCount(),
    validation: emptySplitCount(),
    test: emptySplitCount(),
  };
}

function emptySplitCount(): KelvinsTemporalSplitCounts {
  return {
    eventIds: 0,
    rows: 0,
    precursorEvents: 0,
    outcomes: 0,
    targetOutcomes: 0,
    nonTargetOutcomes: 0,
    highRiskOutcomes: 0,
    lowRiskOutcomes: 0,
    riskEscalationOutcomes: 0,
    noRiskEscalationOutcomes: 0,
  };
}

function buildKelvinsInputHash(
  rows: KelvinsCdmRow[],
  options: ResolvedKelvinsTemporalDatasetOptions,
): string {
  const normalizedRows = rows
    .map((row) => ({
      eventId: row.eventId,
      timeToTcaDays: row.timeToTcaDays,
      missionId: row.missionId,
      riskLog10: row.riskLog10,
      maxRiskEstimateLog10: row.maxRiskEstimateLog10,
      missDistanceM: row.missDistanceM,
      relativeSpeedMs: row.relativeSpeedMs,
      mahalanobisDistance: row.mahalanobisDistance,
      objectType: row.objectType,
      targetObsUsed: row.targetObsUsed,
      chaserObsUsed: row.chaserObsUsed,
      targetPositionCovarianceDet: row.targetPositionCovarianceDet,
      chaserPositionCovarianceDet: row.chaserPositionCovarianceDet,
      f10: row.f10,
      ap: row.ap,
    }))
    .sort(
      (left, right) =>
        left.eventId.localeCompare(right.eventId) ||
        right.timeToTcaDays - left.timeToTcaDays ||
        left.riskLog10 - right.riskLog10,
    );
  return stableHash(
    JSON.stringify({
      options: {
        targetOutcome: options.targetOutcome,
        highRiskThresholdLog10: options.highRiskThresholdLog10,
        riskEscalationDeltaLog10: options.riskEscalationDeltaLog10,
        riskIncreaseDeltaLog10: options.riskIncreaseDeltaLog10,
        closeMissDistanceM: options.closeMissDistanceM,
        lowMahalanobisDistance: options.lowMahalanobisDistance,
        highRelativeSpeedMs: options.highRelativeSpeedMs,
        sparseObservationCount: options.sparseObservationCount,
        highAp: options.highAp,
        highF10: options.highF10,
        includeCdmObservedEvent: options.includeCdmObservedEvent,
        includeObjectTypeEvents: options.includeObjectTypeEvents,
        includeUnknownObjectTypeEvent: options.includeUnknownObjectTypeEvent,
        excludeRiskFeatureEvents: options.excludeRiskFeatureEvents,
        eventGapMs: options.eventGapMs,
        minLeadTimeDays: options.minLeadTimeDays,
        splitSeed: options.splitSeed,
        splitRatios: options.splitRatios,
        stratifySplitsByOutcome: options.stratifySplitsByOutcome,
        sourceDomain: options.sourceDomain,
        sourceArtifactHash: options.sourceArtifactHash,
        sampleEventLimit: options.sampleEventLimit,
      },
      rows: normalizedRows,
    }),
  );
}

function meanPrecision(
  patterns: Array<{ supportCount: number; negativeSupportCount: number }>,
): number {
  if (patterns.length === 0) return 0;
  const total = patterns.reduce((sum, pattern) => {
    return (
      sum +
      pattern.supportCount /
        Math.max(1, pattern.supportCount + pattern.negativeSupportCount)
    );
  }, 0);
  return round(total / patterns.length);
}

function isHighCovariance(value: number | null): boolean {
  return value != null && value >= 1e12;
}

function sanitizeToken(value: string): string {
  const sanitized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
  return sanitized.replace(/^_+|_+$/g, "") || "unknown";
}

function sanitizeObjectType(value: string): string {
  const token = sanitizeToken(value);
  if (["unknown", "unk", "null", "none", "na", "n_a"].includes(token)) {
    return "unknown";
  }
  return token;
}

function required(record: Map<string, string>, key: string): string {
  const value = record.get(key);
  if (value == null || value.trim() === "") {
    throw new Error(`Kelvins CSV missing required column ${key}`);
  }
  return value.trim();
}

function requiredNumber(record: Map<string, string>, key: string): number {
  const value = optionalNumber(record, key);
  if (value == null) {
    throw new Error(`Kelvins CSV missing numeric column ${key}`);
  }
  return value;
}

function optionalNumber(record: Map<string, string>, key: string): number | null {
  const value = record.get(key);
  if (value == null || value.trim() === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return parsed;
}

function optionalText(record: Map<string, string>, key: string): string | null {
  const value = record.get(key);
  if (value == null || value.trim() === "") return null;
  return value.trim();
}

function stableHash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function round(value: number): number {
  return Number(value.toFixed(6));
}
