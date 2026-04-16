export const MISSION_WRITABLE_COLUMNS: Record<string, "numeric" | "text"> = {
  lifetime: "numeric",
  power: "numeric",
  variant: "text",
  mass_kg: "numeric",
  launch_year: "numeric",
};

// Per-column sanity bounds. Any filled value outside → unobtainable (silent
// reject, no DB write). Prevents the nano from dumping `launch_year=1850` or
// `mass_kg=-5` into the catalog when its source page was misparsed.
export const FIELD_RANGE: Record<string, { min: number; max: number }> = {
  lifetime: { min: 0.1, max: 50 },       // design life in years
  power: { min: 0.1, max: 30_000 },      // payload power in W
  mass_kg: { min: 0.1, max: 30_000 },    // dry mass in kg
  launch_year: { min: 1957, max: 2035 }, // Sputnik → near future
};

export function inRange(field: string, value: number): boolean {
  const r = FIELD_RANGE[field];
  if (!r) return true;
  return value >= r.min && value <= r.max;
}

// Unit strings that indicate the value is NOT in the target unit. lifetime is
// years; any mention of days/hours/months → reject (can't auto-convert
// because "months" could be operational or design, ambiguous).
const UNIT_MISMATCHES: Record<string, RegExp> = {
  lifetime: /\b(hour|day|month|minute|second|week)s?\b/i,
  launch_year: /\b(BC|month|day)\b/i,
};

export function unitMismatch(field: string, unit: string): boolean {
  const re = UNIT_MISMATCHES[field];
  return re ? re.test(unit) : false;
}
