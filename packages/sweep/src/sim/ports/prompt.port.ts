/**
 * SimPromptComposer — kernel ↔ pack contract for turn prompt assembly.
 *
 * Given the kernel-assembled AgentContext (generic, domain-opaque) the pack
 * renders the final LLM prompt — choosing which sections to include (fleet
 * snapshot, telemetry target, pc target), field names, ordering, etc.
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.4 (impl moves renderTurnPrompt
 * body from packages/sweep/src/sim/prompt.ts to apps/console-api).
 */

export interface PromptRenderContext {
  /** Kernel metadata — turn number, agent index, persona, goals, etc. */
  frame: Record<string, unknown>;
  /** Pack-defined bag: fleet, telemetryTarget, pcEstimatorTarget, ... */
  domain: Record<string, unknown>;
  /** Observable log (compacted) — author label + summary per entry. */
  observable: Array<{
    turnIndex: number;
    actorKind: string;
    authorLabel: string;
    observableSummary: string;
  }>;
  /** God events up to this turn. */
  godEvents: Array<{
    turnIndex: number;
    summary: string;
    detail?: string;
  }>;
  /** Top-K retrieved memories (kernel scores them). */
  topMemories: Array<{ turnIndex: number; kind: string; content: string }>;
}

export interface SimPromptComposer {
  render(ctx: PromptRenderContext): string;
}
