import { computeOpacityScore } from "../utils/opacity-score";
import {
  toOpacityCandidateView,
  toOpacityScoreView,
} from "../transformers/opacity.transformer";
import type {
  OpacityCandidateRow,
  OpacityCandidateView,
  OpacityScoreView,
} from "../types/opacity.types";

type ListResult<T> = { items: T[]; count: number };

// ── Ports (structural — repos satisfy these by duck typing) ────────
export interface OpacityReadPort {
  listOpacityCandidates(
    opts?: { limit?: number; minScoreFloor?: number },
  ): Promise<OpacityCandidateRow[]>;
  writeOpacityScore(satelliteId: number, score: number): Promise<void>;
}

/**
 * OpacityService — satellite transparency scoring.
 *
 * Lists candidate satellites with undisclosed / sensitive payload signals,
 * computes a composite opacity score, and optionally persists it. Consumed
 * by the `opacity-scout` cortex and the /api/opacity UI.
 */
export class OpacityService {
  constructor(private readonly repo: OpacityReadPort) {}

  async listCandidates(
    opts: { limit?: number; minScoreFloor?: number } = {},
  ): Promise<ListResult<OpacityCandidateView>> {
    const rows = await this.repo.listOpacityCandidates(opts);
    const items = rows.map(toOpacityCandidateView);
    return { items, count: items.length };
  }

  async scoreAndPersist(
    satelliteId: number,
    input: Parameters<typeof computeOpacityScore>[0],
  ): Promise<OpacityScoreView> {
    const score = computeOpacityScore(input);
    await this.repo.writeOpacityScore(satelliteId, score);
    return toOpacityScoreView(satelliteId, score);
  }
}
