import type {
  ConjunctionView,
  FindingStatus,
  FindingView,
  PayloadView,
  Regime,
  SatelliteView,
  TelemetryView,
} from "@interview/shared/ssa";

export type { FindingStatus, Regime };

export type SourceClass = "osint" | "field" | "derived";

export type EntityClass =
  | "Satellite"
  | "Debris"
  | "Operator"
  | "Payload"
  | "OrbitRegime"
  | "ConjunctionEvent"
  | "Maneuver";

export type TelemetryDTO = TelemetryView;

export type SatelliteDTO = SatelliteView & {
  opacityDeficitReasons?: string[];
};

export type PayloadDTO = PayloadView;

export type ConjunctionDTO = ConjunctionView;

export type KgNodeDTO = {
  id: string;
  label: string;
  class: EntityClass;
  degree: number;
  x: number;
  y: number;
  cortex: string;
};

export type KgEdgeDTO = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  sourceClass: SourceClass;
};

export type FindingDTO = FindingView & {
  swarmConsensus?: { accept: number; reject: number; abstain: number; k: number };
  decisionReason?: string;
};
