import type { Logger } from "pino";
import { STEP_REGISTRY, type StepName } from "./steps";
import type { StepEvent, StepPhase } from "./step-events";
import { stepContextStore } from "./step-context";

export { STEP_REGISTRY } from "./steps";
export type { StepName, StepEntry } from "./steps";

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
  const event = buildStepEvent(step, phase, extra);
  logger.info(event);
  stepContextStore.getStore()?.onStep(event);
}

function buildStepEvent(
  step: StepName,
  phase: StepPhase,
  extra: Record<string, unknown>,
): StepEvent {
  const entry = STEP_REGISTRY[step];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[stepLog] unknown step: ${step}`);
    }
    return { step: "unknown", phase, frames: [], terminal: "❔", ...extra };
  }
  const terminal = phase === "error" ? (entry.error ?? entry.terminal) : entry.terminal;
  return { step, phase, frames: entry.frames ?? [], terminal, ...extra };
}
