/**
 * Behavior: LLM-mode orchestration (runAudit for any mode !== "nullScan").
 *
 * Covers:
 *   - batching of operator-country stats by config.batchSize
 *   - per-wave failure isolation (non-ok results dropped)
 *   - briefing-mode overrides on category/severity/affectedSatellites
 *   - past-feedback filtering by operator-country name (case-insensitive)
 *
 * The NanoCaller port (DIP refactor) lets us inject pure fakes — no
 * vi.mock() of @interview/thalamus required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { SsaAuditProvider } from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import type {
  NanoCaller,
  NanoRequest,
} from "../../../../../../src/agent/ssa/sweep/nano-caller.port";
import type { SsaAuditDeps } from "../../../../../../src/agent/ssa/sweep/audit-provider.ssa";
import { StaticConfigProvider } from "@interview/shared/config";
import { fakeSatellitePort, fakeSweepRepo, statsRow } from "./__fixtures";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SsaAuditProvider LLM mode", () => {
  const manyStats = Array.from({ length: 23 }, (_, i) =>
    statsRow({
      operatorCountryId: BigInt(i + 1),
      operatorCountryName: `OC-${i + 1}`,
    }),
  );

  it("batches operator-countries by config.batchSize", async () => {
    // Why: the provider slices the operator-country stats list into waves
    // of config.batchSize before dispatching. 23 items at batchSize=10 must
    // produce 3 batches (10 + 10 + 3). A regression that calls the LLM per
    // item would produce 23 batches and explode cost.
    let capturedBatches: unknown[] | undefined;
    const caller: NanoCaller = {
      async callWaves(items) {
        capturedBatches = items as unknown[];
        return [];
      },
    };
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort({
        getOperatorCountrySweepStats: vi.fn().mockResolvedValue(manyStats),
      }),
      sweepRepo: fakeSweepRepo(),
      nanoCaller: caller,
      config: new StaticConfigProvider({
        batchSize: 10,
        nullScanMaxIdsPerSuggestion: 200,
      }),
    });

    await provider.runAudit({ cycleId: "c", mode: "default", limit: 100 });

    expect(capturedBatches).toBeDefined();
    expect(capturedBatches!.length).toBe(3);
  });

  it("drops non-ok wave results and parses ok ones", async () => {
    // Why: individual batches can fail (rate limit, timeout). The provider
    // must proceed with the ok results. Without this test, a single failure
    // could propagate and abort the entire cycle.
    const stats = [
      statsRow({ operatorCountryId: 1n, operatorCountryName: "Testland" }),
      statsRow({ operatorCountryId: 2n, operatorCountryName: "Testland-B" }),
    ];
    const caller: NanoCaller = {
      async callWaves(items) {
        return [
          {
            ok: false,
            text: "",
            urls: [],
            latencyMs: 0,
            error: "timeout",
            index: 0,
          },
          {
            ok: true,
            text: JSON.stringify([
              {
                operatorCountry: "Testland-B",
                category: "missing_data",
                severity: "warning",
                title: "LLM finding",
              },
            ]),
            urls: [],
            latencyMs: 0,
            index: 1,
          },
        ].slice(0, items.length);
      },
    };
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort({
        getOperatorCountrySweepStats: vi.fn().mockResolvedValue(stats),
      }),
      sweepRepo: fakeSweepRepo(),
      nanoCaller: caller,
      config: new StaticConfigProvider({
        batchSize: 1, // forces 2 batches
        nullScanMaxIdsPerSuggestion: 200,
      }),
    });

    const result = await provider.runAudit({
      cycleId: "c",
      mode: "default",
      limit: 100,
    });

    expect(result).toHaveLength(1);
    expect(result[0]!.domainFields.title).toBe("LLM finding");
  });

  it("briefing mode forces category=briefing_angle, severity=info, affectedSatellites=0", async () => {
    // Why: briefing mode is semantically distinct from anomaly detection.
    // Even if the LLM claims `category=mass_anomaly, severity=critical`,
    // the provider must overwrite to avoid polluting the anomaly workflow
    // with briefing-style speculation.
    const stats = [statsRow({ operatorCountryName: "Testland" })];
    const caller: NanoCaller = {
      async callWaves(items) {
        return items.map((_, i) => ({
          ok: true as const,
          text: JSON.stringify([
            {
              operatorCountry: "Testland",
              category: "mass_anomaly",
              severity: "critical",
              title: "T",
              affectedSatellites: 999,
            },
          ]),
          urls: [],
          latencyMs: 0,
          index: i,
        }));
      },
    };
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort({
        getOperatorCountrySweepStats: vi.fn().mockResolvedValue(stats),
      }),
      sweepRepo: fakeSweepRepo(),
      nanoCaller: caller,
    });

    const [c] = await provider.runAudit({
      cycleId: "c",
      mode: "briefing",
      limit: 10,
    });

    expect(c!.domainFields.category).toBe("briefing_angle");
    expect(c!.domainFields.severity).toBe("info");
    expect(c!.domainFields.affectedSatellites).toBe(0);
  });

  it("injects ONLY matching past feedback into the nano-request instructions", async () => {
    // Why: the provider filters past feedback by operator-country name
    // (case-insensitive) and injects matches into the prompt. Non-matching
    // feedback must NOT leak in — otherwise prompts grow unbounded across
    // unrelated contexts.
    const stats = [statsRow({ operatorCountryName: "Testland" })];
    const fullDomainFields = (overrides: {
      category: string;
      operatorCountryName: string;
    }) => ({
      operatorCountryId: null,
      operatorCountryName: overrides.operatorCountryName,
      category: overrides.category,
      severity: "info",
      title: "past finding",
      description: "past description",
      affectedSatellites: 1,
      suggestedAction: "n/a",
      webEvidence: null,
    });
    const sweepRepo: SsaAuditDeps["sweepRepo"] = {
      loadPastFeedback: vi.fn().mockResolvedValue([
        {
          domainFields: fullDomainFields({
            category: "mass_anomaly",
            operatorCountryName: "Testland",
          }),
          wasAccepted: true,
          reviewerNote: "nice catch",
        },
        {
          domainFields: fullDomainFields({
            category: "enrichment",
            operatorCountryName: "Otherland",
          }),
          wasAccepted: false,
          reviewerNote: null,
        },
      ]),
    };
    const capturedRequests: NanoRequest[] = [];
    const caller: NanoCaller = {
      async callWaves(items, build) {
        for (const item of items) capturedRequests.push(build(item));
        return [];
      },
    };
    const provider = new SsaAuditProvider({
      satelliteRepo: fakeSatellitePort({
        getOperatorCountrySweepStats: vi.fn().mockResolvedValue(stats),
      }),
      sweepRepo,
      nanoCaller: caller,
    });

    await provider.runAudit({ cycleId: "c", mode: "default", limit: 10 });

    expect(capturedRequests).toHaveLength(1);
    expect(capturedRequests[0]!.instructions).toContain("Testland");
    expect(capturedRequests[0]!.instructions).toContain("ACCEPTED");
    expect(capturedRequests[0]!.instructions).not.toContain("Otherland");
  });
});
