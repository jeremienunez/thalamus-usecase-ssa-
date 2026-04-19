import { useMemo } from "react";
import type { ConjunctionDTO } from "@/shared/types";

/**
 * Derive the THREAT BOARD view: top-5 conjunctions by P(C), ≥1e-4 count,
 * peak P(C), and world-space label allow-list (primaries of top-3 only,
 * to keep 3D label density readable).
 */
export function useThreatBoard(conjunctions: ConjunctionDTO[]) {
  return useMemo(() => {
    const sorted = [...conjunctions].sort(
      (a, b) => b.probabilityOfCollision - a.probabilityOfCollision,
    );
    const threats: ConjunctionDTO[] = sorted.slice(0, 5);
    const highCount = conjunctions.filter(
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
