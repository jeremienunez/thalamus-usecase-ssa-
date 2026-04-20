import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ConfigEntry } from "./Entry";
import { WrapProviders } from "../../../tests/wrap";

describe("ConfigEntry", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("promotes console namespace and renders guided config editors", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          domains: {
            "thalamus.budgets": {
              value: {
                simple: {
                  maxCost: 0.03,
                  maxIterations: 2,
                  confidenceTarget: 0.7,
                  coverageTarget: 0.5,
                  minFindingsToStop: 2,
                },
                moderate: {
                  maxCost: 0.06,
                  maxIterations: 4,
                  confidenceTarget: 0.75,
                  coverageTarget: 0.6,
                  minFindingsToStop: 3,
                },
                deep: { maxCost: 0.1, maxIterations: 8 },
              },
              defaults: {},
              schema: { simple: "json", moderate: "json", deep: "json" },
              hasOverrides: false,
            },
            "console.autonomy": {
              value: {
                intervalSec: 45,
                rotation: ["thalamus", "sweep-nullscan"],
                dailyBudgetUsd: 0.5,
                monthlyBudgetUsd: 5,
                maxThalamusCyclesPerDay: 0,
                stopOnBudgetExhausted: true,
              },
              defaults: {},
              schema: {
                intervalSec: "number",
                rotation: "string[]",
                dailyBudgetUsd: "number",
                monthlyBudgetUsd: "number",
                maxThalamusCyclesPerDay: "number",
                stopOnBudgetExhausted: "boolean",
              },
              hasOverrides: true,
            },
            "sim.swarm": {
              value: { defaultFishConcurrency: 8 },
              defaults: {},
              schema: { defaultFishConcurrency: "number" },
              hasOverrides: false,
            },
          },
        }),
      })) as typeof fetch,
    );

    render(<ConfigEntry />, {
      wrapper: ({ children }) => <WrapProviders>{children}</WrapProviders>,
    });

    expect(await screen.findByText("Runtime configuration")).toBeInTheDocument();
    const sections = screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent);
    expect(sections.slice(0, 3)).toEqual(["CONSOLE", "THALAMUS", "SIM"]);

    expect(screen.getByText("Pick the operating path")).toBeInTheDocument();
    expect(screen.getByText("interval 45s")).toBeInTheDocument();
    expect(screen.getByText(/rotation THALAMUS → SWEEP/i)).toBeInTheDocument();
    expect(screen.getAllByText("simple $0.030 · 2 iter").length).toBeGreaterThan(0);
    expect(screen.getAllByText("deep $0.100 · 8 iter").length).toBeGreaterThan(0);
    expect(screen.queryByText("Loop cadence")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Edit console.autonomy/i }));
    expect(await screen.findByText("Loop cadence")).toBeInTheDocument();
    expect(screen.getByText("Research mix")).toBeInTheDocument();
  });

  it("lets the operator drive autonomy and budget choices through guided cards", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          domains: {
            "console.autonomy": {
              value: {
                intervalSec: 45,
                rotation: ["thalamus", "sweep-nullscan"],
                dailyBudgetUsd: 0.5,
                monthlyBudgetUsd: 5,
                maxThalamusCyclesPerDay: 0,
                stopOnBudgetExhausted: true,
              },
              defaults: {},
              schema: {
                intervalSec: "number",
                rotation: "string[]",
                dailyBudgetUsd: "number",
                monthlyBudgetUsd: "number",
                maxThalamusCyclesPerDay: "number",
                stopOnBudgetExhausted: "boolean",
              },
              hasOverrides: false,
            },
            "thalamus.budgets": {
              value: {
                simple: {
                  maxIterations: 2,
                  maxCost: 0.03,
                  confidenceTarget: 0.7,
                  coverageTarget: 0.5,
                  minFindingsToStop: 2,
                },
                moderate: {
                  maxIterations: 4,
                  maxCost: 0.06,
                  confidenceTarget: 0.75,
                  coverageTarget: 0.6,
                  minFindingsToStop: 3,
                },
                deep: {
                  maxIterations: 8,
                  maxCost: 0.1,
                  confidenceTarget: 0.8,
                  coverageTarget: 0.7,
                  minFindingsToStop: 5,
                },
              },
              defaults: {},
              schema: { simple: "json", moderate: "json", deep: "json" },
              hasOverrides: false,
            },
          },
        }),
      })) as typeof fetch,
    );

    render(<ConfigEntry />, {
      wrapper: ({ children }) => <WrapProviders>{children}</WrapProviders>,
    });

    await screen.findByText("Runtime configuration");

    await user.click(screen.getByRole("button", { name: /Edit console.autonomy/i }));
    await user.click(screen.getByRole("button", { name: /Full loop/i }));
    expect(
      screen.getAllByText(/Thalamus → Sweep null-scan → Fish briefing/i).length,
    ).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: /Close drawer/i }));
    await user.click(screen.getByRole("button", { name: /Edit thalamus.budgets/i }));
    await user.click(screen.getByRole("button", { name: /Deep verify/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Deep max iterations")).toHaveValue(10);
      expect(screen.getByLabelText("Deep max spend")).toHaveValue(0.15);
    });
  });
});
