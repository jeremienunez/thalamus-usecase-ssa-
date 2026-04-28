import {
  preEventSignature,
  signatureContainsTargetProxy,
} from "./event-signature";
import {
  buildOutcomeWindows,
  sortTemporalEventsStable,
} from "./episode-windows";
import { containsOrderedEpisode } from "./negative-evidence";
import { temporalPatternHash } from "./pattern-hash";
import { startTemporalProgressPhase } from "./progress";
import { mineOrderedTemporalEpisodes } from "./temporal-episode-miner";
import type {
  LearnTemporalPatternsInput,
  STDPParams,
  TemporalEvent,
  TemporalPatternHypothesis,
  TemporalProgressReporter,
  TemporalPatternScoreComponents,
  TemporalSourceDomain,
} from "./types";

interface CandidateAccumulator {
  sequence: string[];
  supportWindows: Set<string>;
  exampleEventIds: Set<string>;
  temporalWeight: number;
  deltaByStep: number[];
  leadTimes: number[];
  temporalOrderQuality: TemporalPatternHypothesis["temporal_order_quality"];
  containsTargetProxy: boolean;
}

interface NegativeSupport {
  count: number;
  eventIds: Set<string>;
}

interface ComponentEvidence {
  signature: string;
  positive: number;
  negative: number;
  rate: number;
}

const DEFAULT_TARGET_OUTCOMES = [
  "reject",
  "timeout",
  "anomaly",
  "promotion",
  "drift",
  "resolved",
  "pc_low",
  "pc_high",
];

export function learnTemporalPatterns(
  input: LearnTemporalPatternsInput,
): TemporalPatternHypothesis[] {
  assertParams(input.params);
  const domains = input.source_domain
    ? [input.source_domain]
    : uniqueDomains(input.events).filter((domain) => domain !== "mixed");
  const targetOutcomes = input.target_outcomes ?? DEFAULT_TARGET_OUTCOMES;
  const patterns: TemporalPatternHypothesis[] = [];
  const phasePrefix = input.progress_phase_prefix ?? "temporal.learn";
  const outcomeTracker = startTemporalProgressPhase({
    phase: `${phasePrefix}.outcomes`,
    reporter: input.progress,
    total: domains.length * targetOutcomes.length,
    message: "learn temporal patterns by domain and target outcome",
  });
  let completedOutcomes = 0;

  for (const sourceDomain of domains) {
    const domainEvents = learningEventsForDomain(input.events, sourceDomain);
    for (const terminalStatus of targetOutcomes) {
      const learned = learnForOutcome({
        events: domainEvents,
        params: input.params,
        sourceDomain,
        terminalStatus,
        progress: input.progress,
        phasePrefix: `${phasePrefix}.${sourceDomain}.${terminalStatus}`,
      });
      patterns.push(...learned);
      completedOutcomes += 1;
      outcomeTracker.progress(completedOutcomes, {
        patterns: patterns.length,
        events: domainEvents.length,
      });
    }
  }
  outcomeTracker.complete({ patterns: patterns.length });

  return patterns.sort(
    (left, right) =>
      right.pattern_score - left.pattern_score ||
      left.pattern_hash.localeCompare(right.pattern_hash),
  );
}

function learnForOutcome(input: {
  events: TemporalEvent[];
  params: STDPParams;
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">;
  terminalStatus: string;
  progress?: TemporalProgressReporter;
  phasePrefix: string;
}): TemporalPatternHypothesis[] {
  const windows = buildOutcomeWindows(
    input.events,
    input.terminalStatus,
    input.params.pattern_window_ms,
  );
  const comparableOutcomeCount = input.events.filter(
    (event) => event.terminal_status != null,
  ).length;
  if (windows.length === 0 || comparableOutcomeCount === 0) return [];

  const candidates = collectPositiveCandidates({
    windows,
    params: input.params,
    progress: input.progress,
    phasePrefix: input.phasePrefix,
  });
  const baselineRate = windows.length / comparableOutcomeCount;
  const otherOutcomeWindows = buildOtherOutcomeWindows({
    events: input.events,
    terminalStatus: input.terminalStatus,
    patternWindowMs: input.params.pattern_window_ms,
  });
  const negatives = collectNegativeSupport({
    otherOutcomeWindows,
    candidates,
    params: input.params,
    progress: input.progress,
    phasePrefix: input.phasePrefix,
  });
  const componentEvidence = collectComponentEvidence({
    positiveWindows: windows,
    negativeWindows: otherOutcomeWindows,
  });
  const materializeTracker = startTemporalProgressPhase({
    phase: `${input.phasePrefix}.materialize`,
    reporter: input.progress,
    total: candidates.size,
    message: "score and materialize temporal hypotheses",
  });
  const hypotheses: TemporalPatternHypothesis[] = [];
  let materializedCandidates = 0;

  for (const candidate of candidates.values()) {
    const negative = negatives.get(candidate.sequence.join("\u001f")) ?? {
      count: 0,
      eventIds: new Set<string>(),
    };
    const supportCount = candidate.supportWindows.size;
    const patternRate =
      supportCount / Math.max(1, supportCount + negative.count);
    const lift = patternRate / Math.max(0.000001, baselineRate);
    const bestComponent = bestComponentForSequence(
      candidate.sequence,
      componentEvidence,
    );
    const sequenceLiftOverBestComponent =
      bestComponent == null ? null : patternRate - bestComponent.rate;
    const leadTime = leadTimeStats(candidate.leadTimes);
    const components = scoreComponents({
      temporalWeight: candidate.temporalWeight / supportCount,
      supportCount,
      negativeSupportCount: negative.count,
      lift,
      params: input.params,
    });
    const patternScore = roundScore(
      components.temporal_weight *
        components.support_factor *
        components.lift_factor *
        components.negative_penalty *
        components.stability_factor,
    );

    if (
      supportCount < input.params.min_support ||
      patternScore < input.params.activation_threshold
    ) {
      materializedCandidates += 1;
      materializeTracker.progress(materializedCandidates, {
        patterns: hypotheses.length,
      });
      continue;
    }

    const hash = temporalPatternHash({
      pattern_version: input.params.pattern_version,
      source_domain: input.sourceDomain,
      terminal_status: input.terminalStatus,
      pattern_window_ms: input.params.pattern_window_ms,
      sequence: candidate.sequence,
    });

    hypotheses.push({
      pattern_id: hash,
      pattern_hash: hash,
      pattern_version: input.params.pattern_version,
      status: candidate.sequence.length === 1 ? "candidate" : "reviewable",
      source_domain: input.sourceDomain,
      terminal_status: input.terminalStatus,
      pattern_window_ms: input.params.pattern_window_ms,
      pattern_score: patternScore,
      support_count: supportCount,
      negative_support_count: negative.count,
      baseline_rate: roundScore(baselineRate),
      pattern_rate: roundScore(patternRate),
      lift: roundScore(lift),
      best_component_signature: bestComponent?.signature ?? null,
      best_component_rate: bestComponent ? roundScore(bestComponent.rate) : null,
      sequence_lift_over_best_component:
        sequenceLiftOverBestComponent == null
          ? null
          : roundScore(sequenceLiftOverBestComponent),
      lead_time_ms_avg: leadTime.avg,
      lead_time_ms_p50: leadTime.p50,
      lead_time_ms_p95: leadTime.p95,
      temporal_order_quality: candidate.temporalOrderQuality,
      contains_target_proxy: candidate.containsTargetProxy,
      contains_singleton_only: candidate.sequence.length === 1,
      sources: sortedUnique(
        candidate.sequence.map((signature) => signature.split("|")[1] ?? "unknown"),
      ),
      example_event_ids: sortedUnique([...candidate.exampleEventIds]),
      counterexample_event_ids: sortedUnique([...negative.eventIds]),
      sequence: candidate.sequence.map((eventSignature, index) => ({
        step_index: index,
        event_signature: eventSignature,
        avg_delta_ms: Math.round(candidate.deltaByStep[index] / supportCount),
        support_count: supportCount,
      })),
      score_components: components,
      hypothesis: true,
      decisionAuthority: false,
    });
    materializedCandidates += 1;
    materializeTracker.progress(materializedCandidates, {
      patterns: hypotheses.length,
    });
  }
  materializeTracker.complete({ patterns: hypotheses.length });
  return hypotheses;
}

function collectPositiveCandidates(input: {
  windows: ReturnType<typeof buildOutcomeWindows>;
  params: STDPParams;
  progress?: TemporalProgressReporter;
  phasePrefix: string;
}): Map<string, CandidateAccumulator> {
  const candidates = new Map<string, CandidateAccumulator>();
  const tracker = startTemporalProgressPhase({
    phase: `${input.phasePrefix}.positive_candidates`,
    reporter: input.progress,
    total: input.windows.length,
    message: "mine positive temporal episodes",
  });

  input.windows.forEach((window, windowIndex) => {
    const orderedPreEvents = sortTemporalEventsStable(window.preEvents);
    for (const minedEpisode of mineOrderedTemporalEpisodes(orderedPreEvents, {
      max_steps: input.params.max_steps,
      max_span_ms: input.params.max_span_ms ?? input.params.pattern_window_ms,
      max_gap_ms: input.params.max_gap_ms,
      max_candidates_per_window: input.params.max_candidates_per_window,
    })) {
      const episode = minedEpisode.events;
      const sequence = minedEpisode.sequence;
      const key = minedEpisode.key;
      const existing =
        candidates.get(key) ??
        {
          sequence,
          supportWindows: new Set<string>(),
          exampleEventIds: new Set<string>(),
          temporalWeight: 0,
          deltaByStep: Array.from({ length: sequence.length }, () => 0),
          leadTimes: [],
          temporalOrderQuality: minedEpisode.temporal_order_quality,
          containsTargetProxy: sequence.some(signatureContainsTargetProxy),
        };
      existing.supportWindows.add(window.outcome.id);
      let episodeWeight = 0;
      episode.forEach((event, index) => {
        const delta = window.outcome.timestamp - event.timestamp;
        episodeWeight += Math.exp(-delta / input.params.pre_trace_decay_ms);
        existing.deltaByStep[index] += delta;
        existing.exampleEventIds.add(event.id);
      });
      existing.temporalWeight += episodeWeight / episode.length;
      existing.leadTimes.push(window.outcome.timestamp - episode[0]!.timestamp);
      existing.temporalOrderQuality = mergeTemporalOrderQuality(
        existing.temporalOrderQuality,
        minedEpisode.temporal_order_quality,
      );
      existing.containsTargetProxy =
        existing.containsTargetProxy || sequence.some(signatureContainsTargetProxy);
      candidates.set(key, existing);
    }
    tracker.progress(windowIndex + 1, { candidates: candidates.size });
  });
  tracker.complete({ candidates: candidates.size });

  return candidates;
}

function collectNegativeSupport(input: {
  otherOutcomeWindows: Array<{ outcome: TemporalEvent; preEvents: TemporalEvent[] }>;
  candidates: Map<string, CandidateAccumulator>;
  params: STDPParams;
  progress?: TemporalProgressReporter;
  phasePrefix: string;
}): Map<string, NegativeSupport> {
  const supports = new Map<string, NegativeSupport>();
  const tracker = startTemporalProgressPhase({
    phase: `${input.phasePrefix}.negative_evidence`,
    reporter: input.progress,
    total: input.candidates.size,
    message: "count negative evidence for candidate episodes",
  });
  let completedCandidates = 0;

  for (const [key, candidate] of input.candidates) {
    const negative: NegativeSupport = { count: 0, eventIds: new Set<string>() };
    for (const window of input.otherOutcomeWindows) {
      if (
        !containsOrderedEpisode(window.preEvents, candidate.sequence, {
          max_span_ms: input.params.max_span_ms ?? input.params.pattern_window_ms,
          max_gap_ms: input.params.max_gap_ms,
        })
      ) {
        continue;
      }
      negative.count += 1;
      for (const event of window.preEvents) {
        negative.eventIds.add(event.id);
      }
    }
    supports.set(key, negative);
    completedCandidates += 1;
    tracker.progress(completedCandidates, {
      candidates: input.candidates.size,
      negative_windows: input.otherOutcomeWindows.length,
      supports: supports.size,
    });
  }
  tracker.complete({ supports: supports.size });

  return supports;
}

function buildOtherOutcomeWindows(input: {
  events: TemporalEvent[];
  terminalStatus: string;
  patternWindowMs: number;
}): Array<{ outcome: TemporalEvent; preEvents: TemporalEvent[] }> {
  return input.events
    .filter(
      (event) =>
        event.terminal_status != null &&
        event.terminal_status !== input.terminalStatus,
    )
    .map((outcome) => ({
      outcome,
      preEvents: input.events.filter(
        (event) =>
          event.timestamp >= outcome.timestamp - input.patternWindowMs &&
          event.timestamp < outcome.timestamp &&
          event.id !== outcome.id,
      ),
    }));
}

function collectComponentEvidence(input: {
  positiveWindows: ReturnType<typeof buildOutcomeWindows>;
  negativeWindows: Array<{ outcome: TemporalEvent; preEvents: TemporalEvent[] }>;
}): Map<string, ComponentEvidence> {
  const counts = new Map<string, { positive: number; negative: number }>();
  for (const window of input.positiveWindows) {
    for (const signature of signaturesInWindow(window.preEvents)) {
      const count = counts.get(signature) ?? { positive: 0, negative: 0 };
      count.positive += 1;
      counts.set(signature, count);
    }
  }
  for (const window of input.negativeWindows) {
    for (const signature of signaturesInWindow(window.preEvents)) {
      const count = counts.get(signature) ?? { positive: 0, negative: 0 };
      count.negative += 1;
      counts.set(signature, count);
    }
  }

  return new Map(
    [...counts.entries()].map(([signature, count]) => [
      signature,
      {
        signature,
        positive: count.positive,
        negative: count.negative,
        rate: count.positive / Math.max(1, count.positive + count.negative),
      },
    ]),
  );
}

function signaturesInWindow(events: TemporalEvent[]): Set<string> {
  return new Set(
    events
      .filter((event) => event.terminal_status == null)
      .map((event) => preEventSignature(event)),
  );
}

function bestComponentForSequence(
  sequence: string[],
  evidence: Map<string, ComponentEvidence>,
): ComponentEvidence | null {
  const [best] = sequence
    .map((signature) => evidence.get(signature))
    .filter((row): row is ComponentEvidence => row != null)
    .sort((left, right) => {
      if (right.rate !== left.rate) return right.rate - left.rate;
      if (right.positive !== left.positive) return right.positive - left.positive;
      return left.signature.localeCompare(right.signature);
    });
  return best ?? null;
}

function mergeTemporalOrderQuality(
  left: TemporalPatternHypothesis["temporal_order_quality"],
  right: TemporalPatternHypothesis["temporal_order_quality"],
): TemporalPatternHypothesis["temporal_order_quality"] {
  const rank = {
    real_time_ordered: 0,
    turn_ordered: 1,
    same_timestamp_ordered: 2,
    synthetic_ordered: 3,
  } satisfies Record<TemporalPatternHypothesis["temporal_order_quality"], number>;
  return rank[right] > rank[left] ? right : left;
}

function leadTimeStats(values: number[]): {
  avg: number | null;
  p50: number | null;
  p95: number | null;
} {
  if (values.length === 0) return { avg: null, p50: null, p95: null };
  const sorted = [...values].sort((left, right) => left - right);
  const avg = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
  return {
    avg: Math.round(avg),
    p50: Math.round(percentile(sorted, 0.5)),
    p95: Math.round(percentile(sorted, 0.95)),
  };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor((sorted.length - 1) * p)),
  );
  return sorted[index]!;
}

function scoreComponents(input: {
  temporalWeight: number;
  supportCount: number;
  negativeSupportCount: number;
  lift: number;
  params: STDPParams;
}): TemporalPatternScoreComponents {
  const supportFactor = Math.min(1, input.supportCount / input.params.min_support);
  const liftFactor = Math.min(1, Math.log1p(Math.max(0, input.lift)) / Math.log1p(2));
  const negativePenalty =
    input.supportCount / Math.max(1, input.supportCount + input.negativeSupportCount);
  return {
    temporal_weight: roundScore(
      Math.min(1, input.temporalWeight * (1 + input.params.learning_rate)),
    ),
    support_factor: roundScore(supportFactor),
    lift_factor: roundScore(liftFactor),
    negative_penalty: roundScore(negativePenalty),
    stability_factor: 1,
  };
}

function learningEventsForDomain(
  events: TemporalEvent[],
  sourceDomain: Exclude<TemporalSourceDomain, "mixed">,
): TemporalEvent[] {
  return events.filter((event) => {
    if (sourceDomain === "production") {
      return event.source_domain === "production" && !event.seeded_by_pattern_id;
    }
    return event.source_domain === sourceDomain;
  });
}

function uniqueDomains(events: TemporalEvent[]): TemporalSourceDomain[] {
  return sortedUnique(events.map((event) => event.source_domain)) as TemporalSourceDomain[];
}

function assertParams(params: STDPParams): void {
  if (!params.pattern_version.trim()) {
    throw new Error("pattern_version is required for deterministic THL scoring");
  }
  if (params.pattern_window_ms <= 0) throw new Error("pattern_window_ms must be positive");
  if (params.pre_trace_decay_ms <= 0) throw new Error("pre_trace_decay_ms must be positive");
  if (params.learning_rate <= 0) throw new Error("learning_rate must be positive");
  if (params.min_support <= 0) throw new Error("min_support must be positive");
  if (params.max_steps <= 0) throw new Error("max_steps must be positive");
  if (params.max_span_ms != null && params.max_span_ms < 0) {
    throw new Error("max_span_ms must be non-negative");
  }
  if (params.max_gap_ms != null && params.max_gap_ms < 0) {
    throw new Error("max_gap_ms must be non-negative");
  }
  if (
    params.max_candidates_per_window != null &&
    params.max_candidates_per_window <= 0
  ) {
    throw new Error("max_candidates_per_window must be positive");
  }
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
