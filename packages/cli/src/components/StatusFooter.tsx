import React from "react";
import { Box, Text } from "ink";
interface Props { sessionId: string; tokens: number; maxTokens: number; costUsd: number; lastAction?: string; lastMs?: number }
export function StatusFooter(p: Props): React.JSX.Element {
  const last = p.lastAction ? ` · last: ${p.lastAction} (${((p.lastMs ?? 0)/1000).toFixed(1)}s)` : "";
  return (
    <Box borderStyle="single" borderTop borderBottom={false} borderLeft={false} borderRight={false} paddingX={1}>
      <Text dimColor>
        session {p.sessionId.slice(0,4)} · tokens {(p.tokens/1000).toFixed(1)}k/{(p.maxTokens/1000).toFixed(0)}k · cost ${p.costUsd.toFixed(3)}{last}
      </Text>
    </Box>
  );
}
