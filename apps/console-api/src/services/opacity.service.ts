import type { ReflexionRepository } from "../repositories/reflexion.repository";
import { computeOpacityScore } from "../repositories/reflexion.repository";

/**
 * OpacityService — satellite transparency scoring.
 *
 * Lists candidate satellites with undisclosed / sensitive payload signals,
 * computes a composite opacity score, and optionally persists it. Consumed
 * by the `opacity-scout` cortex and the future /api/opacity UI.
 */
export class OpacityService {
  constructor(private readonly repo: ReflexionRepository) {}

  async listCandidates(
    opts: Parameters<ReflexionRepository["listOpacityCandidates"]>[0] = {},
  ) {
    return this.repo.listOpacityCandidates(opts);
  }

  async scoreAndPersist(satelliteId: number, input: Parameters<typeof computeOpacityScore>[0]) {
    const score = computeOpacityScore(input);
    await this.repo.writeOpacityScore(satelliteId, score);
    return { satelliteId, score };
  }
}
