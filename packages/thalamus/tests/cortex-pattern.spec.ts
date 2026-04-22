/**
 * SPEC-TH-003 — Cortex Pattern
 *
 * Traceability covered:
 *   AC-1 execute always resolves with a CortexOutput
 *   AC-2 unknown cortex yields empty output + model === "none"
 *   AC-3 findings are normalised (confidence in [0,1], impactScore in [0,10])
 *   AC-4 user-scoped cortex without userId returns empty, no SQL helper call
 *   AC-5 helper throw does not reject the executor (graceful degradation)
 *
 * Skipped (need real LLM / full pipeline mock):
 *   AC-6 prompt-injection stripping verified via a transport spy
 *   AC-7 additive registration smoke (covered by SPEC-TH-002 + SPEC-TH-031)
 *   AC-8 payload bounds — covered by SPEC-TH-020 Layer 3 tests
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock heavy boundaries BEFORE importing the module under test.
vi.mock("../src/cortices/cortex-llm", () => ({
  analyzeCortexData: vi.fn(),
}));
vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: vi.fn(() => ({
    chat: vi.fn(async () => ({ content: "" })),
  })),
}));

import { CortexExecutor } from "../src/cortices/executor";
import { CortexRegistry, type CortexSkill } from "../src/cortices/registry";
import { noopDomainConfig, type CortexDataProvider } from "../src/cortices/types";
import { StandardStrategy } from "../src/cortices/strategies/standard-strategy";
import { StrategistStrategy } from "../src/cortices/strategies/strategist-strategy";
import { NullWebSearchAdapter } from "../src/transports/openai-web-search.adapter";
import type {
  SourceFetcherPort,
  SourceResult,
} from "../src/ports/source-fetcher.port";
import {
  ResearchFindingType,
  ResearchUrgency,
  ResearchRelation,
} from "@interview/shared/enum";
import { analyzeCortexData } from "../src/cortices/cortex-llm";

// Build a fake CortexRegistry that returns canned skills.
function fakeRegistry(skills: Record<string, Partial<CortexSkill>>) {
  const map = new Map<string, CortexSkill>();
  for (const [name, s] of Object.entries(skills)) {
    map.set(name, {
      filePath: `/fake/${name}.md`,
      body: s.body ?? "skill body",
      header: {
        name,
        description: s.header?.description ?? "",
        sqlHelper: s.header?.sqlHelper ?? "none",
        params: s.header?.params ?? {},
      },
    });
  }
  const registry = new CortexRegistry("/tmp/test-cortex-pattern");
  registry.get = (name: string) => map.get(name);
  registry.has = (name: string) => map.has(name);
  registry.names = () => [...map.keys()];
  registry.size = () => map.size;
  return registry;
}

// Test domain config — matches the historic SSA defaults the tests were
// written against (FleetAnalyst user-scoped, AdvisoryRadar / DebrisForecaster
// web-enriched / relevance-filtered).
const testDomainConfig = {
  ...noopDomainConfig,
  userScopedCortices: new Set(["fleet_analyst", "advisory_radar"]),
  webEnrichedCortices: new Set(["advisory_radar", "debris_forecaster"]),
  relevanceFilteredCortices: new Set(["advisory_radar", "debris_forecaster"]),
};

// Build the default strategy list the production container also wires:
// Strategist first (specialised), Standard last (catch-all). Empty data
// provider by default; individual tests can inject a real seam fake.
function buildTestStrategies({
  dataProvider = {},
  sourceFetcher = {
    fetchForCortex: async () => [] as SourceResult[],
  },
}: {
  dataProvider?: CortexDataProvider;
  sourceFetcher?: SourceFetcherPort;
} = {}) {
  return [
    new StrategistStrategy(testDomainConfig),
    new StandardStrategy(
      dataProvider,
      testDomainConfig,
      new NullWebSearchAdapter(),
      sourceFetcher,
    ),
  ];
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SPEC-TH-003 AC-2 — unknown cortex yields empty output", () => {
  it("returns findings: [] and model === 'none'", async () => {
    const registry = fakeRegistry({}); // empty
    const executor = new CortexExecutor(registry, buildTestStrategies());

    const out = await executor.execute("does_not_exist", {
      query: "any",
      params: {},
      cycleId: 1n,
    });

    expect(out.findings).toEqual([]);
    expect(out.metadata.model).toBe("none");
    expect(out.metadata.duration).toBeGreaterThanOrEqual(0);
    expect(analyzeCortexData).not.toHaveBeenCalled();
  });
});

describe("SPEC-TH-003 AC-1 / AC-3 — nominal execution normalises findings", () => {
  it("resolves with a CortexOutput whose findings are all in range", async () => {
    const rawFindings = [
      {
        title: "Finding A",
        summary: "Out of range confidence will be clamped",
        findingType: ResearchFindingType.Insight,
        urgency: ResearchUrgency.Low,
        evidence: [],
        confidence: 1.5, // should clamp to 1
        impactScore: 20, // should clamp to 10
        edges: [],
      },
      {
        title: "Finding B",
        summary: "Negative values clamp to 0",
        findingType: ResearchFindingType.Anomaly,
        urgency: ResearchUrgency.Medium,
        evidence: [{ source: "test", data: {}, weight: 1 }],
        confidence: -0.5,
        impactScore: -3,
        edges: [
          {
            entityType: "satellite",
            entityId: 42,
            relation: ResearchRelation.About,
          },
        ],
      },
    ];

    vi.mocked(analyzeCortexData).mockResolvedValue({
      findings: rawFindings,
      tokensEstimate: 100,
      model: "test-nano",
    });

    // Make external sources non-empty so the executor reaches the LLM path.
    const sourceFetcher: SourceFetcherPort = {
      fetchForCortex: async () => [
        {
          type: "celestrak",
          source: "test",
          url: "x",
          data: { a: 1 },
          fetchedAt: new Date().toISOString(),
          latencyMs: 0,
        },
      ],
    };

    const registry = fakeRegistry({
      catalog: {
        header: { name: "catalog", description: "", sqlHelper: "none", params: {} },
      },
    });
    const executor = new CortexExecutor(
      registry,
      buildTestStrategies({ sourceFetcher }),
    );

    const out = await executor.execute("catalog", {
      query: "screen conjunctions",
      params: {},
      cycleId: 1n,
    });

    expect(out.findings.length).toBeGreaterThan(0);
    for (const f of out.findings) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
      expect(f.impactScore).toBeGreaterThanOrEqual(0);
      expect(f.impactScore).toBeLessThanOrEqual(10);
      expect(
        Object.values(ResearchFindingType),
        `invalid findingType: ${f.findingType}`,
      ).toContain(f.findingType);
      expect(
        Object.values(ResearchUrgency),
        `invalid urgency: ${f.urgency}`,
      ).toContain(f.urgency);
    }
    expect(out.metadata.model).toBe("test-nano");
  });
});

describe("SPEC-TH-003 AC-4 — user-scoped cortex requires userId", () => {
  it("FleetAnalyst without params.userId returns empty and does NOT call analyzeCortexData", async () => {
    const registry = fakeRegistry({
      fleet_analyst: {
        header: {
          name: "fleet_analyst",
          description: "",
          sqlHelper: "listSatellitesByOperator",
          params: {},
        },
      },
    });
    const executor = new CortexExecutor(registry, buildTestStrategies());

    const out = await executor.execute("fleet_analyst", {
      query: "fleet",
      params: {}, // no userId
      cycleId: 1n,
    });

    expect(out.findings).toEqual([]);
    expect(analyzeCortexData).not.toHaveBeenCalled();
  });
});

describe("SPEC-TH-003 AC-5 — helper throw is swallowed, executor keeps going", () => {
  it("does not reject when the SQL helper throws and still uses surviving source rows", async () => {
    // cortex-llm mock returns empty findings — enough to verify the strategy
    // did not propagate the helper failure and still processed source data.
    vi.mocked(analyzeCortexData).mockResolvedValue({
      findings: [],
      tokensEstimate: 0,
      model: "test-nano",
    });

    const explodingHelper = vi.fn(async () => {
      throw new Error("db down");
    });
    const registry = fakeRegistry({
      catalog: {
        header: {
          name: "catalog",
          description: "",
          sqlHelper: "explodingHelper",
          params: {},
        },
      },
    });
    // Provide 1 source row so DATA is non-empty — the strategy's
    // "data-gap" meta-finding emits only when DATA was non-empty.
    const sourceFetcher: SourceFetcherPort = {
      fetchForCortex: async () => [
        {
          type: "celestrak",
          source: "test",
          url: "x",
          data: { a: 1 },
          fetchedAt: new Date().toISOString(),
          latencyMs: 0,
        },
      ],
    };
    const executor = new CortexExecutor(
      registry,
      buildTestStrategies({
        dataProvider: { explodingHelper },
        sourceFetcher,
      }),
    );

    const promise = executor.execute("catalog", {
      query: "screen",
      params: { noradId: 25544 },
      cycleId: 1n,
    });
    await expect(promise).resolves.toBeDefined();
    const out = await promise;
    // Bug #3 L1 fix (2026-04-17 morning audit): when the LLM emits 0
    // findings while DATA was non-empty (here: 1 structured-source row
    // survived after the helper failure), the strategy emits a synthetic
    // data-gap "anomaly" meta-finding so the silence stays visible.
    expect(explodingHelper).toHaveBeenCalledWith({ noradId: 25544 });
    expect(out.findings).toHaveLength(1);
    expect(out.findings[0].findingType).toBe(ResearchFindingType.Anomaly);
    expect(out.findings[0].title).toMatch(/0 findings from \d+ data items/);
    expect(out.metadata).toBeDefined();
  });
});
