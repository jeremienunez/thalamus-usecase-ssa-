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

export type TemporalOrderQuality =
  | "real_time_ordered"
  | "turn_ordered"
  | "same_timestamp_ordered"
  | "synthetic_ordered";

export interface TemporalEvent {
  id: string;
  projection_run_id: string;
  event_type: string;
  event_source: string;
  entity_id?: string;
  sim_run_id?: string;
  fish_index?: number;
  turn_index?: number;
  order_index?: number;
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
  temporal_order_quality?: TemporalOrderQuality;
  canonical_signature?: string;
  source_table: string;
  source_pk: string;
  payload_hash: string;
  metadata?: Record<string, unknown>;
}

export interface TemporalEventSet {
  timestamp: number;
  order_index: number;
  temporal_order_quality: TemporalOrderQuality;
  events: TemporalEvent[];
}

export interface TemporalEpisode {
  episode_id: string;
  entity_id?: string;
  source_domain: TemporalSourceDomain;
  seeded_by_pattern_id?: string;
  event_sets: TemporalEventSet[];
  outcome?: string;
  censoring: "complete" | "right_censored" | "left_censored";
}

export interface STDPParams {
  pattern_window_ms: number;
  pre_trace_decay_ms: number;
  learning_rate: number;
  activation_threshold: number;
  min_support: number;
  max_steps: number;
  max_span_ms?: number;
  max_gap_ms?: number;
  max_candidates_per_window?: number;
  pattern_version: string;
}

export type TemporalProgressStatus = "started" | "progress" | "completed";

export interface TemporalProgressEvent {
  phase: string;
  status: TemporalProgressStatus;
  completed?: number;
  total?: number;
  elapsed_ms: number;
  eta_ms?: number;
  rate_per_sec?: number;
  message?: string;
  counters?: Record<string, string | number | boolean | null>;
}

export type TemporalProgressReporter = (event: TemporalProgressEvent) => void;

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
  pattern_rate: number;
  lift: number;
  best_component_signature?: string | null;
  best_component_rate?: number | null;
  sequence_lift_over_best_component?: number | null;
  lead_time_ms_avg?: number | null;
  lead_time_ms_p50?: number | null;
  lead_time_ms_p95?: number | null;
  temporal_order_quality: TemporalOrderQuality;
  contains_target_proxy: boolean;
  contains_singleton_only: boolean;
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
  progress?: TemporalProgressReporter;
  progress_phase_prefix?: string;
}
