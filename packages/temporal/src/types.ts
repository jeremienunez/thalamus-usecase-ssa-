export type TemporalSourceDomain =
  | "production"
  | "simulation"
  | "simulation_seeded"
  | "mixed";

export type TemporalPatternStatus =
  | "candidate"
  | "reviewable"
  | "accepted"
  | "rejected"
  | "deprecated";

export interface TemporalEvent {
  id: string;
  projection_run_id: string;
  event_type: string;
  event_source: string;
  entity_id?: string;
  sim_run_id?: string;
  fish_index?: number;
  turn_index?: number;
  timestamp: number;
  agent_id?: string;
  action_kind?: string;
  confidence_before?: number;
  confidence_after?: number;
  review_outcome?: string;
  terminal_status?: string;
  embedding_id?: string;
  seeded_by_pattern_id?: string;
  source_domain: TemporalSourceDomain;
  canonical_signature?: string;
  source_table: string;
  source_pk: string;
  payload_hash: string;
  metadata?: Record<string, unknown>;
}

export interface STDPParams {
  pattern_window_ms: number;
  pre_trace_decay_ms: number;
  learning_rate: number;
  activation_threshold: number;
  min_support: number;
  max_steps: number;
  pattern_version: string;
}

export interface TemporalPatternStep {
  step_index: number;
  event_signature: string;
  avg_delta_ms: number;
  support_count: number;
}

export interface TemporalPatternScoreComponents {
  temporal_weight: number;
  support_factor: number;
  lift_factor: number;
  negative_penalty: number;
  stability_factor: number;
}

export interface TemporalPatternHypothesis {
  pattern_id: string;
  pattern_hash: string;
  pattern_version: string;
  status: TemporalPatternStatus;
  source_domain: TemporalSourceDomain;
  terminal_status: string;
  pattern_window_ms: number;
  pattern_score: number;
  support_count: number;
  negative_support_count: number;
  baseline_rate: number;
  lift: number;
  sources: string[];
  example_event_ids: string[];
  counterexample_event_ids: string[];
  sequence: TemporalPatternStep[];
  score_components: TemporalPatternScoreComponents;
  hypothesis: true;
  decisionAuthority: false;
}

export interface LearnTemporalPatternsInput {
  events: TemporalEvent[];
  params: STDPParams;
  source_domain?: Exclude<TemporalSourceDomain, "mixed">;
  target_outcomes?: string[];
}
