import type { Regime, SatelliteView } from "@interview/shared";
import { toSatelliteView } from "../transformers/satellite-view.transformer";
import type { SatelliteOrbitalRow } from "../types/satellite.types";

export interface SatelliteOrbitalReadPort {
  listWithOrbital(limit: number, regime?: Regime): Promise<SatelliteOrbitalRow[]>;
}

export type SatellitesReadPort = SatelliteOrbitalReadPort;

export class SatelliteViewService {
  constructor(private readonly repo: SatelliteOrbitalReadPort) {}

  async list(opts: {
    limit: number;
    regime?: Regime;
  }): Promise<{ items: SatelliteView[]; count: number }> {
    // Regime filter is pushed down into SQL so it composes with LIMIT.
    const rows = await this.repo.listWithOrbital(opts.limit, opts.regime);
    const items = rows.map(toSatelliteView);
    return { items, count: items.length };
  }
}
