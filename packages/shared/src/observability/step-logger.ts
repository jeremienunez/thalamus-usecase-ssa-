import type { Logger } from "pino";
import { STEP_REGISTRY, type StepName } from "./steps";

export { STEP_REGISTRY } from "./steps";
export type { StepName, StepEntry } from "./steps";

export type StepPhase = "start" | "done" | "error";

export interface StepEvent {
  step: StepName | "unknown";
  phase: StepPhase;
  frames: string[];
  terminal: string;
  [extra: string]: unknown;
}

/**
 * Emit a structured step lifecycle event.
 *
 * The CLI renderer consumes `step`, `phase`, `frames`, and `terminal`
 * to drive animated spinners + terminal emoji.  Any extra fields (e.g.
 * `cortex`, `fishId`, `cycleId`) are forwarded verbatim.
 */
export function stepLog(
  logger: Logger,
  step: StepName,
  phase: StepPhase,
  extra: Record<string, unknown> = {},
): void {
  const entry = STEP_REGISTRY[step];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[stepLog] unknown step: ${step}`);
    }
    logger.info({ step: "unknown", phase, frames: [], terminal: "❔", ...extra });
    return;
  }
  const terminal = phase === "error" ? (entry.error ?? entry.terminal) : entry.terminal;
  logger.info({ step, phase, frames: entry.frames, terminal, ...extra });
}
