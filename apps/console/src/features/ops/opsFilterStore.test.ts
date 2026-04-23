import { beforeEach, describe, expect, it } from "vitest";
import { useOpsFilterStore } from "./opsFilterStore";

beforeEach(() => {
  useOpsFilterStore.setState({
    regimeVisible: { LEO: true, MEO: true, GEO: true, HEO: true },
    pcThresholdExp: -8,
    provenance: { osint: true, field: true },
  });
});

describe("useOpsFilterStore", () => {
  it("toggles regimes, updates the pc threshold, and flips provenance flags", () => {
    useOpsFilterStore.getState().toggleRegime("GEO");
    useOpsFilterStore.getState().setPcThresholdExp(-4);
    useOpsFilterStore.getState().toggleProvenance("field");

    expect(useOpsFilterStore.getState().regimeVisible).toEqual({
      LEO: true,
      MEO: true,
      GEO: false,
      HEO: true,
    });
    expect(useOpsFilterStore.getState().pcThresholdExp).toBe(-4);
    expect(useOpsFilterStore.getState().provenance).toEqual({
      osint: true,
      field: false,
    });
  });
});
