import {
  toFleetAnalysisView,
  toRegimeProfileView,
  toOrbitSlotView,
} from "../transformers/fleet-analysis.transformer";
import type {
  FleetAnalysisRow,
  RegimeProfileRow,
  OrbitSlotRow,
  FleetAnalysisView,
  RegimeProfileView,
  OrbitSlotView,
} from "../types/fleet-analysis.types";
import {
  toOrbitalTrafficView,
  toDebrisForecastView,
  toLaunchManifestView,
  toLaunchEpochWeatherView,
} from "../transformers/traffic-forecast.transformer";
import type {
  OrbitalTrafficRow,
  DebrisForecastRow,
  LaunchManifestRow,
  LaunchEpochWeatherRow,
  OrbitalTrafficView,
  DebrisForecastView,
  LaunchManifestView,
  LaunchEpochWeatherView,
} from "../types/traffic-forecast.types";

// ── Ports (structural — repos satisfy these by duck typing) ────────
export interface FleetAnalysisReadPort {
  analyzeOperatorFleet(opts: {
    operatorId?: string | number | bigint;
    limit?: number;
  }): Promise<FleetAnalysisRow[]>;
  profileOrbitRegime(opts: {
    operatorCountryName?: string;
    operatorCountryId?: string | number;
    orbitRegime?: string;
    limit?: number;
  }): Promise<RegimeProfileRow[]>;
  planOrbitSlots(opts: {
    operatorId?: string | number | bigint;
    limit?: number;
  }): Promise<OrbitSlotRow[]>;
}

export interface TrafficForecastReadPort {
  analyzeOrbitalTraffic(opts: {
    windowDays?: number;
    regimeId?: string | number | bigint;
    limit?: number;
  }): Promise<OrbitalTrafficRow[]>;
  forecastDebris(opts: {
    regimeId?: string | number | bigint;
    limit?: number;
  }): Promise<DebrisForecastRow[]>;
  listLaunchManifest(opts: {
    horizonDays?: number;
    limit?: number;
  }): Promise<LaunchManifestRow[]>;
  getLaunchEpochWeather(opts: {
    operatorCountryName?: string;
    operatorCountryId?: string | number;
    orbitRegime?: string;
    limit?: number;
  }): Promise<LaunchEpochWeatherRow[]>;
}

type ListResult<T> = { items: T[]; count: number };

export class OrbitalAnalysisService {
  constructor(
    private readonly fleetRepo: FleetAnalysisReadPort,
    private readonly trafficRepo: TrafficForecastReadPort,
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
    limit: number;
  }): Promise<ListResult<OrbitSlotView>> {
    const rows = await this.fleetRepo.planOrbitSlots({
      operatorId: opts.operatorId,
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
    limit: number;
  }): Promise<ListResult<DebrisForecastView>> {
    const rows = await this.trafficRepo.forecastDebris({
      regimeId: opts.regimeId,
      limit: opts.limit,
    });
    const items = rows.map((r, i) => toDebrisForecastView(r, i));
    return { items, count: items.length };
  }

  async launchManifest(opts: {
    horizonDays: number;
    limit: number;
  }): Promise<ListResult<LaunchManifestView>> {
    const rows = await this.trafficRepo.listLaunchManifest({
      horizonDays: opts.horizonDays,
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
