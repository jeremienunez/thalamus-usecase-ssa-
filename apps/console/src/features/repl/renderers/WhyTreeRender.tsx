import { clsx } from "clsx";
import type { DispatchResult, WhyNode } from "@/types/repl-turn";

const WHY_CLASS_COLOR: Record<"field" | "osint" | "sim" | "derived", string> = {
  field: "text-cold",
  osint: "text-amber",
  sim: "text-dim",
  derived: "text-dim",
};

const WHY_KIND_COLOR: Record<WhyNode["kind"], string> = {
  finding: "text-cyan",
  edge: "text-amber",
  source_item: "text-muted",
  evidence: "text-dim",
};

type WhyLine = { prefix: string; branch: string; node: WhyNode };

function flattenWhy(n: WhyNode, prefix: string, isLast: boolean, isRoot: boolean): WhyLine[] {
  const branch = isRoot ? "" : isLast ? "└── " : "├── ";
  const out: WhyLine[] = [{ prefix, branch, node: n }];
  const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
  n.children.forEach((c, i, arr) => {
    out.push(...flattenWhy(c, nextPrefix, i === arr.length - 1, false));
  });
  return out;
}

export function WhyTreeRender({ r }: { r: Extract<DispatchResult, { kind: "why" }> }) {
  const lines = flattenWhy(r.tree, "", true, true);
  const s = r.stats;
  return (
    <div className="flex flex-col gap-0.5 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">why · {r.findingId}</div>
      <div className="mono text-caption text-dim">
        {s.edges} edges · {s.sourceItems} source_items · source_classes:{" "}
        <span className="text-cold">FIELD={s.byClass.field}</span>{" "}
        <span className="text-amber">OSINT={s.byClass.osint}</span>{" "}
        <span className="text-dim">SIM={s.byClass.sim}</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="mono text-caption whitespace-pre">
          <span className="text-dim">
            {l.prefix}
            {l.branch}
          </span>
          <span className={clsx(WHY_KIND_COLOR[l.node.kind], "uppercase")}>{l.node.kind}</span>
          <span className="text-dim"> </span>
          <span
            className={clsx(
              l.node.sourceClass
                ? WHY_CLASS_COLOR[l.node.sourceClass]
                : l.node.kind === "finding"
                  ? "text-primary"
                  : "text-muted",
            )}
          >
            {l.node.label}
          </span>
          {l.node.sha256 && (l.node.kind === "edge" || l.node.kind === "source_item") && (
            <span className="ml-1 border border-hairline px-1 text-dim">
              sha256:{l.node.sha256.slice(0, 8)}
            </span>
          )}
          {l.node.sourceClass && l.node.kind !== "finding" && (
            <span className={clsx("ml-1", WHY_CLASS_COLOR[l.node.sourceClass])}>
              [{l.node.sourceClass.toUpperCase()}]
            </span>
          )}
          {l.node.detail && <span className="text-dim"> · {l.node.detail}</span>}
        </div>
      ))}
    </div>
  );
}
