import { render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  runtime: {
    open: true,
    setOpen: vi.fn(),
    turns: [],
    inFlight: 2,
    sendTurn: vi.fn(),
    runFollowUp: vi.fn(),
    cancelTurn: vi.fn(),
  },
}));

vi.mock("./useReplRuntime", () => ({
  useReplRuntime: () => state.runtime,
}));

import { ReplProvider } from "./ReplProvider";
import { useRepl } from "./ReplContext";

describe("repl context wiring", () => {
  it("throws when useRepl is called outside ReplProvider", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useRepl())).toThrow(
      /useRepl must be used inside <ReplProvider>/,
    );
    expect(consoleError).toHaveBeenCalled();
  });

  it("provides the runtime value through ReplProvider", () => {
    function Consumer() {
      const repl = useRepl();
      return (
        <div>
          {repl.open ? "open" : "closed"} · {repl.inFlight}
        </div>
      );
    }

    render(
      <ReplProvider>
        <Consumer />
      </ReplProvider>,
    );

    expect(screen.getByText("open · 2")).toBeInTheDocument();
  });
});
