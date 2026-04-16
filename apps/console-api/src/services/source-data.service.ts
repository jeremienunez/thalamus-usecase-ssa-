import type {
  AdvisoryRow,
  RssTrendRow,
  ManeuverPlanRow,
  ObservationIngestRow,
  CorrelationMergeRow,
  OrbitalPrimerRow,
  SourceRepository,
} from "../repositories/source.repository";

export class SourceDataService {
  constructor(private readonly repo: SourceRepository) {}

  async listAdvisory(opts: {
    sinceIso?: string;
    operatorId?: string;
    category?: string;
    limit?: number;
  }): Promise<{ items: AdvisoryRow[]; count: number }> {
    const items = await this.repo.listAdvisoryFeed(opts);
    return { items, count: items.length };
  }

  async listRss(opts: {
    category?: string;
    days?: number;
    limit?: number;
  }): Promise<{ items: RssTrendRow[]; count: number }> {
    const items = await this.repo.listRssItems(opts);
    return { items, count: items.length };
  }

  async listManeuverSources(opts: {
    conjunctionEventId?: string;
    maxDeltaVmps?: number;
    limit?: number;
  }): Promise<{ items: ManeuverPlanRow[]; count: number }> {
    const items = await this.repo.listManeuverPlanSources(opts);
    return { items, count: items.length };
  }

  async listObservationSources(opts: {
    stationId?: string;
    windowMinutes?: number;
    limit?: number;
  }): Promise<{ items: ObservationIngestRow[]; count: number }> {
    const items = await this.repo.listObservationSources(opts);
    return { items, count: items.length };
  }

  async listCorrelationSources(opts: {
    conjunctionEventId?: string;
    limit?: number;
  }): Promise<{ items: CorrelationMergeRow[]; count: number }> {
    const items = await this.repo.listCorrelationSources(opts);
    return { items, count: items.length };
  }

  async listOrbitalPrimer(opts: {
    topic?: string;
    stakeholderLevel?: string;
    limit?: number;
  }): Promise<{ items: OrbitalPrimerRow[]; count: number }> {
    const items = await this.repo.listOrbitalPrimerSources(opts);
    return { items, count: items.length };
  }
}
