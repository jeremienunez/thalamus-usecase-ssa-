import {
  toAdvisoryView,
  toRssView,
  toManeuverView,
  toObservationView,
  toCorrelationView,
  toOrbitalPrimerView,
} from "../transformers/source-data.transformer";
import type {
  AdvisoryRow,
  RssTrendRow,
  ManeuverPlanRow,
  ObservationIngestRow,
  CorrelationMergeRow,
  OrbitalPrimerRow,
  AdvisoryView,
  RssView,
  ManeuverView,
  ObservationView,
  CorrelationView,
  OrbitalPrimerView,
} from "../types/source-data.types";

// ── Port (structural — repo satisfies this by duck typing) ────────
export interface SourcesReadPort {
  listAdvisoryFeed(opts: {
    sinceIso?: string;
    operatorId?: string | number | bigint;
    category?: string;
    limit?: number;
  }): Promise<AdvisoryRow[]>;
  listRssItems(opts: {
    category?: string;
    days?: number;
    limit?: number;
  }): Promise<RssTrendRow[]>;
  listManeuverPlanSources(opts: {
    conjunctionEventId?: string | number | bigint;
    maxDeltaVmps?: number;
    limit?: number;
  }): Promise<ManeuverPlanRow[]>;
  listObservationSources(opts: {
    stationId?: string;
    windowMinutes?: number;
    limit?: number;
  }): Promise<ObservationIngestRow[]>;
  listCorrelationSources(opts: {
    conjunctionEventId?: string | number | bigint;
    limit?: number;
  }): Promise<CorrelationMergeRow[]>;
  listOrbitalPrimerSources(opts: {
    topic?: string;
    stakeholderLevel?: string;
    limit?: number;
  }): Promise<OrbitalPrimerRow[]>;
}

export class SourceDataService {
  constructor(private readonly repo: SourcesReadPort) {}

  async listAdvisory(opts: {
    sinceIso?: string;
    operatorId?: string;
    category?: string;
    limit?: number;
  }): Promise<{ items: AdvisoryView[]; count: number }> {
    const rows = await this.repo.listAdvisoryFeed(opts);
    const items = rows.map(toAdvisoryView);
    return { items, count: items.length };
  }

  async listRss(opts: {
    category?: string;
    days?: number;
    limit?: number;
  }): Promise<{ items: RssView[]; count: number }> {
    const rows = await this.repo.listRssItems(opts);
    const items = rows.map(toRssView);
    return { items, count: items.length };
  }

  async listManeuverSources(opts: {
    conjunctionEventId?: string;
    maxDeltaVmps?: number;
    limit?: number;
  }): Promise<{ items: ManeuverView[]; count: number }> {
    const rows = await this.repo.listManeuverPlanSources(opts);
    const items = rows.map(toManeuverView);
    return { items, count: items.length };
  }

  async listObservationSources(opts: {
    stationId?: string;
    windowMinutes?: number;
    limit?: number;
  }): Promise<{ items: ObservationView[]; count: number }> {
    const rows = await this.repo.listObservationSources(opts);
    const items = rows.map(toObservationView);
    return { items, count: items.length };
  }

  async listCorrelationSources(opts: {
    conjunctionEventId?: string;
    limit?: number;
  }): Promise<{ items: CorrelationView[]; count: number }> {
    const rows = await this.repo.listCorrelationSources(opts);
    const items = rows.map(toCorrelationView);
    return { items, count: items.length };
  }

  async listOrbitalPrimer(opts: {
    topic?: string;
    stakeholderLevel?: string;
    limit?: number;
  }): Promise<{ items: OrbitalPrimerView[]; count: number }> {
    const rows = await this.repo.listOrbitalPrimerSources(opts);
    const items = rows.map(toOrbitalPrimerView);
    return { items, count: items.length };
  }
}
