import { createContext, useContext, type ReactNode } from "react";
import { buildKgGraph, incidentEdgesFor } from "./graph-builder";
import { createSigmaRenderer } from "./sigma-renderer";

export interface GraphAdapter {
  buildKgGraph: typeof buildKgGraph;
  incidentEdgesFor: typeof incidentEdgesFor;
  createSigmaRenderer: typeof createSigmaRenderer;
}

export const defaultGraphAdapter: GraphAdapter = {
  buildKgGraph,
  incidentEdgesFor,
  createSigmaRenderer,
};

const GraphContext = createContext<GraphAdapter | null>(null);

export function GraphProvider({
  value,
  children,
}: {
  value: GraphAdapter;
  children: ReactNode;
}) {
  return <GraphContext.Provider value={value}>{children}</GraphContext.Provider>;
}

export function useGraph(): GraphAdapter {
  const v = useContext(GraphContext);
  if (!v) throw new Error("useGraph must be used inside GraphProvider");
  return v;
}
