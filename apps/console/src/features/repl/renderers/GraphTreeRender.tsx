import type { DispatchResult, GraphNode } from "@/types/repl-turn";

export function GraphTreeRender({ r }: { r: Extract<DispatchResult, { kind: "graph" }> }) {
  const rows: { depth: number; node: GraphNode }[] = [];
  const walk = (n: GraphNode, d: number) => {
    rows.push({ depth: d, node: n });
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(r.tree, 0);
  return (
    <div className="flex flex-col gap-0.5 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">graph · root {r.root}</div>
      {rows.map((row, i) => (
        <div key={i} className="mono text-caption">
          <span className="text-dim">
            {"  ".repeat(row.depth)}
            {row.depth === 0 ? "◆" : "└"}{" "}
          </span>
          <span className="text-primary">{row.node.label}</span>
          <span className="text-dim"> [{row.node.class}]</span>
        </div>
      ))}
    </div>
  );
}
