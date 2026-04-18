/**
 * God channel — admin-facing wrapper around orchestrator.inject.
 *
 * Validates the payload via Zod, then delegates. Exposes predefined
 * event templates so the admin UI can emit narratively consistent
 * injections without free-form prose.
 */

import { createLogger } from "@interview/shared/observability";
import { godEventSchema } from "./legacy-ssa-schema";
// Plan 2 · B.6: GOD_EVENT_TEMPLATES now lives in the perturbation pack.
// Sweep-internal fallback re-exports it via legacy-ssa-perturbation-pack.
import { GOD_EVENT_TEMPLATES } from "./legacy-ssa-perturbation-pack";
import type { SimOrchestrator, GodEventInput } from "./sim-orchestrator.service";

const logger = createLogger("god-channel");

export { GOD_EVENT_TEMPLATES };

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
