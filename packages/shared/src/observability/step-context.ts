import { AsyncLocalStorage } from "node:async_hooks";
import type { StepEvent } from "./step-logger";

export interface StepContext {
  onStep: (event: StepEvent) => void;
}

export const stepContextStore = new AsyncLocalStorage<StepContext>();
