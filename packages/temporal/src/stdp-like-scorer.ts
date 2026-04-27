import { canonicalEventSignature } from "./event-signature";
import { buildOutcomeWindows, sortTemporalEventsStable } from "./episode-windows";
import { containsOrderedEpisode } from "./negative-evidence";
import { temporalPatternHash } from "./pattern-hash";
import type {
  LearnTemporalPatternsInput,
  STDPParams,
  TemporalEvent,
  TemporalPatternHypothesis,
  TemporalPatternScoreComponents,
  TemporalSourceDomain,
} from "./types";

interface CandidateAccumulator {
  sequence: string[];
  supportWindows: Set<string>;
  exampleEventIds: Set<string>;
  temporalWeight: number;
  deltaByStep: number[];
}

interface NegativeSupport {
  count: number;
  eventIds: Set<string>;
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

  for (const sourceDomain of domains) {
    const domainEvents = learningEventsForDomain(input.events, sourceDomain);
    for (const terminalStatus of targetOutcomes) {
      patterns.push(
        ...learnForOutcome({
          events: domainEvents,
          params: input.params,
          sourceDomain,
          terminalStatus,
        }),
      );
    }
  }

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

  const candidates = collectPositiveCandidates(windows, input.params);
  const baselineRate = windows.length / comparableOutcomeCount;
  const negatives = collectNegativeSupport({
    events: input.events,
    terminalStatus: input.terminalStatus,
    patternWindowMs: input.params.pattern_window_ms,
    candidates,
  });

  return [...candidates.values()].flatMap((candidate) => {
    const negative = negatives.get(candidate.sequence.join("\u001f")) ?? {
      count: 0,
      eventIds: new Set<string>(),
    };
    const supportCount = candidate.supportWindows.size;
    const observedRate =
      supportCount / Math.max(1, supportCount + negative.count);
    const lift = observedRate / Math.max(0.000001, baselineRate);
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
      return [];
    }

    const hash = temporalPatternHash({
      pattern_version: input.params.pattern_version,
      source_domain: input.sourceDomain,
      terminal_status: input.terminalStatus,
      pattern_window_ms: input.params.pattern_window_ms,
      sequence: candidate.sequence,
    });

    return [
      {
        pattern_id: hash,
        pattern_hash: hash,
        pattern_version: input.params.pattern_version,
        status: "reviewable",
        source_domain: input.sourceDomain,
        terminal_status: input.terminalStatus,
        pattern_window_ms: input.params.pattern_window_ms,
        pattern_score: patternScore,
        support_count: supportCount,
        negative_support_count: negative.count,
        baseline_rate: roundScore(baselineRate),
        lift: roundScore(lift),
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
      } satisfies TemporalPatternHypothesis,
    ];
  });
}

function collectPositiveCandidates(
  windows: ReturnType<typeof buildOutcomeWindows>,
  params: STDPParams,
): Map<string, CandidateAccumulator> {
  const candidates = new Map<string, CandidateAccumulator>();

  for (const window of windows) {
    const orderedPreEvents = sortTemporalEventsStable(window.preEvents);
    for (const episode of suffixEpisodes(orderedPreEvents, params.max_steps)) {
      const sequence = episode.map(canonicalEventSignature);
      const key = sequence.join("\u001f");
      const existing =
        candidates.get(key) ??
        {
          sequence,
          supportWindows: new Set<string>(),
          exampleEventIds: new Set<string>(),
          temporalWeight: 0,
          deltaByStep: Array.from({ length: sequence.length }, () => 0),
        };
      existing.supportWindows.add(window.outcome.id);
      let episodeWeight = 0;
      episode.forEach((event, index) => {
        const delta = window.outcome.timestamp - event.timestamp;
        episodeWeight += Math.exp(-delta / params.pre_trace_decay_ms);
        existing.deltaByStep[index] += delta;
        existing.exampleEventIds.add(event.id);
      });
      existing.temporalWeight += episodeWeight / episode.length;
      candidates.set(key, existing);
    }
  }

  return candidates;
}

function collectNegativeSupport(input: {
  events: TemporalEvent[];
  terminalStatus: string;
  patternWindowMs: number;
  candidates: Map<string, CandidateAccumulator>;
}): Map<string, NegativeSupport> {
  const supports = new Map<string, NegativeSupport>();
  const otherOutcomeWindows = input.events
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

  for (const [key, candidate] of input.candidates) {
    const negative: NegativeSupport = { count: 0, eventIds: new Set<string>() };
    for (const window of otherOutcomeWindows) {
      if (!containsOrderedEpisode(window.preEvents, candidate.sequence)) continue;
      negative.count += 1;
      for (const event of window.preEvents) {
        negative.eventIds.add(event.id);
      }
    }
    supports.set(key, negative);
  }

  return supports;
}

function suffixEpisodes(events: TemporalEvent[], maxSteps: number): TemporalEvent[][] {
  const capped = events.slice(-maxSteps);
  const episodes: TemporalEvent[][] = [];
  for (let length = 1; length <= capped.length; length += 1) {
    episodes.push(capped.slice(capped.length - length));
  }
  return episodes;
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
}

function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function roundScore(value: number): number {
  return Number(value.toFixed(6));
}
