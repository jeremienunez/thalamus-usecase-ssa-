/**
 * Bus datasheet loader + matcher.
 *
 * Reads `bus-datasheets.json` once (cached per process), resolves a bus name
 * (with alias fallback) to the canonical datasheet, and flattens the
 * `published` + `inferred` blocks into the `SeedRefs.busDatasheetPrior`
 * shape consumed by the telemetry_inference_agent skill.
 *
 * Strict honesty:
 *   - When a scalar has no published value and no inferred value, it is
 *     absent from the flattened output — the fish must say so rather than
 *     inventing.
 *   - Confidence from the JSON is NOT surfaced to the fish (the swarm
 *     aggregator derives the final SIM confidence from dispersion, not from
 *     per-scalar self-reports).
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { SeedRefs } from "@interview/db-schema";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("bus-datasheets");

// ─── JSON shape ──────────────────────────────────────────────────────

interface Range {
  min?: number;
  typical?: number;
  max?: number;
  note?: string;
}

interface ScalarInferred {
  typical: number;
  confidence: number;
  note?: string;
}

interface BusEntry {
  name: string;
  aliases?: string[];
  platformClass?: string;
  regime?: string;
  published?: Partial<Record<string, Range | null>>;
  inferred?: Partial<Record<string, ScalarInferred>>;
  context?: {
    designLifeYears?: number;
    launchMassKg?: { min?: number; max?: number; typical?: number };
    battery?: string;
    solarArrayM2?: { min?: number; max?: number };
    note?: string;
  };
  sources?: string[];
}

interface BusDatasheetsFile {
  $schemaVersion: number;
  $fields: Record<string, { unit: string; interpretation: string }>;
  buses: BusEntry[];
}

// ─── Scalar key → unit registry (from $fields) ───────────────────────

export interface ScalarPrior {
  typical: number;
  min: number;
  max: number;
  unit: string;
}

// ─── Cache + lookup ──────────────────────────────────────────────────

let cache: {
  file: BusDatasheetsFile;
  byNormalisedName: Map<string, BusEntry>;
} | null = null;

function normalise(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, "-")
    .replace(/[?()]/g, "");
}

function loadFile(): {
  file: BusDatasheetsFile;
  byNormalisedName: Map<string, BusEntry>;
} {
  if (cache) return cache;
  const here = dirname(fileURLToPath(import.meta.url));
  const path = resolve(here, "datasheets.json");
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    logger.error({ err, path }, "datasheets.json not found");
    throw new Error(
      `datasheets.json missing — expected at ${path}. Did you forget to copy it on deploy?`,
    );
  }
  const file = JSON.parse(raw) as BusDatasheetsFile;
  const byNormalisedName = new Map<string, BusEntry>();
  for (const bus of file.buses) {
    byNormalisedName.set(normalise(bus.name), bus);
    for (const alias of bus.aliases ?? []) {
      byNormalisedName.set(normalise(alias), bus);
    }
  }
  cache = { file, byNormalisedName };
  return cache;
}

/** Reset the cache — test-only, exported for fixture replay. */
export function __resetBusDatasheetCache(): void {
  cache = null;
}

// ─── Public API ──────────────────────────────────────────────────────

export interface BusPriorLookup {
  found: boolean;
  canonicalName: string | null;
  prior: NonNullable<SeedRefs["busDatasheetPrior"]> | null;
  matchedAlias: string | null;
  designLifeYears: number | null;
  sources: string[];
}

/**
 * Resolve a free-form bus name (e.g. from satellite.satellite_bus.name) to a
 * canonical datasheet entry and flatten into the prompt-ready prior shape.
 *
 * Returns `{ found: false, prior: null }` when no match — the caller decides
 * whether to fall back to a generic prior or skip the sim.
 */
export function lookupBusPrior(busName: string | null | undefined): BusPriorLookup {
  if (!busName) {
    return {
      found: false,
      canonicalName: null,
      prior: null,
      matchedAlias: null,
      designLifeYears: null,
      sources: [],
    };
  }
  const { file, byNormalisedName } = loadFile();
  const n = normalise(busName);
  const entry = byNormalisedName.get(n);
  if (!entry) {
    return {
      found: false,
      canonicalName: null,
      prior: null,
      matchedAlias: null,
      designLifeYears: null,
      sources: [],
    };
  }

  const scalars: Record<string, ScalarPrior> = {};
  const units = Object.fromEntries(
    Object.entries(file.$fields).map(([k, v]) => [k, v.unit]),
  );

  // Prefer published values; fall back to inferred. Missing entirely → skip.
  const keys = new Set<string>([
    ...Object.keys(entry.published ?? {}),
    ...Object.keys(entry.inferred ?? {}),
  ]);
  for (const key of keys) {
    const pub = entry.published?.[key];
    const inf = entry.inferred?.[key];
    const unit = units[key] ?? "";

    if (pub && (pub.typical != null || pub.min != null || pub.max != null)) {
      const typical =
        pub.typical ??
        (pub.min != null && pub.max != null
          ? (pub.min + pub.max) / 2
          : (pub.min ?? pub.max ?? null));
      if (typical == null) continue;
      scalars[key] = {
        typical,
        min: pub.min ?? typical,
        max: pub.max ?? typical,
        unit,
      };
    } else if (inf?.typical != null) {
      // Inferred scalars have no published range — use ±30% as the
      // implicit envelope so fish can perturb around the centre without
      // pretending to cite a min/max.
      const t = inf.typical;
      scalars[key] = {
        typical: t,
        min: t * 0.7,
        max: t * 1.3,
        unit,
      };
    }
  }

  const matchedAlias = entry.aliases?.find((a) => normalise(a) === n) ?? null;

  return {
    found: true,
    canonicalName: entry.name,
    matchedAlias,
    prior: {
      busArchetype: entry.name,
      scalars,
    },
    designLifeYears: entry.context?.designLifeYears ?? null,
    sources: entry.sources ?? [],
  };
}

/**
 * Expose the raw entry (+ context) for consumers who want launch mass,
 * battery type, sources, etc. Thin wrapper around the same lookup.
 */
export function lookupBusEntry(
  busName: string | null | undefined,
): BusEntry | null {
  if (!busName) return null;
  const { byNormalisedName } = loadFile();
  return byNormalisedName.get(normalise(busName)) ?? null;
}

/** List every canonical bus name in the datasheet (diagnostics + tests). */
export function listBusNames(): string[] {
  return loadFile().file.buses.map((b) => b.name);
}
