import { createHash } from "node:crypto";
import type { TemporalSourceDomain } from "./types";

export interface PatternHashInput {
  pattern_version: string;
  source_domain: TemporalSourceDomain;
  terminal_status: string;
  pattern_window_ms: number;
  sequence: string[];
}

export function temporalPatternHash(input: PatternHashInput): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalHashInput(input)))
    .digest("hex");
}

function canonicalHashInput(input: PatternHashInput): PatternHashInput {
  return {
    pattern_version: input.pattern_version,
    source_domain: input.source_domain,
    terminal_status: input.terminal_status,
    pattern_window_ms: input.pattern_window_ms,
    sequence: [...input.sequence],
  };
}
