import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RefObject } from "react";
import {
  AnimatedStepBadge,
  AppShell,
  CycleLoader,
  Drawer,
  DrawerSection,
  ErrorBoundary,
  KV,
  Measure,
} from "./index";
import { HudPanel } from "./HudPanel";
import { blockBar, confidenceBar } from "./sparkline";
import { FullPaneFallback, Skeleton } from "./Skeleton";
import { MetricTile, MetricTilePlaceholder } from "./MetricTile";
import { useUiStore } from "./uiStore";
import { useAnimatedNumber } from "@/hooks/useAnimatedNumber";

const state = vi.hoisted(() => ({
  animatedNumber: 12.6,
  drawerRef: { current: null } as RefObject<HTMLButtonElement | null>,
}));

vi.mock("@/hooks/useAnimatedNumber", () => ({
  useAnimatedNumber: vi.fn((target: number) => state.animatedNumber ?? target),
}));

vi.mock("@/hooks/useDrawerA11y", () => ({
  useDrawerA11y: () => state.drawerRef,
}));

describe("shared ui primitives", () => {
  beforeEach(() => {
    state.animatedNumber = 12.6;
    vi.mocked(useAnimatedNumber).mockClear();
    useUiStore.setState({
      railCollapsed: false,
      drawerId: null,
      autonomyFeedOpen: false,
      configFocus: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("re-exports the shell components from index", () => {
    expect(AppShell).toBeDefined();
    expect(Drawer).toBeDefined();
    expect(CycleLoader).toBeDefined();
    expect(AnimatedStepBadge).toBeDefined();
  });

  it("animates normal badges and freezes instantaneous, done, and error states", () => {
    vi.useFakeTimers();

    const { rerender } = render(<AnimatedStepBadge step="cortex" />);
    const badge = screen.getByTitle("cortex · progress");
    expect(badge).toHaveTextContent("🧩");

    act(() => {
      vi.advanceTimersByTime(170);
    });
    expect(badge).toHaveTextContent("⚙️");

    rerender(<AnimatedStepBadge step="guardrail.breach" phase="progress" title="guard" />);
    expect(screen.getByTitle("guard")).toHaveTextContent("🚧");

    rerender(<AnimatedStepBadge step="planner" phase="done" />);
    expect(screen.getByTitle("planner · done")).toHaveTextContent("📍");

    rerender(<AnimatedStepBadge step="planner" phase="error" />);
    expect(screen.getByTitle("planner · error")).toHaveTextContent("⚠️");
  });

  it("renders loader trails, elapsed times, and hides unknown current steps", () => {
    const { rerender } = render(
      <CycleLoader
        cycleId="cycle-7"
        elapsedMs={5123}
        trail={[
          { name: "planner", phase: "done", terminal: "📍", elapsedMs: 1000 },
          { name: "reflexion", phase: "error", terminal: "⚠️", elapsedMs: 2500 },
        ]}
        current={{ name: "cortex", phase: "progress", terminal: "✅", elapsedMs: 3000 }}
      />,
    );

    expect(screen.getByText("cycle-7")).toBeInTheDocument();
    expect(screen.getByText((_, node) => node?.textContent === "· 5.1s")).toBeInTheDocument();
    expect(screen.getByText("planner")).toBeInTheDocument();
    expect(screen.getByText("reflexion")).toBeInTheDocument();
    expect(screen.getByText("cortex")).toBeInTheDocument();

    rerender(
      <CycleLoader
        cycleId="cycle-7"
        elapsedMs={0}
        trail={[]}
        current={{ name: "unknown", phase: "progress", terminal: "?", elapsedMs: 0 }}
      />,
    );
    expect(screen.queryByText("?")).not.toBeInTheDocument();

    rerender(
      <CycleLoader
        cycleId="cycle-7"
        elapsedMs={1500}
        trail={[]}
        current={{ name: "planner", phase: "error", terminal: "⚠️", elapsedMs: 1000 }}
      />,
    );
    expect(screen.getByText("planner")).toHaveClass("text-hot");
  });

  it("renders drawers, sections, kv rows, and closes through the shared store", () => {
    const { rerender } = render(
      <Drawer title="Context">
        <div>payload</div>
      </Drawer>,
    );

    const closed = screen.getByRole("complementary", { hidden: true });
    expect(closed).toHaveAttribute("aria-hidden", "true");
    expect(closed).toHaveAttribute("inert", "");

    act(() => {
      useUiStore.getState().openDrawer("node:42");
    });
    rerender(
      <Drawer title="Context" subtitle="SAT-42">
        <DrawerSection title="Meta">
          <KV k="Class" v="Satellite" mono />
          <KV k="Color" v="cyan" color="#00ffff" />
        </DrawerSection>
      </Drawer>,
    );

    const open = screen.getByRole("complementary");
    expect(open).toHaveAttribute("aria-hidden", "false");
    expect(open).not.toHaveAttribute("inert");
    expect(screen.getByText("SAT-42")).toBeInTheDocument();
    expect(screen.getByText("Meta")).toBeInTheDocument();
    expect(screen.getByText("Class")).toBeInTheDocument();
    expect(screen.getByText("Satellite")).toHaveClass("mono", "text-numeric");
    expect(screen.getByText("cyan")).toHaveClass("text-primary");
    expect(screen.getByText("cyan")).toHaveStyle({ color: "#00ffff" });

    fireEvent.click(screen.getByRole("button", { name: "Close drawer" }));
    expect(useUiStore.getState().drawerId).toBeNull();
  });

  it("keeps scoped drawers hidden for stale drawer ids", () => {
    const { rerender } = render(
      <Drawer title="Satellite" scope="sat:">
        <div>satellite payload</div>
      </Drawer>,
    );

    act(() => {
      useUiStore.getState().openDrawer("f:7");
    });
    rerender(
      <Drawer title="Satellite" scope="sat:">
        <div>satellite payload</div>
      </Drawer>,
    );

    expect(screen.getByRole("complementary", { hidden: true })).toHaveAttribute(
      "aria-hidden",
      "true",
    );

    act(() => {
      useUiStore.getState().openDrawer("sat:42");
    });
    rerender(
      <Drawer title="Satellite" scope="sat:">
        <div>satellite payload</div>
      </Drawer>,
    );

    expect(screen.getByRole("complementary")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("satellite payload")).toBeInTheDocument();
  });

  it("renders fault panels, custom fallbacks, and retry/reload actions", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const reload = vi.fn();
    vi.stubGlobal("location", { ...window.location, reload });

    function Boom() {
      throw new Error("boom");
    }

    function Recoverable() {
      const [armed, setArmed] = useState(true);

      return (
        <div>
          <button onClick={() => setArmed(false)}>stabilize</button>
          <ErrorBoundary>{armed ? <Boom /> : <div>recovered</div>}</ErrorBoundary>
        </div>
      );
    }

    const { rerender } = render(<Recoverable />);

    expect(screen.getByText("SUBSYSTEM FAULT")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "stabilize" }));
    fireEvent.click(screen.getByRole("button", { name: "RETRY" }));
    expect(screen.getByText("recovered")).toBeInTheDocument();

    rerender(
      <ErrorBoundary fallback={<div>custom fallback</div>}>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("custom fallback")).toBeInTheDocument();
    expect(screen.queryByText("SUBSYSTEM FAULT")).not.toBeInTheDocument();

    rerender(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "RELOAD CONSOLE" }));
    expect(reload).toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
  });

  it("handles missing console objects in componentDidCatch", () => {
    const boundary = new ErrorBoundary({ children: null, fallback: null });
    vi.stubGlobal("console", undefined);
    expect(() => boundary.componentDidCatch(new Error("silent boom"), {})).not.toThrow();
  });

  it("renders hud panels, measures, metric tiles, skeletons, and fallbacks", () => {
    const { rerender } = render(
      <HudPanel
        title="Status"
        dot="cyan"
        live
        meta="online"
        passthrough
        className="extra"
      >
        <Measure value={["42", "km"]} className="measure" unitClassName="unit" />
      </HudPanel>,
    );

    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(screen.getByText("online")).toBeInTheDocument();
    expect(screen.getByText("42")).toHaveClass("measure");
    expect(screen.getByText("km")).toHaveClass("unit");
    expect(document.querySelector(".pointer-events-none")).toBeTruthy();
    expect(document.querySelector(".animate-ping")).toBeTruthy();

    rerender(
      <div>
        <HudPanel>
          <div>plain hud</div>
        </HudPanel>
        <Measure value={["7", ""]} />
        <MetricTile label="Entities" value={99} accent="hot" />
        <MetricTilePlaceholder label="Links" />
        <Skeleton className="ghost" width={12} height="4rem" />
        <FullPaneFallback />
        <FullPaneFallback label="SCANNING" />
      </div>,
    );

    expect(screen.getByText("plain hud")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.queryByText("km")).not.toBeInTheDocument();
    expect(screen.getByText("Entities")).toBeInTheDocument();
    expect(screen.getByText("13")).toHaveClass("text-hot");
    expect(screen.getByText("Links")).toBeInTheDocument();
    expect(screen.getByText("…")).toBeInTheDocument();
    const skeleton = document.querySelector(".ghost");
    expect(skeleton).toHaveStyle({ width: "12px", height: "4rem" });
    expect(screen.getByText("INITIALIZING")).toBeInTheDocument();
    expect(screen.getByText("SCANNING")).toBeInTheDocument();
  });

  it("passes finite and non-finite values into metric animations", () => {
    render(
      <div>
        <MetricTile
          label="Confidence"
          value={0.4321}
          accent="cyan"
          display={(value) => `${value.toFixed(2)}%`}
        />
        <MetricTile label="Fallback" value={Number.POSITIVE_INFINITY} accent="amber" />
      </div>,
    );

    expect(screen.getByText("12.60%")).toHaveClass("text-cyan");
    expect(vi.mocked(useAnimatedNumber)).toHaveBeenNthCalledWith(1, 0.4321, 420);
    expect(vi.mocked(useAnimatedNumber)).toHaveBeenNthCalledWith(2, 0, 420);
  });

  it("toggles the shared ui store and computes sparkline utilities", () => {
    const now = vi.spyOn(Date, "now").mockReturnValue(4242);

    expect(useUiStore.getState().railCollapsed).toBe(false);
    act(() => {
      useUiStore.getState().toggleRail();
      useUiStore.getState().openDrawer("f:7");
      useUiStore.getState().setAutonomyFeedOpen(true);
      useUiStore.getState().toggleAutonomyFeed();
      useUiStore.getState().focusConfigDomain("console.autonomy");
    });

    expect(useUiStore.getState().railCollapsed).toBe(true);
    expect(useUiStore.getState().drawerId).toBe("f:7");
    expect(useUiStore.getState().autonomyFeedOpen).toBe(false);
    expect(useUiStore.getState().configFocus).toEqual({
      domain: "console.autonomy",
      nonce: 4242,
    });

    act(() => {
      useUiStore.getState().closeDrawer();
      useUiStore.getState().clearConfigFocus();
    });

    expect(useUiStore.getState().drawerId).toBeNull();
    expect(useUiStore.getState().configFocus).toBeNull();
    expect(confidenceBar(-1, 4)).toBe("▁▁▁▁");
    expect(confidenceBar(1.5, 4)).toBe("████");
    expect(confidenceBar(0.4, 4)).toHaveLength(4);
    expect(blockBar(0, 0, 3)).toBe("   ");
    expect(blockBar(1, 10, 5)).toBe("█░░░░");
    expect(blockBar(8, 10, 5)).toBe("████░");

    now.mockRestore();
  });
});
