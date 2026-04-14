import React from "react";
import { Box, Text } from "ink";

export function ClarifyRenderer(p: { question: string; options: string[] }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text color="yellow">? {p.question}</Text>
      {p.options.map((o, i) => (
        <Text key={o}>  {i + 1}. {o}</Text>
      ))}
      <Text dimColor>(reply with /&lt;action&gt; ...)</Text>
    </Box>
  );
}
