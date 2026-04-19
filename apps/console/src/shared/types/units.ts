/**
 * Unit formatters used across the console. All return a tuple `[value, unit]`
 * so the renderer can dim the unit label and tabular-align the value.
 *
 * Use `fmt*` for the shared helpers — they handle null/undefined/Infinity by
 * returning the em-dash glyph for the value and an empty unit.
 */

const DASH = "—";
const SUPERSCRIPT: Record<string, string> = {
  "-": "⁻",
  "+": "⁺",
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
};

function sup(n: number | string): string {
  return String(n)
    .split("")
    .map((c) => SUPERSCRIPT[c] ?? c)
    .join("");
}

export type FormattedValue = readonly [value: string, unit: string];

function bad(v: unknown): boolean {
  return v == null || typeof v !== "number" || !Number.isFinite(v);
}

/** Distance — auto-scales km → m for sub-kilometre distances. */
export function fmtRangeKm(v: number | null | undefined): FormattedValue {
  if (bad(v)) return [DASH, ""];
  const km = v as number;
  if (km < 1) return [(km * 1000).toFixed(0), "m"];
  if (km < 100) return [km.toFixed(2), "km"];
  return [km.toFixed(1), "km"];
}

/** Orbital semi-major axis — always km, no decimals over 1000. */
export function fmtAltitudeKm(v: number | null | undefined): FormattedValue {
  if (bad(v)) return [DASH, ""];
  const km = v as number;
  if (km < 10000) return [km.toFixed(0), "km"];
  return [(km / 1000).toFixed(2), "Mm"]; // Megametres for GEO+ altitudes
}

/** Relative velocity — km/s primary, switches to m/s under 0.1 km/s. */
export function fmtVelocity(v: number | null | undefined): FormattedValue {
  if (bad(v)) return [DASH, ""];
  const kmps = v as number;
  if (Math.abs(kmps) < 0.1) return [(kmps * 1000).toFixed(0), "m/s"];
  return [kmps.toFixed(2), "km/s"];
}

/** Split a PC into mantissa + exponent, with guards for null/0/non-finite. */
function parsePc(v: number | null | undefined): { m: number; e: number } | "zero" | "bad" {
  if (bad(v)) return "bad";
  const pc = v as number;
  if (pc <= 0) return "zero";
  const e = Math.floor(Math.log10(pc));
  return { m: pc / Math.pow(10, e), e };
}

/** Probability of collision — scientific with proper superscript. */
export function fmtPc(v: number | null | undefined): FormattedValue {
  const p = parsePc(v);
  if (p === "bad") return [DASH, ""];
  if (p === "zero") return ["0", ""];
  return [`${p.m.toFixed(2)}×10${sup(p.e)}`, ""];
}

/** Compact PC for tight cells (no ×10, just the e-notation). */
export function fmtPcCompact(v: number | null | undefined): FormattedValue {
  const p = parsePc(v);
  if (p === "bad") return [DASH, ""];
  if (p === "zero") return ["0", ""];
  return [`${p.m.toFixed(2)}e${p.e}`, ""];
}

export function fmtDeg(v: number | null | undefined): FormattedValue {
  if (bad(v)) return [DASH, ""];
  return [(v as number).toFixed(1), "°"];
}

export function fmtCount(v: number | null | undefined): FormattedValue {
  if (bad(v)) return [DASH, ""];
  const n = Math.round(v as number);
  if (Math.abs(n) >= 1000) return [(n / 1000).toFixed(1), "k"];
  return [String(n), ""];
}

export function fmtPct(v: number | null | undefined, fractional = false): FormattedValue {
  if (bad(v)) return [DASH, ""];
  const n = (v as number) * (fractional ? 100 : 1);
  return [n.toFixed(0), "%"];
}

export function fmtMs(v: number | null | undefined): FormattedValue {
  if (bad(v)) return [DASH, ""];
  const ms = v as number;
  if (ms < 1000) return [ms.toFixed(0), "ms"];
  if (ms < 60_000) return [(ms / 1000).toFixed(1), "s"];
  return [(ms / 60_000).toFixed(1), "min"];
}

/** Render `<value><dim unit>`. JSX-friendly; renderer is up to caller. */
export function joinUnit([value, unit]: FormattedValue): string {
  return unit ? `${value} ${unit}` : value;
}
