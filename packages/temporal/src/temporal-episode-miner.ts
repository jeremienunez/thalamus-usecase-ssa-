import { preEventSignature } from "./event-signature";
import {
  sortTemporalEventsStable,
  temporalOrderQualityForEvents,
} from "./episode-windows";
import type { TemporalEvent, TemporalOrderQuality } from "./types";

export interface TemporalEpisodeMiningOptions {
  max_steps: number;
  max_span_ms?: number;
  max_gap_ms?: number;
  max_candidates_per_window?: number;
}

export interface MinedTemporalEpisode {
  key: string;
  sequence: string[];
  events: TemporalEvent[];
  temporal_order_quality: TemporalOrderQuality;
}

export function mineOrderedTemporalEpisodes(
  events: TemporalEvent[],
  options: TemporalEpisodeMiningOptions,
): MinedTemporalEpisode[] {
  assertMiningOptions(options);
  const ordered = sortTemporalEventsStable(events).filter(
    (event) => event.terminal_status == null,
  );
  const maxSteps = Math.trunc(options.max_steps);
  const maxSpanMs = options.max_span_ms ?? Number.POSITIVE_INFINITY;
  const maxGapMs = options.max_gap_ms ?? Number.POSITIVE_INFINITY;
  const maxCandidates = options.max_candidates_per_window ?? 5_000;
  const episodes: MinedTemporalEpisode[] = [];
  const seen = new Set<string>();

  for (let index = 0; index < ordered.length; index += 1) {
    extendEpisode({
      ordered,
      current: [ordered[index]!],
      nextIndex: index + 1,
      maxSteps,
      maxSpanMs,
      maxGapMs,
      maxCandidates,
      seen,
      episodes,
    });
    if (episodes.length >= maxCandidates) break;
  }

  return episodes;
}

function extendEpisode(input: {
  ordered: TemporalEvent[];
  current: TemporalEvent[];
  nextIndex: number;
  maxSteps: number;
  maxSpanMs: number;
  maxGapMs: number;
  maxCandidates: number;
  seen: Set<string>;
  episodes: MinedTemporalEpisode[];
}): void {
  addEpisode(input.current, input.seen, input.episodes);
  if (
    input.current.length >= input.maxSteps ||
    input.episodes.length >= input.maxCandidates
  ) {
    return;
  }

  const first = input.current[0]!;
  const previous = input.current[input.current.length - 1]!;
  for (
    let index = input.nextIndex;
    index < input.ordered.length && input.episodes.length < input.maxCandidates;
    index += 1
  ) {
    const next = input.ordered[index]!;
    if (next.timestamp - first.timestamp > input.maxSpanMs) break;
    if (next.timestamp - previous.timestamp > input.maxGapMs) break;
    input.current.push(next);
    extendEpisode({
      ...input,
      current: input.current,
      nextIndex: index + 1,
    });
    input.current.pop();
  }
}

function addEpisode(
  events: TemporalEvent[],
  seen: Set<string>,
  episodes: MinedTemporalEpisode[],
): void {
  const sequence = events.map(preEventSignature);
  const key = sequence.join("\u001f");
  if (seen.has(key)) return;
  seen.add(key);
  episodes.push({
    key,
    sequence,
    events: [...events],
    temporal_order_quality: temporalOrderQualityForEvents(events),
  });
}

function assertMiningOptions(options: TemporalEpisodeMiningOptions): void {
  if (options.max_steps <= 0) throw new Error("max_steps must be positive");
  if (options.max_span_ms != null && options.max_span_ms < 0) {
    throw new Error("max_span_ms must be non-negative");
  }
  if (options.max_gap_ms != null && options.max_gap_ms < 0) {
    throw new Error("max_gap_ms must be non-negative");
  }
  if (
    options.max_candidates_per_window != null &&
    options.max_candidates_per_window <= 0
  ) {
    throw new Error("max_candidates_per_window must be positive");
  }
}
