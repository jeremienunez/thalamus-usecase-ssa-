import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  conjunctionFixture,
  satelliteFixture,
} from "../../../tests/ssa-fixtures";
import { useOpsFilterStore } from "./opsFilterStore";

type SatelliteListData = { items: ReturnType<typeof satelliteFixture>[] };
type ConjunctionListData = { items: ReturnType<typeof conjunctionFixture>[] };
type EntryTestState = {
  satQuery: {
    data: SatelliteListData | undefined;
    isLoading: boolean;
  };
  cjQuery: {
    filtered: ConjunctionListData | undefined;
    board: ConjunctionListData | undefined;
  };
  openDrawer: ReturnType<typeof vi.fn<(id: string) => void>>;
  regimeFilter: {
    regimeVisible: { LEO: boolean; MEO: boolean; GEO: boolean; HEO: boolean };
    toggleRegime: ReturnType<typeof vi.fn<(key: "LEO" | "MEO" | "GEO" | "HEO") => void>>;
    trailMode: "off" | "tails" | "full";
    setTrailMode: ReturnType<typeof vi.fn<(mode: "off" | "tails" | "full") => void>>;
    orbitRegimeFilter: "ALL" | "LEO" | "MEO" | "GEO" | "HEO";
    filteredSats: ReturnType<typeof satelliteFixture>[];
    regimeCounts: { LEO: number; MEO: number; GEO: number; HEO: number };
  };
  threatBoard: {
    threats: ReturnType<typeof conjunctionFixture>[];
    highCount: number;
    peakPc: number;
    labelIds: number[];
  };
  timeControl: {
    speedIdx: number;
    paused: boolean;
    effectiveSpeed: number | null;
    togglePause: ReturnType<typeof vi.fn<() => void>>;
    selectSpeed: ReturnType<typeof vi.fn<(index: number) => void>>;
  };
  sceneProps: Array<Record<string, unknown>>;
  drawerProps: Array<Record<string, unknown>>;
  findingsProps: Array<Record<string, unknown>>;
};

const state: EntryTestState = vi.hoisted(() => ({
  satQuery: {
    data: undefined,
    isLoading: false,
  },
  cjQuery: {
    filtered: undefined,
    board: undefined,
  },
  openDrawer: vi.fn<(id: string) => void>(),
  regimeFilter: {
    regimeVisible: { LEO: true, MEO: true, GEO: false, HEO: true },
    toggleRegime: vi.fn<(key: "LEO" | "MEO" | "GEO" | "HEO") => void>(),
    trailMode: "tails",
    setTrailMode: vi.fn<(mode: "off" | "tails" | "full") => void>(),
    orbitRegimeFilter: "ALL",
    filteredSats: Array<ReturnType<typeof satelliteFixture>>(),
    regimeCounts: { LEO: 0, MEO: 0, GEO: 0, HEO: 0 },
  },
  threatBoard: {
    threats: Array<ReturnType<typeof conjunctionFixture>>(),
    highCount: 0,
    peakPc: 0,
    labelIds: Array<number>(),
  },
  timeControl: {
    speedIdx: 1,
    paused: false,
    effectiveSpeed: 60,
    togglePause: vi.fn<() => void>(),
    selectSpeed: vi.fn<(index: number) => void>(),
  },
  sceneProps: Array<Record<string, unknown>>(),
  drawerProps: Array<Record<string, unknown>>(),
  findingsProps: Array<Record<string, unknown>>(),
}));

vi.mock("@/hooks/useTimeControl", () => ({
  useTimeControl: () => state.timeControl,
}));

vi.mock("@/hooks/useRegimeFilter", () => ({
  useRegimeFilter: () => state.regimeFilter,
}));

vi.mock("@/hooks/useThreatBoard", () => ({
  useThreatBoard: () => state.threatBoard,
}));

vi.mock("@/usecases/useSatellitesQuery", () => ({
  useSatellitesQuery: () => state.satQuery,
}));

vi.mock("@/usecases/useConjunctionsQuery", () => ({
  useConjunctionsQuery: (threshold: number) => ({
    data: threshold === 0 ? state.cjQuery.board : state.cjQuery.filtered,
  }),
}));

vi.mock("@/shared/ui/uiStore", () => ({
  useUiStore: (
    selector: (value: { openDrawer: typeof state.openDrawer }) => unknown,
  ) => selector({ openDrawer: state.openDrawer }),
}));

vi.mock("./OpsScene", () => ({
  OpsScene: (props: {
    selectedId: number | null;
    focusId: number | null;
    effectiveSpeed: number;
    conjunctions: ReturnType<typeof conjunctionFixture>[];
    onSelectSatellite: (id: number) => void;
    onFocusDone: () => void;
  }) => {
    state.sceneProps.push(props);
    return (
      <div data-testid="ops-scene">
        <div>{`scene:selected=${props.selectedId ?? "none"};focus=${props.focusId ?? "none"};speed=${props.effectiveSpeed};cj=${props.conjunctions.length}`}</div>
        <button type="button" onClick={() => props.onSelectSatellite(100)}>
          scene-select
        </button>
        <button type="button" onClick={props.onFocusDone}>
          scene-focus-done
        </button>
      </div>
    );
  },
}));

vi.mock("./SatelliteSearch", () => ({
  SatelliteSearch: (props: {
    satellites: ReturnType<typeof satelliteFixture>[];
    onPick: (sat: ReturnType<typeof satelliteFixture>) => void;
  }) => (
    <div data-testid="sat-search">
      <div>{`search:${props.satellites.length}`}</div>
      <button
        type="button"
        onClick={() => {
          const sat = props.satellites[1] ?? props.satellites[0];
          if (sat) props.onPick(sat);
        }}
      >
        search-pick
      </button>
    </div>
  ),
}));

vi.mock("./FindingsPanel", () => ({
  FindingsPanel: (props: {
    selectedSatellite: ReturnType<typeof satelliteFixture> | null;
    onFocusSat: (sat: ReturnType<typeof satelliteFixture>) => void;
  }) => {
    state.findingsProps.push(props);
    return (
      <div data-testid="findings-panel">
        <div>{`findings:selected=${props.selectedSatellite?.id ?? "none"}`}</div>
        <button
          type="button"
          onClick={() =>
            props.onFocusSat(
              satelliteFixture({ id: 300, name: "FOCUS-ME", noradId: 300 }),
            )
          }
        >
          findings-focus
        </button>
      </div>
    );
  },
}));

vi.mock("./RegimeFilter", () => ({
  RegimeFilter: (props: {
    trailMode: "off" | "tails" | "full";
    onToggle: (key: "LEO" | "MEO" | "GEO" | "HEO") => void;
    onTrailMode: (mode: "off" | "tails" | "full") => void;
  }) => (
    <div data-testid="regime-filter">
      <div>{`trail:${props.trailMode}`}</div>
      <button type="button" onClick={() => props.onToggle("GEO")}>
        regime-toggle
      </button>
      <button type="button" onClick={() => props.onTrailMode("full")}>
        regime-trail
      </button>
    </div>
  ),
}));

vi.mock("./OpsTelemetryPanel", () => ({
  OpsTelemetryPanel: (props: {
    loadingSats: boolean;
    satelliteCount: number;
    conjunctionCount: number;
    highCount: number;
    peakPc: number;
    paused: boolean;
  }) => (
    <div data-testid="telemetry">
      {`telemetry:${props.loadingSats}:${props.satelliteCount}:${props.conjunctionCount}:${props.highCount}:${props.peakPc}:${props.paused}`}
    </div>
  ),
}));

vi.mock("./ThreatBoardPanel", () => ({
  ThreatBoardPanel: (props: {
    threats: ReturnType<typeof conjunctionFixture>[];
    selectedThreatId?: number | null;
    onSelectThreat: (threat: ReturnType<typeof conjunctionFixture>) => void;
    onFocusSatellite: (satelliteId: number, threat: ReturnType<typeof conjunctionFixture>) => void;
  }) => (
    <div data-testid="threat-board">
      <div>{`threats:${props.threats.length};selected=${props.selectedThreatId ?? "none"}`}</div>
      <button
        type="button"
        onClick={() => {
          const threat = props.threats[0];
          if (threat) props.onSelectThreat(threat);
        }}
      >
        threat-select
      </button>
      <button
        type="button"
        onClick={() => {
          const threat = props.threats[0];
          if (threat) props.onFocusSatellite(threat.secondaryId, threat);
        }}
      >
        threat-focus
      </button>
    </div>
  ),
}));

vi.mock("./OpsInfoStack", () => ({
  OpsInfoStack: () => <div data-testid="ops-info-stack">info-stack</div>,
}));

vi.mock("./TimeControlPanel", () => ({
  TimeControlPanel: (props: {
    paused: boolean;
    speedIdx: number;
    onTogglePause: () => void;
    onSelectSpeed: (index: number) => void;
  }) => (
    <div data-testid="time-control">
      <div>{`time:${props.paused}:${props.speedIdx}`}</div>
      <button type="button" onClick={props.onTogglePause}>
        time-toggle
      </button>
      <button type="button" onClick={() => props.onSelectSpeed(3)}>
        time-speed
      </button>
    </div>
  ),
}));

vi.mock("./OpsDrawer", () => ({
  OpsDrawer: (props: {
    satellite: ReturnType<typeof satelliteFixture> | null;
    conjunctions: ReturnType<typeof conjunctionFixture>[];
    selectedConjunctionId?: number | null;
  }) => {
    state.drawerProps.push(props);
    return (
      <div data-testid="ops-drawer">
        {`drawer:sat=${props.satellite?.id ?? "none"};cj=${props.conjunctions.length};selected=${props.selectedConjunctionId ?? "none"}`}
      </div>
    );
  },
}));

import { OpsEntry as OpsEntryFromIndex } from "./index";

beforeEach(() => {
  state.satQuery.data = {
    items: [
      satelliteFixture({ id: 100, name: "ISS" }),
      satelliteFixture({ id: 200, name: "STARLINK-1000", noradId: 200 }),
      satelliteFixture({ id: 300, name: "FOCUS-ME", noradId: 300 }),
    ],
  };
  state.satQuery.isLoading = true;
  state.cjQuery.filtered = {
    items: [
      conjunctionFixture({ id: 11, primaryId: 100, secondaryId: 200 }),
      conjunctionFixture({ id: 12, primaryId: 200, secondaryId: 300 }),
    ],
  };
  state.cjQuery.board = {
    items: [
      conjunctionFixture({ id: 11, primaryId: 100, secondaryId: 200, probabilityOfCollision: 3e-4 }),
    ],
  };
  state.regimeFilter = {
    regimeVisible: { LEO: true, MEO: true, GEO: false, HEO: true },
    toggleRegime: vi.fn(),
    trailMode: "tails",
    setTrailMode: vi.fn(),
    orbitRegimeFilter: "ALL",
    filteredSats: state.satQuery.data.items,
    regimeCounts: { LEO: 2, MEO: 0, GEO: 1, HEO: 0 },
  };
  state.threatBoard = {
    threats: state.cjQuery.board.items,
    highCount: 1,
    peakPc: 3e-4,
    labelIds: [100, 200],
  };
  state.timeControl = {
    speedIdx: 1,
    paused: false,
    effectiveSpeed: 60,
    togglePause: vi.fn(),
    selectSpeed: vi.fn(),
  };
  state.openDrawer.mockReset();
  state.sceneProps = [];
  state.drawerProps = [];
  state.findingsProps = [];
  useOpsFilterStore.setState({
    regimeVisible: { LEO: true, MEO: true, GEO: true, HEO: true },
    pcThresholdExp: -6,
    provenance: { osint: true, field: true },
  });
});

describe("OpsEntry", () => {
  it("wires selection, search, threat focus, and drawer filtering through the ops shell", async () => {
    const user = userEvent.setup();
    render(<OpsEntryFromIndex />);

    expect(screen.getByTestId("telemetry")).toHaveTextContent(
      "telemetry:true:3:1:1:0.0003:false",
    );
    expect(screen.getByTestId("ops-info-stack")).toHaveTextContent("info-stack");
    expect(screen.getByText("scene:selected=none;focus=none;speed=60;cj=2")).toBeInTheDocument();
    expect(screen.getByText("drawer:sat=none;cj=0;selected=none")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "scene-select" }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("sat:100");
    expect(screen.getByText("scene:selected=100;focus=none;speed=60;cj=2")).toBeInTheDocument();
    expect(screen.getByText("drawer:sat=100;cj=1;selected=none")).toBeInTheDocument();
    expect(screen.getByText("findings:selected=100")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "search-pick" }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("sat:200");
    expect(screen.getByText("scene:selected=200;focus=200;speed=60;cj=2")).toBeInTheDocument();
    expect(screen.getByText("drawer:sat=200;cj=2;selected=none")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "scene-focus-done" }));
    expect(screen.getByText("scene:selected=200;focus=none;speed=60;cj=2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "threat-select" }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("sat:100");
    expect(screen.getByText("drawer:sat=100;cj=1;selected=11")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "threat-focus" }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("sat:200");
    expect(screen.getByText("scene:selected=200;focus=200;speed=60;cj=2")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "findings-focus" }));
    expect(state.openDrawer).toHaveBeenLastCalledWith("sat:300");
    expect(screen.getByText("scene:selected=300;focus=300;speed=60;cj=2")).toBeInTheDocument();
    expect(screen.getByText("drawer:sat=300;cj=1;selected=none")).toBeInTheDocument();
  });

  it("forwards regime and time controls to their hooks", async () => {
    const user = userEvent.setup();
    render(<OpsEntryFromIndex />);

    await user.click(screen.getByRole("button", { name: "regime-toggle" }));
    await user.click(screen.getByRole("button", { name: "regime-trail" }));
    await user.click(screen.getByRole("button", { name: "time-toggle" }));
    await user.click(screen.getByRole("button", { name: "time-speed" }));

    expect(state.regimeFilter.toggleRegime).toHaveBeenCalledWith("GEO");
    expect(state.regimeFilter.setTrailMode).toHaveBeenCalledWith("full");
    expect(state.timeControl.togglePause).toHaveBeenCalled();
    expect(state.timeControl.selectSpeed).toHaveBeenCalledWith(3);
  });

  it("falls back to empty query data and default scene speed when query payloads are absent", () => {
    state.satQuery.data = undefined;
    state.cjQuery.filtered = undefined;
    state.cjQuery.board = undefined;
    state.regimeFilter.filteredSats = [];
    state.threatBoard = {
      threats: [],
      highCount: 0,
      peakPc: 0,
      labelIds: [],
    };
    state.timeControl.effectiveSpeed = null;

    render(<OpsEntryFromIndex />);

    expect(screen.getByTestId("telemetry")).toHaveTextContent(
      "telemetry:true:0:0:0:0:false",
    );
    expect(screen.getByText("scene:selected=none;focus=none;speed=1;cj=0")).toBeInTheDocument();
    expect(screen.getByText("drawer:sat=none;cj=0;selected=none")).toBeInTheDocument();
  });
});
