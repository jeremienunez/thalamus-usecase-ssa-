import React from "react";
import { Box, Text } from "ink";
import { colorFor, bar, type SourceClass } from "../util/colors";

interface Finding {
  id: string; summary: string; sourceClass: SourceClass;
  confidence: number; evidenceRefs: string[];
}
export interface BriefingProps {
  executiveSummary: string;
  findings: Finding[];
  recommendedActions: string[];
  followUpPrompts: string[];
}

export function BriefingRenderer(p: BriefingProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box borderStyle="single" borderLeft borderTop={false} borderBottom={false} borderRight={false} paddingLeft={1}>
        <Text dimColor>{p.executiveSummary}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {p.findings.map((f) => {
          const tint = colorFor(f.sourceClass);
          return (
            <Box key={f.id}>
              <Text>{tint("●")} </Text>
              <Text bold>{f.id}</Text>
              <Text> {tint(f.sourceClass)} </Text>
              <Text>{tint(bar(f.confidence))} </Text>
              <Text>{f.summary}</Text>
              <Text dimColor> ({f.evidenceRefs.join(", ")})</Text>
            </Box>
          );
        })}
      </Box>
      {p.recommendedActions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">Recommended actions:</Text>
          {p.recommendedActions.map((a, i) => <Text key={i}>  → {a}</Text>)}
        </Box>
      )}
      {p.followUpPrompts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Try next:</Text>
          {p.followUpPrompts.map((q, i) => <Text key={i} dimColor>  • {q}</Text>)}
        </Box>
      )}
    </Box>
  );
}
