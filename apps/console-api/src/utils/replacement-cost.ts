import type {
  ReplacementCostRawRow,
  ReplacementCostRow,
} from "../types/satellite.types";

const FALLBACK_MASS_KG = 500;
const USD_PER_KG_BUS = 50_000;
const USD_PER_PAYLOAD_FIXED = 10_000_000;
const USD_PER_KG_LAUNCH = 10_000;

export function computeReplacementCost(
  row: ReplacementCostRawRow,
): ReplacementCostRow {
  const massKg = row.massKg ?? FALLBACK_MASS_KG;
  const payloadCount = Math.max(row.payloadNames.length, 1);
  const bus = massKg * USD_PER_KG_BUS;
  const payload = payloadCount * USD_PER_PAYLOAD_FIXED;
  const launch = massKg * USD_PER_KG_LAUNCH;
  const mid = bus + payload + launch;

  return {
    ...row,
    estimatedCost: {
      low: Math.round(mid * 0.7),
      mid: Math.round(mid),
      high: Math.round(mid * 1.3),
      currency: "USD",
    },
    breakdown: {
      bus: Math.round(bus),
      payload: Math.round(payload),
      launch: Math.round(launch),
    },
  };
}
