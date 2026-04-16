import type { Regime, SatelliteView } from "@interview/shared";
import { SatelliteRepository } from "../repositories/satellite.repository";
import { toSatelliteView } from "../transformers/satellite-view.transformer";

export class SatelliteViewService {
  constructor(private readonly repo: SatelliteRepository) {}

  async list(opts: {
    limit: number;
    regime?: Regime;
  }): Promise<{ items: SatelliteView[]; total: number }> {
    // Regime filter is pushed down into SQL so it composes with LIMIT.
    const rows = await this.repo.listWithOrbital(opts.limit, opts.regime);
    const items = rows.map(toSatelliteView);
    return { items, total: items.length };
  }
}
