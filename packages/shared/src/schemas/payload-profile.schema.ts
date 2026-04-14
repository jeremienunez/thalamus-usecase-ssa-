/**
 * Payload Technical Profile — Zod schema for JSONB validation.
 *
 * Validates LLM / fetcher output before writing to `payload.technical_profile`.
 *
 * This schema carries the quantitative fingerprint of a spacecraft payload
 * (instrument, transponder, sensor) — the equivalent of a product data sheet
 * collapsed into a structured, version-controlled record.
 *
 * Design note on where abstraction stops:
 *   `fieldConfidence` and `computeProfileConfidence` are the generic signal
 *   layer — they don't know what a payload is, they weight named sub-scores.
 *   Everything above that line (`radiometric`, `optical`, `rf`, `thermal`,
 *   `reliability`, `spaceWeatherSensitivity`) is pure SSA domain.
 */

import { z } from "zod";

// ─── Reusable sub-schemas ────────────────────────────────────

const rangeValue = z.object({
  value: z.number().nullable(),
  range: z.tuple([z.number(), z.number()]).nullable(),
});

const bandValue = z.object({
  centerMHz: z.number().nullable(),
  bandwidthMHz: z.number().nullable(),
  range: z.tuple([z.number(), z.number()]).nullable(),
});

const spectralBand = z.object({
  name: z.string(),
  centerNm: z.number().nullable(),
  widthNm: z.number().nullable(),
});

// ─── Identity sub-schema ─────────────────────────────────────

const identitySchema = z.object({
  // NORAD catalog number (integer) of the host satellite, if applicable.
  noradId: z.number().nullable().default(null),
  // COSPAR / International Designator (e.g. "2023-019A").
  cospar: z.string().nullable().default(null),
  manufacturer: z.string().nullable().default(null),
  heritage: z.array(z.string()).default([]),
  busArchetype: z.string().nullable().default(null),
  instrumentClass: z
    .enum(["sar", "optical", "infrared", "transponder", "sigint", "science"])
    .nullable()
    .default(null),
  generation: z.enum(["block-i", "block-ii", "block-iii", "next-gen"]).nullable().default(null),
  maturity: z.enum(["flight-proven", "first-flight", "prototype"]).nullable().default(null),
});

// ─── Field confidence sub-schema ─────────────────────────────

const fieldConfidenceSchema = z.object({
  identity: z.number().min(0).max(1).default(0),
  radiometric: z.number().min(0).max(1).default(0),
  optical: z.number().min(0).max(1).default(0),
  rf: z.number().min(0).max(1).default(0),
  thermal: z.number().min(0).max(1).default(0),
  reliability: z.number().min(0).max(1).default(0),
  spaceWeatherSensitivity: z.number().min(0).max(1).default(0),
});

// ─── Source schema ───────────────────────────────────────────

const sourceSchema = z.object({
  doi: z.string().optional(),
  url: z.string().optional(),
  title: z.string().optional(),
  type: z.string().optional(),
  year: z.number().optional(),
  accessed: z.string().optional(),
  fields: z.array(z.string()).default([]),
});

// ─── Main schema ─────────────────────────────────────────────

export const payloadProfileSchema = z.object({
  schemaVersion: z.number().default(1),

  identity: identitySchema.optional(),

  radiometric: z
    .object({
      eirpDbw: rangeValue.nullable().default(null),
      gainDbi: rangeValue.nullable().default(null),
      gOverTDbPerK: rangeValue.nullable().default(null),
      polarization: z
        .enum(["linear-h", "linear-v", "rhcp", "lhcp", "dual"])
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),

  optical: z
    .object({
      apertureMm: z.number().nullable().default(null),
      gsdM: rangeValue.nullable().default(null),
      snrDb: rangeValue.nullable().default(null),
      spectralBands: z.array(spectralBand).default([]),
      fieldOfViewDeg: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),

  rf: z
    .object({
      uplink: bandValue.nullable().default(null),
      downlink: bandValue.nullable().default(null),
      crosslink: bandValue.nullable().default(null),
      modulation: z.array(z.string()).default([]),
    })
    .nullable()
    .default(null),

  thermal: z
    .object({
      maxHeatDissipationW: z.number().nullable().default(null),
      operatingTempC: z
        .tuple([z.number(), z.number()])
        .nullable()
        .default(null),
      radiatorAreaM2: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),

  reliability: z
    .object({
      mtbfHours: z.number().nullable().default(null),
      redundancyClass: z
        .enum(["none", "cold", "warm", "hot"])
        .nullable()
        .default(null),
      radiationToleranceKrad: z.number().nullable().default(null),
      designLifeYears: z.number().nullable().default(null),
    })
    .nullable()
    .default(null),

  spaceWeatherSensitivity: z
    .object({
      solarFluxSensitivity: z
        .enum(["low", "moderate", "high"])
        .nullable()
        .default(null),
      singleEventUpsetClass: z
        .enum(["low", "moderate", "high"])
        .nullable()
        .default(null),
      debrisVulnerability: z
        .enum(["low", "moderate", "high"])
        .nullable()
        .default(null),
      geomagneticStormImpact: z
        .enum(["low", "moderate", "high"])
        .nullable()
        .default(null),
    })
    .nullable()
    .default(null),

  sources: z.array(sourceSchema).default([]),

  fieldConfidence: fieldConfidenceSchema.optional(),

  lastUpdated: z
    .string()
    .datetime()
    .default(() => new Date().toISOString()),
});

export type PayloadProfile = z.infer<typeof payloadProfileSchema>;

// Default identity for deep-merge when missing.
const DEFAULT_IDENTITY: NonNullable<PayloadProfile["identity"]> = {
  noradId: null,
  cospar: null,
  manufacturer: null,
  heritage: [],
  busArchetype: null,
  instrumentClass: null,
  generation: null,
  maturity: null,
};

const DEFAULT_FIELD_CONFIDENCE: NonNullable<PayloadProfile["fieldConfidence"]> = {
  identity: 0,
  radiometric: 0,
  optical: 0,
  rf: 0,
  thermal: 0,
  reliability: 0,
  spaceWeatherSensitivity: 0,
};

export function ensureIdentity(
  p: PayloadProfile,
): NonNullable<PayloadProfile["identity"]> {
  return p.identity ?? { ...DEFAULT_IDENTITY };
}

export function ensureFieldConfidence(
  p: PayloadProfile,
): NonNullable<PayloadProfile["fieldConfidence"]> {
  return p.fieldConfidence ?? { ...DEFAULT_FIELD_CONFIDENCE };
}

// ─── Confidence calculation ──────────────────────────────────

// Weights sum to 1.0. Identity is load-bearing (it anchors every other field).
const FIELD_WEIGHTS: Record<
  keyof NonNullable<PayloadProfile["fieldConfidence"]>,
  number
> = {
  identity: 0.3,
  radiometric: 0.2,
  optical: 0.15,
  rf: 0.15,
  reliability: 0.1,
  spaceWeatherSensitivity: 0.05,
  thermal: 0.05,
};

export function computeProfileConfidence(
  fc: NonNullable<PayloadProfile["fieldConfidence"]>,
): number {
  let sum = 0;
  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const val = fc[field as keyof typeof fc] ?? 0;
    sum += val * weight;
  }
  return Math.round(sum * 100) / 100;
}

export const PROFILE_WRITE_THRESHOLD = 0.75;
