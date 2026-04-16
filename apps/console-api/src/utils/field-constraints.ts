export const MISSION_WRITABLE_COLUMNS: Record<string, "numeric" | "text"> = {
  lifetime: "numeric",
  power: "numeric",
  variant: "text",
  mass_kg: "numeric",
  launch_year: "numeric",
};

export const FIELD_RANGE: Record<string, { min: number; max: number }> = {
  lifetime: { min: 0.1, max: 50 },
  power: { min: 0.1, max: 30_000 },
  mass_kg: { min: 0.1, max: 30_000 },
  launch_year: { min: 1957, max: 2035 },
};

export function inRange(field: string, value: number): boolean {
  const r = FIELD_RANGE[field];
  if (!r) return true;
  return value >= r.min && value <= r.max;
}

const UNIT_MISMATCHES: Record<string, RegExp> = {
  lifetime: /\b(hour|day|month|minute|second|week)s?\b/i,
  launch_year: /\b(BC|month|day)\b/i,
};

export function unitMismatch(field: string, unit: string): boolean {
  const re = UNIT_MISMATCHES[field];
  return re ? re.test(unit) : false;
}
