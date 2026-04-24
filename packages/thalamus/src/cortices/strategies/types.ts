/**
 * CortexExecutionStrategy — Strategy Pattern for cortex execution.
 *
 * Each strategy encapsulates a different pipeline. The executor picks the
 * first strategy whose `canHandle(cortexName)` returns `true`. Adding a
 * new pipeline (e.g. streaming cortex, RAG cortex) = new strategy, not a
 * modification of `CortexExecutor`. Open/Closed Principle.
 */

import type { CortexSkill } from "../registry";
import type { CortexInput, CortexOutput } from "../types";

export interface CortexExecutionStrategy {
  /** Does this strategy handle the given cortex? First match wins. */
  canHandle(cortexName: string): boolean;

  /** Run the cortex. May reject; DAG-level callers own failure diagnostics. */
  execute(skill: CortexSkill, input: CortexInput): Promise<CortexOutput>;
}
