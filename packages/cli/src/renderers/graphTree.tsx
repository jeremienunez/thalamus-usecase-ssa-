import React from "react";
import { Box, Text } from "ink";

export interface GraphTree {
  root: string;
  levels: Array<{ depth: number; nodes: string[] }>;
}

export function GraphTreeRenderer(p: { tree: unknown }): React.JSX.Element {
  const t = p.tree as GraphTree | null;
  if (!t) return <Text dimColor>(no graph)</Text>;
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Graph: {t.root}</Text>
      {t.levels.map((lvl) => (
        <Box key={lvl.depth} flexDirection="column">
          <Text dimColor>{"  ".repeat(lvl.depth)}depth {lvl.depth} ({lvl.nodes.length})</Text>
          {lvl.nodes.map((n) => <Text key={n}>{"  ".repeat(lvl.depth)}• {n}</Text>)}
        </Box>
      ))}
    </Box>
  );
}
