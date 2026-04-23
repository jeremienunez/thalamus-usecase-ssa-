import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeftRail } from "./LeftRail";

type RuntimeDomain =
  | { schema: Record<string, unknown>; hasOverrides?: boolean }
  | undefined;

const state = vi.hoisted(() => ({
  pathname: "/ops",
  ui: {
    railCollapsed: false,
    toggleRail: vi.fn(),
    focusConfigDomain: vi.fn(),
  },
  runtimeConfig: {
    isLoading: false,
    data: undefined as
      | {
          domains: Record<string, RuntimeDomain>;
        }
      | undefined,
  },
  ops: {
    regimeVisible: { LEO: true, MEO: false, GEO: true, HEO: false },
    toggleRegime: vi.fn(),
    pcThresholdExp: -6.5,
    setPcThresholdExp: vi.fn(),
    provenance: { osint: true, field: false },
    toggleProvenance: vi.fn(),
  },
}));

vi.mock("@tanstack/react-router", () => ({
  useRouterState: () => ({
    location: { pathname: state.pathname },
  }),
}));

vi.mock("@/shared/ui/uiStore", () => ({
  useUiStore: (selector: (value: typeof state.ui) => unknown) => selector(state.ui),
}));

vi.mock("@/features/config/runtime-config", () => ({
  useRuntimeConfigList: () => state.runtimeConfig,
}));

vi.mock("@/features/ops/opsFilterStore", () => ({
  useOpsFilterStore: (selector: (value: typeof state.ops) => unknown) => selector(state.ops),
}));

describe("LeftRail", () => {
  beforeEach(() => {
    state.pathname = "/ops";
    state.ui.railCollapsed = false;
    state.ui.toggleRail.mockReset();
    state.ui.focusConfigDomain.mockReset();
    state.runtimeConfig.isLoading = false;
    state.runtimeConfig.data = undefined;
    state.ops.regimeVisible = { LEO: true, MEO: false, GEO: true, HEO: false };
    state.ops.toggleRegime.mockReset();
    state.ops.pcThresholdExp = -6.5;
    state.ops.setPcThresholdExp.mockReset();
    state.ops.provenance = { osint: true, field: false };
    state.ops.toggleProvenance.mockReset();
  });

  it("collapses the rail and hides content when collapsed", () => {
    state.ui.railCollapsed = true;

    render(<LeftRail />);

    expect(screen.queryByText(/FILTERS/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Expand rail" }));
    expect(state.ui.toggleRail).toHaveBeenCalled();
    expect(screen.queryByLabelText("LEO")).not.toBeInTheDocument();
  });

  it("renders ops filters and delegates interactions to the ops store", () => {
    render(<LeftRail />);

    expect(screen.getByText(/FILTERS/)).toBeInTheDocument();
    expect(screen.getByText(/OPS/)).toBeInTheDocument();
    expect(screen.getByText("≥ 10⁻⁶·⁵")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("LEO"));
    fireEvent.click(screen.getByLabelText("OSINT"));
    fireEvent.click(screen.getByLabelText("FIELD"));
    fireEvent.change(screen.getByRole("slider"), {
      target: { value: "-5.5" },
    });

    expect(state.ops.toggleRegime).toHaveBeenCalledWith("LEO");
    expect(state.ops.toggleProvenance).toHaveBeenNthCalledWith(1, "osint");
    expect(state.ops.toggleProvenance).toHaveBeenNthCalledWith(2, "field");
    expect(state.ops.setPcThresholdExp).toHaveBeenCalledWith(-5.5);
  });

  it("falls back to ops mode when the pathname has no route segment", () => {
    state.pathname = "";

    render(<LeftRail />);

    expect(screen.getByText(/OPS/)).toBeInTheDocument();
    expect(screen.getByLabelText("LEO")).toBeInTheDocument();
  });

  it("renders thalamus and sweep static filter panels", () => {
    state.pathname = "/thalamus";
    const { rerender } = render(<LeftRail />);

    expect(screen.getByText("CORTEX")).toBeInTheDocument();
    expect(screen.getByLabelText("catalog")).toBeInTheDocument();
    expect(screen.getByLabelText("Satellite")).toBeInTheDocument();

    state.pathname = "/sweep";
    rerender(<LeftRail />);

    expect(screen.getByText("STATUS")).toBeInTheDocument();
    expect(screen.getByLabelText("pending")).toBeInTheDocument();
    expect(screen.getByLabelText("accepted")).toBeInTheDocument();
    expect(screen.getByRole("slider")).toHaveValue("50");
  });

  it("renders config jump links in loading and loaded states", () => {
    state.pathname = "/config";
    state.runtimeConfig.isLoading = true;

    const { rerender } = render(<LeftRail />);
    expect(screen.getByText("Loading…")).toBeInTheDocument();

    state.runtimeConfig.isLoading = false;
    state.runtimeConfig.data = {
      domains: {
        "custom.beta": { schema: { one: true } },
        "console.zeta": { schema: { one: true, two: true, three: true } },
        "thalamus.gamma": { schema: { one: true } },
        "sim.alpha": { schema: { one: true } },
        "console.autonomy": { schema: { one: true }, hasOverrides: true },
        "console.alpha": { schema: { one: true, two: true } },
        "thalamus.budgets": { schema: { one: true, two: true }, hasOverrides: true },
        "sweep.status": { schema: { one: true } },
      },
    };

    rerender(<LeftRail />);

    const consoleSection = screen.getByText("CONSOLE").closest("section");
    const thalamusSection = screen.getByText("THALAMUS").closest("section");
    const simSection = screen.getByText("SIM").closest("section");
    const sweepSection = screen.getByText("SWEEP").closest("section");
    const customSection = screen.getByText("CUSTOM").closest("section");

    expect(consoleSection && thalamusSection).toBeTruthy();
    expect(simSection && sweepSection && customSection).toBeTruthy();
    expect(
      consoleSection?.compareDocumentPosition(thalamusSection as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sweepSection?.compareDocumentPosition(customSection as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    const consoleButtons = within(consoleSection as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(consoleButtons).toEqual(["autonomy1", "alpha2", "zeta3"]);

    const autonomy = screen.getByRole("button", { name: /autonomy/i });
    const budgets = screen.getByRole("button", { name: /budgets/i });
    expect(autonomy).toHaveClass("text-amber");
    expect(budgets).toHaveClass("text-amber");

    fireEvent.click(autonomy);
    expect(state.ui.focusConfigDomain).toHaveBeenCalledWith("console.autonomy");
  });

  it("covers synthetic config ordering and fallback branches", () => {
    state.pathname = "/config";
    const originalSplit = String.prototype.split;

    vi.spyOn(String.prototype, "split").mockImplementation(function (
      this: string,
      separator: string | RegExp,
      limit?: number,
    ) {
      const value = String(this);
      if (separator === "." && value === "thalamus.budgets") {
        return ["console", "budgets"];
      }
      if (separator === "." && value === "void.domain") {
        return [];
      }
      return originalSplit.call(value, separator, limit);
    });

    state.runtimeConfig.data = {
      domains: {
        "console.autonomy": { schema: { one: true }, hasOverrides: true },
        "thalamus.budgets": { schema: { one: true, two: true }, hasOverrides: true },
        "console.empty": undefined,
        "void.domain": { schema: { one: true } },
      },
    };

    render(<LeftRail />);

    expect(screen.getByText("OTHER")).toBeInTheDocument();
    const consoleSection = screen.getByText("CONSOLE").closest("section");
    const consoleButtons = within(consoleSection as HTMLElement)
      .getAllByRole("button")
      .map((button) => button.textContent);
    expect(consoleButtons).toEqual(["autonomy1", "budgets2", "empty0"]);
  });

  it("falls back to an empty content area for unknown modes", () => {
    state.pathname = "/mystery";

    render(<LeftRail />);

    expect(screen.getByText(/FILTERS/)).toBeInTheDocument();
    expect(screen.getByText(/MYSTERY/)).toBeInTheDocument();
    expect(screen.queryByText("ORBIT REGIME")).not.toBeInTheDocument();
    expect(screen.queryByText("CORTEX")).not.toBeInTheDocument();
    expect(screen.queryByText("STATUS")).not.toBeInTheDocument();
  });

  it("preserves unknown characters in superscript formatting", () => {
    state.pathname = "/ops";
    state.ops.pcThresholdExp = Number.NaN;

    render(<LeftRail />);

    expect(screen.getByText("≥ 10NaN")).toBeInTheDocument();
  });
});
