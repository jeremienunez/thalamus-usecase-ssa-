import { FleetAnalysisRepository } from "../repositories/fleet-analysis.repository";
import { TrafficForecastRepository } from "../repositories/traffic-forecast.repository";

export class OrbitalAnalysisService {
  constructor(
    private readonly fleetRepo: FleetAnalysisRepository,
    private readonly trafficRepo: TrafficForecastRepository,
  ) {}

  async analyzeFleet(opts: {
    operatorId?: string;
    limit: number;
  }) {
    return this.fleetRepo.analyzeOperatorFleet({
      operatorId: opts.operatorId,
      limit: opts.limit,
    });
  }

  async profileRegime(opts: {
    id: string;
    operatorCountryName?: string;
    operatorCountryId?: string;
    orbitRegime?: string;
    limit: number;
  }) {
    return this.fleetRepo.profileOrbitRegime({
      operatorCountryName: opts.operatorCountryName,
      operatorCountryId: opts.operatorCountryId ?? opts.id,
      orbitRegime: opts.orbitRegime,
      limit: opts.limit,
    });
  }

  async planSlots(opts: {
    operatorId?: string;
    horizonYears: number;
    limit: number;
  }) {
    return this.fleetRepo.planOrbitSlots({
      operatorId: opts.operatorId,
      horizonYears: opts.horizonYears,
      limit: opts.limit,
    });
  }

  async analyzeTraffic(opts: {
    windowDays: number;
    regimeId?: string;
    limit: number;
  }) {
    return this.trafficRepo.analyzeOrbitalTraffic({
      windowDays: opts.windowDays,
      regimeId: opts.regimeId,
      limit: opts.limit,
    });
  }

  async forecastDebris(opts: {
    regimeId?: string;
    horizonYears: number;
    limit: number;
  }) {
    return this.trafficRepo.forecastDebris({
      regimeId: opts.regimeId,
      horizonYears: opts.horizonYears,
      limit: opts.limit,
    });
  }

  async launchManifest(opts: {
    horizonDays: number;
    regimeId?: string;
    limit: number;
  }) {
    return this.trafficRepo.listLaunchManifest({
      horizonDays: opts.horizonDays,
      regimeId: opts.regimeId,
      limit: opts.limit,
    });
  }
}
