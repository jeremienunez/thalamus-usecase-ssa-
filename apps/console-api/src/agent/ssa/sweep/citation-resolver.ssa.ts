/**
 * CitationResolver (OCP)
 *
 * Tells the reviewer WHERE a missing satellite-column value should come from.
 *
 * Design: a narrow port + a composite of strategies. Adding a new source
 * (Wikipedia, SatBeams, UCS…) means shipping a new strategy, not editing
 * this file's conditionals.
 */

/** Internal: one source strategy. Returns null when it doesn't handle `column`. */
export interface CitationStrategy {
  resolve(column: string): string | null;
}

/** Public port: always returns a citation string (guarded by a fallback). */
export interface CitationResolver {
  resolve(column: string): string;
}

/** GCAT public catalog mappings (planet4589.org/space/gcat, CC-BY). */
export const gcatStrategy: CitationStrategy = {
  resolve(column) {
    const mapping: Record<string, string> = {
      mass_kg:
        "Back-fill from GCAT `DryMass`/`Mass`/`TotMass` (planet4589.org/space/gcat, CC-BY).",
      satellite_bus_id:
        "Back-fill from GCAT `Bus` field cross-referenced with `satellite_bus.name`.",
      launch_year: "Derive from GCAT `LDate` or CelesTrak TLE epoch.",
      operator_country_id:
        "Infer from GCAT `State` field or operator home jurisdiction.",
      operator_id: "Infer from GCAT `Owner` field or operator master list.",
    };
    return mapping[column] ?? null;
  },
};

/** CelesTrak GROUP → platform-class inference. */
export const celestrakStrategy: CitationStrategy = {
  resolve(column) {
    if (column !== "platform_class_id") return null;
    return "Infer from CelesTrak GROUP (gps-ops → navigation, starlink → communications, weather → earth_observation, military → military, science → science).";
  },
};

/**
 * Operator-private telemetry — no public source. Routes to sim-fish
 * multi-agent inference (SPEC-TH-040 SIM_UNCORROBORATED).
 */
export const privateTelemetryStrategy: CitationStrategy = {
  resolve(column) {
    const privateTelemetry = new Set([
      "power_draw",
      "thermal_margin",
      "pointing_accuracy",
      "attitude_rate",
      "payload_duty",
      "solar_array_health",
      "battery_depth_of_discharge",
      "propellant_remaining",
    ]);
    if (!privateTelemetry.has(column)) return null;
    return (
      `Operator-private telemetry — no public source. Route to sim-fish ` +
      `multi-agent inference (SPEC-TH-040 SIM_UNCORROBORATED) and surface as ` +
      `a separate suggestion with source_class tagging.`
    );
  },
};

/** Catch-all — must remain last in the composite chain. */
export const defaultFallbackStrategy: CitationStrategy = {
  resolve(column) {
    return `Back-fill "${column}" from operator ingest or operator datasheet.`;
  },
};

/** Composite resolver: first strategy returning non-null wins. */
export class CompositeCitationResolver implements CitationResolver {
  constructor(private readonly strategies: CitationStrategy[]) {}
  resolve(column: string): string {
    for (const s of this.strategies) {
      const hit = s.resolve(column);
      if (hit !== null) return hit;
    }
    // Defensive — unreachable if the chain ends with defaultFallbackStrategy.
    return `Back-fill "${column}" from operator ingest or operator datasheet.`;
  }
}

export function createDefaultCitationResolver(): CitationResolver {
  return new CompositeCitationResolver([
    gcatStrategy,
    celestrakStrategy,
    privateTelemetryStrategy,
    defaultFallbackStrategy,
  ]);
}
