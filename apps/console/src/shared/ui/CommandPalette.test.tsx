import { act, createEvent, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";

const state = vi.hoisted(() => ({
  navigate: vi.fn(),
  sendTurn: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => state.navigate,
}));

vi.mock("@/features/repl/ReplContext", () => ({
  useRepl: () => ({
    sendTurn: state.sendTurn,
  }),
}));

describe("CommandPalette", () => {
  beforeEach(() => {
    state.navigate.mockReset();
    state.sendTurn.mockReset();
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("handles global closed shortcuts and toggles with meta-k", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "1", metaKey: true });
    fireEvent.keyDown(window, { key: "2", metaKey: true });
    fireEvent.keyDown(window, { key: "3", metaKey: true });

    expect(state.navigate).toHaveBeenNthCalledWith(1, { to: "/ops" });
    expect(state.navigate).toHaveBeenNthCalledWith(2, { to: "/thalamus" });
    expect(state.navigate).toHaveBeenNthCalledWith(3, { to: "/sweep" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    });
  });

  it("filters actions, navigates with the keyboard, and restores focus on close", async () => {
    render(
      <div>
        <button>launch point</button>
        <CommandPalette />
      </div>,
    );

    const launchPoint = screen.getByRole("button", { name: "launch point" });
    launchPoint.focus();

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");
    await waitFor(() => expect(input).toHaveFocus());

    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("-opt-0"));
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("-opt-1"));
    fireEvent.keyDown(input, { key: "ArrowUp" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("-opt-0"));
    fireEvent.keyDown(input, { key: "End" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("-opt-3"));
    fireEvent.keyDown(input, { key: "Home" });
    expect(input).toHaveAttribute("aria-activedescendant", expect.stringContaining("-opt-0"));

    fireEvent.change(input, { target: { value: "thal" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(state.navigate).toHaveBeenCalledWith({ to: "/thalamus" });
    await waitFor(() => expect(launchPoint).toHaveFocus());
  });

  it("supports mouse selection, assistant fallback, and slash commands", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");
    const thalamus = screen.getByRole("option", { name: /Go to THALAMUS/i });

    fireEvent.mouseEnter(thalamus);
    fireEvent.click(thalamus);
    expect(state.navigate).toHaveBeenCalledWith({ to: "/thalamus" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByRole("option", { name: /Go to OPS/i }));
    expect(state.navigate).toHaveBeenCalledWith({ to: "/ops" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByRole("option", { name: /Go to SWEEP/i }));
    expect(state.navigate).toHaveBeenCalledWith({ to: "/sweep" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    fireEvent.click(screen.getByRole("option", { name: /System status/i }));
    expect(state.navigate).toHaveBeenCalledWith({ to: "/" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const fallbackInput = await screen.findByRole("combobox");
    fireEvent.change(fallbackInput, { target: { value: "catalog anomaly" } });
    const fallback = screen.getByRole("option", { name: /Ask assistant/i });
    fireEvent.click(fallback);
    expect(state.sendTurn).toHaveBeenCalledWith("catalog anomaly");

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const enterFallbackInput = await screen.findByRole("combobox");
    fireEvent.change(enterFallbackInput, { target: { value: "unmapped signal" } });
    const enterFallback = screen.getByRole("option", { name: /Ask assistant/i });
    fireEvent.mouseEnter(enterFallback);
    fireEvent.keyDown(enterFallbackInput, { key: "Enter" });
    expect(state.sendTurn).toHaveBeenCalledWith("unmapped signal");

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const slashInput = await screen.findByRole("combobox");
    fireEvent.change(slashInput, { target: { value: "/status" } });
    fireEvent.keyDown(slashInput, { key: "Enter" });
    expect(state.sendTurn).toHaveBeenCalledWith("/status");
  });

  it("handles empty filters, tab trapping, escape, and overlay clicks", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");
    fireEvent.change(input, { target: { value: "   " } });

    expect(screen.getByText("type a command or question")).toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-activedescendant");

    const tab = createEvent.keyDown(input, { key: "Tab" });
    fireEvent(input, tab);
    expect(tab.defaultPrevented).toBe(true);

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(state.navigate).not.toHaveBeenCalled();
    expect(state.sendTurn).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "" } });
    fireEvent.keyDown(input, { key: "x" });

    fireEvent.click(screen.getByRole("dialog", { name: "Command palette" }));
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("presentation"));
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const escapeInput = await screen.findByRole("combobox");
    fireEvent.keyDown(escapeInput, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
    });
  });

  it("ignores stale active indexes after filtering to a shorter action list", async () => {
    render(<CommandPalette />);

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const input = await screen.findByRole("combobox");

    act(() => {
      fireEvent.keyDown(input, { key: "ArrowDown" });
      fireEvent.change(input, { target: { value: "ops" } });
      fireEvent.keyDown(input, { key: "Enter" });
    });

    expect(state.navigate).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Command palette" })).toBeInTheDocument();
  });
});
