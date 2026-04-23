import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ResultView } from "./ResultView";
import type { BriefingUiAction } from "@/types/repl-turn";

describe("repl ResultView", () => {
  it("renders briefing results and forwards recommended follow-ups and UI actions", async () => {
    const user = userEvent.setup();
    const onFollowUp = vi.fn();
    const onUiAction = vi.fn<(action: BriefingUiAction) => void>();

    render(
      <ResultView
        result={{
          kind: "briefing",
          executiveSummary: "Summary headline",
          findings: [
            {
              id: "F-1",
              sourceClass: "field",
              confidence: 0.92,
              summary: "Field signal",
              evidenceRefs: ["A1"],
            },
            {
              id: "F-2",
              sourceClass: "osint",
              confidence: 0.64,
              summary: "OSINT signal",
              evidenceRefs: ["B7", "B9"],
            },
            {
              id: "F-3",
              sourceClass: "derived",
              confidence: 0.31,
              summary: "Derived signal",
              evidenceRefs: ["C4"],
            },
          ],
          recommendedActions: ["Run secondary sweep"],
          followUpPrompts: ["Explain the sigma spread"],
          uiActions: [
            {
              kind: "open_config",
              domain: "console.autonomy",
              label: "Open autonomy config",
            },
          ],
          costUsd: 0.02,
        }}
        onFollowUp={onFollowUp}
        onUiAction={onUiAction}
      />,
    );

    expect(screen.getByText("Summary headline")).toBeInTheDocument();
    expect(screen.getByText("Field signal")).toBeInTheDocument();
    expect(screen.getByText("OSINT signal")).toBeInTheDocument();
    expect(screen.getByText("Derived signal")).toBeInTheDocument();
    expect(screen.getByText("(B7, B9)")).toBeInTheDocument();
    expect(screen.getByText("Recommended actions")).toBeInTheDocument();
    expect(screen.getByText("Try next")).toBeInTheDocument();
    expect(screen.getByText("Operator shortcuts")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Run secondary sweep/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Explain the sigma spread/i }),
    );
    await user.click(
      screen.getByRole("button", { name: /Open autonomy config/i }),
    );

    expect(onFollowUp).toHaveBeenNthCalledWith(1, "Run secondary sweep");
    expect(onFollowUp).toHaveBeenNthCalledWith(2, "Explain the sigma spread");
    expect(onUiAction).toHaveBeenCalledWith({
      kind: "open_config",
      domain: "console.autonomy",
      label: "Open autonomy config",
    });
  });

  it("renders telemetry, logs, graph, resolution, and chat results", () => {
    const { rerender } = render(
      <ResultView
        result={{
          kind: "telemetry",
          satId: "25544",
          satName: "ISS",
          distribution: [
            {
              name: "semi-major axis",
              unit: "km",
              median: 6790,
              p5: 6789,
              p95: 6792,
            },
            {
              name: "eccentricity",
              unit: "",
              median: 0.001,
              p5: 0.001,
              p95: 0.001,
            },
          ],
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText(/telemetry/i)).toBeInTheDocument();
    expect(screen.getByText("semi-major axis")).toBeInTheDocument();
    expect(screen.getByText("eccentricity")).toBeInTheDocument();
    expect(screen.getByText("[6789 .. 6792]")).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "logs",
          events: [
            {
              time: "2026-04-23T10:11:12.000Z",
              level: "warn",
              service: "planner",
              msg: "slow upstream",
              step: "planner",
              phase: "progress",
            },
            {
              time: "2026-04-23T10:11:13.000Z",
              level: "error",
              service: "swarm",
              msg: "fish diverged",
            },
            {
              time: "2026-04-23T10:11:14.000Z",
              level: "info",
              service: "nano",
              msg: "using default phase",
              step: "nano.call",
            },
          ],
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("logs · 3 events")).toBeInTheDocument();
    expect(screen.getByText("planner")).toBeInTheDocument();
    expect(screen.getByText("fish diverged")).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "graph",
          root: "sat-1",
          tree: {
            id: "sat-1",
            label: "Satellite",
            class: "satellite",
            children: [
              {
                id: "pl-1",
                label: "Payload",
                class: "payload",
                children: [],
              },
            ],
          },
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("graph · root sat-1")).toBeInTheDocument();
    expect(screen.getByText("Satellite")).toBeInTheDocument();
    expect(screen.getByText("Payload")).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "resolution",
          suggestionId: "SUG-1",
          ok: true,
          delta: { findingId: "F-123" },
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("SUG-1")).toBeInTheDocument();
    expect(screen.getByText("accepted")).toBeInTheDocument();
    expect(
      screen.getByText("delta.findingId = F-123"),
    ).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "resolution",
          suggestionId: "SUG-2",
          ok: false,
          delta: { findingId: "F-456" },
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("SUG-2")).toBeInTheDocument();
    expect(
      screen.getByText("delta.findingId = F-456"),
    ).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "chat",
          text: "assistant answer",
          provider: "openai",
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("assistant answer")).toBeInTheDocument();
    expect(screen.getByText("assistant · openai")).toBeInTheDocument();
  });

  it("renders why trees, clarify prompts, and pc estimators while forwarding their follow-up actions", async () => {
    const user = userEvent.setup();
    const onFollowUp = vi.fn();
    const { rerender } = render(
      <ResultView
        result={{
          kind: "why",
          findingId: "F-1",
          stats: {
            edges: 2,
            sourceItems: 1,
            byClass: { field: 1, osint: 1, sim: 0 },
          },
          tree: {
            label: "Finding root",
            kind: "finding",
            children: [
              {
                label: "Evidence edge",
                kind: "edge",
                sourceClass: "osint",
                sha256: "abcdef1234567890",
                children: [
                  {
                    label: "Source item",
                    kind: "source_item",
                    sourceClass: "field",
                    sha256: "12345678deadbeef",
                    detail: "catalog row",
                    children: [
                      {
                        label: "Excerpt",
                        kind: "evidence",
                        detail: "quoted text",
                        children: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        }}
        onFollowUp={onFollowUp}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("why · F-1")).toBeInTheDocument();
    expect(screen.getByText(/FIELD=1/i)).toBeInTheDocument();
    expect(screen.getByText("Finding root")).toBeInTheDocument();
    expect(screen.getByText(/sha256:abcdef12/i)).toBeInTheDocument();
    expect(screen.getByText(/sha256:12345678/i)).toBeInTheDocument();
    expect(screen.getByText("[FIELD]")).toBeInTheDocument();
    expect(screen.getByText(/catalog row/i)).toBeInTheDocument();
    expect(screen.getByText(/quoted text/i)).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "clarify",
          question: "Which operator?",
          options: ["operator", "satellite"],
        }}
        onFollowUp={onFollowUp}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("? Which operator?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "/operator" }));
    expect(onFollowUp).toHaveBeenCalledWith("/operator ");

    rerender(
      <ResultView
        result={{
          kind: "pc",
          conjunctionId: "CX-1",
          estimate: {
            medianPc: 1.2e-5,
            sigmaPc: 0.123,
            p5Pc: 2.1e-6,
            p95Pc: 7.8e-5,
            fishCount: 12,
            severity: "high",
            suggestionId: "SUG-9",
            histogramBins: [
              { log10Pc: -6, count: 1 },
              { log10Pc: -5, count: 4 },
            ],
            clusters: [
              {
                mode: "retrograde",
                flags: ["wide_covariance"],
                pcRange: [1e-6, 1e-4],
                fishCount: 3,
              },
            ],
          },
        }}
        onFollowUp={onFollowUp}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText(/pc · conjunction CX-1/i)).toBeInTheDocument();
    expect(screen.getByText("[HIGH]")).toBeInTheDocument();
    expect(screen.getByText("Dissent clusters")).toBeInTheDocument();
    expect(screen.getByText("retrograde")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /accept SUG-9/i }));
    expect(onFollowUp).toHaveBeenCalledWith("/accept SUG-9");

    rerender(
      <ResultView
        result={{
          kind: "pc",
          conjunctionId: "CX-2",
          estimate: {
            medianPc: 2.3e-6,
            sigmaPc: 0.456,
            p5Pc: 1.1e-6,
            p95Pc: 4.2e-6,
            fishCount: 5,
            severity: "medium",
            histogramBins: [{ log10Pc: -6.5, count: 2 }],
            clusters: [],
          },
        }}
        onFollowUp={onFollowUp}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("[MEDIUM]")).toBeInTheDocument();
    expect(screen.queryByText("Dissent clusters")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /accept/i })).not.toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "pc",
          conjunctionId: "CX-3",
          estimate: {
            medianPc: 9.9e-8,
            sigmaPc: 0.111,
            p5Pc: 5e-8,
            p95Pc: 1.5e-7,
            fishCount: 2,
            severity: "info",
            histogramBins: [{ log10Pc: -7, count: 1 }],
            clusters: [],
          },
        }}
        onFollowUp={onFollowUp}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("[INFO]")).toBeInTheDocument();

    rerender(
      <ResultView
        result={{
          kind: "pc",
          conjunctionId: "CX-4",
          estimate: {
            medianPc: 0,
            sigmaPc: 0.1,
            p5Pc: 0,
            p95Pc: 0,
            fishCount: 1,
            severity: "info",
            histogramBins: [{ log10Pc: -9, count: 0 }],
            clusters: [],
          },
        }}
        onFollowUp={onFollowUp}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("0")).toBeInTheDocument();
  });

  it("falls back to a unit telemetry scale when every telemetry spread is flat", () => {
    render(
      <ResultView
        result={{
          kind: "telemetry",
          satId: "30000",
          satName: "FlatSat",
          distribution: [
            {
              name: "drag term",
              unit: "",
              median: 0,
              p5: 0,
              p95: 0,
            },
          ],
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("drag term")).toBeInTheDocument();
    expect(screen.getByText("[0 .. 0]")).toBeInTheDocument();
  });

  it("renders branching why trees with non-terminal siblings", () => {
    render(
      <ResultView
        result={{
          kind: "why",
          findingId: "F-2",
          stats: {
            edges: 3,
            sourceItems: 2,
            byClass: { field: 1, osint: 1, sim: 1 },
          },
          tree: {
            label: "Root finding",
            kind: "finding",
            children: [
              {
                label: "First edge",
                kind: "edge",
                sourceClass: "osint",
                children: [],
              },
              {
                label: "Second edge",
                kind: "edge",
                sourceClass: "derived",
                children: [
                  {
                    label: "Sibling source A",
                    kind: "source_item",
                    sourceClass: "field",
                    children: [],
                  },
                  {
                    label: "Sibling source B",
                    kind: "source_item",
                    sourceClass: "sim",
                    children: [],
                  },
                ],
              },
            ],
          },
        }}
        onFollowUp={vi.fn()}
        onUiAction={vi.fn()}
      />,
    );

    expect(screen.getByText("First edge")).toBeInTheDocument();
    expect(screen.getByText("Second edge")).toBeInTheDocument();
    expect(screen.getByText("Sibling source A")).toBeInTheDocument();
    expect(screen.getByText("Sibling source B")).toBeInTheDocument();
  });
});
