import React from "react";
import { Box, Text } from "ink";

export interface PcCluster {
  mode: string;
  flags: string[];
  pcRange: [number, number];
  fishCount: number;
}

export interface PcEstimate {
  conjunctionId: string;
  medianPc: number;
  sigmaPc: number;
  p5Pc: number;
  p95Pc: number;
  fishCount: number;
  clusters: PcCluster[];
  samples: number[];
  severity: "info" | "medium" | "high";
  suggestionId?: string;
  methodology: string;
}

/** Bin samples by log10(Pc) into a coarse histogram (6 buckets from 1e-7..1e-2). */
function histogram(samples: number[]): { label: string; count: number }[] {
  const edges = [1e-7, 1e-6, 1e-5, 1e-4, 1e-3, 1e-2];
  const bins = new Array(edges.length + 1).fill(0) as number[];
  for (const s of samples) {
    let idx = 0;
    for (; idx < edges.length; idx++) if (s < edges[idx]!) break;
    bins[idx]!++;
  }
  return bins.map((count, i) => {
    const lo = i === 0 ? 0 : edges[i - 1]!;
    const hi = i >= edges.length ? Infinity : edges[i]!;
    const label = hi === Infinity ? `>=${lo.toExponential(0)}` : `<${hi.toExponential(0)}`;
    return { label, count };
  });
}

export function PcEstimatorRenderer(p: { conjunctionId: string; estimate: unknown }): React.JSX.Element {
  const e = p.estimate as PcEstimate | null;
  if (!e || e.fishCount === 0) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Pc estimate · {p.conjunctionId}</Text>
        <Text dimColor>(no fish results — Pc estimator not wired in this boot)</Text>
      </Box>
    );
  }
  const bins = histogram(e.samples);
  const maxBin = Math.max(1, ...bins.map((b) => b.count));
  const sevColor = e.severity === "high" ? "red" : e.severity === "medium" ? "yellow" : "cyan";
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Pc estimate · {e.conjunctionId}</Text>
      <Box>
        <Text>
          median=<Text color={sevColor}>{e.medianPc.toExponential(2)}</Text>{" "}
          σ={e.sigmaPc.toExponential(2)}{" "}
          <Text dimColor>[p5={e.p5Pc.toExponential(2)} p95={e.p95Pc.toExponential(2)}]</Text>{" "}
          fish={e.fishCount}{" "}
          <Text color={sevColor}>[{e.severity}]</Text>
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        <Text dimColor>distribution (log10(Pc))</Text>
        {bins.map((b, i) => (
          <Box key={i}>
            <Text dimColor>  {b.label.padEnd(10)}</Text>
            <Text>{"█".repeat(Math.round((b.count / maxBin) * 20))}</Text>
            <Text dimColor> {b.count}</Text>
          </Box>
        ))}
      </Box>
      {e.clusters.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>dissent clusters</Text>
          {e.clusters.map((c, i) => (
            <Text key={i}>
              {"  "}• {c.mode} ({c.fishCount}f) [{c.pcRange[0].toExponential(1)}..{c.pcRange[1].toExponential(1)}]
              {c.flags.length > 0 && <Text dimColor>  flags: {c.flags.join(",")}</Text>}
            </Text>
          ))}
        </Box>
      )}
      {e.suggestionId && (
        <Box marginTop={1}>
          <Text color="cyan">→ /accept {e.suggestionId}</Text>
        </Box>
      )}
    </Box>
  );
}
