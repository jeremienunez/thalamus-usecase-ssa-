import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { FindingDto } from "@/dto/http";

const state = vi.hoisted(() => ({
  query: {
    data: undefined as FindingDto | undefined,
    isLoading: false,
    error: null as Error | null,
  },
  onCloseRef: { current: null as HTMLButtonElement | null },
}));

vi.mock("@/usecases/useFindingQuery", () => ({
  useFindingQuery: () => state.query,
}));

vi.mock("@/hooks/useDrawerA11y", () => ({
  useDrawerA11y: () => state.onCloseRef,
}));

import { FindingReadout } from "./FindingReadout";

function finding(
  overrides: Partial<FindingDto> = {},
): FindingDto {
  return {
    id: "f:42",
    title: "Neural anomaly",
    summary: "Telemetry drift confirmed.",
    cortex: "opacity-scout",
    status: "accepted",
    priority: 87,
    createdAt: "2026-04-22T10:11:12.000Z",
    linkedEntityIds: ["sat:1", "op:2", "regime:3", "finding:4", "payload:5", "custom:6"],
    evidence: [
      { kind: "osint", uri: "https://a.example", snippet: "line one" },
      { kind: "field", uri: "sensor://primary", snippet: "" },
    ],
    ...overrides,
  };
}

beforeEach(() => {
  state.query.data = undefined;
  state.query.isLoading = false;
  state.query.error = null;
  state.onCloseRef.current = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("FindingReadout", () => {
  it("renders the closed empty state and lets the operator close the panel", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(<FindingReadout findingId={null} onClose={onClose} />);

    expect(screen.getByRole("complementary", { hidden: true })).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      screen.getByText(/click a finding-neuron in the cortex to capture its synaptic activity/i),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /Close synaptic readout/i, hidden: true }),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("renders loading and error states for an active finding id", async () => {
    state.query.isLoading = true;
    const { rerender } = render(<FindingReadout findingId={7} onClose={vi.fn()} />);

    expect(screen.getByText("FIRING F#7")).toBeInTheDocument();

    state.query.isLoading = false;
    state.query.error = new Error("upstream failed");
    rerender(<FindingReadout findingId={7} onClose={vi.fn()} />);

    expect(screen.getByText("SIGNAL LOST")).toBeInTheDocument();
    expect(screen.getByText(/could not fetch/i)).toHaveTextContent("F#7");
  });

  it("renders a full synaptic readout with focus callbacks and evidence", async () => {
    const user = userEvent.setup();
    const onFocusEntity = vi.fn();
    state.query.data = finding();

    render(
      <FindingReadout
        findingId={42}
        onClose={vi.fn()}
        onFocusEntity={onFocusEntity}
      />,
    );

    expect(screen.getByRole("complementary")).toHaveAttribute("aria-hidden", "false");
    expect(screen.getByText("SYNAPTIC READOUT")).toBeInTheDocument();
    expect(screen.getAllByText("VISUAL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Occipital").length).toBeGreaterThan(0);
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(screen.getByText("Neural anomaly")).toBeInTheDocument();
    expect(screen.getByText("SUMMARY")).toBeInTheDocument();
    expect(screen.getByText("Telemetry drift confirmed.")).toBeInTheDocument();
    expect(screen.getByText("AXON ENDPOINTS · 6")).toBeInTheDocument();
    expect(screen.getByText("satellite")).toBeInTheDocument();
    expect(screen.getByText("operator")).toBeInTheDocument();
    expect(screen.getByText("regime")).toBeInTheDocument();
    expect(screen.getByText("finding")).toBeInTheDocument();
    expect(screen.getByText("payload")).toBeInTheDocument();
    expect(screen.getByText("custom")).toBeInTheDocument();
    expect(screen.getByText("EVIDENCE · 2")).toBeInTheDocument();
    expect(screen.getByText("line one")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /satellite\s+1/i }));
    expect(onFocusEntity).toHaveBeenCalledWith("sat:1");
  });

  it("falls back to associative defaults and disables endpoint focus when no callback exists", () => {
    const splitlessEntity = Object.assign(new String("odd"), {
      split: () => [] as string[],
      replace: () => "odd",
    }) as string;
    const oddFinding = {
      ...finding({
        cortex: undefined,
        linkedEntityIds: [":77", splitlessEntity],
        evidence: [{ kind: "alien", uri: "odd://signal", snippet: "ghost line" }],
        status: "mystery",
      }),
      priority: undefined,
    };
    state.query.data = oddFinding as FindingDto;

    render(<FindingReadout findingId={42} onClose={vi.fn()} />);

    expect(screen.getAllByText("ASSOCIATIVE").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Inter-cortical").length).toBeGreaterThan(0);
    expect(screen.getByText((_, element) => element?.textContent === "0/100")).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /entity\s*:77/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /entity\s+odd/i })).toBeDisabled();
    expect(screen.getByText("MYSTERY")).toBeInTheDocument();
    expect(screen.getByText("alien")).toBeInTheDocument();
    expect(screen.getByText("EVIDENCE · 1")).toBeInTheDocument();
    expect(screen.getByText("ghost line")).toBeInTheDocument();
  });
});
