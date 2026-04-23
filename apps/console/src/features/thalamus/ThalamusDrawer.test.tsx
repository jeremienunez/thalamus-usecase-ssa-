import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import type { EntityClass, KgEdgeDto, KgNodeDto } from "@/dto/http";
import { useUiStore } from "@/shared/ui/uiStore";

vi.mock("@/hooks/useDrawerA11y", () => ({
  useDrawerA11y: () => ({ current: null }),
}));

import { ThalamusDrawer } from "./ThalamusDrawer";

function node(
  overrides: Partial<KgNodeDto> = {},
): KgNodeDto {
  return {
    id: "sat:1",
    label: "ISS",
    class: "Satellite",
    degree: 0,
    x: 0,
    y: 0,
    cortex: "catalog",
    ...overrides,
  };
}

function edge(
  overrides: Partial<KgEdgeDto> = {},
): KgEdgeDto {
  return {
    id: "edge-1",
    source: "sat:1",
    target: "op:7",
    relation: "operated-by",
    confidence: 0.8,
    sourceClass: "field",
    ...overrides,
  };
}

beforeEach(() => {
  act(() => {
    useUiStore.setState({ drawerId: "kg:sat:1" });
  });
});

afterEach(() => {
  act(() => {
    useUiStore.setState({ drawerId: null });
  });
});

describe("ThalamusDrawer", () => {
  it("renders the placeholder drawer when no node is selected", () => {
    render(<ThalamusDrawer node={null} edges={[]} />);

    expect(screen.getByText("ENTITY")).toBeInTheDocument();
    expect(screen.getByText("select a neuron")).toBeInTheDocument();
  });

  it("describes every supported class and falls back for unknown ones", () => {
    const cases: Array<[EntityClass | "Mystery", string]> = [
      ["Satellite", "Tracked space asset"],
      ["Operator", "Sovereign or commercial entity"],
      ["OrbitRegime", "Coarse altitude/inclination class"],
      ["ConjunctionEvent", "Pair-wise close-approach event"],
      ["Payload", "Functional class hosted on a Satellite"],
      ["Maneuver", "Detected or planned orbital change"],
      ["Debris", "Untracked or fragment object"],
      ["Mystery", "Knowledge-graph entity"],
    ];

    const { rerender } = render(
      <ThalamusDrawer node={node()} edges={[edge()]} />,
    );

    for (const [cls, snippet] of cases) {
      rerender(
        <ThalamusDrawer
          node={node({ class: cls as EntityClass })}
          edges={[edge({ id: `edge-${cls}` })]}
        />,
      );
      expect(screen.getByText(new RegExp(snippet, "i"))).toBeInTheDocument();
    }
  });

  it("renders isolated and dense neuron analytics, including source buckets and overflow counts", () => {
    const isolatedNode = node({ cortex: "" });
    const { rerender } = render(<ThalamusDrawer node={isolatedNode} edges={[]} />);
    const ascii = document.querySelector("pre");

    expect(screen.getByText("isolated · no incident edges yet")).toBeInTheDocument();
    expect(screen.getByText("— no signal")).toBeInTheDocument();
    expect(ascii?.textContent).toContain("░░░░░░");
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);

    const mediumEdges = Array.from({ length: 5 }, (_, index) =>
      edge({
        id: `medium-${index}`,
        relation: index % 2 === 0 ? "operated-by" : "hosts",
        sourceClass: (index % 2 === 0 ? "field" : "osint") as KgEdgeDto["sourceClass"],
        confidence: 0.5,
      }),
    );
    rerender(<ThalamusDrawer node={node()} edges={mediumEdges} />);
    expect(document.querySelector("pre")?.textContent).toContain("▒▒▒▒▒▒");

    const denseEdges = Array.from({ length: 13 }, (_, index) =>
      edge({
        id: `dense-${index}`,
        source: index % 2 === 0 ? "sat:1" : `peer:${index}`,
        target: index % 2 === 0 ? `peer:${index}` : "sat:1",
        relation: index % 3 === 0 ? "observed-with" : "operated-by",
        sourceClass:
          index % 5 === 0
            ? "field"
            : index % 5 === 1
              ? "osint"
              : index % 5 === 2
                ? "sim"
                : index % 5 === 3
                  ? undefined
                  : ("weird" as KgEdgeDto["sourceClass"]),
        confidence: index === 12 ? Number.NaN : 0.6,
      })
    );
    rerender(
      <ThalamusDrawer
        node={node({ class: "Mystery" as EntityClass })}
        edges={denseEdges}
      />,
    );

    expect(document.querySelector("pre")?.textContent).toContain("▓▓▓▓▓▓");
    expect(screen.getByText("AXONS · 13")).toBeInTheDocument();
    expect(screen.getByText("field")).toBeInTheDocument();
    expect(screen.getByText("osint")).toBeInTheDocument();
    expect(screen.getByText("sim")).toBeInTheDocument();
    expect(screen.getAllByText("observed-with").length).toBeGreaterThan(0);
    expect(screen.getAllByText("operated-by").length).toBeGreaterThan(0);
    expect(screen.getByText(/\+1 more/i)).toBeInTheDocument();
    expect(screen.getByText("60")).toBeInTheDocument();
  });
});
