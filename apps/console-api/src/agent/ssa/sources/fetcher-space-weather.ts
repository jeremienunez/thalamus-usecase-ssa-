import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-space-weather");
const TIMEOUT_MS = 15_000;

/**
 * Space-weather fetcher (NOAA SWPC equivalent): solar radio flux (F10.7),
 * planetary K-index (Kp) and a notional radiation environment index per
 * orbit-regime / launch year. Used by the orbit-regime profiler and the
 * launch-epoch cortex.
 */

async function fetchNoaaSwpc(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const lat = params.latitude as number | undefined;
  const lon = params.longitude as number | undefined;
  const year = (params.year as number) ?? new Date().getFullYear() - 1;

  if (lat == null || lon == null) return [];

  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;
  // Notional NOAA SWPC archive endpoint shape — kept stable so the
  // cortex/test harness can mock it. Real SWPC exposes per-day F10.7
  // and Kp series via JSON.
  const url = `https://services.swpc.noaa.gov/json/archive/space-weather?latitude=${lat}&longitude=${lon}&start_date=${startDate}&end_date=${endDate}&daily=f107_flux,kp_index,radiation_belt_flux,total_electron_content`;

  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return [];

    const data = (await res.json()) as {
      daily: {
        f107_flux: number[];
        kp_index: number[];
        radiation_belt_flux: number[];
        total_electron_content: number[];
      };
    };

    const {
      f107_flux: f107,
      kp_index: kp,
      radiation_belt_flux: rbf,
      total_electron_content: tec,
    } = data.daily;

    // Annual mean F10.7 — proxy for solar activity envelope.
    const meanF107 = f107.reduce((a, b) => a + b, 0) / Math.max(f107.length, 1);
    // Annual mean Kp — geomagnetic activity envelope.
    const meanKp = kp.reduce((a, b) => a + b, 0) / Math.max(kp.length, 1);
    // Peak radiation belt flux — bounding case for hardening budget.
    const peakRbf = rbf.length ? Math.max(...rbf) : 0;
    // Mean TEC — ionospheric drag / GNSS error proxy.
    const meanTec = tec.reduce((a, b) => a + b, 0) / Math.max(tec.length, 1);

    return [
      {
        type: "space_weather_indices",
        source: "NOAA SWPC archive (notional)",
        url,
        data: {
          year,
          latitude: lat,
          longitude: lon,
          meanF107: Math.round(meanF107),
          meanKp: Math.round(meanKp * 100) / 100,
          peakRadiationBeltFlux: Math.round(peakRbf),
          meanTec: Math.round(meanTec),
          window: `${startDate} to ${endDate}`,
          solarActivityClass:
            meanF107 < 80
              ? "deep_min"
              : meanF107 < 110
                ? "low"
                : meanF107 < 150
                  ? "moderate"
                  : meanF107 < 200
                    ? "high"
                    : "very_high",
        },
        fetchedAt: new Date().toISOString(),
        latencyMs: Date.now() - start,
      },
    ];
  } catch (err) {
    logger.debug({ err, lat, lon, year }, "NOAA SWPC fetch failed");
    return [];
  }
}

registerSource(
  ["orbit_regime_profiler", "launch_epoch_forecaster"],
  fetchNoaaSwpc,
  "space-weather",
);
