import { SatelliteRepository } from "../repositories/satellite.repository";
import { SatelliteEnrichmentRepository } from "../repositories/satellite-enrichment.repository";

export class SatelliteEnrichmentService {
  constructor(
    private readonly satRepo: SatelliteRepository,
    private readonly enrichRepo: SatelliteEnrichmentRepository,
  ) {}

  async findFull(id: bigint | number) {
    return this.satRepo.findByIdFull(id);
  }

  async listByOperator(name: string) {
    return this.satRepo.listByOperator({ operator: name });
  }

  async catalogContext(opts: {
    source?: string;
    sinceEpoch?: string;
    limit: number;
  }) {
    return this.enrichRepo.listCatalogContext(opts);
  }

  async replacementCost(opts: { satelliteId: string }) {
    return this.enrichRepo.estimateReplacementCost(opts);
  }

  async launchCost(opts: {
    orbitRegime?: string;
    minLaunchCost?: number;
    maxLaunchCost?: number;
    limit: number;
  }) {
    return this.enrichRepo.getLaunchCostContext(opts);
  }
}
