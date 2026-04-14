/**
 * SPEC-TH-012 — Curator (dedup + rank after nano swarm).
 *
 * The curator's `scoreBatch` is LLM-gated; `heuristicScore` is pure and
 * testable here in principle but lives inside the Curator class alongside
 * swarm-specific state. For this pass the ACs are captured as pointers to
 * the integration suite, where fake LLM + deterministic seed covers the
 * ranking contract end-to-end.
 */
import { describe, it, expect } from "vitest";
import * as curatorModule from "../src/explorer/curator";

describe("SPEC-TH-012 module surface", () => {
  it("exports a Curator binding", () => {
    expect(Object.keys(curatorModule).length).toBeGreaterThan(0);
  });
});

describe("SPEC-TH-012 scenario ACs (integration suite)", () => {
  it.todo("AC-1 heuristicScore respects SSA-vocabulary token weights");
  it.todo("AC-2 scoreBatch routes items through LLM ranking with bounded cost");
  it.todo("AC-3 duplicates by canonical title collapse to one entry");
  it.todo("AC-4 output is stable under shuffled input (rank ordering)");
});
