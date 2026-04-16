import { SatelliteRepository } from "../repositories/satellite.repository";
import { SatelliteEnrichmentRepository } from "../repositories/satellite-enrichment.repository";
import {
  toSatelliteFullView,
  toSatelliteListView,
  toCatalogContextView,
  toReplacementCostView,
  toLaunchCostView,
  toPayloadContextView,
  type SatelliteFullView,
  type SatelliteListView,
  type CatalogContextView,
  type ReplacementCostView,
  type LaunchCostView,
  type PayloadContextView,
} from "../transformers/satellite-enrichment.transformer";

export class SatelliteEnrichmentService {
  constructor(
    private readonly satRepo: SatelliteRepository,
    private readonly enrichRepo: SatelliteEnrichmentRepository,
  ) {}

  async findFull(
    id: bigint | number,
  ): Promise<{ item: SatelliteFullView | null }> {
    const row = await this.satRepo.findByIdFull(id);
    return { item: row ? toSatelliteFullView(row) : null };
  }

  async listByOperator(
    name: string,
  ): Promise<{ items: SatelliteListView[]; count: number }> {
    const rows = await this.satRepo.listByOperator({ operator: name });
    const items = rows.map(toSatelliteListView);
    return { items, count: items.length };
  }

  async catalogContext(opts: {
    source?: string;
    sinceEpoch?: string;
    limit: number;
  }): Promise<{ items: CatalogContextView[]; count: number }> {
    const rows = await this.enrichRepo.listCatalogContext(opts);
    const items = rows.map(toCatalogContextView);
    return { items, count: items.length };
  }

  async replacementCost(opts: {
    satelliteId: string;
  }): Promise<{ items: ReplacementCostView[]; count: number }> {
    const rows = await this.enrichRepo.estimateReplacementCost(opts);
    const items = rows.map(toReplacementCostView);
    return { items, count: items.length };
  }

  async launchCost(opts: {
    orbitRegime?: string;
    minLaunchCost?: number;
    maxLaunchCost?: number;
    limit: number;
  }): Promise<{ items: LaunchCostView[]; count: number }> {
    const rows = await this.enrichRepo.getLaunchCostContext(opts);
    const items = rows.map(toLaunchCostView);
    return { items, count: items.length };
  }

  async payloadContext(
    opts: Parameters<SatelliteEnrichmentRepository["getPayloadContext"]>[0],
  ): Promise<{ items: PayloadContextView[]; count: number }> {
    const rows = await this.enrichRepo.getPayloadContext(opts);
    const items = rows.map(toPayloadContextView);
    return { items, count: items.length };
  }
}
