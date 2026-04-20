import { create } from "zustand";

export type RegimeKey = "LEO" | "MEO" | "GEO" | "HEO";

type State = {
  regimeVisible: Record<RegimeKey, boolean>;
  toggleRegime: (k: RegimeKey) => void;
  pcThresholdExp: number;
  setPcThresholdExp: (e: number) => void;
  provenance: { osint: boolean; field: boolean };
  toggleProvenance: (k: "osint" | "field") => void;
};

export const useOpsFilterStore = create<State>((set) => ({
  regimeVisible: { LEO: true, MEO: true, GEO: true, HEO: true },
  toggleRegime: (k) =>
    set((s) => ({ regimeVisible: { ...s.regimeVisible, [k]: !s.regimeVisible[k] } })),
  pcThresholdExp: -8,
  setPcThresholdExp: (e) => set({ pcThresholdExp: e }),
  provenance: { osint: true, field: true },
  toggleProvenance: (k) =>
    set((s) => ({ provenance: { ...s.provenance, [k]: !s.provenance[k] } })),
}));
