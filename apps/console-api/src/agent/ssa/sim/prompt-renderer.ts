/**
 * SsaPromptRenderer — renders the SSA turn prompt from the kernel context.
 *
 * TODO(Plan 2 · B.4): move renderTurnPrompt + all section builders
 *   (fleet snapshot, telemetry target, pc target, god events, observable log)
 *   from packages/sweep/src/sim/prompt.ts. Sections read from
 *   ctx.domain.{fleet, telemetryTarget, pcEstimatorTarget}.
 *
 * The kernel's turn-runner calls this port with a PromptRenderContext that
 * already bundles persona/goals, observable log, god events, and retrieved
 * memories. The pack decides final Markdown layout + section order.
 */

import type {
  SimPromptComposer,
  PromptRenderContext,
} from "@interview/sweep";

export class SsaPromptRenderer implements SimPromptComposer {
  render(_ctx: PromptRenderContext): string {
    // TODO(B.4): implement — concatenate
    //   ## FRAME (persona + goals + constraints)
    //   ## FLEET (if ctx.domain.fleet)
    //   ## TELEMETRY TARGET (if ctx.domain.telemetryTarget)
    //   ## PC ESTIMATOR TARGET (if ctx.domain.pcEstimatorTarget)
    //   ## GOD EVENTS
    //   ## OBSERVABLE LOG
    //   ## TOP MEMORIES
    //   ## DECISION POINT
    throw new Error("SsaPromptRenderer.render: TODO Plan 2 · B.4");
  }
}
