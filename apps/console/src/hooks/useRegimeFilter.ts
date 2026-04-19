import { useMemo, useState } from "react";
import type { SatelliteDTO } from "@/shared/types";

type RegimeKey = "LEO" | "MEO" | "GEO" | "HEO";
type TrailMode = "off" | "tails" | "full";
type RegimeFilterKey = "ALL" | RegimeKey;

/**
 * Regime visibility + trail-mode state. Derives:
 *   - `orbitRegimeFilter`: "ALL" unless exactly one regime is on
 *   - `filteredSats`: sats whose regime is currently visible
 *   - `regimeCounts`: per-regime totals across the unfiltered set
 */
export function useRegimeFilter(satellites: SatelliteDTO[]) {
  const [regimeVisible, setRegimeVisible] = useState<Record<RegimeKey, boolean>>({
    LEO: true,
    MEO: true,
    GEO: true,
    HEO: true,
  });
  const toggleRegime = (k: RegimeKey) =>
    setRegimeVisible((v) => ({ ...v, [k]: !v[k] }));

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
