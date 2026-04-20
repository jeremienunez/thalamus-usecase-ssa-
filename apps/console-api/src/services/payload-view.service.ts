import type { PayloadView } from "@interview/shared";
import { toPayloadView } from "../transformers/payload-view.transformer";
import type { SatellitePayloadRow } from "../types/payload.types";

export interface SatellitePayloadsReadPort {
  listBySatelliteId(satelliteId: bigint): Promise<SatellitePayloadRow[]>;
}

export class PayloadViewService {
  constructor(private readonly repo: SatellitePayloadsReadPort) {}

  async listForSatellite(
    satelliteId: bigint,
  ): Promise<{ items: PayloadView[]; count: number }> {
    const rows = await this.repo.listBySatelliteId(satelliteId);
    const items = rows.map(toPayloadView);
    return { items, count: items.length };
  }
}
