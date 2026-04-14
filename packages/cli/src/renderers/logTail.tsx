import React from "react";
import { Box, Text } from "ink";
import { AnimatedEmoji } from "../components/AnimatedEmoji";
import type { StepName, StepPhase } from "@interview/shared";

interface Event {
  time: number;
  level: number;
  service?: string;
  msg: string;
  step?: string;
  phase?: string;
  [k: string]: unknown;
}

export function LogTailRenderer(p: { events: Event[] }): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Logs ({p.events.length})</Text>
      {p.events.map((e, i) => {
        const hasStep = typeof e.step === "string" && (e.phase === "start" || e.phase === "done" || e.phase === "error");
        return (
          <Box key={i}>
            {hasStep
              ? <AnimatedEmoji step={e.step as StepName} phase={e.phase as StepPhase} />
              : <Text dimColor>·</Text>}
            <Text dimColor> {new Date(e.time).toISOString().slice(11, 19)} </Text>
            {e.service && <Text color="cyan">{e.service} </Text>}
            <Text>{e.msg ?? ""}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
