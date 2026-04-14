import React from "react";
import { Box, Text } from "ink";
import { bar } from "../util/colors";

export interface TelemetryDistribution {
  satId: string;
  scalars?: Array<{ name: string; unit?: string; median: number; p5: number; p95: number; typical?: number; withinEnvelope?: boolean }>;
}

export function TelemetryRenderer(p: { satId: string; distribution: unknown }): React.JSX.Element {
  const dist = p.distribution as TelemetryDistribution | null;
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Telemetry · sat {p.satId}</Text>
      {(!dist?.scalars || dist.scalars.length === 0) ? (
        <Text dimColor>(no distribution returned)</Text>
      ) : (
        dist.scalars.map((s) => {
          const span = Math.max(0.0001, s.p95 - s.p5);
          const rel = Math.max(0, Math.min(1, (s.median - s.p5) / span));
          return (
            <Box key={s.name}>
              <Text dimColor>  {s.name.padEnd(24)}</Text>
              <Text>{bar(rel)} </Text>
              <Text>{s.median.toFixed(2)}{s.unit ? ` ${s.unit}` : ""}</Text>
              <Text dimColor>  [{s.p5.toFixed(2)}..{s.p95.toFixed(2)}]</Text>
              {s.withinEnvelope === false && <Text color="red"> out-of-envelope</Text>}
            </Box>
          );
        })
      )}
    </Box>
  );
}
