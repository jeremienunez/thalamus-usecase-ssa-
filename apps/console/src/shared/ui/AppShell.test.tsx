import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { useUiStore } from "./uiStore";

const state = vi.hoisted(() => ({
  telemetryThrows: false,
  replThrows: false,
  pathname: "/ops",
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({ location: { pathname: state.pathname } }),
}));

vi.mock("./TopBar", () => ({
  TopBar: () => <div>top bar</div>,
}));

vi.mock("./LeftRail", () => ({
  LeftRail: () => <div>left rail</div>,
}));

vi.mock("./CommandPalette", () => ({
  CommandPalette: () => <div>palette</div>,
}));

vi.mock("@/features/repl/ReplProvider", () => ({
  ReplProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="repl-provider">{children}</div>
  ),
}));

vi.mock("@/features/ops/TelemetryStrip", () => ({
  TelemetryStrip: () => {
    if (state.telemetryThrows) throw new Error("telemetry fault");
    return <div>telemetry strip</div>;
  },
}));

vi.mock("@/features/repl/ReplPanel", () => ({
  ReplPanel: () => {
    if (state.replThrows) throw new Error("repl fault");
    return <div>repl panel</div>;
  },
}));

describe("AppShell", () => {
  beforeEach(() => {
    state.telemetryThrows = false;
    state.replThrows = false;
    state.pathname = "/ops";
    useUiStore.setState({
      railCollapsed: false,
      drawerId: null,
      autonomyFeedOpen: false,
      configFocus: null,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the shell chrome around its children", () => {
    render(
      <AppShell>
        <div>payload</div>
      </AppShell>,
    );

    expect(screen.getByTestId("repl-provider")).toBeInTheDocument();
    expect(screen.getByText("top bar")).toBeInTheDocument();
    expect(screen.getByText("left rail")).toBeInTheDocument();
    expect(screen.getByText("payload")).toBeInTheDocument();
    expect(screen.getByText("telemetry strip")).toBeInTheDocument();
    expect(screen.getByText("palette")).toBeInTheDocument();
    expect(screen.getByText("repl panel")).toBeInTheDocument();
  });

  it("drops telemetry and repl panels through fallback boundaries when they crash", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    state.telemetryThrows = true;
    state.replThrows = true;

    render(
      <AppShell>
        <div>payload</div>
      </AppShell>,
    );

    expect(screen.getByText("top bar")).toBeInTheDocument();
    expect(screen.getByText("left rail")).toBeInTheDocument();
    expect(screen.getByText("payload")).toBeInTheDocument();
    expect(screen.getByText("palette")).toBeInTheDocument();
    expect(screen.queryByText("telemetry strip")).not.toBeInTheDocument();
    expect(screen.queryByText("repl panel")).not.toBeInTheDocument();
    expect(consoleError).toHaveBeenCalled();
  });

  it("closes stale drawers when the route scope changes", async () => {
    useUiStore.getState().openDrawer("f:7");
    state.pathname = "/ops";

    render(
      <AppShell>
        <div>payload</div>
      </AppShell>,
    );

    await waitFor(() => {
      expect(useUiStore.getState().drawerId).toBeNull();
    });
  });
});
