/**
 * God channel — admin-facing wrapper around orchestrator.inject.
 *
 * Validates the payload via Zod, then delegates. Exposes predefined
 * event templates so the admin UI can emit narratively consistent
 * injections without free-form prose.
 */

import { createLogger } from "@interview/shared/observability";
import { godEventSchema } from "./legacy-ssa-schema";
import type { SimOrchestrator, GodEventInput } from "./sim-orchestrator.service";

const logger = createLogger("god-channel");

export const GOD_EVENT_TEMPLATES: Record<
  string,
  Omit<GodEventInput, "summary"> & { summaryTemplate: string }
> = {
  asat_sample: {
    kind: "asat_event",
    summaryTemplate:
      "Kinetic ASAT test fragments {target} — debris cloud rises across LEO shells; tracking advisories broadcast.",
    detail:
      "A kinetic anti-satellite test has fragmented the target satellite. Operators in adjacent orbital shells face elevated conjunction rates for the coming weeks. Debris models are being updated by tracking networks.",
  },
  regulation_sample: {
    kind: "regulation",
    summaryTemplate:
      "New regulation effective {target}: operators must maneuver within 24h of high-probability conjunction alerts or face licence review.",
    detail:
      "A regulator has issued a binding rule compressing the maneuver-decision window. Operators who fail to act within 24h of high-probability conjunction alerts may face licence review, fines, or operational suspension.",
  },
  launch_surge_sample: {
    kind: "launch_surge",
    summaryTemplate:
      "Unexpected launch surge: +{target} satellites deploying to the primary commercial regime over the next 30 days.",
    detail:
      "A constellation operator has accelerated its deployment schedule. The primary regime will see a concentrated influx of new satellites, tightening slot availability and raising baseline conjunction rates.",
  },
  debris_cascade_sample: {
    kind: "debris_cascade",
    summaryTemplate:
      "Secondary collision in {target}: initial debris from previous event triggers a cascade — tracking coverage degraded.",
    detail:
      "A follow-on collision has produced a second-generation debris population. The cascade increases tracking uncertainty and forces a reassessment of maneuver thresholds fleet-wide.",
  },
};

export class GodChannelService {
  constructor(private readonly orchestrator: SimOrchestrator) {}

  async inject(
    simRunId: number,
    raw: unknown,
  ): Promise<{ simTurnId: number }> {
    // Zod-inferred type has optional fields structurally; parse() has
    // already enforced required-ness at runtime, so the cast is safe.
    const parsed = godEventSchema.parse(raw) as GodEventInput;
    const result = await this.orchestrator.inject(simRunId, parsed);
    logger.info(
      { simRunId, simTurnId: result.simTurnId, eventKind: parsed.kind },
      "god event injected",
    );
    return result;
  }

  /**
   * Shortcut for admin UI: inject one of the named templates with a target
   * label interpolated into the summary (e.g. template="asat_sample",
   * target="Satellite #42" -> "Kinetic ASAT test fragments Satellite #42 ...").
   */
  async injectFromTemplate(
    simRunId: number,
    templateKey: keyof typeof GOD_EVENT_TEMPLATES | string,
    target: string,
    opts?: { targetSatelliteId?: number; targetOperatorId?: number },
  ): Promise<{ simTurnId: number }> {
    const tpl = GOD_EVENT_TEMPLATES[templateKey as string];
    if (!tpl) throw new Error(`unknown god event template: ${templateKey}`);
    const summary = tpl.summaryTemplate.replace("{target}", target);
    return await this.orchestrator.inject(simRunId, {
      kind: tpl.kind,
      summary,
      detail: tpl.detail,
      targetSatelliteId: opts?.targetSatelliteId,
      targetOperatorId: opts?.targetOperatorId,
    });
  }
}
