import { useMemo, useState } from "react";
import type { SatelliteDto } from "@/dto/http";
import { useOpsFilterStore, type RegimeKey } from "@/features/ops/opsFilterStore";

type TrailMode = "off" | "tails" | "full";
type RegimeFilterKey = "ALL" | RegimeKey;

/**
 * Regime visibility + trail-mode state. Derives:
 *   - `orbitRegimeFilter`: "ALL" unless exactly one regime is on
 *   - `filteredSats`: sats whose regime is currently visible
 *   - `regimeCounts`: per-regime totals across the unfiltered set
 *
 * Regime visibility is sourced from the shared ops filter store so the HUD
 * regime toggles and the left-rail ops filters stay in sync.
 */
export function useRegimeFilter(satellites: SatelliteDto[]) {
  const regimeVisible = useOpsFilterStore((s) => s.regimeVisible);
  const toggleRegime = useOpsFilterStore((s) => s.toggleRegime);

  const [trailMode, setTrailMode] = useState<TrailMode>("tails");

  const orbitRegimeFilter: RegimeFilterKey = useMemo(() => {
    const onKeys = (Object.keys(regimeVisible) as RegimeKey[]).filter(
      (k) => regimeVisible[k],
    );
    if (onKeys.length === 1 && onKeys[0]) return onKeys[0];
    return "ALL";
  }, [regimeVisible]);

  const { filteredSats, regimeCounts } = useMemo(() => {
    const counts: Record<RegimeKey, number> = { LEO: 0, MEO: 0, GEO: 0, HEO: 0 };
    for (const s of satellites) counts[s.regime as RegimeKey]++;
    const visibleSats = satellites.filter(
      (s) => regimeVisible[s.regime as RegimeKey],
    );
    return { filteredSats: visibleSats, regimeCounts: counts };
  }, [satellites, regimeVisible]);

  return {
    regimeVisible,
    toggleRegime,
    trailMode,
    setTrailMode,
    orbitRegimeFilter,
    filteredSats,
    regimeCounts,
  };
}
