import { FleetAnalysisRepository } from "../repositories/fleet-analysis.repository";
import { TrafficForecastRepository } from "../repositories/traffic-forecast.repository";
import {
  toFleetAnalysisView,
  toRegimeProfileView,
  toOrbitSlotView,
  type FleetAnalysisView,
  type RegimeProfileView,
  type OrbitSlotView,
} from "../transformers/fleet-analysis.transformer";
import {
  toOrbitalTrafficView,
  toDebrisForecastView,
  toLaunchManifestView,
  toLaunchEpochWeatherView,
  type OrbitalTrafficView,
  type DebrisForecastView,
  type LaunchManifestView,
  type LaunchEpochWeatherView,
} from "../transformers/traffic-forecast.transformer";

type ListResult<T> = { items: T[]; count: number };

export class OrbitalAnalysisService {
  constructor(
    private readonly fleetRepo: FleetAnalysisRepository,
    private readonly trafficRepo: TrafficForecastRepository,
  ) {}

  async analyzeFleet(opts: {
    operatorId?: string;
    limit: number;
  }): Promise<ListResult<FleetAnalysisView>> {
    const rows = await this.fleetRepo.analyzeOperatorFleet({
      operatorId: opts.operatorId,
      limit: opts.limit,
    });
    const items = rows.map(toFleetAnalysisView);
    return { items, count: items.length };
  }

  async profileRegime(opts: {
    id: string;
    operatorCountryName?: string;
    operatorCountryId?: string;
    orbitRegime?: string;
    limit: number;
  }): Promise<ListResult<RegimeProfileView>> {
    const rows = await this.fleetRepo.profileOrbitRegime({
      operatorCountryName: opts.operatorCountryName,
      operatorCountryId: opts.operatorCountryId ?? opts.id,
      orbitRegime: opts.orbitRegime,
      limit: opts.limit,
    });
    const items = rows.map(toRegimeProfileView);
    return { items, count: items.length };
  }

  async planSlots(opts: {
    operatorId?: string;
    horizonYears: number;
    limit: number;
  }): Promise<ListResult<OrbitSlotView>> {
    const rows = await this.fleetRepo.planOrbitSlots({
      operatorId: opts.operatorId,
      horizonYears: opts.horizonYears,
      limit: opts.limit,
    });
    const items = rows.map(toOrbitSlotView);
    return { items, count: items.length };
  }

  async analyzeTraffic(opts: {
    windowDays: number;
    regimeId?: string;
    limit: number;
  }): Promise<ListResult<OrbitalTrafficView>> {
    const rows = await this.trafficRepo.analyzeOrbitalTraffic({
      windowDays: opts.windowDays,
      regimeId: opts.regimeId,
      limit: opts.limit,
    });
    const items = rows.map((r, i) => toOrbitalTrafficView(r, i));
    return { items, count: items.length };
  }

  async forecastDebris(opts: {
    regimeId?: string;
    horizonYears: number;
    limit: number;
  }): Promise<ListResult<DebrisForecastView>> {
    const rows = await this.trafficRepo.forecastDebris({
      regimeId: opts.regimeId,
      horizonYears: opts.horizonYears,
      limit: opts.limit,
    });
    const items = rows.map((r, i) => toDebrisForecastView(r, i));
    return { items, count: items.length };
  }

  async launchManifest(opts: {
    horizonDays: number;
    regimeId?: string;
    limit: number;
  }): Promise<ListResult<LaunchManifestView>> {
    const rows = await this.trafficRepo.listLaunchManifest({
      horizonDays: opts.horizonDays,
      regimeId: opts.regimeId,
      limit: opts.limit,
    });
    const items = rows.map((r, i) => toLaunchManifestView(r, i));
    return { items, count: items.length };
  }

  async getLaunchEpochWeather(opts: {
    operatorCountryName?: string;
    operatorCountryId?: string;
    orbitRegime?: string;
    limit?: number;
  }): Promise<ListResult<LaunchEpochWeatherView>> {
    const rows = await this.trafficRepo.getLaunchEpochWeather({
      operatorCountryName: opts.operatorCountryName,
      operatorCountryId: opts.operatorCountryId,
      orbitRegime: opts.orbitRegime,
      limit: opts.limit,
    });
    const items = rows.map(toLaunchEpochWeatherView);
    return { items, count: items.length };
  }
}
