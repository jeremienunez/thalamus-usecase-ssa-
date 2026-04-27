import {
  canonicalEventSignature,
  canonicalTemporalEventId,
  learnTemporalPatterns,
  sortTemporalEventsStable,
  temporalPatternHash,
  type STDPParams,
  type TemporalEvent,
} from "../src";

const baseParams: STDPParams = {
  pattern_window_ms: 1_000,
  pre_trace_decay_ms: 1_000,
  learning_rate: 0.1,
  activation_threshold: 0.25,
  min_support: 2,
  max_steps: 2,
  pattern_version: "temporal-v0.2.0",
};

describe("Temporal Hypothesis Layer DoD edge cases", () => {
  it("sorts equal timestamps by id before mining episodes", () => {
    const events = [
      event({ id: "b", timestamp: 10, event_type: "agent.reject" }),
      event({ id: "a", timestamp: 10, event_type: "agent.timeout" }),
      event({ id: "c", timestamp: 11, event_type: "fish.sim_run_completed" }),
    ];

    expect(sortTemporalEventsStable(events).map((item) => item.id)).toEqual([
      "a",
      "b",
      "c",
    ]);
  });

  it("creates deterministic projection ids from source identity", () => {
    const first = canonicalTemporalEventId({
      source_table: "sim_review_evidence",
      source_pk: "42",
      event_type: "review.missing_relative_velocity",
    });
    const second = canonicalTemporalEventId({
      source_table: "sim_review_evidence",
      source_pk: "42",
      event_type: "review.missing_relative_velocity",
    });

    expect(first).toBe(second);
    expect(first).toHaveLength(64);
  });

  it("excludes entity_id and agent_id from the default signature", () => {
    const left = event({
      event_type: "agent.timeout",
      event_source: "agent",
      action_kind: "tool_call",
      terminal_status: "timeout",
      entity_id: "sat-1",
      agent_id: "agent-a",
    });
    const right = event({
      event_type: "agent.timeout",
      event_source: "agent",
      action_kind: "tool_call",
      terminal_status: "timeout",
      entity_id: "sat-2",
      agent_id: "agent-b",
    });

    expect(canonicalEventSignature(left)).toBe(canonicalEventSignature(right));
  });

  it("uses none for missing action_kind and terminal_status", () => {
    expect(
      canonicalEventSignature(
        event({
          event_type: "embedding.attached",
          event_source: "embedding",
          action_kind: undefined,
          terminal_status: undefined,
        }),
      ),
    ).toBe("embedding.attached|embedding|none|none");
  });

  it("returns identical pattern hashes for identical inputs and params", () => {
    const events = [
      ...positiveEpisode("a", 1_000, "timeout"),
      ...positiveEpisode("b", 2_000, "timeout"),
    ];

    const first = learnTemporalPatterns({
      events,
      params: baseParams,
      source_domain: "production",
      target_outcomes: ["timeout"],
    });
    const second = learnTemporalPatterns({
      events,
      params: baseParams,
      source_domain: "production",
      target_outcomes: ["timeout"],
    });

    expect(first.map((pattern) => pattern.pattern_hash)).toEqual(
      second.map((pattern) => pattern.pattern_hash),
    );
  });

  it("separates the same sequence by terminal outcome", () => {
    const events = [
      ...positiveEpisode("timeout-1", 1_000, "timeout"),
      ...positiveEpisode("timeout-2", 2_000, "timeout"),
      ...positiveEpisode("reject-1", 3_000, "reject"),
      ...positiveEpisode("reject-2", 4_000, "reject"),
    ];

    const patterns = learnTemporalPatterns({
      events,
      params: baseParams,
      source_domain: "production",
      target_outcomes: ["timeout", "reject"],
    });

    expect(new Set(patterns.map((pattern) => pattern.terminal_status))).toEqual(
      new Set(["timeout", "reject"]),
    );
  });

  it("filters sequences with support below min_support", () => {
    const patterns = learnTemporalPatterns({
      events: positiveEpisode("single", 1_000, "timeout"),
      params: { ...baseParams, min_support: 2 },
      source_domain: "production",
      target_outcomes: ["timeout"],
    });

    expect(patterns).toHaveLength(0);
  });

  it("penalizes frequent sequences that appear without the target outcome", () => {
    const cleanPatterns = learnTemporalPatterns({
      events: [
        ...positiveEpisode("a", 1_000, "timeout"),
        ...positiveEpisode("b", 2_000, "timeout"),
      ],
      params: baseParams,
      source_domain: "production",
      target_outcomes: ["timeout"],
    });
    const noisyPatterns = learnTemporalPatterns({
      events: [
        ...positiveEpisode("a", 1_000, "timeout"),
        ...positiveEpisode("b", 2_000, "timeout"),
        ...positiveEpisode("c", 3_000, "reject"),
        ...positiveEpisode("d", 4_000, "reject"),
        ...positiveEpisode("e", 5_000, "reject"),
      ],
      params: baseParams,
      source_domain: "production",
      target_outcomes: ["timeout"],
    });

    expect(cleanPatterns[0]?.negative_support_count).toBe(0);
    expect(noisyPatterns[0]?.negative_support_count).toBeGreaterThan(0);
    expect(noisyPatterns[0]?.pattern_score).toBeLessThan(
      cleanPatterns[0]?.pattern_score ?? 0,
    );
  });

  it("excludes simulation_seeded events from production learning", () => {
    const patterns = learnTemporalPatterns({
      events: [
        ...positiveEpisode("seeded-a", 1_000, "timeout", {
          source_domain: "simulation_seeded",
          seeded_by_pattern_id: "pattern-1",
        }),
        ...positiveEpisode("seeded-b", 2_000, "timeout", {
          source_domain: "simulation_seeded",
          seeded_by_pattern_id: "pattern-1",
        }),
      ],
      params: baseParams,
      source_domain: "production",
      target_outcomes: ["timeout"],
    });

    expect(patterns).toHaveLength(0);
  });

  it("keeps simulation_seeded patterns in their own domain", () => {
    const patterns = learnTemporalPatterns({
      events: [
        ...positiveEpisode("seeded-a", 1_000, "timeout", {
          source_domain: "simulation_seeded",
          seeded_by_pattern_id: "pattern-1",
        }),
        ...positiveEpisode("seeded-b", 2_000, "timeout", {
          source_domain: "simulation_seeded",
          seeded_by_pattern_id: "pattern-1",
        }),
      ],
      params: baseParams,
      source_domain: "simulation_seeded",
      target_outcomes: ["timeout"],
    });

    expect(patterns[0]?.source_domain).toBe("simulation_seeded");
  });

  it("changes pattern hashes when pattern_version changes", () => {
    const sequence = [
      "fish.high_uncertainty|fish|none|none",
      "review.missing_relative_velocity|review|none|none",
    ];
    const first = temporalPatternHash({
      pattern_version: "temporal-v0.2.0",
      source_domain: "production",
      terminal_status: "timeout",
      pattern_window_ms: 1_000,
      sequence,
    });
    const second = temporalPatternHash({
      pattern_version: "temporal-v0.3.0",
      source_domain: "production",
      terminal_status: "timeout",
      pattern_window_ms: 1_000,
      sequence,
    });

    expect(first).not.toBe(second);
  });

  it("requires pattern_version before learning starts", () => {
    expect(() =>
      learnTemporalPatterns({
        events: [],
        params: { ...baseParams, pattern_version: "" },
      }),
    ).toThrow("pattern_version is required");
  });
});

function positiveEpisode(
  prefix: string,
  outcomeTimestamp: number,
  terminalStatus: string,
  overrides: Partial<TemporalEvent> = {},
): TemporalEvent[] {
  return [
    event({
      id: `${prefix}-a`,
      timestamp: outcomeTimestamp - 200,
      event_type: "fish.high_uncertainty",
      event_source: "fish",
      ...overrides,
      terminal_status: undefined,
    }),
    event({
      id: `${prefix}-b`,
      timestamp: outcomeTimestamp - 100,
      event_type: "review.missing_relative_velocity",
      event_source: "review",
      ...overrides,
      terminal_status: undefined,
    }),
    event({
      id: `${prefix}-outcome`,
      timestamp: outcomeTimestamp,
      event_type: `outcome.${terminalStatus}`,
      event_source: "outcome",
      ...overrides,
      terminal_status: terminalStatus,
    }),
  ];
}

function event(input: Partial<TemporalEvent>): TemporalEvent {
  const id = input.id ?? `${input.event_type ?? "event"}-${input.timestamp ?? 0}`;
  return {
    id,
    projection_run_id: "projection-1",
    event_type: input.event_type ?? "fish.high_uncertainty",
    event_source: input.event_source ?? "fish",
    timestamp: input.timestamp ?? 0,
    source_domain: input.source_domain ?? "production",
    source_table: input.source_table ?? "fixture",
    source_pk: input.source_pk ?? id,
    payload_hash: input.payload_hash ?? `payload-${id}`,
    ...input,
  };
}
