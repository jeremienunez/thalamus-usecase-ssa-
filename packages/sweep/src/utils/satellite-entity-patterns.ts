/**
 * Satellite / SSA entity extraction patterns.
 * Used by OSINT ingestion (press, amateur observers) and Resource Explorer crawler.
 *
 * Covers:
 *  - Common satellite constellation names (Sentinel, Starlink, GPS III, GOES, Cosmos, Intelsat, OneWeb, Iridium)
 *  - 5-digit NORAD catalog IDs
 *  - COSPAR / international designators (YYYY-NNN[A-Z])
 *  - Orbital regime keywords (LEO/MEO/GEO/SSO/HEO/GTO)
 *  - Common operators & agencies
 */

export const SATELLITE_NAME_PATTERNS =
  /\b(Sentinel-\d[A-Z]?|Starlink-\d{4,5}|GPS\s+III\s+SV-?\d{2}|GOES-\d{1,2}|Cosmos-\d{3,4}|Intelsat\s+\d+|OneWeb-\d+|Iridium-\d+)\b/gi;

export const NORAD_PATTERN = /\b(\d{5})\b/g;

export const COSPAR_PATTERN = /\b(\d{4}-\d{3}[A-Z]{1,2})\b/g;

export const ORBIT_REGIME_PATTERNS =
  /\b(LEO|MEO|GEO|SSO|HEO|GTO|low[- ]earth\s+orbit|medium[- ]earth\s+orbit|geostationary|sun[- ]synchronous|highly\s+elliptical|geostationary\s+transfer)\b/gi;

export const OPERATOR_PATTERNS =
  /\b(SpaceX|NASA|ESA|CNES|JAXA|ROSCOSMOS|ISRO|CNSA|DGA|Airbus\s+DS|Thales\s+Alenia\s+Space|Lockheed\s+Martin|Northrop\s+Grumman|Boeing|Intelsat|SES|Eutelsat|OneWeb|Iridium|Maxar|Planet|BlackSky)\b/gi;

export const DATA_POINT_RE =
  /(\d+[.,]?\d*)\s*(km|m|deg|°|kg|W|MHz|GHz|Hz|m\/s|minutes?|hours?|days?|years?|orbits?|passes?)\b/g;

/**
 * Extract unique matches from text using a regex pattern.
 * Returns lowercase, deduplicated array.
 */
export function uniqueMatches(text: string, pattern: RegExp): string[] {
  const matches = [...text.matchAll(new RegExp(pattern.source, pattern.flags))];
  const seen = new Set<string>();
  return matches
    .map((m) => (m[1] ?? m[0]).toLowerCase().trim())
    .filter((v) => {
      if (seen.has(v)) return false;
      seen.add(v);
      return true;
    });
}

/**
 * Extract all satellite-domain entities from a text block.
 */
export function extractSatelliteEntities(text: string) {
  return {
    satellites: uniqueMatches(text, SATELLITE_NAME_PATTERNS),
    norads: uniqueMatches(text, NORAD_PATTERN),
    cospars: uniqueMatches(text, COSPAR_PATTERN),
    orbitRegimes: uniqueMatches(text, ORBIT_REGIME_PATTERNS),
    operators: uniqueMatches(text, OPERATOR_PATTERNS),
    dataPoints: uniqueMatches(text, DATA_POINT_RE),
    hasSatelliteContent:
      uniqueMatches(text, SATELLITE_NAME_PATTERNS).length > 0 ||
      uniqueMatches(text, NORAD_PATTERN).length > 0 ||
      uniqueMatches(text, COSPAR_PATTERN).length > 0,
  };
}
