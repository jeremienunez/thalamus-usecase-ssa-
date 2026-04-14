import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import pc from "picocolors";
import type { Estimate } from "../util/etaStore";

const FRAMES = [
  ["     .·°·.   ", "    ·     ·  ", "   ·   ●   · ", "    · ─┼─ ·  ", "     ·─┴─·   "],
  ["     ·°·.·   ", "    ·     .  ", "   ·   ●   · ", "    · ─┼─ .  ", "     .─┴─·   "],
  ["     .·.°·   ", "    .     .  ", "   ·   ●   · ", "    . ─┼─ ·  ", "     ·─┴─.   "],
];

interface Props {
  kind: string;
  subject: string;
  etaEstimate: Estimate;
  elapsedMs: number;
  costUsd: number;
  _frameOverride?: number;
}

export function SatelliteLoader(props: Props): React.JSX.Element {
  const [frame, setFrame] = useState(props._frameOverride ?? 0);
  useEffect(() => {
    if (props._frameOverride !== undefined) return;
    const id = setInterval(() => setFrame((f) => f + 1), 100);
    return () => clearInterval(id);
  }, [props._frameOverride]);

  const sprite = FRAMES[frame % FRAMES.length];
  const subtitle = renderSubtitle(props);

  return (
    <Box flexDirection="column">
      {sprite.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      <Text>{subtitle}</Text>
    </Box>
  );
}

function renderSubtitle(p: Props): string {
  const head = `running: ${p.subject}`;
  const cost = `$${p.costUsd.toFixed(3)} so far`;
  const eta = formatEta(p.etaEstimate, p.elapsedMs);
  return `${head}  ${eta}  ·  ${cost}`;
}

function formatEta(e: Estimate, elapsed: number): string {
  if (e.status === "estimating") return pc.gray("~ estimating…");
  if (e.status === "estimating-soon") return pc.gray(`~ estimating (${e.samples} samples)…`);
  const remaining = Math.max(0, Math.round((e.p50Ms - elapsed) / 1000));
  if (elapsed < e.p50Ms) return pc.green(`~ ${remaining}s remaining`);
  if (elapsed < e.p95Ms)
    return pc.yellow(
      `~ ${Math.max(0, Math.round((e.p95Ms - elapsed) / 1000))}s remaining, slower than usual`
    );
  return pc.red(`running long — p95 was ${Math.round(e.p95Ms / 1000)}s`);
}
