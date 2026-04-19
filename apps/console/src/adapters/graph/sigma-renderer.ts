import Sigma from "sigma";
import type { GraphInstance } from "./graph-builder";

export interface SigmaRendererHandle {
  kill: () => void;
  resetCamera: () => void;
  focusNode: (nodeId: string) => void;
  getNodeAttributes: (nodeId: string) => Record<string, unknown>;
}

export interface SigmaRendererOptions {
  onNodeClick: (nodeId: string, attrs: Record<string, unknown>) => void;
  onHoverChange: (cursor: "pointer" | "default") => void;
}

/**
 * Mount a Sigma renderer on the given container and return a handle that
 * owns its lifecycle. The caller never touches the Sigma instance directly.
 */
export function createSigmaRenderer(
  container: HTMLElement,
  graph: GraphInstance,
  opts: SigmaRendererOptions,
): SigmaRendererHandle {
  const renderer = new Sigma(graph, container, {
    labelColor: { attribute: "labelColor" },
    labelSize: 12,
    labelFont: "JetBrains Mono Variable, ui-monospace, monospace",
    labelWeight: "700",
    defaultEdgeColor: "#22D3EE99",
    renderLabels: true,
    renderEdgeLabels: false,
    labelRenderedSizeThreshold: 4,
    enableEdgeEvents: false,
    minCameraRatio: 0.05,
    maxCameraRatio: 4,
  });

  requestAnimationFrame(() => {
    renderer.getCamera().animatedReset({ duration: 600 });
  });

  renderer.on("clickNode", ({ node }) => {
    opts.onNodeClick(node, graph.getNodeAttributes(node));
  });
  renderer.on("enterNode", () => opts.onHoverChange("pointer"));
  renderer.on("leaveNode", () => opts.onHoverChange("default"));

  return {
    kill: () => renderer.kill(),
    resetCamera: () => renderer.getCamera().animatedReset({ duration: 600 }),
    focusNode: (nodeId: string) => {
      if (!graph.hasNode(nodeId)) return;
      const attrs = graph.getNodeAttributes(nodeId);
      renderer.getCamera().animate(
        { x: (attrs.x as number) / 1000 + 0.5, y: (attrs.y as number) / 1000 + 0.5, ratio: 0.35 },
        { duration: 400 },
      );
    },
    getNodeAttributes: (nodeId: string) => graph.getNodeAttributes(nodeId),
  };
}
