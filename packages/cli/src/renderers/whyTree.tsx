import React from "react";
import { Box, Text } from "ink";

interface WhyNode {
  id: string;
  label: string;
  kind: "finding" | "edge" | "source_item";
  sha256?: string;
  children: WhyNode[];
}

function renderNode(n: WhyNode, prefix: string, isLast: boolean): React.JSX.Element[] {
  const branch = prefix === "" ? "" : (isLast ? "└── " : "├── ");
  const line = (
    <Text key={`${prefix}${n.id}`}>
      <Text dimColor>{prefix}{branch}</Text>
      <Text bold>{n.kind}</Text>
      <Text> {n.label}</Text>
      {n.sha256 && <Text dimColor> (sha256:{n.sha256.slice(0, 8)})</Text>}
    </Text>
  );
  const nextPrefix = prefix + (isLast ? "    " : "│   ");
  const kids = n.children.flatMap((c, i, arr) => renderNode(c, nextPrefix, i === arr.length - 1));
  return [line, ...kids];
}

export function WhyTreeRenderer(p: { tree: unknown }): React.JSX.Element {
  const t = p.tree as WhyNode | null;
  if (!t) return <Text dimColor>(no provenance)</Text>;
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Why: {t.label}</Text>
      {renderNode(t, "", true)}
    </Box>
  );
}
