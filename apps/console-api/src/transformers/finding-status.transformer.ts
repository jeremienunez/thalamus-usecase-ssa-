import type { FindingStatus } from "@interview/shared";

export function mapFindingStatus(s: string): FindingStatus {
  const l = s.toLowerCase();
  if (l === "archived") return "accepted";
  if (l === "invalidated") return "rejected";
  if (l === "active") return "pending";
  return "in-review";
}

export function toDbStatus(s: string): "active" | "archived" | "invalidated" {
  if (s === "accepted") return "archived";
  if (s === "rejected") return "invalidated";
  return "active";
}

export function parseFindingId(raw: string): bigint | null {
  const s = raw.startsWith("f:") ? raw.slice(2) : raw;
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
