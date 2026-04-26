/**
 * Tier-3 BDD E2E — runtime-config knobs exercised against /api/cycles/run
 * with REAL LLM calls (no fixtures), parametrized across every supported
 * provider so per-provider config-routing bugs are caught.
 *
 * Opt-in: real-LLM tests are gated on RUN_LLM_E2E. The file itself is always
 * collected so skips stay visible per test. Each provider block is additionally
 * gated on the relevant API key env var via `providerKeyPresent(p)`, so
 * running the suite with only OPENAI_API_KEY will skip kimi / minimax / local
 * smokes.
 *
 * Structure:
 *   1. Provider smoke matrix — one test per provider in
 *      ["openai","kimi","minimax","deepseek","local"]. Proves the chain reorder reaches
 *      the real transport for that provider (no error + findingsEmitted ≥ 0).
 *   2. Universal behavioral tests — budget override, cortex kill switch,
 *      reflexion cap, run once against the cheapest config
 *      (openai gpt-5.4-nano, reasoningEffort low).
 *
 * Cost envelope: ~$0.35 per full run. Every test clamps planner spend via
 * maxCostUsd ≤ 0.20 and resets every runtime-config domain in afterEach to
 * prevent leak into neighbouring specs (singleFork Redis).
 *
 * HTTP contract (as discovered by previous run):
 *   POST /api/cycles/run => { cycle: { id, kind, startedAt, completedAt,
 *     findingsEmitted, cortices[], error? } }.
 *   No costUsd, no iterations, no metadata.provider are exposed. Structural
 *   invariants sit on cycle.error, cycle.findingsEmitted, cycle.cortices,
 *   and the /api/findings listing for per-cortex observability.
 */
import { describe, it, expect, afterEach } from "vitest";
import { patchConfig, resetAllConfig } from "./helpers/runtime-config";

const RUN_LLM = process.env.RUN_LLM_E2E === "1";
const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";

const PROVIDERS = ["openai", "kimi", "minimax", "deepseek", "local"] as const;
type Provider = (typeof PROVIDERS)[number];

const CHEAPEST_MODEL: Record<Provider, string> = {
  openai: "gpt-5.4-nano",
  kimi: "kimi-k2",
  minimax: "MiniMax-M2.7",
  deepseek: "deepseek-v4-flash",
  local: "local/gemma-e4b-q8",
};

function providerKeyPresent(p: string): boolean {
  switch (p) {
    case "openai":
      return !!process.env.OPENAI_API_KEY;
    case "kimi":
      return !!(process.env.MOONSHOT_API_KEY || process.env.KIMI_API_KEY);
    case "minimax":
      return !!process.env.MINIMAX_API_KEY;
    case "deepseek":
      return !!process.env.DEEPSEEK_API_KEY;
    case "local":
      return !!process.env.LOCAL_LLM_URL;
    default:
      return false;
  }
}

function llmEnabledForProvider(p: Provider): boolean {
  return RUN_LLM && providerKeyPresent(p);
}

type CycleResponse = {
  cycle: {
    id: string;
    kind: "thalamus" | "fish" | "both";
    startedAt: string;
    completedAt: string;
    findingsEmitted: number;
    cortices: string[];
    error?: string;
  };
};

type FindingsListResponse = {
  items: Array<{
    id: string;
    title: string;
    summary: string;
    cortex: string;
    status: string;
    priority: number;
    createdAt: string;
    linkedEntityIds: string[];
    evidence: Array<{ kind: string; uri: string; snippet: string }>;
  }>;
  count: number;
};

async function runCycle(query: string): Promise<{
  cycleId: string;
  cortices: string[];
  findingsEmitted: number;
  error?: string;
  startedAt: string;
  completedAt: string;
}> {
  const res = await fetch(`${BASE}/api/cycles/run`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "thalamus", query }),
  });
  const body = (await res.json()) as CycleResponse | { error?: string };
  if (!("cycle" in body) || !body.cycle) {
    throw new Error(
      `cycles/run non-cycle response status=${res.status} body=${JSON.stringify(body)}`,
    );
  }
  return {
    cycleId: body.cycle.id,
    cortices: body.cycle.cortices,
    findingsEmitted: body.cycle.findingsEmitted,
    error: body.cycle.error,
    startedAt: body.cycle.startedAt,
    completedAt: body.cycle.completedAt,
  };
}

async function listFindings(
  filter: { cortex?: string; status?: string } = {},
): Promise<FindingsListResponse["items"]> {
  const qs = new URLSearchParams();
  if (filter.cortex) qs.set("cortex", filter.cortex);
  if (filter.status) qs.set("status", filter.status);
  const url = `${BASE}/api/findings${qs.toString() ? `?${qs.toString()}` : ""}`;
  const res = await fetch(url);
  const body = (await res.json()) as FindingsListResponse;
  return body.items ?? [];
}

describe("runtime-config cycle BDD (real LLM, multi-provider)", () => {
  afterEach(async () => {
    await resetAllConfig();
  });

  describe.each(PROVIDERS)("provider %s", (p) => {
    it.skipIf(!llmEnabledForProvider(p))(
      `given thalamus.planner.provider ${p} with matching model, when a minimal cycle runs, then the cycle completes without error`,
      async () => {
        const patch = await patchConfig("thalamus.planner", {
          provider: p,
          model: CHEAPEST_MODEL[p],
          reasoningEffort: "low",
          maxCortices: 2,
          maxCostUsd: 0.05,
        });
        expect(patch.status).toBe(200);

        const result = await runCycle("liste 2 opérateurs LEO");

        expect(result.error).toBeUndefined();
        expect(result.findingsEmitted).toBeGreaterThanOrEqual(0);
      },
      180_000,
    );
  });

  describe("universal behavioral (via openai gpt-5.4-nano)", () => {
    it.skipIf(!llmEnabledForProvider("openai"))(
      "given thalamus.planner.maxCostUsd 0.20 and reasoningEffort medium, when a heavier cycle runs, then cycle completes and findingsEmitted is at least one",
      async () => {
        const patch = await patchConfig("thalamus.planner", {
          provider: "openai",
          model: CHEAPEST_MODEL.openai,
          maxCostUsd: 0.2,
          maxCortices: 2,
          reasoningEffort: "medium",
        });
        expect(patch.status).toBe(200);

        const cycle = await runCycle(
          "briefing LEO conjonctions + débris + lancements prochains",
        );

        expect(cycle.error).toBeUndefined();
        expect(cycle.findingsEmitted).toBeGreaterThanOrEqual(1);
      },
      180_000,
    );

    it.skipIf(!llmEnabledForProvider("openai"))(
      "given cortex override conjunction_analysis enabled false, when a cycle runs, then no new finding has cortex equals conjunction_analysis",
      async () => {
        const plannerPatch = await patchConfig("thalamus.planner", {
          provider: "openai",
          model: CHEAPEST_MODEL.openai,
          reasoningEffort: "low",
          maxCortices: 2,
          maxCostUsd: 0.05,
        });
        expect(plannerPatch.status).toBe(200);

        const cortexPatch = await patchConfig("thalamus.cortex", {
          overrides: { conjunction_analysis: { enabled: false } },
        });
        expect(cortexPatch.status).toBe(200);

        const before = await listFindings({
          cortex: "conjunction_analysis",
        });

        const cycle = await runCycle("analyse conjonctions COSMOS-2390");

        expect(cycle.error).toBeUndefined();
        const after = await listFindings({
          cortex: "conjunction_analysis",
        });
        expect(after.length).toBe(before.length);
      },
      180_000,
    );

    it.skipIf(!llmEnabledForProvider("openai"))(
      "given thalamus.reflexion.maxIterations 1, when a cycle runs on an audit query, then the cycle completes without error",
      async () => {
        const plannerPatch = await patchConfig("thalamus.planner", {
          provider: "openai",
          model: CHEAPEST_MODEL.openai,
          reasoningEffort: "low",
          maxCortices: 2,
          maxCostUsd: 0.05,
        });
        expect(plannerPatch.status).toBe(200);

        const reflexionPatch = await patchConfig("thalamus.reflexion", {
          maxIterations: 1,
        });
        expect(reflexionPatch.status).toBe(200);

        const cycle = await runCycle("audit complet catalogue LEO");

        expect(cycle.error).toBeUndefined();
        expect(cycle.completedAt.length).toBeGreaterThan(0);
        expect(cycle.findingsEmitted).toBeGreaterThanOrEqual(0);
      },
      180_000,
    );
  });
});
