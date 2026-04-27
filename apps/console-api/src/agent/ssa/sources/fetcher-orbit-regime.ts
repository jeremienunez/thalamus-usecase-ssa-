import { createLogger } from "@interview/shared/observability";
import type { SourceResult } from "./types";
import { registerSource } from "./registry";

const logger = createLogger("source-orbit-regime");
const TIMEOUT_MS = 12_000;

type DebrisDensityFeature = {
  properties?: {
    CLASS?: unknown;
    DESCR?: unknown;
    EPOCH?: unknown;
  };
};

type DebrisDensityResponse = {
  features?: DebrisDensityFeature[];
};

/**
 * Per-regime characterization feed. Pulls the orbital-debris density
 * map and an altitude profile at a given latitude/longitude (for a
 * ground-track sample) so the orbit-regime cortex can reason about
 * collision risk and station-keeping envelope.
 */

async function fetchDebrisDensity(
  lat: number,
  lon: number,
): Promise<SourceResult | null> {
  const bbox = `${lat - 0.01},${lon - 0.01},${lat + 0.01},${lon + 0.01}`;
  // Notional ESA DISCOS WFS endpoint — shape-stable for the test harness.
  const url = `https://discosweb.esoc.esa.int/api/debris?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature&TYPENAMES=discos:DEBRIS_DENSITY_1M&BBOX=${bbox},EPSG:4326&OUTPUTFORMAT=application/json&COUNT=1`;
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) return null;
    const data = (await res.json()) as DebrisDensityResponse;
    const feature = data.features?.[0];
    if (!feature) return null;
    const properties = feature.properties ?? {};
    return {
      type: "debris_density",
      source: "ESA DISCOS WFS (1m debris density)",
      url,
      data: {
        debrisClass: asString(properties.CLASS, "unknown"),
        description: asString(properties.DESCR, ""),
        epoch: asString(properties.EPOCH, ""),
      },
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

async function fetchAltitudeProfile(
  lat: number,
  lon: number,
): Promise<SourceResult | null> {
  const url =
    "https://data.geopf.fr/altimetrie/1.0/calcul/alti/rest/elevation.json";
  const start = Date.now();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lon: String(lon), lat: String(lat) }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      elevations: Array<{ z: number }>;
    };
    const z = data.elevations?.[0]?.z;
    if (z == null) return null;
    return {
      type: "ground_track_elevation",
      source: "IGN Geoplateforme Altimetry (ground-track sample)",
      url,
      data: { elevationM: z },
      fetchedAt: new Date().toISOString(),
      latencyMs: Date.now() - start,
    };
  } catch {
    return null;
  }
}

async function fetchOrbitRegimeData(
  params: Record<string, unknown>,
): Promise<SourceResult[]> {
  const lat = params.latitude as number | undefined;
  const lon = params.longitude as number | undefined;
  if (lat == null || lon == null) return [];

  const [debris, alt] = await Promise.all([
    fetchDebrisDensity(lat, lon),
    fetchAltitudeProfile(lat, lon),
  ]);

  return [debris, alt].filter((r): r is SourceResult => r !== null);
}

registerSource(
  ["orbit_regime_profiler"],
  fetchOrbitRegimeData,
  "orbit-regime",
);
