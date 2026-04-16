import type { Regime, SatelliteView } from "@interview/shared";
import { SatelliteRepository } from "../repositories/satellite.repository";
import { toSatelliteView } from "../transformers/satellite-view.transformer";

export class SatelliteViewService {
  constructor(private readonly repo: SatelliteRepository) {}

  async list(opts: {
    limit: number;
    regime?: Regime;
  }): Promise<{ items: SatelliteView[]; total: number }> {
    const rows = await this.repo.listWithOrbital(opts.limit);
    const items = rows.map(toSatelliteView);
    const filtered = opts.regime
      ? items.filter((s) => s.regime === opts.regime)
      : items;
    return { items: filtered, total: filtered.length };
  }
}
