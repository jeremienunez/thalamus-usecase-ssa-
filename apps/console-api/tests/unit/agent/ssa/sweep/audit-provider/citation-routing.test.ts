/**
 * Behavior: citation routing through the default CitationResolver.
 *
 * The provider wires in the default composite resolver at construction.
 * These tests verify the WIRING — i.e. that calling runAudit on a
 * column yields the expected citation. The resolver's individual
 * strategies are unit-tested in citation-resolver.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SsaAuditProvider } from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import {
  fakeSatellitePort,
  fakeSweepRepo,
  makeEmptyCaller,
  ctxNullScan,
  nullRow,
} from "./__fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

async function oneCandidateFor(column: string) {
  const provider = new SsaAuditProvider({
    satelliteRepo: fakeSatellitePort({
      nullScanByColumn: vi.fn().mockResolvedValue([nullRow({ column })]),
    }),
    sweepRepo: fakeSweepRepo(),
    nanoCaller: makeEmptyCaller().caller,
  });
  const [c] = await provider.runAudit(ctxNullScan());
  return String(c!.domainFields.suggestedAction);
}

describe("SsaAuditProvider citation routing", () => {
  it("routes mass_kg backfill to GCAT", async () => {
    // Why: GCAT is the authoritative public source for satellite mass.
    // A wrong citation makes reviewers dismiss valid suggestions as
    // unsourced.
    expect(await oneCandidateFor("mass_kg")).toMatch(/GCAT/);
  });

  it("routes operator-private power_draw to sim-fish with SIM_UNCORROBORATED", async () => {
    // Why: telemetry has no public source and must be flagged unverified,
    // otherwise sim-inferred values look like facts in the KG.
    const citation = await oneCandidateFor("power_draw");
    expect(citation).toMatch(/sim-fish/);
    expect(citation).toMatch(/SIM_UNCORROBORATED/);
  });

  it("falls back to generic operator-ingest for an unknown column", async () => {
    // Why: new columns must NOT default into the sim-fish path (which
    // would tag them as unverified). The generic fallback forces reviewers
    // to notice unmapped columns and extend the resolver explicitly.
    const citation = await oneCandidateFor("random_unmapped_column_x");
    expect(citation).toMatch(/operator ingest/);
    expect(citation).not.toMatch(/GCAT|sim-fish/);
  });
});
