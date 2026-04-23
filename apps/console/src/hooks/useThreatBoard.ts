import { useMemo } from "react";
import type { ConjunctionDto } from "@/dto/http";

/**
 * Derive the THREAT BOARD view: top-5 conjunctions by P(C), ≥1e-4 count,
 * peak P(C), and world-space label allow-list (primaries of top-3 only,
 * to keep 3D label density readable).
 */
export function useThreatBoard(conjunctions: ConjunctionDto[]) {
  return useMemo(() => {
    const valid = conjunctions.filter(
      (c) => c.minRangeKm > 0 && c.relativeVelocityKmps > 0,
    );
    const sorted = [...valid].sort(
      (a, b) => b.probabilityOfCollision - a.probabilityOfCollision,
    );
    const threats: ConjunctionDto[] = sorted.slice(0, 5);
    const highCount = valid.filter(
      (c) => c.probabilityOfCollision >= 1e-4,
    ).length;
    const peakPc = sorted[0]?.probabilityOfCollision ?? 0;
    const ids = new Set<number>();
    for (const c of sorted.slice(0, 3)) {
      ids.add(c.primaryId);
      ids.add(c.secondaryId);
    }
    return { threats, highCount, peakPc, labelIds: Array.from(ids) };
  }, [conjunctions]);
}
