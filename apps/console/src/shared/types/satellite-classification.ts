import type { Regime } from "@interview/shared/ssa";

export type SatelliteBusClass = "TELECOM" | "PROBE" | "SMALLSAT";

interface BusRule {
  cls: SatelliteBusClass;
  /** Name-prefix match (case-insensitive). */
  prefixes?: string[];
  /** Substring contains-match (case-insensitive). */
  contains?: string[];
}

const RULES: BusRule[] = [
  // Station-class / platforms
  { cls: "PROBE", contains: ["ISS", "TIANGONG", "HUBBLE", "HST", "TIANHE", "TIANZHOU"] },
  // Science / weather / Earth observation
  {
    cls: "PROBE",
    prefixes: [
      "NOAA",
      "GOES",
      "LANDSAT",
      "TERRA",
      "AQUA",
      "AURA",
      "METOP",
      "SENTINEL",
      "CRYOSAT",
      "JPSS",
      "TDRS",
      "METEOR",
      "ICESAT",
      "CALIPSO",
      "JASON",
      "SMAP",
      "TIROS",
    ],
    contains: ["NASA", "JAXA", "ISRO", "CNSA", "ESA"],
  },
  // Commercial / government comms buses
  {
    cls: "TELECOM",
    prefixes: [
      "INTELSAT",
      "INMARSAT",
      "EUTELSAT",
      "SES",
      "DIRECTV",
      "ECHOSTAR",
      "GALAXY",
      "ASTRA",
      "NIMIQ",
      "JCSAT",
      "NSS",
      "AMC",
      "ASIASAT",
      "VIASAT",
      "SKYNET",
      "WGS",
      "MILSTAR",
      "MUOS",
      "SICRAL",
      "GSAT",
    ],
    contains: ["THAL", "CNES"],
  },
  // GNSS buses
  {
    cls: "TELECOM",
    prefixes: ["NAVSTAR", "GPS", "GALILEO", "BEIDOU", "GLONASS", "QZS", "IRNSS"],
  },
];

/**
 * Bus-archetype classifier. Drives which 3D model an instance picks up.
 *
 * Evaluates name-based rules in order, then falls back to regime:
 *  - GEO → TELECOM (big comms bus)
 *  - anything else → SMALLSAT (flat-panel, Starlink-class)
 */
export function classifySatellite(input: {
  name: string;
  regime: Regime;
}): SatelliteBusClass {
  const n = input.name.toUpperCase();
  for (const rule of RULES) {
    if (rule.prefixes?.some((p) => n.startsWith(p))) return rule.cls;
    if (rule.contains?.some((c) => n.includes(c))) return rule.cls;
  }
  if (input.regime === "GEO") return "TELECOM";
  return "SMALLSAT";
}
