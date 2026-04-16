import React from "react";
import { Box, Text } from "ink";

export interface CandidateRow {
  candidateName: string;
  candidateNoradId: number | null;
  candidateClass: string | null;
  cosDistance: number;
  overlapKm: number;
  apogeeKm: number | null;
  perigeeKm: number | null;
  regime: string;
}

interface Props {
  targetNoradId: number;
  rows: CandidateRow[];
}

function classColor(c: string | null): "cyan" | "yellow" | "red" | "white" {
  if (c === "debris") return "red";
  if (c === "rocket_stage") return "yellow";
  if (c === "payload") return "cyan";
  return "white";
}

/**
 * Table of KNN conjunction candidates. Cosine-tightness and altitude overlap
 * are what the narrow-phase cortex will consume next — surface both clearly.
 */
export function CandidatesRenderer(p: Props): React.JSX.Element {
  if (p.rows.length === 0) {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>KNN candidates · target NORAD {p.targetNoradId}</Text>
        <Text dimColor>(no semantic neighbors — target not embedded or no altitude overlap)</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>KNN candidates · target NORAD {p.targetNoradId} · {p.rows.length} survivors</Text>
      <Box marginTop={1}>
        <Text dimColor>  {"cos".padEnd(7)}{"ovl".padEnd(7)}{"class".padEnd(14)}{"alt".padEnd(14)}{"regime".padEnd(8)}name</Text>
      </Box>
      {p.rows.map((r, i) => {
        const alt = r.perigeeKm != null && r.apogeeKm != null
          ? `${Math.round(r.perigeeKm)}x${Math.round(r.apogeeKm)}`
          : "—";
        return (
          <Box key={i}>
            <Text>{"  "}</Text>
            <Text color={r.cosDistance < 0.30 ? "green" : r.cosDistance < 0.40 ? "yellow" : "gray"}>
              {r.cosDistance.toFixed(3).padEnd(7)}
            </Text>
            <Text>{Math.round(r.overlapKm).toString().padEnd(7)}</Text>
            <Text color={classColor(r.candidateClass)}>{(r.candidateClass ?? "—").padEnd(14)}</Text>
            <Text>{alt.padEnd(14)}</Text>
            <Text dimColor>{r.regime.padEnd(8)}</Text>
            <Text>{r.candidateName}</Text>
            {r.candidateNoradId != null && <Text dimColor> ({r.candidateNoradId})</Text>}
          </Box>
        );
      })}
    </Box>
  );
}
