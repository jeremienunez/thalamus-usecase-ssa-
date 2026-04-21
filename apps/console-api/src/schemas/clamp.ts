import { z } from "zod";

/**
 * Numeric "tuning knob" helpers.
 *
 * Use these for fields where callers can pass any sane numeric value and we
 * silently clamp to the service's operating range (e.g. `k`, `limit`,
 * `intervalSec`). NaN / Infinity / non-numeric still get rejected via
 * `.finite()` — those are programmer errors, not tuning.
 *
 * For semantic identifiers (enum `kind`, `field`, `decision`, `regime`,
 * NORAD `id`) use strict enums/regexes — invalid input is a 400, never a clamp.
 */

const numberLike = (value: unknown): unknown => {
  if (value === undefined) return undefined;
  if (typeof value === "number") return value;
  // Accept numeric query-string inputs, but reject blank strings plus
  // booleans/objects/arrays. `?limit=` should be a validation error, not a
  // silent clamp to the minimum via Number("") === 0.
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed === "" ? Number.NaN : Number(trimmed);
  }
  return Number.NaN;
};

/** Integer clamp: reject non-finite / non-number, then clamp to [min, max]. */
export const clampedInt = (min: number, max: number, dflt: number) =>
  z.preprocess(
    numberLike,
    z
      .number()
      .int()
      .finite()
      .default(dflt)
      .transform((v) => Math.max(min, Math.min(max, v))),
  );

/** Float clamp: reject non-finite / non-number, then clamp to [min, max]. */
export const clampedNumber = (min: number, max: number, dflt: number) =>
  z.preprocess(
    numberLike,
    z
      .number()
      .finite()
      .default(dflt)
      .transform((v) => Math.max(min, Math.min(max, v))),
  );
