/**
 * Satellite domain entity extraction patterns (SSA — Space Situational Awareness).
 * Used by RSS ingestion and Resource Explorer crawler to spot spacecraft,
 * payload classes, orbital regimes, and operator identifiers in free text.
 *
 * All patterns use a single capture group so `uniqueMatches` can extract the
 * canonical token (the full identifier, not just the hit).
 */

// --- Core satellite identifiers ----------------------------------------------

/** NORAD Satellite Catalog Number — 1 to 5 decimal digits (modern objects use 5). */
export const NORAD_ID_PATTERNS = /\b(?:NORAD[- ]?|SATCAT[- ]?|#)?(\d{5})\b/g;

/** COSPAR / International Designator — YYYY-NNNL (e.g. 2023-042B). */
export const COSPAR_PATTERNS = /\b(\d{4}-\d{3}[A-Z]{1,2})\b/g;

// --- Commercial / military / science platform name patterns -----------------

/**
 * Spacecraft / constellation naming patterns common in open catalogs,
 * operator press releases and tracking-data distribution messages (TDMs).
 */
export const SATELLITE_NAME_PATTERNS =
  /\b(Sentinel-\d[A-Z]?|Starlink-\d{4,5}|GPS\s+III\s+SV-?\d{2}|GOES-\d{1,2}|Cosmos-\d{3,4}|Kosmos[- ]\d{3,4}|Intelsat\s+\d{2,3}|OneWeb-\d{4}|Iridium-\d{3}|Galileo-\d{2}|BeiDou-\d{1,2}|NOAA-\d{1,2}|Landsat-\d{1,2}|Terra|Aqua|Aura|Meteosat-\d{1,2}|MetOp-[A-C]|Jason-\d|CryoSat-\d|SWOT|ICESat-\d|Planet-\d{3,4}|SkySat-\d{1,3}|BlackSky-\d{1,2}|ICEYE-X\d{1,2}|Capella-\d{1,2}|Molniya-\d|Tundra-\d|Yaogan-\d{1,3}|Gaofen-\d{1,2}|Shijian-\d{1,2})\b/gi;

/** Launch / rocket family — useful when correlating OSINT chatter. */
export const LAUNCH_VEHICLE_PATTERNS =
  /\b(Falcon\s+9|Falcon\s+Heavy|Starship|Ariane\s*[56]|Vega-?C?|Soyuz-?\d?|Proton-?M?|Long\s+March\s*\d[A-Z]?|Atlas\s+V|Delta\s+IV\s+Heavy|Electron|H-?II[AB]?|H3|New\s+Shepard|New\s+Glenn|PSLV|GSLV(?:[- ]Mk\s*III)?)\b/gi;

/** Orbital regime keywords — LEO / MEO / GEO / HEO / SSO / Molniya / Tundra. */
export const ORBIT_REGIME_PATTERNS =
  /\b(LEO|MEO|GEO|HEO|GTO|SSO|polar|sun[- ]synchronous|geostationary|Molniya|Tundra|Lagrange\s+L[12345]|cislunar)\b/gi;

/** Operator / agency patterns — major civil + military + commercial. */
export const OPERATOR_PATTERNS =
  /\b(NASA|ESA|JAXA|CNES|DLR|ASI|UKSA|ISRO|CNSA|Roscosmos|KARI|SpaceX|Planet\s*Labs|Maxar|BlackSky|Capella\s*Space|ICEYE|Airbus\s+Defence(?:\s+and\s+Space)?|Thales\s+Alenia\s+Space|Lockheed\s+Martin|Northrop\s+Grumman|Boeing|Rocket\s*Lab|Eutelsat|SES|Intelsat\s+Corp|Inmarsat|OneWeb|Viasat|Telesat|USSF|NRO|NOAA)\b/gi;

/** Numeric telemetry-like data points (apogee/perigee/inclination/Δv/P_c). */
export const DATA_POINT_RE =
  /(\d+[.,]?\d*)\s*(km|m|deg|°|rad|m\/s|km\/s|dB|dBW|W|kW|kg|Hz|kHz|MHz|GHz|Pa|hPa|bar|years?|days?|minutes?|mins?|s|seconds?|%|arcsec)\b/g;

export interface SatelliteEntities {
  noradIds: string[];
  cosparIds: string[];
  satellites: string[];
  launchVehicles: string[];
  orbitRegimes: string[];
  operators: string[];
  dataPoints: string[];
  hasSatelliteContent: boolean;
}

// --- Helpers ----------------------------------------------------------------

/**
 * Extract unique matches from text using a regex pattern.
 * Returns lowercase, deduplicated array of the first capture group.
 */
export function uniqueMatches(text: string, pattern: RegExp): string[] {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
  const seen = new Set<string>();
  return matches
    .map((m) => (m[1] ?? m[0]).toLowerCase().trim())
    .filter((v) => {
      if (!v) return false;
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}

/**
 * Extract all satellite / SSA entities from a text block.
 * Shape mirrors the previous domain extractor so services can
 * drop it in without refactors: top-level keys remain primitive arrays
 * plus a boolean `hasSatelliteContent` gate.
 */
export function extractSatelliteEntities(text: string): SatelliteEntities {
  const noradIds = uniqueMatches(text, NORAD_ID_PATTERNS);
  const cosparIds = uniqueMatches(text, COSPAR_PATTERNS);
  const satellites = uniqueMatches(text, SATELLITE_NAME_PATTERNS);
  const launchVehicles = uniqueMatches(text, LAUNCH_VEHICLE_PATTERNS);
  const orbitRegimes = uniqueMatches(text, ORBIT_REGIME_PATTERNS);
  const operators = uniqueMatches(text, OPERATOR_PATTERNS);
  const dataPoints = uniqueMatches(text, DATA_POINT_RE);

  return {
    noradIds,
    cosparIds,
    satellites,
    launchVehicles,
    orbitRegimes,
    operators,
    dataPoints,
    hasSatelliteContent:
      noradIds.length > 0 ||
      cosparIds.length > 0 ||
      satellites.length > 0 ||
      operators.length > 0,
  };
}
