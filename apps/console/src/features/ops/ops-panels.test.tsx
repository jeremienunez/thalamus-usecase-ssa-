import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conjunctionFixture,
  findingFixture,
  satelliteFixture,
} from "../../../tests/ssa-fixtures";

type FindingListData = {
  items: ReturnType<typeof findingFixture>[];
  count: number;
};
type SatelliteListData = {
  items: ReturnType<typeof satelliteFixture>[];
  count: number;
};
type ConjunctionListData = {
  items: ReturnType<typeof conjunctionFixture>[];
  count: number;
};
type CyclesData = {
  items: Array<{ kind: "thalamus" | "fish" | "both"; findingsEmitted: number }>;
};
type OpsPanelsState = {
  findings: {
    data: FindingListData | undefined;
    isLoading: boolean;
  };
  launch: {
    isPending: boolean;
    mutate: ReturnType<typeof vi.fn<(kind: "thalamus" | "fish" | "both") => void>>;
  };
  cycles: {
    data: CyclesData | undefined;
  };
  satellites: {
    data: SatelliteListData | undefined;
  };
  conjunctions: {
    data: ConjunctionListData | undefined;
  };
};

const state: OpsPanelsState = vi.hoisted(() => ({
  findings: {
    data: undefined,
    isLoading: false,
  },
  launch: {
    isPending: false,
    mutate: vi.fn<(kind: "thalamus" | "fish" | "both") => void>(),
  },
  cycles: {
    data: undefined,
  },
  satellites: {
    data: undefined,
  },
  conjunctions: {
    data: undefined,
  },
}));

vi.mock("@/usecases", () => ({
  useFindings: () => state.findings,
  useLaunchCycle: () => state.launch,
  useCycles: () => state.cycles,
  useSatellites: () => state.satellites,
  useConjunctions: () => state.conjunctions,
}));

vi.mock("@/hooks/useUtcClock", () => ({
  useUtcClock: () => ({
    utc: "12:34:56",
    date: "2026-04-23",
  }),
}));

import { CycleLaunchPanel } from "./CycleLaunchPanel";
import { FindingsPanel } from "./FindingsPanel";
import { OpsInfoStack } from "./OpsInfoStack";
import { OpsTelemetryPanel } from "./OpsTelemetryPanel";
import { RegimeFilter } from "./RegimeFilter";
import { SatelliteSearch } from "./SatelliteSearch";
import { TelemetryStrip } from "./TelemetryStrip";
import { ThreatBoardPanel } from "./ThreatBoardPanel";
import { TimeControlPanel } from "./TimeControlPanel";

function triggerReactClick(node: Element) {
  const reactPropsKey = Reflect.ownKeys(node).find(
    (key) => typeof key === "string" && key.startsWith("__reactProps"),
  );
  if (!reactPropsKey) return;
  const reactProps = Reflect.get(node, reactPropsKey);
  const onClick = Reflect.get(reactProps, "onClick");
  if (typeof onClick === "function") onClick();
}

function triggerReactHandler(
  node: Element,
  handlerName: string,
  payload: Record<string, unknown>,
) {
  const reactPropsKey = Reflect.ownKeys(node).find(
    (key) => typeof key === "string" && key.startsWith("__reactProps"),
  );
  if (!reactPropsKey) return;
  const reactProps = Reflect.get(node, reactPropsKey);
  const handler = Reflect.get(reactProps, handlerName);
  if (typeof handler === "function") handler(payload);
}

beforeEach(() => {
  state.findings.data = undefined;
  state.findings.isLoading = false;
  state.launch.isPending = false;
  state.launch.mutate.mockReset();
  state.cycles.data = undefined;
  state.satellites.data = undefined;
  state.conjunctions.data = undefined;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ops panels", () => {
  it("launches cycles and reflects pending/latest state", async () => {
    const user = userEvent.setup();
    state.cycles.data = { items: [{ kind: "fish", findingsEmitted: 4 }] };

    const { rerender } = render(<CycleLaunchPanel />);

    expect(screen.getByText("CYCLE LAUNCHER")).toBeInTheDocument();
    expect(screen.getByText("last FISH · +4")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /THALAMUS/i }));
    await user.click(screen.getByRole("button", { name: /FISH/i }));
    await user.click(screen.getByRole("button", { name: /BOTH/i }));

    expect(state.launch.mutate).toHaveBeenNthCalledWith(1, "thalamus");
    expect(state.launch.mutate).toHaveBeenNthCalledWith(2, "fish");
    expect(state.launch.mutate).toHaveBeenNthCalledWith(3, "both");

    state.launch.isPending = true;
    rerender(<CycleLaunchPanel />);

    expect(screen.getByText("CYCLE · RUNNING")).toBeInTheDocument();

    triggerReactClick(screen.getByRole("button", { name: /THALAMUS/i }));
    expect(state.launch.mutate).toHaveBeenCalledTimes(3);
  });

  it("searches satellites, ranks matches, and supports keyboard commit", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    const satellites = [
      satelliteFixture({ id: 1, name: "STARLINK-200", noradId: 9001, opacityScore: 0.92 }),
      satelliteFixture({ id: 2, name: "ALPHA", noradId: 12345, opacityScore: 0 }),
      satelliteFixture({ id: 3, name: "BETA STAR", noradId: 77 }),
    ];

    render(<SatelliteSearch satellites={satellites} onPick={onPick} />);

    fireEvent.keyDown(window, { key: "/" });
    const input = screen.getByPlaceholderText(/search satellite/i);
    expect(input).toHaveFocus();

    await user.type(input, "star");

    const options = screen.getAllByRole("button");
    expect(options[0]).toHaveTextContent("STARLINK-200");
    expect(options[0]).toHaveTextContent("gap 0.92");
    expect(options[1]).toHaveTextContent("BETA STAR");
    expect(screen.getByText("2")).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
    expect(input).toHaveValue("");
  });

  it("closes the search dropdown on escape and outside click", async () => {
    const user = userEvent.setup();
    render(
      <SatelliteSearch
        satellites={[satelliteFixture({ id: 1, name: "ISS" })]}
        onPick={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/search satellite/i);
    await user.type(input, "iss");
    expect(screen.getByRole("button", { name: /ISS/i })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("button", { name: /ISS/i })).not.toBeInTheDocument();

    await user.type(input, "iss");
    expect(screen.getByRole("button", { name: /ISS/i })).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("button", { name: /ISS/i })).not.toBeInTheDocument();
  });

  it("matches by norad, clamps arrow-up, reopens on focus, and ignores slash inside inputs", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();

    render(
      <SatelliteSearch
        satellites={[
          satelliteFixture({ id: 1, name: "ALPHA", noradId: 77001 }),
          satelliteFixture({ id: 2, name: "BETA", noradId: 17777 }),
          satelliteFixture({ id: 3, name: "GAMMA", noradId: 42 }),
        ]}
        onPick={onPick}
      />,
    );

    const input = screen.getByPlaceholderText(/search satellite/i);
    input.focus();
    fireEvent.keyDown(input, { key: "/", target: input });
    expect(input).toHaveFocus();

    await user.type(input, "77");
    fireEvent.keyDown(input, { key: "ArrowUp" });
    const beta = screen.getByRole("button", { name: /BETA/i });
    fireEvent.mouseEnter(beta);
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 2 }));

    await user.type(input, "alp");
    fireEvent.focus(input);
    expect(screen.getByRole("button", { name: /ALPHA/i })).toBeInTheDocument();
  });

  it("commits a satellite search through a direct mouse click", async () => {
    const user = userEvent.setup();
    const onPick = vi.fn();
    render(
      <SatelliteSearch
        satellites={[satelliteFixture({ id: 1, name: "ISS" })]}
        onPick={onPick}
      />,
    );

    const input = screen.getByPlaceholderText(/search satellite/i);
    await user.type(input, "iss");
    await user.click(screen.getByRole("button", { name: /ISS/i }));

    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });

  it("filters and focuses findings for the selected satellite", async () => {
    const user = userEvent.setup();
    const onFocusSat = vi.fn();
    const satellites = [
      satelliteFixture({ id: 100, name: "ISS" }),
      satelliteFixture({ id: 200, name: "STARLINK-1000" }),
    ];
    state.findings.data = {
      items: [
        findingFixture({
          id: "f:1",
          title: "Older unrelated",
          createdAt: "2026-04-21T00:00:00.000Z",
          linkedEntityIds: [],
          status: "pending",
          cortex: "opacity-scout",
        }),
        findingFixture({
          id: "f:2",
          title: "Relevant recent",
          createdAt: "2026-04-23T00:00:00.000Z",
          linkedEntityIds: ["sat:100"],
          status: "accepted",
          cortex: "conjunction-analysis",
        }),
        findingFixture({
          id: "f:3",
          title: "Missing satellite mapping",
          createdAt: "2026-04-22T12:00:00.000Z",
          linkedEntityIds: ["sat:404"],
          status: "rejected",
          cortex: "classification-auditor",
        }),
      ],
      count: 3,
    };

    const { rerender } = render(
      <FindingsPanel
        satellites={satellites}
        selectedSatellite={null}
        onFocusSat={onFocusSat}
      />,
    );

    expect(screen.getByText("RECENT FINDINGS")).toBeInTheDocument();
    expect(screen.getByText("3 / 3")).toBeInTheDocument();

    rerender(
      <FindingsPanel
        satellites={satellites}
        selectedSatellite={satellites[0] ?? null}
        onFocusSat={onFocusSat}
      />,
    );

    expect(screen.getByText("FINDINGS · ISS")).toBeInTheDocument();
    expect(screen.getByText("Relevant recent")).toBeInTheDocument();
    expect(screen.queryByText("Older unrelated")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Focus satellite 100/i }));
    expect(onFocusSat).toHaveBeenCalledWith(expect.objectContaining({ id: 100 }));
  });

  it("shows the empty findings copy for selected and global views", () => {
    state.findings.data = { items: [], count: 0 };
    const satellites = [satelliteFixture({ id: 100, name: "ISS" })];

    const { rerender } = render(
      <FindingsPanel
        satellites={satellites}
        selectedSatellite={null}
        onFocusSat={vi.fn()}
      />,
    );

    expect(screen.getByText(/No findings yet/i)).toBeInTheDocument();

    rerender(
      <FindingsPanel
        satellites={satellites}
        selectedSatellite={satellites[0] ?? null}
        onFocusSat={vi.fn()}
      />,
    );

    expect(screen.getByText(/No findings linked to this satellite yet/i)).toBeInTheDocument();
  });

  it("falls back to zero counts when findings data is absent", () => {
    state.findings.data = undefined;
    state.findings.isLoading = false;

    render(
      <FindingsPanel
        satellites={[]}
        selectedSatellite={null}
        onFocusSat={vi.fn()}
      />,
    );

    expect(screen.getByText("0 / 0")).toBeInTheDocument();
  });

  it("shows loading counts and does not focus when the linked satellite is absent", async () => {
    const user = userEvent.setup();
    const onFocusSat = vi.fn();
    state.findings.isLoading = true;
    state.findings.data = {
      items: [
        findingFixture({
          id: "f:404",
          title: "Unknown mapping",
          linkedEntityIds: ["sat:404"],
          status: "in-review",
          cortex: "strategist",
        }),
      ],
      count: 1,
    };

    render(
      <FindingsPanel
        satellites={[satelliteFixture({ id: 100, name: "ISS" })]}
        selectedSatellite={null}
        onFocusSat={onFocusSat}
      />,
    );

    expect(screen.getByText("…")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Focus satellite 404/i }));
    expect(onFocusSat).not.toHaveBeenCalled();
  });

  it("renders regime toggles and optional trail controls", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const onTrailMode = vi.fn();

    const { rerender } = render(
      <RegimeFilter
        visible={{ LEO: true, MEO: false, GEO: true, HEO: true }}
        onToggle={onToggle}
        counts={{ LEO: 3, GEO: 1 }}
        trailMode="tails"
        onTrailMode={onTrailMode}
      />,
    );

    expect(screen.getByText("TRAILS")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "LEO 3" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "MEO 0" })).toHaveClass("opacity-40");
    await user.click(screen.getByRole("button", { name: "HEO 0" }));
    await user.click(screen.getByRole("button", { name: "FULL" }));

    expect(onToggle).toHaveBeenCalledWith("HEO");
    expect(onTrailMode).toHaveBeenCalledWith("full");

    rerender(
      <RegimeFilter
        visible={{ LEO: true, MEO: true, GEO: true, HEO: true }}
        onToggle={onToggle}
        counts={{}}
      />,
    );

    expect(screen.queryByText("TRAILS")).not.toBeInTheDocument();
  });

  it("hides trail controls when the callback is missing even if trailMode is present", () => {
    render(
      <RegimeFilter
        visible={{ LEO: true, MEO: true, GEO: true, HEO: true }}
        onToggle={vi.fn()}
        counts={{}}
        trailMode="off"
      />,
    );

    expect(screen.queryByText("TRAILS")).not.toBeInTheDocument();
  });

  it("hides trail controls when the mode is undefined even if a callback exists", () => {
    render(
      <RegimeFilter
        visible={{ LEO: true, MEO: true, GEO: true, HEO: true }}
        onToggle={vi.fn()}
        counts={{}}
        onTrailMode={vi.fn()}
      />,
    );

    expect(screen.queryByText("TRAILS")).not.toBeInTheDocument();
  });

  it("defaults missing regime visibility keys to visible", () => {
    const visible = { LEO: true, MEO: true, GEO: true, HEO: true };
    Reflect.deleteProperty(visible, "HEO");

    render(
      <RegimeFilter
        visible={visible}
        onToggle={vi.fn()}
        counts={{ HEO: 4 }}
      />,
    );

    expect(screen.getByRole("button", { name: "HEO 4" })).not.toHaveClass("opacity-40");
  });

  it("renders the info stack clock, legend, and embedded launcher", () => {
    render(<OpsInfoStack />);

    expect(screen.getByText("UTC")).toBeInTheDocument();
    expect(screen.getByText("12:34:56")).toBeInTheDocument();
    expect(screen.getByText("2026-04-23")).toBeInTheDocument();
    expect(screen.getByText("LEGEND")).toBeInTheDocument();
    expect(screen.getByText("CYCLE LAUNCHER")).toBeInTheDocument();
  });

  it("renders telemetry tiles in loading and live modes", () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <OpsTelemetryPanel
        loadingSats={true}
        satelliteCount={0}
        conjunctionCount={1}
        highCount={0}
        peakPc={1e-8}
        paused={false}
      />,
    );

    expect(screen.getByText("LIVE TELEMETRY")).toBeInTheDocument();
    expect(screen.getByText("SSA / OPS")).toBeInTheDocument();

    rerender(
      <OpsTelemetryPanel
        loadingSats={false}
        satelliteCount={321}
        conjunctionCount={8}
        highCount={2}
        peakPc={2e-4}
        paused={true}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("TELEMETRY · PAUSED")).toBeInTheDocument();
    expect(screen.getByText("321")).toBeInTheDocument();
    expect(screen.getByText("8")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });

  it("renders the amber peak-pc accent band", () => {
    vi.useFakeTimers();
    render(
      <OpsTelemetryPanel
        loadingSats={false}
        satelliteCount={1}
        conjunctionCount={1}
        highCount={0}
        peakPc={5e-5}
        paused={false}
      />,
    );

    act(() => {
      vi.advanceTimersByTime(500);
    });

    expect(screen.getByText("5.00e-5")).toBeInTheDocument();
  });

  it("toggles pause and speed selections", async () => {
    const user = userEvent.setup();
    const onTogglePause = vi.fn();
    const onSelectSpeed = vi.fn();

    render(
      <TimeControlPanel
        paused={false}
        speedIdx={1}
        labels={["1×", "1m", "10m"]}
        fullLabels={["REAL-TIME", "1 MIN / S", "10 MIN / S"]}
        onTogglePause={onTogglePause}
        onSelectSpeed={onSelectSpeed}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Pause" }));
    await user.click(screen.getByRole("button", { name: "Speed 10 MIN / S" }));

    expect(onTogglePause).toHaveBeenCalled();
    expect(onSelectSpeed).toHaveBeenCalledWith(2);
  });

  it("renders the paused time control state with play semantics", async () => {
    const user = userEvent.setup();
    const onTogglePause = vi.fn();

    render(
      <TimeControlPanel
        paused={true}
        speedIdx={0}
        labels={["1×"]}
        fullLabels={["REAL-TIME"]}
        onTogglePause={onTogglePause}
        onSelectSpeed={vi.fn()}
      />,
    );

    expect(screen.getByText("PAUSED")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Play" }));
    expect(onTogglePause).toHaveBeenCalledTimes(1);
  });

  it("renders threat board empty state, keyboard selection, and satellite focus", async () => {
    const user = userEvent.setup();
    const onSelectThreat = vi.fn();
    const onFocusSatellite = vi.fn();
    const { rerender } = render(
      <ThreatBoardPanel threats={[]} />,
    );

    expect(screen.getByText("— no events —")).toBeInTheDocument();

    rerender(
      <ThreatBoardPanel
        threats={[
          conjunctionFixture({
            id: 1,
            probabilityOfCollision: 2e-4,
            action: "maneuver_candidate",
            covarianceQuality: "HIGH",
          }),
          conjunctionFixture({
            id: 2,
            probabilityOfCollision: 2e-7,
            action: "no_action",
            covarianceQuality: "LOW",
            secondaryName: "OBJECT-2",
          }),
        ]}
        selectedThreatId={1}
        onSelectThreat={onSelectThreat}
        onFocusSatellite={onFocusSatellite}
      />,
    );

    const row = screen.getByRole("button", {
      name: /Focus conjunction ISS to STARLINK-1000/i,
    });
    row.focus();
    fireEvent.keyDown(row, { key: " " });

    expect(onSelectThreat).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));

    await user.click(screen.getByRole("button", { name: /Focus satellite OBJECT-2/i }));
    expect(onFocusSatellite).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ id: 2 }),
    );
  });

  it("renders passive threat rows without selection handlers", () => {
    render(
      <ThreatBoardPanel
        threats={[
          conjunctionFixture({
            id: 3,
            probabilityOfCollision: 6e-8,
            action: "no_action",
            covarianceQuality: "LOW",
          }),
        ]}
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Focus conjunction ISS to STARLINK-1000/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("6.00e-8")).toBeInTheDocument();
  });

  it("ignores non-activation keys on selectable threat rows", () => {
    const onSelectThreat = vi.fn();
    render(
      <ThreatBoardPanel
        threats={[conjunctionFixture({ id: 4, probabilityOfCollision: 1e-4 })]}
        onSelectThreat={onSelectThreat}
      />,
    );

    const row = screen.getByRole("button", {
      name: /Focus conjunction ISS to STARLINK-1000/i,
    });
    fireEvent.keyDown(row, { key: "ArrowRight" });
    expect(onSelectThreat).not.toHaveBeenCalled();
  });

  it("no-ops passive keyboard and focus-button clicks when callbacks are absent", () => {
    const { container } = render(
      <ThreatBoardPanel
        threats={[conjunctionFixture({ id: 5, probabilityOfCollision: 2e-4 })]}
      />,
    );

    const row = container.querySelector("li > div");
    expect(row).toBeTruthy();
    if (!row) return;

    triggerReactHandler(row, "onKeyDown", {
      key: "Enter",
      preventDefault() {},
    });
    triggerReactHandler(screen.getByRole("button", { name: /Focus satellite ISS/i }), "onClick", {
      stopPropagation() {},
    });
  });

  it("streams seeded telemetry lines and caps the heartbeat history", () => {
    vi.useFakeTimers();
    state.satellites.data = {
      items: [satelliteFixture({ id: 1 })],
      count: 1,
    };
    state.conjunctions.data = {
      items: [conjunctionFixture({ id: 1 })],
      count: 1,
    };
    state.findings.data = {
      items: [findingFixture({ status: "pending" })],
      count: 1,
    };

    render(<TelemetryStrip />);

    expect(screen.getByText(/catalog loaded/i)).toBeInTheDocument();
    expect(screen.getByText(/awaiting reviewer input/i)).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000 * 45);
    });

    expect(screen.getByText("streaming · 40 / 40")).toBeInTheDocument();
    expect(screen.getAllByText(/heartbeat · console-api healthy/i).length).toBeGreaterThan(0);
  });

  it("shows the drained queue variant when no finding is pending", () => {
    state.satellites.data = {
      items: [satelliteFixture({ id: 1 })],
      count: 1,
    };
    state.conjunctions.data = {
      items: [conjunctionFixture({ id: 1 })],
      count: 1,
    };
    state.findings.data = {
      items: [
        findingFixture({ id: "f:1", status: "accepted" }),
        findingFixture({ id: "f:2", status: "rejected" }),
      ],
      count: 2,
    };

    render(<TelemetryStrip />);

    expect(screen.getByText(/reviewer queue drained/i)).toBeInTheDocument();
    expect(screen.getAllByText("INFO").length).toBe(3);
  });

  it("falls back to zero counts when telemetry data has not arrived yet", () => {
    vi.useFakeTimers();
    state.satellites.data = undefined;
    state.conjunctions.data = undefined;
    state.findings.data = undefined;

    render(<TelemetryStrip />);

    expect(screen.getByText("streaming · 0 / 40")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(15_000);
    });

    expect(screen.getByText(/heartbeat · console-api healthy/i)).toBeInTheDocument();
    expect(screen.getByText("INFO")).toHaveClass("text-muted");
  });

  it("renders accept and reject telemetry tones from pre-seeded state", async () => {
    vi.resetModules();
    vi.doMock("@/usecases", () => ({
      useSatellites: () => ({ data: undefined }),
      useConjunctions: () => ({ data: undefined }),
      useFindings: () => ({ data: undefined }),
    }));
    vi.doMock("react", async () => {
      const actual = await vi.importActual<typeof import("react")>("react");
      return {
        ...actual,
        useState: () =>
          actual.useState([
            { ts: "00:00:01", kind: "ACCEPT", msg: "accepted by reviewer" },
            { ts: "00:00:02", kind: "REJECT", msg: "rejected by reviewer" },
          ]),
      };
    });

    try {
      const { TelemetryStrip: SeededTelemetryStrip } = await import("./TelemetryStrip");
      render(<SeededTelemetryStrip />);

      expect(screen.getByText("ACCEPT")).toHaveClass("text-cyan");
      expect(screen.getByText("REJECT")).toHaveClass("text-hot");
    } finally {
      vi.doUnmock("react");
      vi.doUnmock("@/usecases");
      vi.resetModules();
    }
  });
});
