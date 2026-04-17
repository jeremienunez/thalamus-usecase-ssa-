import {
  toSatelliteFullView,
  toSatelliteListView,
  toCatalogContextView,
  toReplacementCostView,
  toLaunchCostView,
  toPayloadContextView,
} from "../transformers/satellite-enrichment.transformer";
import type {
  SatelliteFullView,
  SatelliteListView,
  CatalogContextView,
  ReplacementCostView,
  LaunchCostView,
  PayloadContextView,
  FindByIdFullRow,
  ListByOperatorRow,
  CatalogContextRow,
  ReplacementCostRawRow,
  LaunchCostRow,
  PayloadContextRow,
} from "../types/satellite.types";
import { computeReplacementCost } from "../utils/replacement-cost";

// ── Ports (structural — repos satisfy these by duck typing) ────────
export interface SatellitesFullReadPort {
  findByIdFull(id: bigint | number): Promise<FindByIdFullRow | null>;
  listByOperator(opts: {
    operator?: string;
    limit?: number;
  }): Promise<ListByOperatorRow[]>;
}

export interface SatelliteEnrichmentReadPort {
  listCatalogContext(opts: {
    source?: string;
    sinceEpoch?: string;
    limit?: number;
  }): Promise<CatalogContextRow[]>;
  findReplacementCostInputs(opts: {
    satelliteId: string | number | bigint;
  }): Promise<ReplacementCostRawRow[]>;
  getLaunchCostContext(opts: {
    orbitRegime?: string;
    minLaunchCost?: number;
    maxLaunchCost?: number;
    limit?: number;
  }): Promise<LaunchCostRow[]>;
  getPayloadContext(opts: {
    payloadId?: number | bigint;
    payloadName?: string;
    payloadKind?: string;
    batch?: boolean;
    limit?: number;
    [key: string]: unknown;
  }): Promise<PayloadContextRow[]>;
}

export class SatelliteEnrichmentService {
  constructor(
    private readonly satRepo: SatellitesFullReadPort,
    private readonly enrichRepo: SatelliteEnrichmentReadPort,
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
    const rawRows = await this.enrichRepo.findReplacementCostInputs(opts);
    const items = rawRows
      .map(computeReplacementCost)
      .map(toReplacementCostView);
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
    opts: Parameters<SatelliteEnrichmentReadPort["getPayloadContext"]>[0],
  ): Promise<{ items: PayloadContextView[]; count: number }> {
    const rows = await this.enrichRepo.getPayloadContext(opts);
    const items = rows.map(toPayloadContextView);
    return { items, count: items.length };
  }
}
