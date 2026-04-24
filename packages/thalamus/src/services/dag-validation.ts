import type { DAGNode } from "../cortices/types";

export type DagValidationCode =
  | "empty_dag"
  | "duplicate_cortex"
  | "self_dependency"
  | "missing_dependency"
  | "circular_dependency";

export class DagValidationError extends Error {
  constructor(
    public readonly code: DagValidationCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "DagValidationError";
  }
}

export function validateDag(
  nodes: DAGNode[],
  opts: { allowEmpty?: boolean } = {},
): void {
  if (!opts.allowEmpty && nodes.length === 0) {
    throw new DagValidationError(
      "empty_dag",
      "DAG must contain at least one node",
    );
  }

  const byName = new Map<string, DAGNode>();
  for (const node of nodes) {
    if (byName.has(node.cortex)) {
      throw new DagValidationError(
        "duplicate_cortex",
        `DAG contains duplicate cortex "${node.cortex}"`,
        { cortex: node.cortex },
      );
    }
    byName.set(node.cortex, node);
  }

  for (const node of nodes) {
    for (const dep of node.dependsOn) {
      if (dep === node.cortex) {
        throw new DagValidationError(
          "self_dependency",
          `Cortex "${node.cortex}" cannot depend on itself`,
          { cortex: node.cortex },
        );
      }
      if (!byName.has(dep)) {
        throw new DagValidationError(
          "missing_dependency",
          `Cortex "${node.cortex}" depends on missing cortex "${dep}"`,
          { cortex: node.cortex, dependency: dep },
        );
      }
    }
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const stack: string[] = [];

  const visit = (name: string): void => {
    if (visited.has(name)) return;
    if (visiting.has(name)) {
      const start = stack.indexOf(name);
      const cycle = [...stack.slice(Math.max(0, start)), name];
      throw new DagValidationError(
        "circular_dependency",
        `DAG contains a circular dependency: ${cycle.join(" -> ")}`,
        { cycle },
      );
    }

    const node = byName.get(name);
    if (!node) return;

    visiting.add(name);
    stack.push(name);
    for (const dep of node.dependsOn) {
      visit(dep);
    }
    stack.pop();
    visiting.delete(name);
    visited.add(name);
  };

  for (const name of byName.keys()) {
    visit(name);
  }
}
