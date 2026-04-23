import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Turn } from "./reducer";

const state = vi.hoisted(() => ({
  repl: {
    open: true,
    setOpen: vi.fn(),
    turns: [] as Turn[],
    inFlight: 0,
    sendTurn: vi.fn(),
    runFollowUp: vi.fn(),
    cancelTurn: vi.fn(),
  },
  navigate: vi.fn(),
  setAutonomyFeedOpen: vi.fn(),
  focusConfigDomain: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
}));

vi.mock("@/shared/ui/uiStore", () => ({
  useUiStore: <T,>(selector: (store: {
    setAutonomyFeedOpen: typeof state.setAutonomyFeedOpen;
    focusConfigDomain: typeof state.focusConfigDomain;
  }) => T) =>
    selector({
      setAutonomyFeedOpen: state.setAutonomyFeedOpen,
      focusConfigDomain: state.focusConfigDomain,
    }),
}));

vi.mock("./ReplContext", () => ({
  useRepl: () => state.repl,
}));

vi.mock("./TurnView", () => ({
  TurnView: (props: {
    turn: Turn;
    onFollowUp: (input: string) => void;
    onUiAction: (action: {
      kind: "open_feed" | "open_config";
      target?: "autonomy";
      domain?: "console.autonomy";
      label: string;
    }) => void;
    onCancel?: () => void;
  }) => (
    <div data-testid={`turn-${props.turn.id}`}>
      <div>{props.turn.input}</div>
      <button onClick={() => props.onFollowUp("child follow-up")}>
        child follow-up
      </button>
      <button
        onClick={() =>
          props.onUiAction({
            kind: "open_feed",
            target: "autonomy",
            label: "Open feed",
          })
        }
      >
        open feed
      </button>
      <button
        onClick={() =>
          props.onUiAction({
            kind: "open_config",
            domain: "console.autonomy",
            label: "Open config",
          })
        }
      >
        open config
      </button>
      <button onClick={() => props.onCancel?.()}>cancel turn</button>
    </div>
  ),
}));

import { ReplPanel } from "./ReplPanel";

function makeTurn(overrides: Partial<Turn> = {}): Turn {
  return {
    id: "t-1",
    input: "query",
    phase: "classifying",
    startedAt: 1,
    steps: [],
    findings: [],
    chatText: "",
    summaryText: "",
    followupOrder: [],
    followups: {},
    ...overrides,
  };
}

describe("repl ReplPanel", () => {
  beforeEach(() => {
    state.repl.open = true;
    state.repl.setOpen.mockReset();
    state.repl.turns = [];
    state.repl.inFlight = 0;
    state.repl.sendTurn.mockReset();
    state.repl.runFollowUp.mockReset();
    state.repl.cancelTurn.mockReset();
    state.navigate.mockReset();
    state.setAutonomyFeedOpen.mockReset();
    state.focusConfigDomain.mockReset();
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      writable: true,
      value: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("returns null when the REPL is closed", () => {
    state.repl.open = false;

    const { container } = render(<ReplPanel />);

    expect(container.firstChild).toBeNull();
  });

  it("shows the empty state, plural running badge, trims submit eligibility, and closes from the chrome and keyboard", async () => {
    const user = userEvent.setup();
    state.repl.inFlight = 2;

    render(<ReplPanel />);

    expect(screen.getByText("REPL")).toBeInTheDocument();
    expect(screen.getByText("2 running")).toBeInTheDocument();
    expect(screen.getByText("0 turn(s)")).toBeInTheDocument();
    expect(
      screen.getByText(/Enter a slash command/i),
    ).toBeInTheDocument();

    const input = screen.getByRole("textbox");
    await user.keyboard("{Enter}");
    expect(state.repl.sendTurn).not.toHaveBeenCalled();

    await user.type(input, "  /query riskiest conjunction  ");
    await user.keyboard("{Enter}");
    expect(state.repl.sendTurn).toHaveBeenCalledWith(
      "  /query riskiest conjunction  ",
    );
    expect(input).toHaveValue("");

    await user.keyboard("{Escape}");
    expect(state.repl.setOpen).toHaveBeenCalledWith(false);

    await user.click(screen.getByRole("button", { name: "Close REPL" }));
    expect(state.repl.setOpen).toHaveBeenCalledWith(false);
  });

  it("wires child follow-up and cancel callbacks and handles both UI-action branches", async () => {
    const user = userEvent.setup();
    state.repl.inFlight = 1;
    state.repl.turns = [makeTurn({ id: "t-1", input: "operator prompt" })];

    render(<ReplPanel />);

    expect(screen.getByText("running")).toBeInTheDocument();
    expect(screen.getByText("1 turn(s)")).toBeInTheDocument();
    expect(screen.getByTestId("turn-t-1")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "child follow-up" }));
    expect(state.repl.sendTurn).toHaveBeenCalledWith("child follow-up");

    await user.click(screen.getByRole("button", { name: "cancel turn" }));
    expect(state.repl.cancelTurn).toHaveBeenCalledWith("t-1");

    await user.click(screen.getByRole("button", { name: "open feed" }));
    expect(state.setAutonomyFeedOpen).toHaveBeenCalledWith(true);
    expect(state.repl.setOpen).toHaveBeenCalledWith(false);
    expect(state.navigate).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "open config" }));
    expect(state.focusConfigDomain).toHaveBeenCalledWith("console.autonomy");
    expect(state.repl.setOpen).toHaveBeenCalledWith(false);
    expect(state.navigate).toHaveBeenCalledWith({ to: "/config" });
  });

  it("restores focus to the previously active element when the panel closes", () => {
    state.repl.open = false;
    const inputFocus = vi
      .spyOn(HTMLInputElement.prototype, "focus")
      .mockImplementation(() => {});

    const { rerender } = render(
      <div>
        <button type="button">launcher</button>
        <ReplPanel />
      </div>,
    );
    const launcher = screen.getByRole("button", { name: "launcher" });
    const launcherFocus = vi.spyOn(launcher, "focus");
    launcher.focus();

    state.repl.open = true;
    rerender(
      <div>
        <button type="button">launcher</button>
        <ReplPanel />
      </div>,
    );

    expect(inputFocus).toHaveBeenCalled();

    state.repl.open = false;
    rerender(
      <div>
        <button type="button">launcher</button>
        <ReplPanel />
      </div>,
    );

    expect(launcherFocus).toHaveBeenCalled();
  });
});
