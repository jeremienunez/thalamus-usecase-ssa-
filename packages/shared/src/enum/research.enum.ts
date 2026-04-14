/**
 * Research / Thalamus enums — SSA (Space Situational Awareness) domain.
 *
 * Scope note:
 *   `Research*` names (ResearchCycle, ResearchRelation, ResearchStatus, …)
 *   are deliberately kept. They describe the generic machinery that
 *   produces, links and invalidates findings — that layer is domain-agnostic.
 *
 *   What IS domain-specific is the content those findings point at: cortices,
 *   entities, relations to tactical events. Those values below reflect the
 *   SSA vocabulary (satellites, payloads, conjunctions, maneuvers).
 */

export enum ResearchCortex {
  // Core SSA cortices (see README "Primary build — Space Situational Awareness").
  Catalog = "catalog",
  Observations = "observations",
  ConjunctionAnalysis = "conjunction_analysis",
  Correlation = "correlation",
  ManeuverPlanning = "maneuver_planning",
  // Domain-specific analysts.
  ApogeeTracker = "apogee_tracker",
  DebrisForecaster = "debris_forecaster",
  RegimeProfiler = "regime_profiler",
  FleetAnalyst = "fleet_analyst",
  LaunchScout = "launch_scout",
  AdvisoryRadar = "advisory_radar",
  PayloadProfiler = "payload_profiler",
  BriefingProducer = "briefing_producer",
  TrafficSpotter = "traffic_spotter",
  OrbitSlotOptimizer = "orbit_slot_optimizer",
  ReplacementCostAnalyst = "replacement_cost_analyst",
  MissionCopywriter = "mission_copywriter",
  OrbitalAnalyst = "orbital_analyst",
  // Generic analysts reused across cortices.
  DataAuditor = "data_auditor",
  ClassificationAuditor = "classification_auditor",
  Strategist = "strategist",
}

export enum ResearchFindingType {
  Anomaly = "anomaly",
  Trend = "trend",
  Forecast = "forecast",
  Insight = "insight",
  Alert = "alert",
  Opportunity = "opportunity",
  Strategy = "strategy",
}

export enum ResearchEntityType {
  Satellite = "satellite",
  OperatorCountry = "operator_country",
  Operator = "operator",
  Launch = "launch",
  SatelliteBus = "satellite_bus",
  Payload = "payload",
  OrbitRegime = "orbit_regime",
  ConjunctionEvent = "conjunction_event",
  Maneuver = "maneuver",
  Finding = "finding",
}

export enum ResearchRelation {
  About = "about",
  Compares = "compares",
  CausedBy = "caused_by",
  Affects = "affects",
  Supports = "supports",
  Contradicts = "contradicts",
  SimilarTo = "similar_to",
}

export enum ResearchStatus {
  Active = "active",
  Archived = "archived",
  Invalidated = "invalidated",
}

export enum ResearchUrgency {
  Low = "low",
  Medium = "medium",
  High = "high",
  Critical = "critical",
}

export enum ResearchCycleTrigger {
  Daemon = "daemon",
  User = "user",
  Alert = "alert",
  System = "system",
}

export enum ResearchCycleStatus {
  Running = "running",
  Completed = "completed",
  Failed = "failed",
  Cancelled = "cancelled",
}
