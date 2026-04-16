import type { SourceRepository } from "../repositories/source.repository";
import {
  toAdvisoryView,
  toRssView,
  toManeuverView,
  toObservationView,
  toCorrelationView,
  toOrbitalPrimerView,
  type AdvisoryView,
  type RssView,
  type ManeuverView,
  type ObservationView,
  type CorrelationView,
  type OrbitalPrimerView,
} from "../transformers/source-data.transformer";

export class SourceDataService {
  constructor(private readonly repo: SourceRepository) {}

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
