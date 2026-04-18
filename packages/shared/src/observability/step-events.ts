import type { StepName } from "./steps";

export type StepPhase = "start" | "done" | "error";

export interface StepEvent {
  step: StepName | "unknown";
  phase: StepPhase;
  frames: string[];
  terminal: string;
  [extra: string]: unknown;
}
