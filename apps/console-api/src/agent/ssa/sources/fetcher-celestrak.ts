import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-celestrak");

/**
 * CelesTrak TLE catalog fetcher.
 *
 * Queries CelesTrak by NORAD ID or launch epoch, returns the latest
 * two-line element set alongside a reference to Vallado's SGP4
 * propagator as the canonical orbital-mechanics model.
 */

function sgp4Reference(): SourceResult {
  return {
    type: "orbit_model_reference",
    source:
      "Vallado SGP4 / SDP4 propagator (AIAA 2006-6753, public reference implementation)",
    url: "https://celestrak.org/publications/AIAA/2006-6753/",
    data: {
      formula:
        "Mean motion + drag (B*) -> state vector via SGP4; decay: dMeanMotion/dt = n_dot + n_ddot/2*t + ...",
      variables: {
        meanMotion: "Revolutions per day",
        bstar: "Drag term (1/earth-radii)",
        inclination: "Inclination (deg)",
        eccentricity: "Orbit eccentricity",
      },
      note: "Use CelesTrak TLEs to seed SGP4 for any NORAD ID / epoch.",
    },
    fetchedAt: new Date().toISOString(),
    latencyMs: 0,
  };
}

async function fetchCelestrakData(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const results: SourceResult[] = [sgp4Reference()];

  const token = process.env.CELESTRAK_API_TOKEN;
  const noradId = params.noradId as string | number | undefined;
  const operatorCountry =
    (params.operatorCountry as string) ??
    (params.operatorCountryName as string);
  const launchYear = params.launchYear as number | undefined;

  const hasKey = noradId ?? (operatorCountry && launchYear);
  if (!hasKey) return results;

  try {
    const qs = new URLSearchParams();
    if (noradId) qs.set("CATNR", String(noradId));
    if (operatorCountry) qs.set("OPERATOR", String(operatorCountry));
    if (launchYear) qs.set("LAUNCH_YEAR", String(launchYear));
    qs.set("FORMAT", "JSON");

    const url = `https://celestrak.org/NORAD/elements/gp.php?${qs}`;
    const start = Date.now();
    const res = await fetch(url, {
      headers: {
        ...(token ? { Authorization: `Token ${token}` } : {}),
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(12_000),
    });
    if (res.ok) {
      const data = (await res.json()) as Array<{
        OBJECT_NAME: string;
        NORAD_CAT_ID: number;
        EPOCH: string;
        MEAN_MOTION: number;
        ECCENTRICITY: number;
        INCLINATION: number;
      }>;
      if (data.length) {
        results.push({
          type: "tle_catalog",
          source: `CelesTrak — ${noradId ?? operatorCountry ?? ""} ${launchYear ?? ""}`.trim(),
          url: "https://celestrak.org",
          data: data.slice(0, 5).map((r) => ({
            objectName: r.OBJECT_NAME,
            noradId: r.NORAD_CAT_ID,
            epoch: r.EPOCH,
            meanMotion: r.MEAN_MOTION,
            eccentricity: r.ECCENTRICITY,
            inclination: r.INCLINATION,
          })),
          fetchedAt: new Date().toISOString(),
          latencyMs: Date.now() - start,
        });
      }
    }
  } catch (err) {
    logger.debug({ err }, "CelesTrak fetch failed");
  }

  return results;
}

registerSource(
  ["launch_epoch_forecaster", "apogee_tracker"],
  fetchCelestrakData,
  "celestrak",
);
