import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  EMPTY_AUTONOMY_STATE,
  WrapProviders,
  makeStubApi,
} from "../../../tests/wrap";
import { AutonomyControl } from "./Control";
import { useUiStore } from "@/shared/ui/uiStore";

describe("AutonomyControl", () => {
  beforeEach(() => {
    useUiStore.setState({
      autonomyFeedOpen: false,
      configFocus: null,
    });
  });

  it("starts autonomy without forcing an interval override", async () => {
    const user = userEvent.setup();
    const start = vi.fn(async () => ({
      ok: true,
      state: EMPTY_AUTONOMY_STATE,
    }));
    const api = makeStubApi({
      autonomy: {
        status: async () => ({
          running: false,
          intervalMs: 45_000,
          startedAt: null,
          tickCount: 0,
          currentTick: null,
          history: [],
          dailySpendUsd: 0,
          monthlySpendUsd: 0,
          thalamusCyclesToday: 0,
          stoppedReason: null,
          nextTickInMs: null,
        }),
        start,
        stop: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
        reset: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
      },
    });

    render(<AutonomyControl />, {
      wrapper: ({ children }) => <WrapProviders deps={{ api }}>{children}</WrapProviders>,
    });

    await user.click(screen.getByRole("button", { name: /AUTONOMY OFF/i }));

    await waitFor(() => {
      expect(start).toHaveBeenCalledWith(undefined);
    });
  });

  it("shows autonomy telemetry, stop reason, tick cost, and reset control in the feed", async () => {
    const user = userEvent.setup();
    const reset = vi.fn(async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }));
    const api = makeStubApi({
      stats: {
        get: async () => ({
          satellites: 0,
          conjunctions: 0,
          kgNodes: 12,
          kgEdges: 24,
          findings: 7,
          byStatus: {},
          byCortex: {},
        }),
      },
      sweep: {
        listSuggestions: async () => ({ items: [], count: 3 }),
        review: async () => ({ ok: true, reviewed: true, resolution: null }),
      },
      autonomy: {
        status: async () => ({
          running: false,
          intervalMs: 45_000,
          startedAt: null,
          tickCount: 4,
          currentTick: null,
          history: [
            {
              id: "tick-1",
              action: "thalamus",
              queryOrMode: "deep debris sweep",
              startedAt: "2026-04-20T10:00:00.000Z",
              completedAt: "2026-04-20T10:00:02.500Z",
              emitted: 2,
              costUsd: 0.015,
            },
          ],
          dailySpendUsd: 0.125,
          monthlySpendUsd: 4.5,
          thalamusCyclesToday: 3,
          stoppedReason: "daily_budget_exhausted",
          nextTickInMs: null,
        }),
        start: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
        stop: async () => ({ ok: true, state: EMPTY_AUTONOMY_STATE }),
        reset,
      },
    });

    render(<AutonomyControl />, {
      wrapper: ({ children }) => <WrapProviders deps={{ api }}>{children}</WrapProviders>,
    });

    await user.click(screen.getByRole("button", { name: /FEED/i }));

    expect(await screen.findByText("DAILY SPEND")).toBeInTheDocument();
    expect(screen.getByText("$0.125")).toBeInTheDocument();
    expect(screen.getByText("$4.50")).toBeInTheDocument();
    expect(screen.getByText("daily budget exhausted")).toBeInTheDocument();
    expect(screen.getByText("$0.015")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Reset spend/i }));

    await waitFor(() => {
      expect(reset).toHaveBeenCalledTimes(1);
    });
  });
});
