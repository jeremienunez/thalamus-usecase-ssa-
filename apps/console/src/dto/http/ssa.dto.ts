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

export type TelemetryDto = TelemetryView;

export type SatelliteDto = SatelliteView & {
  opacityDeficitReasons?: string[];
};

export type PayloadDto = PayloadView;

export type ConjunctionDto = ConjunctionView;

export type KgNodeDto = {
  id: string;
  label: string;
  class: EntityClass;
  degree: number;
  x: number;
  y: number;
  cortex: string;
};

export type KgEdgeDto = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  sourceClass: SourceClass;
};

export type FindingDto = FindingView & {
  swarmConsensus?: { accept: number; reject: number; abstain: number; k: number };
  decisionReason?: string;
};
