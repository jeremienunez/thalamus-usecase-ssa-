import React from "react";
import { Box, Text } from "ink";

type SourceClass = "field" | "osint" | "sim" | "derived";

interface WhyNode {
  id: string;
  label: string;
  kind: "finding" | "edge" | "source_item";
  sha256?: string;
  sourceClass?: SourceClass;
  children: WhyNode[];
}

// Ink color map. Finding=cyan, edge=yellow, source_item=white (dim).
const KIND_COLOR: Record<WhyNode["kind"], string> = {
  finding: "cyan",
  edge: "yellow",
  source_item: "white",
};

// Source-class palette mirrors the web REPL: field=cyan-ish (cold), osint=yellow (amber), sim=gray.
const CLASS_COLOR: Record<SourceClass, string> = {
  field: "cyanBright",
  osint: "yellowBright",
  sim: "gray",
  derived: "gray",
};

function renderNode(n: WhyNode, prefix: string, isLast: boolean, isRoot: boolean): React.JSX.Element[] {
  const branch = isRoot ? "" : (isLast ? "└── " : "├── ");
  const kindColor = KIND_COLOR[n.kind];
  const line = (
    <Text key={`${prefix}${n.id}`}>
      <Text dimColor>{prefix}{branch}</Text>
      <Text bold color={kindColor}>{n.kind.toUpperCase()}</Text>
      <Text> </Text>
      {n.sourceClass ? (
        <Text color={CLASS_COLOR[n.sourceClass]}>{n.label}</Text>
      ) : (
        <Text>{n.label}</Text>
      )}
      {n.sha256 && (n.kind === "edge" || n.kind === "source_item") && (
        <Text dimColor> [sha256:{n.sha256.slice(0, 8)}]</Text>
      )}
      {n.sourceClass && n.kind !== "finding" && (
        <Text color={CLASS_COLOR[n.sourceClass]}> [{n.sourceClass.toUpperCase()}]</Text>
      )}
    </Text>
  );
  const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
  const kids = n.children.flatMap((c, i, arr) =>
    renderNode(c, nextPrefix, i === arr.length - 1, false),
  );
  return [line, ...kids];
}

function collectStats(n: WhyNode): { edges: number; sourceItems: number; byClass: Record<"field" | "osint" | "sim", number> } {
  const stats = { edges: 0, sourceItems: 0, byClass: { field: 0, osint: 0, sim: 0 } };
  const walk = (x: WhyNode): void => {
    if (x.kind === "edge") stats.edges++;
    if (x.kind === "source_item") stats.sourceItems++;
    if (x.sourceClass && x.sourceClass !== "derived" && x.kind !== "finding") {
      stats.byClass[x.sourceClass]++;
    }
    x.children.forEach(walk);
  };
  n.children.forEach(walk);
  return stats;
}

export function WhyTreeRenderer(p: { tree: unknown }): React.JSX.Element {
  const t = p.tree as WhyNode | null;
  if (!t) return <Text dimColor>(no provenance)</Text>;
  const s = collectStats(t);
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Why: {t.label}</Text>
      <Text dimColor>
        {s.edges} edges · {s.sourceItems} source_items · source_classes:{" "}
        <Text color="cyanBright">FIELD={s.byClass.field}</Text>{" "}
        <Text color="yellowBright">OSINT={s.byClass.osint}</Text>{" "}
        <Text color="gray">SIM={s.byClass.sim}</Text>
      </Text>
      {renderNode(t, "", true, true)}
    </Box>
  );
}
