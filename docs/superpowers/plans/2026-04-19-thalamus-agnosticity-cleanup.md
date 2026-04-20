# Thalamus Agnosticity Cleanup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the "base is agnostic, not absent" refactor for `packages/thalamus` — evict the remaining SSA leakage (planner prompt, fallback DAG, daemon-dag duplicate, SSA explorer/source pack, satellite entity patterns, ENTITY_TABLE_MAP, SSA edge orphan-cleanup, concrete `VoyageEmbedder`, SSA-named public types) without breaking runtime SSA behavior. Apps inject. Package stays runnable standalone on generic defaults.

**Architecture:** Additive-first. Every leak is replaced by a port / setter / injected config on the app side **before** the package copy is deleted. Functionality trumps purity — nothing is removed unless the replacement is wired and green. CLI loses its `noopDomainConfig` in-process cycle shortcut and routes through `console-api` HTTP. No DB migration in this pass.

**Tech Stack:** TypeScript 5.9, pnpm workspace, Vitest (unit + integration + e2e), dependency-cruiser (arch guard), jscpd (duplication guard), Fastify (console-api), Drizzle + Postgres (KG), BullMQ + Redis (ingestion staging).

---

## 0. Scope

### In scope

1. Package public API breaking changes (generic types, fewer exports).
2. Moves from `packages/thalamus/src/**` → `apps/console-api/src/agent/ssa/thalamus-pack/**`.
3. CLI cycle path: delete in-process `runCycle` shortcut, route through HTTP.
4. Three coherent dedups:
   - `packages/thalamus/src/utils/llm-json-parser.ts` ↔ `packages/sweep/src/utils/llm-json-parser.ts` → `packages/shared/src/utils/llm-json-parser.ts`.
   - Delete stale `packages/sweep/src/middleware/auth.middleware.ts` (zero consumers — `apps/console-api/src/middleware/auth.middleware.ts` is the only auth middleware anyone imports).
   - Delete `packages/thalamus/src/config/daemon-dags.config.ts` after `apps/console-api/src/agent/ssa/daemon-dags.ts` is the only source (resolving the drift spotted between the two).
5. `VoyageEmbedder` concrete implementation → app-owned. Package keeps the port.
6. Arch guards: forbid SSA tokens inside `packages/thalamus/src` via depcruise.

### Out of scope (will be flagged, not solved)

- **C1/C2** triple-write path + `sim-promotion.service.ts` 511-line god-service. Orthogonal. Separate branch.
- **SPEC-SSA-028** `CortexDataProvider` HTTP migration. Parked. BDD stub at `apps/console-api/tests/e2e/cortex-data-provider-http.stub.spec.ts`.
- **SPEC-TH-025** Runtime-config expansion to 8 more sub-domains. Parked. BDD stub at `apps/console-api/tests/e2e/runtime-config-cortex.stub.spec.ts`.
- **I8** Generalizing `process.env` reads through a `ConfigProvider<T>` for all 20+ sites. We only extract `VoyageEmbedder`'s env read as a side-effect of making it a port. Everything else stays.
- **Shadow DTOs front/api** (`apps/console/src/shared/types/dtos.ts` vs `apps/console-api/src/transformers/*.dto.ts`). Real duplication but unrelated to thalamus agnosticity. Separate plan.
- DB enum migration. `research_cortex` / `research_entity_type` Postgres enums keep their SSA values; the package contract shifts to `string` at compile time while runtime values stay identical.
- Barrel-promotion of `@interview/thalamus/explorer/*` deep-path aliases in vitest configs. Keep the aliases — the targeted files (`nano-caller`, `curator`, `nano-swarm`, `research-graph.service`) all stay inside the package after this plan.

### Preconditions verified 2026-04-19

- ✅ `feature/console-front-5l` already merged into `main` (commits `82f0fce`, `282c044`). The plan's "wait for front-5l stabilization" gate is satisfied.
- ✅ `apps/console-api/src/agent/ssa/domain-config.ts` already exists and injects `keywords`, `userScoped`, `webEnriched`, `relevanceFiltered`, `fallbackCortices`, `daemonDags`, `webSearchPrompt`, `preSummarize`, `sourcingRules`, `entityTypes`.
- ✅ Setter pattern already established: `setNanoSwarmProfile`, `setCuratorPrompt`, `setNanoSwarmConfigProvider`, `setNanoConfigProvider`. We extend it.
- ✅ Sweep package imports only generic thalamus symbols (`CortexRegistry`, `ConfidenceService`, `callNanoWithMode`, `extractJsonObject`). None of those move, so sweep is not broken.

### Draft-plan corrections made during validation

- **"fallback DAG SSA"** — confirmed: `packages/thalamus/src/services/thalamus-planner.service.ts:274-297` hardcodes `fleet_analyst`/`conjunction_analysis`/`regime_profiler`/`strategist` in `private fallbackPlan(query)`. New `DomainConfig.fallbackPlan` field is justified.
- **"verificationReasonCodes injection"** — reflexion.prompt.ts has only _example_ gap names ("need_operator_id", "need_payload_profile"). There is no hardcoded SSA reason-code array to inject; the only SSA residue is two example strings in the system prompt. Decision: **replace those two example strings with domain-agnostic placeholders in the kernel prompt** and let `DomainConfig.sourcingRules` carry any SSA-specific guidance (already the mechanism in place). Do not invent a new `verificationReasonCodes` port.
- **busContext in `CortexFinding` public type (line 50 of `cortices/types.ts`)** — the draft plan missed this SSA leak. `busContext?: { busId: number; busName: string; similarity?: number }` is SSA vocabulary in the kernel's public contract. Replace with `extensions?: Record<string, unknown>` and let SSA cortices stamp `extensions.busContext = { busId, busName, similarity }` from their side. Finding-persister and transformer code follow through.
- **`opacity-scout.prompt.ts`** — draft didn't list it explicitly. It's SSA-only (OpacityScout is an SSA cortex). Move to `apps/console-api/src/agent/ssa/thalamus-pack/prompts/opacity-scout.prompt.ts`. Drop from `packages/thalamus/src/prompts/index.ts`.
- **`StrategistStrategy`** gated by `ResearchCortex.Strategist` enum lookup in `cortices/strategies/strategist-strategy.ts:21`. Must match on the cortex **name string** (`"strategist"`) via the cortex header metadata or a `DomainConfig.synthesisCortexName` field. Pick the latter (explicit port, one place to change).
- **`cortices/strategies/helpers.ts` `normalizeFinding`** imports `ResearchFindingType`/`ResearchUrgency`/`ResearchEntityType`/`ResearchRelation` enums from `@interview/shared`. Keep `ResearchFindingType`/`ResearchUrgency`/`ResearchRelation` (draft confirms they're generic). Drop the `ResearchEntityType.Satellite` fallback (SSA); validate edge entityType against the `DomainConfig.entityTypes` array (already injected) with "unknown" fallback or edge-drop policy.
- **CLI boot.ts cycle path** — confirmed at `packages/cli/src/boot.ts:186-239`. Calls `thalamusService.runCycle()` with no `domainConfig` (falls to `noopDomainConfig`). After Phase 5 this silently produces zero findings; before Phase 5 the noop fallback hides the breakage. We cut this path in Phase 7 to prevent a silent regression.
- **`apps/console-api/src/agent/ssa/thalamus-pack/`** does not yet exist. We create it.
- **Sweep consumers of `@interview/thalamus`**: `packages/sweep/src/config/container.ts` (`CortexRegistry`, `ConfidenceService`), `packages/sweep/src/sim/turn-runner-sequential.ts` + `turn-runner-dag.ts` (`callNanoWithMode`, `extractJsonObject`). All four survive this refactor unchanged. Verified.

---

## 1. Phasing & commit plan

Eight phases = eight commits minimum, executed on a single feature branch `feature/thalamus-agnosticity`. Additive commits first (1→4), then consumer migration (5→6), then deletion (7→8). Each phase ends with typecheck + unit + arch + dup + relevant e2e green.

| Phase | Commit title prefix                                                         | Risk                |
| ----- | --------------------------------------------------------------------------- | ------------------- |
| 0     | `chore(thalamus-agnostic): baseline`                                        | low                 |
| 1     | `feat(thalamus): extend DomainConfig seams`                                 | low (additive)      |
| 2     | `feat(ssa): thalamus-pack scaffold + fetchers move`                         | medium (file moves) |
| 3     | `feat(ssa): explorer pack move + entity-catalog port`                       | medium              |
| 4     | `feat(thalamus): embedder + voyage port`                                    | low                 |
| 5     | `refactor(thalamus): generic public types + string cortex/entity`           | **high (breaking)** |
| 6     | `refactor(thalamus): extensions replaces busContext`                        | medium (breaking)   |
| 7     | `refactor(cli): route cycles via console-api HTTP`                          | medium              |
| 8     | `chore(repo): dedup (llm-json-parser, stale auth, daemon-dag), arch guards` | low                 |

Each numbered Task below maps to the phase indicated in its heading.

---

## 2. File structure locks (what lands where)

### Stays in `packages/thalamus/src/` (the generic kernel)

- `services/*.service.ts` — `ThalamusService`, `ThalamusPlanner`, `ThalamusDAGExecutor`, `ThalamusReflexion`, `CycleLoopRunner`, `FindingPersister`, `StopCriteriaEvaluator`, `ResearchGraphService`.
- `cortices/executor.ts`, `registry.ts`, `field-correlation.ts`, `guardrails.ts`, `confidence.ts`, `cortex-llm.ts`, `config.ts`, `types.ts` (with public types tightened in Phase 5/6), `strategies/{standard,strategist}-strategy.ts` + `helpers.ts`.
- `explorer/orchestrator.ts`, `nano-caller.ts`, `nano-swarm.ts` (with generic default profile, no SSA extraction call), `curator.ts`.
- `prompts/{nano-swarm,curator,reflexion,planner}.prompt.ts` — but `planner.prompt.ts` becomes a generic template + `DomainConfig.plannerPrompt` override.
- `repositories/research-cycle.repository.ts`, `research-finding.repository.ts`, `research-edge.repository.ts` (with SSA orphan-cleanup replaced by injected `EntityCatalogPort`).
- `entities/research.entity.ts`, `types/research.types.ts` (generic types in Phase 5), `transformers/research.transformer.ts`.
- `transports/*` (LLM transport + factory + fixture + web-search adapter), `ports/web-search.port.ts`.
- `utils/ssrf-guard.ts`. `utils/llm-json-parser.ts` → moves to `@interview/shared/utils` in Phase 8.
- `config/container.ts`, `runtime-config.ts`, `register-runtime-config.ts`. `enrichment.ts` keeps its `process.env` reads (I8 out of scope, per declaration).

### Moves to `apps/console-api/src/agent/ssa/thalamus-pack/`

Tree:

```
apps/console-api/src/agent/ssa/thalamus-pack/
├── cortices/
│   └── sources/          # was packages/thalamus/src/cortices/sources/*
│       ├── fetcher-arxiv.ts
│       ├── fetcher-bus-archetype.ts
│       ├── fetcher-celestrak.ts
│       ├── fetcher-knowledge-graph.ts
│       ├── fetcher-launch-market.ts
│       ├── fetcher-ntrs.ts
│       ├── fetcher-orbit-regime.ts
│       ├── fetcher-regulation.ts
│       ├── fetcher-rss.ts
│       ├── fetcher-seesat.ts
│       ├── fetcher-space-weather.ts
│       ├── fetcher-spectra.ts
│       ├── spacetrack-diff.ts
│       ├── registry.ts
│       ├── types.ts
│       └── index.ts
├── explorer/             # SSA-specific explorer work (scout, crawler, SSA extraction)
│   ├── scout.ts          # was packages/thalamus/src/explorer/scout.ts
│   ├── crawler.ts        # was packages/thalamus/src/explorer/crawler.ts
│   └── satellite-entity-patterns.ts   # was packages/thalamus/src/utils/*
├── prompts/
│   ├── opacity-scout.prompt.ts        # was packages/thalamus/src/prompts/*
│   └── ssa-planner.prompt.ts          # NEW — the SSA-flavored planner prompt
├── ports/
│   ├── entity-catalog.port.ts         # NEW — resolveNames + cleanOrphans interface consumed by research-graph.service
│   └── embedder.port.ts               # NEW — generic embedder port (moved from thalamus types)
├── adapters/
│   ├── ssa-entity-catalog.adapter.ts  # NEW — implements EntityCatalogPort for SSA tables
│   └── voyage-embedder.adapter.ts     # was packages/thalamus/src/utils/voyage-embedder.ts
└── domain-config.ts       # already exists; this phase extends it (plannerPrompt, fallbackPlan, synthesisCortexName, extractEntities?)
```

### New files in `packages/thalamus/src/`

- `ports/embedder.port.ts` — `EmbedderPort` interface (`embedQuery`, `embedDocuments`, `isAvailable`). Kept internal for now; exported from barrel.
- `ports/entity-catalog.port.ts` — `EntityCatalogPort` (`resolveNames(refs): Promise<Map<string, string>>`, `cleanOrphans(): Promise<number>`).
- `entities/null-embedder.ts` — `NullEmbedder implements EmbedderPort` (returns `null` from every call, `isAvailable() → false`). Default for standalone package usage.
- `entities/noop-entity-catalog.ts` — `NoopEntityCatalog implements EntityCatalogPort` (returns empty Map, 0 cleaned). Default for standalone usage.
- `prompts/planner-generic.prompt.ts` — domain-agnostic `buildGenericPlannerSystemPrompt(input)` (strips the "SSA" framing, keeps DAG mechanics). Used when `DomainConfig.plannerPrompt` is not provided.

### Deletions

- `packages/thalamus/src/utils/voyage-embedder.ts` (moved).
- `packages/thalamus/src/utils/satellite-entity-patterns.ts` (moved).
- `packages/thalamus/src/utils/llm-json-parser.ts` (dedup).
- `packages/thalamus/src/prompts/opacity-scout.prompt.ts` (moved).
- `packages/thalamus/src/cortices/sources/` **entire directory** (moved).
- `packages/thalamus/src/explorer/scout.ts` (moved).
- `packages/thalamus/src/explorer/crawler.ts` (moved). Note: `orchestrator.ts` currently imports from `scout.ts` + `crawler.ts` — it is refactored to accept port-shaped collaborators OR the SSA-specific orchestration (scout+crawler+curator) moves with the pack. See Task 3.4.
- `packages/thalamus/src/repositories/entity-name-resolver.ts` (moved).
- `packages/thalamus/src/config/daemon-dags.config.ts` (dedup; `apps/console-api/src/agent/ssa/daemon-dags.ts` wins).
- `packages/sweep/src/middleware/auth.middleware.ts` (stale, unreferenced).
- `packages/sweep/src/utils/llm-json-parser.ts` (dedup; both sweep + thalamus import from shared).

---

## 3. Ports & contracts (full signatures)

### 3.1 `EntityCatalogPort`

```ts
// packages/thalamus/src/ports/entity-catalog.port.ts
export interface EntityRef {
  entityType: string;
  entityId: bigint;
}

export interface EntityCatalogPort {
  /**
   * Resolve display names for a batch of (entityType, entityId) pairs.
   * Returns Map<"type:id", name>. Keys not found in the backing catalog
   * are silently omitted. Callers render missing keys as fallback strings.
   */
  resolveNames(refs: EntityRef[]): Promise<Map<string, string>>;

  /**
   * Delete edges in `research_edge` whose target (entityType, entityId)
   * no longer exists in the domain catalog. Returns deleted row count.
   * Implementations are domain-specific (SSA checks satellite/operator/
   * orbit_regime/…; threat-intel would check indicator/actor/campaign).
   */
  cleanOrphans(): Promise<number>;
}
```

Package default: `NoopEntityCatalog` (returns empty Map, cleans 0 rows).
App implementation: `SsaEntityCatalogAdapter` inside `apps/console-api/src/agent/ssa/thalamus-pack/adapters/`, replicates the current `ENTITY_TABLE_MAP` + `cleanOrphans` SQL from `EntityNameResolver` and `ResearchEdgeRepository`.

### 3.2 `EmbedderPort`

```ts
// packages/thalamus/src/ports/embedder.port.ts
export interface EmbedderPort {
  isAvailable(): boolean;
  embedQuery(text: string): Promise<number[] | null>;
  embedDocuments(texts: string[]): Promise<(number[] | null)[]>;
}
```

Package default: `NullEmbedder` (always returns null, `isAvailable = false`). Used by tests and by standalone package consumers.
App implementation: `VoyageEmbedderAdapter` inside the ssa/thalamus-pack, same class body as today minus no change needed — it already matches the port shape.

### 3.3 `DomainConfig` — added fields

```ts
// packages/thalamus/src/cortices/types.ts (extended)
export interface DomainConfig {
  // ── existing fields, unchanged ─────────────────────────────────────
  keywords: Set<string>;
  userScopedCortices: Set<string>;
  webEnrichedCortices: Set<string>;
  relevanceFilteredCortices: Set<string>;
  fallbackCortices: string[];
  daemonDags: Record<string, DAGPlan>;
  webSearchPrompt: WebSearchPromptFn;
  preSummarize: (
    rows: Record<string, unknown>[],
    cortexName: string,
  ) => Record<string, unknown>[];
  sourcingRules?: string;
  entityTypes?: string[];

  // ── NEW fields (Phase 1) ───────────────────────────────────────────
  /**
   * Planner system-prompt builder. Kernel passes `{ headers, cortexNames }`
   * and receives the system prompt string. If omitted, the kernel falls
   * back to `buildGenericPlannerSystemPrompt`. SSA domain ships the
   * current planner.prompt.ts content here.
   */
  plannerPrompt?: (input: {
    headers: string;
    cortexNames: readonly string[];
  }) => string;

  /**
   * Fallback DAG when the planner LLM returns an empty plan or fails
   * entirely. If omitted, kernel falls back to running the
   * `fallbackCortices` list flat (no dependsOn chain). SSA domain ships
   * the current `fleet_analyst → conjunction_analysis → regime_profiler → strategist`
   * pipeline here.
   */
  fallbackPlan?: (query: string) => DAGPlan;

  /**
   * Name of the synthesis cortex that must run last in every plan.
   * `StrategistStrategy.canHandle` compares cortex name to this string.
   * Default: `"strategist"` (works unchanged for SSA).
   */
  synthesisCortexName?: string;

  /**
   * Optional entity-extraction hook used by nano-swarm when building
   * follow-up queries. If omitted, nano-swarm uses text-only grounding
   * (no entity list). SSA pack wires `extractSatelliteEntities`.
   */
  extractEntities?: (text: string) => {
    primary: string[];
    secondary?: string[];
    hasContent: boolean;
  };
}
```

### 3.4 `BuildThalamusOpts` — added fields

```ts
export interface BuildThalamusOpts {
  db: Database;
  skillsDir: string;
  dataProvider: CortexDataProvider;
  domainConfig?: DomainConfig;
  webSearch?: WebSearchPort;
  strategies?: CortexExecutionStrategy[];

  // ── NEW (Phase 3+4) ────────────────────────────────────────────────
  /** Optional entity catalog. Defaults to NoopEntityCatalog. */
  entityCatalog?: EntityCatalogPort;
  /** Optional embedder. Defaults to NullEmbedder. */
  embedder?: EmbedderPort;

  // ── REMOVED ────────────────────────────────────────────────────────
  // voyageApiKey was used to construct VoyageEmbedder inside the container.
  // After Phase 4 the container does not know about Voyage at all; the app
  // passes an `embedder` instead. Consumers who still pass `voyageApiKey`
  // get a TS error (intentional breaking change, app-only wiring).
}
```

---

## 4. Tasks

### Task 0.1: Baseline snapshots

**Files:**

- Modify: nothing.
- Artifacts: `.reports/thalamus-agnostic-baseline/` (gitignored).

- [ ] **Step 1: Create baseline branch off current main.**

```bash
git checkout main && git pull
git checkout -b feature/thalamus-agnosticity
```

- [ ] **Step 2: Capture depcruise baseline (errors + orphans).**

```bash
mkdir -p .reports/thalamus-agnostic-baseline
pnpm arch:check:repo > .reports/thalamus-agnostic-baseline/depcruise-before.txt 2>&1 || true
```

Expected: pass or existing warnings documented. If it fails on main, stop — fix main first.

- [ ] **Step 3: Capture jscpd baseline.**

```bash
pnpm dup:report:full
cp -r .reports/jscpd-full .reports/thalamus-agnostic-baseline/jscpd-before
```

- [ ] **Step 4: Capture typecheck + test baseline.**

```bash
pnpm -r typecheck 2>&1 | tee .reports/thalamus-agnostic-baseline/typecheck-before.txt
pnpm test 2>&1 | tee .reports/thalamus-agnostic-baseline/test-before.txt
```

Expected: all green. If any suite is red on `main`, stop and investigate — we do not start on a red base.

- [ ] **Step 5: Commit baseline artifacts marker (empty commit, no artifacts in repo).**

```bash
git commit --allow-empty -m "chore(thalamus-agnostic): baseline snapshot captured (see .reports/)"
```

---

### Task 1.1: Extend `DomainConfig` with new optional seams

**Files:**

- Modify: `packages/thalamus/src/cortices/types.ts:115-191`
- Create: `packages/thalamus/src/prompts/planner-generic.prompt.ts`
- Modify: `packages/thalamus/src/prompts/index.ts` (export the generic prompt)
- Test: `packages/thalamus/tests/unit/cortices/types.domain-config.test.ts` (new) — validates `noopDomainConfig` satisfies the new optional shape and the generic planner prompt fires when omitted.

- [ ] **Step 1: Write the failing test (Vitest, unit project).**

```ts
// packages/thalamus/tests/unit/cortices/types.domain-config.test.ts
import { describe, it, expect } from "vitest";
import {
  noopDomainConfig,
  type DomainConfig,
} from "../../../src/cortices/types";
import { buildGenericPlannerSystemPrompt } from "../../../src/prompts/planner-generic.prompt";

describe("DomainConfig (new optional seams)", () => {
  it("noopDomainConfig leaves plannerPrompt/fallbackPlan/synthesisCortexName undefined", () => {
    expect(noopDomainConfig.plannerPrompt).toBeUndefined();
    expect(noopDomainConfig.fallbackPlan).toBeUndefined();
    expect(noopDomainConfig.synthesisCortexName).toBeUndefined();
    expect(noopDomainConfig.extractEntities).toBeUndefined();
  });

  it("accepts a DomainConfig with all new seams populated", () => {
    const cfg: DomainConfig = {
      ...noopDomainConfig,
      plannerPrompt: ({ headers, cortexNames }) =>
        `Plan across ${cortexNames.length} cortices:\n${headers}`,
      fallbackPlan: (query) => ({
        intent: query,
        complexity: "moderate",
        nodes: [],
      }),
      synthesisCortexName: "synth",
      extractEntities: (text) => ({
        primary: [text],
        hasContent: text.length > 0,
      }),
    };
    expect(cfg.plannerPrompt?.({ headers: "h", cortexNames: [] })).toContain(
      "0 cortices",
    );
    expect(cfg.fallbackPlan?.("q")?.intent).toBe("q");
    expect(cfg.synthesisCortexName).toBe("synth");
    expect(cfg.extractEntities?.("x").hasContent).toBe(true);
  });
});

describe("buildGenericPlannerSystemPrompt", () => {
  it("emits a prompt without SSA vocabulary", () => {
    const prompt = buildGenericPlannerSystemPrompt({
      headers: "some_cortex(): do a thing",
      cortexNames: ["some_cortex"],
    });
    expect(prompt).not.toMatch(/SSA|satellite|NORAD|conjunction|fleet/i);
    expect(prompt).toContain("some_cortex");
    expect(prompt).toContain("DAG");
  });
});
```

- [ ] **Step 2: Run — must FAIL (missing file + missing fields).**

```bash
pnpm --filter @interview/thalamus vitest run tests/unit/cortices/types.domain-config.test.ts
```

Expected: module-not-found + type errors.

- [ ] **Step 3: Create `planner-generic.prompt.ts`.**

```ts
// packages/thalamus/src/prompts/planner-generic.prompt.ts
/**
 * Domain-agnostic planner system prompt. Used by ThalamusPlanner when
 * DomainConfig.plannerPrompt is not provided. Describes DAG mechanics
 * and JSON output shape without SSA vocabulary.
 */
export interface GenericPlannerPromptInput {
  headers: string;
  cortexNames: readonly string[];
}

export function buildGenericPlannerSystemPrompt(
  input: GenericPlannerPromptInput,
): string {
  return `You are a research planner. You decompose research questions into a DAG of cortex activations.

Available cortices:
${input.headers}

Rules:
- Each node has: cortex (name), params (key-value), dependsOn (list of cortex names that must complete first).
- Independent cortices should have empty dependsOn (they run in parallel).
- If a cortex needs results from another, add it to dependsOn.
- Use 2-5 cortices per query. Don't activate every cortex unless the query truly requires it.
- Never activate the same cortex twice in one DAG.
- Valid cortex names: ${input.cortexNames.join(", ")}
- Params must come only from explicit query text or obvious header defaults. Never invent identifiers, dates, or thresholds.
- Classify query complexity: "simple" | "moderate" | "deep".

Respond with ONLY a JSON object: { "intent": "...", "complexity": "simple|moderate|deep", "nodes": [...] }`;
}
```

- [ ] **Step 4: Extend `DomainConfig` + `noopDomainConfig` in `cortices/types.ts`.**

Edit the `DomainConfig` interface (keeping existing fields) to append:

```ts
  plannerPrompt?: (input: { headers: string; cortexNames: readonly string[] }) => string;
  fallbackPlan?: (query: string) => DAGPlan;
  synthesisCortexName?: string;
  extractEntities?: (text: string) => { primary: string[]; secondary?: string[]; hasContent: boolean };
```

No change to `noopDomainConfig` — all new fields are optional.

- [ ] **Step 5: Export the generic prompt from `prompts/index.ts`.**

Add:

```ts
export {
  buildGenericPlannerSystemPrompt,
  type GenericPlannerPromptInput,
} from "./planner-generic.prompt";
```

- [ ] **Step 6: Run test — must PASS.**

```bash
pnpm --filter @interview/thalamus vitest run tests/unit/cortices/types.domain-config.test.ts
```

- [ ] **Step 7: Run full thalamus unit suite to prove no regression.**

```bash
pnpm --filter @interview/thalamus vitest run
```

- [ ] **Step 8: Commit.**

```bash
git add packages/thalamus/src/cortices/types.ts \
        packages/thalamus/src/prompts/planner-generic.prompt.ts \
        packages/thalamus/src/prompts/index.ts \
        packages/thalamus/tests/unit/cortices/types.domain-config.test.ts
git commit -m "feat(thalamus): add plannerPrompt/fallbackPlan/synthesisCortexName DomainConfig seams"
```

---

### Task 1.2: ThalamusPlanner consumes the new seams

**Files:**

- Modify: `packages/thalamus/src/services/thalamus-planner.service.ts:1-70` (constructor signature) and `:100-148` (LLM path) and `:270-297` (private `fallbackPlan`).
- Modify: `packages/thalamus/src/config/container.ts:110-114` (pass the new fields in constructor).
- Test: `packages/thalamus/tests/unit/services/thalamus-planner.test.ts` — existing file; add two cases.

- [ ] **Step 1: Add failing tests.**

```ts
// additions to existing spec
it("uses DomainConfig.plannerPrompt when provided", async () => {
  const captured: string[] = [];
  const transport = mockLlmTransport((system) => {
    captured.push(system);
    return DAG_JSON;
  });
  const planner = new ThalamusPlanner(
    registry,
    DAEMON_DAGS_FIXTURE,
    new Set(),
    {
      plannerPrompt: ({ headers }) => `CUSTOM:${headers}`,
      fallbackPlan: undefined,
      fallbackCortices: [],
      synthesisCortexName: "strategist",
    },
    transport,
  );
  await planner.plan("q");
  expect(captured[0]).toMatch(/^CUSTOM:/);
});

it("uses DomainConfig.fallbackPlan when planner LLM fails", async () => {
  const transport = mockLlmTransport(() => {
    throw new Error("LLM dead");
  });
  const customFallback = {
    intent: "FB",
    complexity: "simple",
    nodes: [{ cortex: "x", params: {}, dependsOn: [] }],
  };
  const planner = new ThalamusPlanner(
    registry,
    {},
    new Set(),
    {
      plannerPrompt: undefined,
      fallbackPlan: () => customFallback,
      fallbackCortices: [],
      synthesisCortexName: "strategist",
    },
    transport,
  );
  const plan = await planner.plan("q");
  expect(plan.intent).toBe("FB");
});

it("runs fallbackCortices flat when neither plannerLLM succeeds nor fallbackPlan is provided", async () => {
  const transport = mockLlmTransport(() => {
    throw new Error("LLM dead");
  });
  const planner = new ThalamusPlanner(
    registry,
    {},
    new Set(),
    {
      plannerPrompt: undefined,
      fallbackPlan: undefined,
      fallbackCortices: ["a", "b"],
      synthesisCortexName: "strategist",
    },
    transport,
  );
  const plan = await planner.plan("q");
  expect(plan.nodes.map((n) => n.cortex).sort()).toEqual(["a", "b"]);
  expect(plan.nodes.every((n) => n.dependsOn.length === 0)).toBe(true);
});
```

- [ ] **Step 2: Change `ThalamusPlanner` constructor** to accept a `plannerConfig` object with `plannerPrompt?`, `fallbackPlan?`, `fallbackCortices`, `synthesisCortexName` (default `"strategist"`) instead of the current `daemonDags + userScopedCortices` pair. Keep the old params as deprecated overloads? **No — just refactor all two callers in one commit** (container.ts and the unit test file). This is the additive-first path: the new constructor signature subsumes the old.

- [ ] **Step 3: Replace hardcoded prompt call** with:

```ts
const systemPrompt = this.plannerConfig.plannerPrompt
  ? this.plannerConfig.plannerPrompt({ headers, cortexNames })
  : buildGenericPlannerSystemPrompt({ headers, cortexNames });
```

- [ ] **Step 4: Replace `private fallbackPlan(query)` body** with:

```ts
private fallbackPlan(query: string): DAGPlan {
  if (this.plannerConfig.fallbackPlan) return this.plannerConfig.fallbackPlan(query);
  const nodes = this.plannerConfig.fallbackCortices.map((cortex) => ({
    cortex,
    params: {},
    dependsOn: [] as string[],
  }));
  return { intent: query, complexity: "moderate", nodes };
}
```

- [ ] **Step 5: Update `config/container.ts`** to pass `{ plannerPrompt: domainConfig.plannerPrompt, fallbackPlan: domainConfig.fallbackPlan, fallbackCortices: domainConfig.fallbackCortices, synthesisCortexName: domainConfig.synthesisCortexName ?? "strategist", daemonDags: domainConfig.daemonDags, userScopedCortices: domainConfig.userScopedCortices }`.

- [ ] **Step 6: Run planner tests — must PASS.**

```bash
pnpm --filter @interview/thalamus vitest run tests/unit/services/thalamus-planner.test.ts
```

- [ ] **Step 7: Run full thalamus suite + console-api unit suite.**

```bash
pnpm --filter @interview/thalamus vitest run
pnpm --filter @interview/console-api vitest run --project unit
```

- [ ] **Step 8: Commit.**

```bash
git commit -am "feat(thalamus): planner consumes DomainConfig.plannerPrompt + fallbackPlan"
```

---

### Task 1.3: Populate new seams on SSA domain-config

**Files:**

- Modify: `apps/console-api/src/agent/ssa/domain-config.ts`
- Create: `apps/console-api/src/agent/ssa/thalamus-pack/prompts/ssa-planner.prompt.ts` (holds the old `buildPlannerSystemPrompt` body)
- Create: `apps/console-api/src/agent/ssa/thalamus-pack/fallback-plan.ts` (holds the old `fallbackPlan` body)
- Test: `apps/console-api/tests/unit/agent/ssa/domain-config.test.ts` (new)

- [ ] **Step 1: Failing test.**

```ts
// apps/console-api/tests/unit/agent/ssa/domain-config.test.ts
import { describe, it, expect } from "vitest";
import { buildSsaDomainConfig } from "../../../../src/agent/ssa/domain-config";

describe("buildSsaDomainConfig (extended)", () => {
  it("ships a planner prompt that mentions SSA vocabulary", () => {
    const cfg = buildSsaDomainConfig();
    const prompt = cfg.plannerPrompt!({
      headers: "fleet_analyst(): ...",
      cortexNames: ["fleet_analyst"],
    });
    expect(prompt).toMatch(
      /SSA|Space Situational Awareness|NORAD|fleet_analyst/,
    );
  });
  it("ships an SSA fallback plan with fleet + conjunction + regime + strategist", () => {
    const cfg = buildSsaDomainConfig();
    const plan = cfg.fallbackPlan!("any query");
    expect(plan.nodes.map((n) => n.cortex)).toEqual(
      expect.arrayContaining([
        "fleet_analyst",
        "conjunction_analysis",
        "regime_profiler",
        "strategist",
      ]),
    );
  });
  it("names strategist as the synthesis cortex", () => {
    expect(buildSsaDomainConfig().synthesisCortexName).toBe("strategist");
  });
});
```

- [ ] **Step 2: Create `ssa-planner.prompt.ts`** — copy the old body of `packages/thalamus/src/prompts/planner.prompt.ts:16-38` verbatim into a new `buildSsaPlannerSystemPrompt` function in the app pack.

- [ ] **Step 3: Create `fallback-plan.ts`** — copy the old body of `packages/thalamus/src/services/thalamus-planner.service.ts:274-297` into an exported `ssaFallbackPlan(query)` function.

- [ ] **Step 4: Update `buildSsaDomainConfig()` to wire them.**

```ts
import { buildSsaPlannerSystemPrompt } from "./thalamus-pack/prompts/ssa-planner.prompt";
import { ssaFallbackPlan } from "./thalamus-pack/fallback-plan";
// …
  plannerPrompt: buildSsaPlannerSystemPrompt,
  fallbackPlan: ssaFallbackPlan,
  synthesisCortexName: "strategist",
```

- [ ] **Step 5: Run the test + console-api unit + e2e smoke.**

```bash
pnpm --filter @interview/console-api vitest run tests/unit/agent/ssa/domain-config.test.ts
pnpm --filter @interview/console-api vitest run --project unit
pnpm --filter @interview/console-api vitest run tests/e2e/thalamus-run-cycle.e2e.spec.ts 2>/dev/null || true
```

Expected: unit green. e2e: only if the test file exists; skip otherwise (smoke is in Phase 5).

- [ ] **Step 6: Delete the SSA planner prompt from the package.**

Leave `packages/thalamus/src/prompts/planner.prompt.ts` in place for now (deleted in Phase 5). This commit only introduces the SSA copy in the app — the package prompt stays usable by legacy callers until we cut them.

- [ ] **Step 7: Commit.**

```bash
git add apps/console-api/src/agent/ssa/domain-config.ts \
        apps/console-api/src/agent/ssa/thalamus-pack/prompts/ssa-planner.prompt.ts \
        apps/console-api/src/agent/ssa/thalamus-pack/fallback-plan.ts \
        apps/console-api/tests/unit/agent/ssa/domain-config.test.ts
git commit -m "feat(ssa): inject plannerPrompt + fallbackPlan via DomainConfig"
```

---

### Task 2.1: Scaffold `thalamus-pack/` structure in console-api

**Files:**

- Create: directory layout from §2. All `.ts` files will be added in Tasks 2.2, 3.1, 3.2, 4.1. This task only creates empty `index.ts` barrels.

- [ ] **Step 1: Create the tree.**

```bash
mkdir -p apps/console-api/src/agent/ssa/thalamus-pack/{cortices/sources,explorer,prompts,ports,adapters}
touch apps/console-api/src/agent/ssa/thalamus-pack/cortices/sources/index.ts
touch apps/console-api/src/agent/ssa/thalamus-pack/index.ts
```

- [ ] **Step 2: Add depcruise rule skeleton** (Phase 8 tightens; this task just declares the zone).

In `.dependency-cruiser.js`, append a rule **in a commented block** (uncomment in Phase 8):

```js
// {
//   name: "thalamus-kernel-no-ssa-vocabulary",
//   severity: "error",
//   comment: "Kernel package must not reference SSA entity names. See SPEC thalamus-agnosticity-cleanup.",
//   from: { path: "^packages/thalamus/src/" },
//   to: { path: "satellite-entity-patterns|fetcher-celestrak|fetcher-spectra|opacity-scout" },
// },
```

- [ ] **Step 3: Commit scaffold.**

```bash
git add apps/console-api/src/agent/ssa/thalamus-pack/ .dependency-cruiser.js
git commit -m "chore(ssa): scaffold thalamus-pack directory + staged arch rule"
```

---

### Task 2.2: Move fetchers + sources registry to the pack

**Files:**

- Move: every `packages/thalamus/src/cortices/sources/*` to `apps/console-api/src/agent/ssa/thalamus-pack/cortices/sources/`.
- Modify: any consumer of the package `sources` exports. Grep first:

- [ ] **Step 1: Inventory consumers.**

```bash
git grep -n "from \"@interview/thalamus/cortices/sources\|from \".*thalamus/src/cortices/sources\|from \"\\./cortices/sources\|from \"\\.\\./cortices/sources"
```

Expected: consumers inside the package only (other fetchers, registry, skill files). SSA skill files in `apps/console-api/src/agent/ssa/skills/` **may** import via relative paths to the package.

- [ ] **Step 2: Move the files** (use `git mv` to preserve history).

```bash
git mv packages/thalamus/src/cortices/sources apps/console-api/src/agent/ssa/thalamus-pack/cortices/sources
```

- [ ] **Step 3: Rewrite internal imports inside the moved files.**

Each moved file currently imports `@interview/shared`, `../types`, `../../utils/...`, `drizzle-orm`, `@interview/db-schema`. Targets now need:

- `../../../../shared/src/...` → keep as `@interview/shared` (workspace resolves).
- `../../types` (the old cortex `types.ts`) → `@interview/thalamus` (exported from barrel).
- `../../../utils/satellite-entity-patterns` → update to new path after Task 3.3 (SSA patterns move). Temporarily keep via `../../../../../../packages/thalamus/src/utils/satellite-entity-patterns` relative path **OR** merge Task 2.2 + 3.3 into one commit. Merge is cleaner.

Decision: execute Task 2.2 + 3.3 as a single commit. Rebase this task's steps into Task 3's "move" commit.

- [ ] **Step 4: (executed in Task 3 — no commit here).**

---

### Task 3.1: Define `EntityCatalogPort` + `NoopEntityCatalog`

**Files:**

- Create: `packages/thalamus/src/ports/entity-catalog.port.ts`
- Create: `packages/thalamus/src/entities/noop-entity-catalog.ts`
- Modify: `packages/thalamus/src/index.ts` (export both)
- Test: `packages/thalamus/tests/unit/ports/entity-catalog.test.ts`

- [ ] **Step 1: Failing test.**

```ts
// packages/thalamus/tests/unit/ports/entity-catalog.test.ts
import { describe, it, expect } from "vitest";
import { NoopEntityCatalog } from "../../../src/entities/noop-entity-catalog";

describe("NoopEntityCatalog", () => {
  it("returns an empty Map for any batch", async () => {
    const c = new NoopEntityCatalog();
    const m = await c.resolveNames([{ entityType: "satellite", entityId: 1n }]);
    expect(m.size).toBe(0);
  });
  it("reports 0 cleaned orphans", async () => {
    expect(await new NoopEntityCatalog().cleanOrphans()).toBe(0);
  });
});
```

- [ ] **Step 2: Create port + noop.**

```ts
// packages/thalamus/src/ports/entity-catalog.port.ts
export interface EntityRef {
  entityType: string;
  entityId: bigint;
}
export interface EntityCatalogPort {
  resolveNames(refs: EntityRef[]): Promise<Map<string, string>>;
  cleanOrphans(): Promise<number>;
}
```

```ts
// packages/thalamus/src/entities/noop-entity-catalog.ts
import type {
  EntityCatalogPort,
  EntityRef,
} from "../ports/entity-catalog.port";
export class NoopEntityCatalog implements EntityCatalogPort {
  async resolveNames(_refs: EntityRef[]): Promise<Map<string, string>> {
    return new Map();
  }
  async cleanOrphans(): Promise<number> {
    return 0;
  }
}
```

- [ ] **Step 3: Export from barrel.**
      Add to `packages/thalamus/src/index.ts`:

```ts
export type { EntityCatalogPort, EntityRef } from "./ports/entity-catalog.port";
export { NoopEntityCatalog } from "./entities/noop-entity-catalog";
```

- [ ] **Step 4: Run port test.** Green.

- [ ] **Step 5: Commit.**

```bash
git commit -am "feat(thalamus): add EntityCatalogPort + NoopEntityCatalog default"
```

---

### Task 3.2: Rewire `ResearchGraphService` + `ResearchEdgeRepository` to use the port

**Files:**

- Modify: `packages/thalamus/src/services/research-graph.service.ts` (replace direct `EntityNameResolver` dependency with `EntityCatalogPort`).
- Modify: `packages/thalamus/src/repositories/research-edge.repository.ts` (remove `cleanOrphans` body — delegate via a new method on the service that calls the port; or remove `cleanOrphans` from the repo entirely and give the service the port directly).
- Modify: `packages/thalamus/src/config/container.ts` (accept `entityCatalog?`, default to `NoopEntityCatalog`, wire into `graphService`).
- Create: `apps/console-api/src/agent/ssa/thalamus-pack/adapters/ssa-entity-catalog.adapter.ts`.
- Modify: `apps/console-api/src/container.ts` (pass `entityCatalog: new SsaEntityCatalogAdapter(db)`).
- Delete (end of task): `packages/thalamus/src/repositories/entity-name-resolver.ts`.

Decision: `cleanOrphans` stays as a service method; the repo sheds the SQL. `ResearchGraphService.cleanupOrphanEdges()` delegates to `this.entityCatalog.cleanOrphans()`.

- [ ] **Step 1: Failing integration test.**

```ts
// packages/thalamus/tests/integration/entity-catalog.integration.test.ts (new)
import { describe, it, expect } from "vitest";
import { buildThalamusContainer, NoopEntityCatalog } from "../../src";
import { makeFakeDb } from "../helpers/fake-db"; // existing helper; adapt if absent
import { tmpdir } from "node:os";

describe("ResearchGraphService uses injected EntityCatalogPort", () => {
  it("cleanupOrphanEdges delegates to port.cleanOrphans", async () => {
    let called = 0;
    const catalog = {
      resolveNames: async () => new Map(),
      cleanOrphans: async () => {
        called++;
        return 42;
      },
    };
    const c = buildThalamusContainer({
      db: makeFakeDb(),
      skillsDir: tmpdir(),
      dataProvider: {},
      entityCatalog: catalog,
    });
    const n = await c.graphService.cleanupOrphanEdges();
    expect(n).toBe(42);
    expect(called).toBe(1);
  });
});
```

- [ ] **Step 2: Rewire service + container + repo.** (Sequential edits; no code inline here — keep Task within the 25k budget.)

- [ ] **Step 3: Write `SsaEntityCatalogAdapter`** — copy `ENTITY_TABLE_MAP` + `resolve()` body from `entity-name-resolver.ts` into the new adapter. Copy the `cleanOrphans` SQL from `research-edge.repository.ts:89-108` into the adapter's `cleanOrphans()`.

- [ ] **Step 4: Wire in `apps/console-api/src/container.ts`.**

```ts
import { SsaEntityCatalogAdapter } from "./agent/ssa/thalamus-pack/adapters/ssa-entity-catalog.adapter";
// …
const thalamus = buildThalamusContainer({
  db,
  skillsDir,
  dataProvider,
  domainConfig: buildSsaDomainConfig(),
  webSearch,
  entityCatalog: new SsaEntityCatalogAdapter(db), // NEW
});
```

- [ ] **Step 5: Delete `packages/thalamus/src/repositories/entity-name-resolver.ts`** + drop its barrel export + drop the import from `container.ts`.

- [ ] **Step 6: Run.**

```bash
pnpm -r typecheck
pnpm --filter @interview/thalamus vitest run
pnpm --filter @interview/console-api vitest run --project unit
pnpm --filter @interview/console-api vitest run --project integration
```

- [ ] **Step 7: Commit.**

```bash
git commit -am "refactor(thalamus): inject EntityCatalogPort; SSA adapter owns entity tables"
```

---

### Task 3.3: Move `satellite-entity-patterns` + the SSA explorer pack

**Files:**

- Move: `packages/thalamus/src/utils/satellite-entity-patterns.ts` → `apps/console-api/src/agent/ssa/thalamus-pack/explorer/satellite-entity-patterns.ts`
- Move: `packages/thalamus/src/explorer/scout.ts` → `apps/console-api/src/agent/ssa/thalamus-pack/explorer/scout.ts`
- Move: `packages/thalamus/src/explorer/crawler.ts` → `apps/console-api/src/agent/ssa/thalamus-pack/explorer/crawler.ts`
- Move: `packages/thalamus/src/prompts/opacity-scout.prompt.ts` → `apps/console-api/src/agent/ssa/thalamus-pack/prompts/opacity-scout.prompt.ts`
- Modify: `packages/thalamus/src/explorer/nano-swarm.ts:26-28,279,304` — remove `extractSatelliteEntities` import and the two call sites; replace with `domainConfig.extractEntities?.(cleanText) ?? { primary: [], hasContent: false }` fed in via setter.
- Modify: `packages/thalamus/src/explorer/orchestrator.ts` — it currently stitches scout + crawler + curator + nano-swarm. Options:
  - (A) Orchestrator stays; receives scout/crawler as injected ports. Needs two new ports (`ScoutPort`, `CrawlerPort`) and default noop impls.
  - (B) Orchestrator moves with the SSA pack; package keeps only the lower-level primitives (`callNano*`, `curator` default prompt).
- Chosen: **(B)**. The orchestrator's value is tied to scout+crawler semantics; inventing two more ports for a single consumer is YAGNI per the user's rule. Move it.

- [ ] **Step 1: Inventory consumers of `ExplorerOrchestrator`.**

```bash
git grep -n "ExplorerOrchestrator\|orchestrator\.explore"
```

Expected consumers: an SSA skill or service. If any non-SSA consumer appears, reconsider option (A).

- [ ] **Step 2: `git mv` the files.**

```bash
git mv packages/thalamus/src/utils/satellite-entity-patterns.ts apps/console-api/src/agent/ssa/thalamus-pack/explorer/satellite-entity-patterns.ts
git mv packages/thalamus/src/explorer/scout.ts apps/console-api/src/agent/ssa/thalamus-pack/explorer/scout.ts
git mv packages/thalamus/src/explorer/crawler.ts apps/console-api/src/agent/ssa/thalamus-pack/explorer/crawler.ts
git mv packages/thalamus/src/explorer/orchestrator.ts apps/console-api/src/agent/ssa/thalamus-pack/explorer/orchestrator.ts
git mv packages/thalamus/src/prompts/opacity-scout.prompt.ts apps/console-api/src/agent/ssa/thalamus-pack/prompts/opacity-scout.prompt.ts
```

- [ ] **Step 3: Execute Task 2.2 file moves** (fetchers + sources registry) in the same commit.

```bash
git mv packages/thalamus/src/cortices/sources apps/console-api/src/agent/ssa/thalamus-pack/cortices/sources
```

- [ ] **Step 4: Rewrite imports in all moved files.**

Patterns to fix:

- `from "../types"` → `from "@interview/thalamus"` (for `CortexFinding`, `DomainConfig`, etc.)
- `from "../../utils/satellite-entity-patterns"` (inside now-moved crawler/scout) → `from "./satellite-entity-patterns"`
- `from "../explorer/..."` (inside moved fetchers) → unchanged or re-rooted to `@interview/thalamus` for explorer primitives that stayed (`callNano*`, `curator`).
- `from "../../prompts/opacity-scout.prompt"` inside `cortex-llm.ts`? Let's grep:

```bash
git grep -n "opacity-scout\.prompt\|buildOpacityScoutSystemPrompt"
```

Wire the opacity-scout prompt consumer to the new app path. If the consumer is a skill file in `apps/console-api/src/agent/ssa/skills/`, the import becomes `../thalamus-pack/prompts/opacity-scout.prompt`.

- [ ] **Step 5: Remove the exports from `packages/thalamus/src/prompts/index.ts`** (drop `buildOpacityScoutSystemPrompt`, `OpacityScoutPromptInput`).

- [ ] **Step 6: Remove `ExplorerOrchestrator` export from `packages/thalamus/src/index.ts`** + strip `setCuratorPrompt` call-site coupling if any.

- [ ] **Step 7: Update `packages/thalamus/src/explorer/nano-swarm.ts`** to drop `satellite-entity-patterns` import and accept an optional `extractEntities` hook (plumbed through a new setter `setEntityExtractor(fn)` added to nano-swarm, mirroring `setNanoSwarmProfile`). Package default: no-op.

- [ ] **Step 8: Wire SSA extractor in `apps/console-api/src/container.ts`.**

```ts
import { setEntityExtractor } from "@interview/thalamus";
import { extractSatelliteEntities } from "./agent/ssa/thalamus-pack/explorer/satellite-entity-patterns";
// …
setEntityExtractor((text) => {
  const e = extractSatelliteEntities(text);
  return {
    primary: [...e.satellites, ...e.noradIds, ...e.cosparIds],
    secondary: [...e.operators, ...e.orbitRegimes, ...e.launchVehicles],
    hasContent: e.hasSatelliteContent,
  };
});
```

- [ ] **Step 9: Update vitest config aliases** if the deep paths `@interview/thalamus/explorer/nano-caller` / `nano-swarm` are still referenced. `nano-caller` + `nano-swarm` stay in package, so those survive. Scout/crawler aliases (if any) break — search & remove.

- [ ] **Step 10: Run.**

```bash
pnpm -r typecheck
pnpm --filter @interview/thalamus vitest run
pnpm --filter @interview/console-api vitest run --project unit
pnpm --filter @interview/console-api vitest run --project integration
pnpm --filter @interview/console-api vitest run --project e2e
```

Expected: a real cycle e2e should fire the SSA extractor via the setter path. If an e2e fails on entity counts, the extractor wiring needs a closer look — do not accept silent-zero behavior.

- [ ] **Step 11: Commit.**

```bash
git commit -am "refactor(ssa): move fetchers+explorer+opacity-scout prompt to thalamus-pack; nano-swarm takes injected extractor"
```

---

### Task 4.1: Extract Voyage embedder as an injected port

**Files:**

- Create: `packages/thalamus/src/ports/embedder.port.ts`
- Create: `packages/thalamus/src/entities/null-embedder.ts`
- Move: `packages/thalamus/src/utils/voyage-embedder.ts` → `apps/console-api/src/agent/ssa/thalamus-pack/adapters/voyage-embedder.adapter.ts`
- Modify: `packages/thalamus/src/config/container.ts` (drop `voyageApiKey` opt, accept `embedder?`, default `NullEmbedder`).
- Modify: `packages/thalamus/src/services/research-graph.service.ts` (constructor signature swaps concrete `VoyageEmbedder` for `EmbedderPort`; it already uses only `embedQuery`/`embedDocuments`/`isAvailable`, so the call sites don't change).
- Modify: `packages/thalamus/src/index.ts` (remove `VoyageEmbedder` export; add `EmbedderPort`, `NullEmbedder`).
- Modify: `apps/console-api/src/container.ts` (instantiate `new VoyageEmbedderAdapter(config.voyageApiKey)` and pass as `embedder`).

- [ ] **Step 1: Failing test.**

```ts
// packages/thalamus/tests/unit/ports/embedder.test.ts
import { describe, it, expect } from "vitest";
import { NullEmbedder } from "../../../src/entities/null-embedder";

describe("NullEmbedder", () => {
  it("reports unavailable", () =>
    expect(new NullEmbedder().isAvailable()).toBe(false));
  it("embedQuery returns null", async () =>
    expect(await new NullEmbedder().embedQuery("x")).toBeNull());
  it("embedDocuments returns an array of nulls", async () => {
    const out = await new NullEmbedder().embedDocuments(["a", "b"]);
    expect(out).toEqual([null, null]);
  });
});
```

- [ ] **Step 2: Create port + null impl.**

- [ ] **Step 3: Move Voyage adapter.** `git mv` then fix its imports (`@interview/shared/observability` stays; logger name unchanged).

- [ ] **Step 4: Update container + graph-service + barrel.**

- [ ] **Step 5: Wire `VoyageEmbedderAdapter` in `apps/console-api/src/container.ts`.** Source the API key from existing `config` (don't read `process.env.VOYAGE_API_KEY` in the package anymore — the ssa/thalamus-pack adapter owns that).

- [ ] **Step 6: Run.**

```bash
pnpm -r typecheck
pnpm test
```

Failure expected: any test that did `new VoyageEmbedder()` directly. Patch those to `new NullEmbedder()` or the new adapter import.

- [ ] **Step 7: Commit.**

```bash
git commit -am "refactor(thalamus): EmbedderPort + NullEmbedder; Voyage concrete moves to ssa/thalamus-pack"
```

---

### Task 5.1: Tighten public types — string cortex names + string entity types

**Files:**

- Modify: `packages/thalamus/src/cortices/types.ts` (replace `ResearchCortex` on `Cortex.name` with `string`; replace `ResearchEntityType` on `CortexFinding.edges[].entityType` with `string`).
- Modify: `packages/thalamus/src/cortices/strategies/helpers.ts` (drop `ResearchEntityType` import + `.Satellite` fallback; validate edge `entityType` against an injected list or pass through as-is; the cortex output is already trusted).
- Modify: `packages/thalamus/src/cortices/strategies/strategist-strategy.ts:21` (`cortexName === this.domainConfig.synthesisCortexName ?? "strategist"` — canHandle uses the DomainConfig field).
- Modify: `packages/thalamus/src/types/research.types.ts` (`cortex: string`, `entityType: string` across DTOs).
- Modify: `packages/thalamus/src/services/finding-persister.service.ts` (`cortex: string` on persist calls; `entityType: string`).
- Modify: `packages/thalamus/src/services/cycle-loop.service.ts:287-291` (replace `edge.entityType === ResearchEntityType.X` checks with a domain-neutral routing — e.g. every edge contributes to the `needsVerification` heuristic, or delete the SSA-specific branches if they are purely gap-detection).
- Modify: `packages/thalamus/src/repositories/research-edge.repository.ts:27,70` (drop `ResearchEntityType` import; `entityType: string` parameter; drop `SsaEntityType` type-narrowing).
- Delete: `packages/thalamus/src/prompts/planner.prompt.ts` (replaced by `planner-generic.prompt.ts` in the package + SSA-specific in the ssa/thalamus-pack).

**Caller-side touch-ups (compile only; no behavior change at runtime because enum values ARE strings):**

- `apps/console-api/src/services/finding-*.service.ts` — any place reading `.cortex` or `.entityType` off a Thalamus DTO keeps working (string-compare to SSA enum values still resolves). Run typecheck to catch any narrowing gaps.

- [ ] **Step 1: Run typecheck on a throw-away branch to catch every narrow-type bite.**

```bash
# On the feature branch, open a scratch commit:
# 1. Edit cortices/types.ts — swap enums for string
# 2. pnpm -r typecheck
```

Record every error site; they are the edit list for Step 2.

- [ ] **Step 2: Apply all edits** (the list above is exhaustive; if typecheck surfaces sites not listed, update this plan inline).

- [ ] **Step 3: Update cycle-loop.service.ts verification heuristic.**

The current code gates `needsVerification` on `edge.entityType === ResearchEntityType.ConjunctionEvent | Satellite | Operator | OperatorCountry | Finding`. Replace with **a domain-neutral heuristic** that asks the `DomainConfig` whether a given entityType is verification-relevant. Add to `DomainConfig`:

```ts
/** Optional filter: which entity types trigger the "needs verification"
 *  heuristic. If omitted, kernel defaults to "all". SSA domain narrows. */
isVerificationRelevantEntityType?: (entityType: string) => boolean;
```

Wire the SSA impl to return `true` for the five old cases, `false` otherwise.

- [ ] **Step 4: Drop planner.prompt.ts (SSA-hardcoded).**

```bash
git rm packages/thalamus/src/prompts/planner.prompt.ts
```

Update `packages/thalamus/src/prompts/index.ts` to drop `buildPlannerSystemPrompt` export. Any code that imported it (`thalamus-planner.service.ts`) already switched to the `DomainConfig.plannerPrompt ?? buildGenericPlannerSystemPrompt` path in Task 1.2.

- [ ] **Step 5: Remove `ResearchCortex` / `ResearchEntityType` imports from** every file under `packages/thalamus/src` except `types/research.types.ts` (where `cortex: string` replaces the enum).

Expected post-change grep:

```bash
git grep "ResearchCortex\|ResearchEntityType" -- packages/thalamus/src | wc -l
```

Target: **0**.

- [ ] **Step 6: Run full suite.**

```bash
pnpm -r typecheck
pnpm test
pnpm arch:check:repo
```

- [ ] **Step 7: Commit.**

```bash
git commit -am "refactor(thalamus): public types become string-keyed; planner.prompt.ts moves to SSA"
```

---

### Task 6.1: Rename `busContext` → `extensions` on the public contract

**Files:**

- Modify: `packages/thalamus/src/cortices/types.ts:50` (`extensions?: Record<string, unknown>`).
- Modify: `packages/thalamus/src/cortices/strategies/helpers.ts:46` (normalize `extensions` pass-through).
- Modify: `packages/thalamus/src/types/research.types.ts:83,105` (`extensions: Record<string, unknown> | null` on both).
- Modify: `packages/thalamus/src/transformers/research.transformer.ts` (map `extensions ↔ busContext` column in DB — **the DB column name stays `bus_context` for this pass; the transformer renames on read/write**).
- Modify: `packages/thalamus/src/services/finding-persister.service.ts:56` (use `finding.extensions ?? null`).
- Modify: every SSA consumer that writes `busContext` → `extensions.busContext`:
  - Skills in `apps/console-api/src/agent/ssa/skills/` reading `finding.busContext` → `finding.extensions?.busContext`.
- Modify: `apps/console/src/shared/types/dtos.ts` **NO** — frontend only reads from console-api DTOs; console-api transformer handles the rename internally. Verify.

**DB column rename is out of scope** (see §0). We keep the column `bus_context` in Postgres and map it to the generic `extensions` field in the transformer. A future plan can rename the column.

- [ ] **Step 1: Failing test.**

```ts
// packages/thalamus/tests/unit/transformers/research.transformer.test.ts (add case)
it("maps bus_context column → extensions field on read, back on write", () => {
  const row = {
    /* …finding row with bus_context: {...} */
  } as any;
  const dto = toResearchFinding(row);
  expect(dto.extensions).toEqual(row.bus_context);
  expect((dto as any).busContext).toBeUndefined();
});
```

- [ ] **Step 2: Apply edits listed above.**

- [ ] **Step 3: Regression run.**

```bash
pnpm -r typecheck && pnpm test
```

Watch for SSA skill / transformer tests that accessed `finding.busContext` — the rename must be complete.

- [ ] **Step 4: Commit.**

```bash
git commit -am "refactor(thalamus): rename busContext → extensions on kernel contract (DB col unchanged)"
```

---

### Task 7.1: Delete CLI in-process cycle path; route through HTTP

**Files:**

- Modify: `packages/cli/src/boot.ts:179-240` (replace the thalamus container build + `runCycle` adapter with an HTTP-client adapter pointing at `POST /api/thalamus/cycles/run`).
- Verify: route contract exists. If `POST /api/thalamus/cycles/run` is missing, **this task becomes one of the CLAUDE.md "missing route means incomplete architecture" cases** and we must add it first.

- [ ] **Step 1: Confirm the route.**

```bash
git grep -n "thalamus/cycles\|/cycles/run\|runCycle" apps/console-api/src/routes/
```

If the route exists, note the Zod request schema and the response shape and skip to Step 3.
If missing: **stop this task and switch to the route-coding vertical slice** per `coding-route-vertical-slice` (add route → controller → service → schema → contract tests). The plan does not spec that route inline because it is out of the 25k-token budget and is its own vertical slice.

- [ ] **Step 2 (only if route was missing):** execute `coding-route-vertical-slice` for `POST /api/thalamus/cycles/run` and `GET /api/thalamus/cycles/:id/findings`, then continue.

- [ ] **Step 3: Replace CLI thalamus adapter with an HTTP client.**

```ts
// packages/cli/src/boot.ts (new block)
import { ThalamusHttpClient } from "./adapters/thalamus.http";
// …
thalamus: {
  runCycle: async ({ query, cycleId }) => {
    const client = new ThalamusHttpClient(ctx.apiBaseUrl, ctx.cliAuth);
    return client.runCycle({ query, traceId: cycleId });
  },
},
```

`ThalamusHttpClient` goes in `packages/cli/src/adapters/thalamus.http.ts` — thin fetch wrapper that hits the console-api route.

- [ ] **Step 4: Delete the now-unused `buildThalamusContainer` + `noopDomainConfig` default dependency from the CLI boot path** and remove the imports.

- [ ] **Step 5: Smoke test against a running console-api.**

```bash
pnpm --filter @interview/console-api dev &
sleep 5
pnpm ssa   # executes the CLI
# manual: run a cycle via the REPL and verify findings come back
```

- [ ] **Step 6: Commit.**

```bash
git commit -am "refactor(cli): route thalamus cycles through console-api HTTP (no more in-process noop shortcut)"
```

---

### Task 8.1: Dedup — llm-json-parser + stale sweep auth + daemon-dag

**Files:**

- Create: `packages/shared/src/utils/llm-json-parser.ts` (content copied from the identical sweep/thalamus pair).
- Delete: `packages/thalamus/src/utils/llm-json-parser.ts`.
- Delete: `packages/sweep/src/utils/llm-json-parser.ts`.
- Modify: every import of those files → `@interview/shared/utils/llm-json-parser`.
- Delete: `packages/sweep/src/middleware/auth.middleware.ts` (no consumers; verified via grep in Task 0).
- Delete: `packages/thalamus/src/config/daemon-dags.config.ts` (ensure no imports first — all consumers must read `DomainConfig.daemonDags`).
- Update: `packages/thalamus/src/index.ts` barrel drops the removed util re-export; swap for the shared one.

- [ ] **Step 1: Verify consumers before deletion.**

```bash
git grep -n "daemon-dags\.config\|DAEMON_DAGS" packages/thalamus/src
git grep -n "sweep/src/middleware/auth\|sweep/middleware/auth"
```

Expected: daemon-dags.config should only be referenced by `container.ts` default fallback (if the chain still uses it) and by the planner tests. Update those to inject via `DomainConfig` instead.

- [ ] **Step 2: Move llm-json-parser to shared.**

```bash
git mv packages/thalamus/src/utils/llm-json-parser.ts packages/shared/src/utils/llm-json-parser.ts
rm packages/sweep/src/utils/llm-json-parser.ts
```

- [ ] **Step 3: Export from shared.**
      Edit `packages/shared/src/index.ts` (or the nearest matching barrel) to add:

```ts
export * from "./utils/llm-json-parser";
```

- [ ] **Step 4: Rewrite imports.**

```bash
git grep -l "from \"\\.\\./utils/llm-json-parser\"" packages/thalamus/src packages/sweep/src \
  | xargs sed -i 's#\\.\\./utils/llm-json-parser#@interview/shared/utils/llm-json-parser#g'
```

(Adjust sed pattern — some callers use one level, some two. Inspect each edit.)

- [ ] **Step 5: Delete the stale sweep auth.**

```bash
git rm packages/sweep/src/middleware/auth.middleware.ts
```

- [ ] **Step 6: Delete daemon-dags duplicate.**

```bash
git rm packages/thalamus/src/config/daemon-dags.config.ts
```

Update the container + any test fixture that imported `DAEMON_DAGS` to read from `DomainConfig.daemonDags` (which the SSA app side ships via `SSA_DAEMON_DAGS`).

- [ ] **Step 7: Run.**

```bash
pnpm -r typecheck
pnpm test
pnpm dup:report
```

Expected: clone density drops further (llm-json-parser was ~218 lines duplicated).

- [ ] **Step 8: Commit.**

```bash
git commit -am "chore(repo): dedup llm-json-parser (→ shared); drop stale sweep/auth + thalamus daemon-dags duplicate"
```

---

### Task 8.2: Activate arch guard — forbid SSA tokens in `packages/thalamus/src`

**Files:**

- Modify: `.dependency-cruiser.js` (uncomment + tighten the staged rule from Task 2.1).

- [ ] **Step 1: Uncomment and strengthen the rule.**

```js
{
  name: "thalamus-kernel-no-ssa-vocabulary",
  severity: "error",
  comment:
    "packages/thalamus/src must not import or reference SSA-specific modules or file names. " +
    "If a capability genuinely needs SSA vocabulary, it belongs in apps/console-api/src/agent/ssa/thalamus-pack/.",
  from: { path: "^packages/thalamus/src/" },
  to: {
    path:
      "satellite-entity-patterns" +
      "|fetcher-celestrak|fetcher-launch-market|fetcher-spectra|fetcher-ntrs" +
      "|fetcher-arxiv|fetcher-seesat|fetcher-bus-archetype|fetcher-knowledge-graph" +
      "|fetcher-orbit-regime|fetcher-regulation|fetcher-rss|fetcher-space-weather" +
      "|opacity-scout|voyage-embedder",
  },
},
```

- [ ] **Step 2: Add a grep-based CI sanity check** (cheap guard against drift):

```bash
# scripts/arch-check-thalamus-agnostic.sh (new)
#!/usr/bin/env bash
set -euo pipefail
if git grep -l -E "satellite|operator_country|conjunction_analysis|fleet_analyst|NORAD|COSPAR" -- 'packages/thalamus/src/**/*.ts'; then
  echo "ERROR: SSA vocabulary found in packages/thalamus/src — see plan 2026-04-19-thalamus-agnosticity-cleanup.md"
  exit 1
fi
```

Wire into `package.json`:

```json
"arch:check:agnostic": "bash scripts/arch-check-thalamus-agnostic.sh"
```

Call it from the root `arch:check:repo`:

```json
"arch:check:repo": "pnpm exec depcruise --config .dependency-cruiser.js apps packages --output-type err-long && bash scripts/arch-check-thalamus-agnostic.sh"
```

- [ ] **Step 3: Run all guards.**

```bash
pnpm arch:check
pnpm arch:check:repo
pnpm arch:check:agnostic
pnpm dup:report
```

Expected: all green. If the grep script fires, revisit Task 5 or 3 — something wasn't fully evicted.

- [ ] **Step 4: Commit.**

```bash
git commit -am "chore(arch): enforce kernel SSA-vocab prohibition (depcruise + grep)"
```

---

### Task 8.3: Final verification + documentation

**Files:**

- Modify: `README.md` (short note: "packages/thalamus is domain-agnostic; SSA wiring lives in apps/console-api/src/agent/ssa/thalamus-pack/").
- Modify: `CHANGELOG.md` (new entry under current date).
- Modify: `DONE.md` (mark C4 from the 2026-04-19 audit).

- [ ] **Step 1: Full re-run.**

```bash
pnpm -r typecheck
pnpm test
pnpm arch:check
pnpm arch:check:repo
pnpm arch:check:agnostic
pnpm dup:report
```

- [ ] **Step 2: Compare to baseline.**

```bash
diff -u .reports/thalamus-agnostic-baseline/typecheck-before.txt <(pnpm -r typecheck 2>&1) || true
diff -u .reports/thalamus-agnostic-baseline/jscpd-before/jscpd-report.json .reports/jscpd/jscpd-report.json || true
```

Expected deltas: fewer duplications (llm-json-parser + daemon-dags gone); zero new depcruise errors; tests green.

- [ ] **Step 3: Smoke test the live stack.**
      Boot `console-api`, run one REPL cycle via the CLI (now HTTP), observe a findings response with non-zero count, observe logs show SSA-named cortices firing.

- [ ] **Step 4: Update docs.**

- [ ] **Step 5: Commit.**

```bash
git commit -am "docs: thalamus agnosticity pass complete — audit item C4 closed"
```

- [ ] **Step 6: Open PR.**

```bash
gh pr create --base main --title "Thalamus agnosticity cleanup (audit C4)" --body-file docs/superpowers/plans/2026-04-19-thalamus-agnosticity-cleanup.md
```

---

## 5. Risks & mitigations

| Risk                                                                                        | Likelihood                                   | Mitigation                                                                                                     |
| ------------------------------------------------------------------------------------------- | -------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Sweep consumers of `@interview/thalamus` break when public surface changes                  | Low — verified they use only generic symbols | Grep in Task 0; re-run after every phase                                                                       |
| Runtime regression because an SSA skill still imports a moved prompt via old path           | Medium                                       | Task 3 includes explicit grep pass + e2e run                                                                   |
| `DomainConfig.extractEntities` wiring silently returns zero entities → no follow-up queries | Medium — this path is easy to test weakly    | e2e requires non-zero entity counts; Task 3 Step 10                                                            |
| `busContext` rename misses an SSA consumer                                                  | Medium                                       | Task 6 Step 3 is the typecheck safety net; SSA skill code will fail to compile                                 |
| CLI HTTP route doesn't exist                                                                | High if not verified                         | Task 7 Step 1 checks first; if missing, pivot to route-vertical-slice                                          |
| DB col `bus_context` vs TS field `extensions` name drift confuses future readers            | Low but annoying                             | Transformer comment `// renamed on read; DB column is bus_context for historical reasons`                      |
| Merging with in-flight SSA work                                                             | Low — coordinate via branch freeze note      | Tell user before opening branch; rebase cost is acceptable                                                     |
| `depcruise` arch rule false positive on a file name that legitimately contains "orbit"      | Low                                          | The rule matches `fetcher-orbit-regime` only — safe. If a future doc/pdf file matches, add `pathNot` carve-out |

## 6. Rollback plan

Each phase is one git commit. Rollback = `git revert <commit>` in reverse phase order, with these caveats:

- Phase 5 (breaking public types) is the highest-risk revert: callers may already assume string keys. Revert requires bringing back enum imports.
- Phase 7 (CLI HTTP) is cheap to revert if the HTTP route pre-existed; risky if Task 7 Step 2 added a new route (reverting the CLI restores the in-process path which is functional only if Phase 5 is also reverted).

Preferred rollback granularity: **phase-pair reverts** (6+5, 3+2, etc.) to keep public types + move pairs consistent.

## 7. Self-review — spec coverage

Mapping every item in the user's draft plan to a task:

| Draft item                                                                                                                                      | Lands in                                                                                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| DomainConfig seams: plannerPrompt, fallbackPlan, verificationReasonCodes                                                                        | Task 1.1 (plannerPrompt + fallbackPlan). `verificationReasonCodes` replaced by a domain-agnostic reflexion prompt — documented in §0 "Corrections" |
| Remove DEFAULT_DAEMON_DAGS from package                                                                                                         | Task 8.1                                                                                                                                           |
| SSA planner prompt + fallback owner = `apps/console-api/src/agent/ssa/domain-config.ts`                                                         | Task 1.3                                                                                                                                           |
| `runCycle()` without explicit profile must not silently fall to SSA                                                                             | Tasks 1.2 + 5 + 7 (CLI cuts its shortcut)                                                                                                          |
| `EntityCatalogPort.resolveNames / cleanOrphans`                                                                                                 | Task 3.1 + 3.2                                                                                                                                     |
| `ResearchEdgeRepository` becomes generic                                                                                                        | Task 3.2 + 5.1                                                                                                                                     |
| `EntityNameResolver` moves out                                                                                                                  | Task 3.2                                                                                                                                           |
| Explorer pack to ssa/thalamus-pack                                                                                                              | Task 3.3                                                                                                                                           |
| `cortices/sources/*` to ssa/thalamus-pack                                                                                                       | Task 3.3                                                                                                                                           |
| `explorer/scout` + `explorer/crawler` to pack                                                                                                   | Task 3.3                                                                                                                                           |
| `satellite-entity-patterns` to pack                                                                                                             | Task 3.3                                                                                                                                           |
| `VoyageEmbedder` concrete to pack                                                                                                               | Task 4.1                                                                                                                                           |
| Embedder port injected                                                                                                                          | Task 4.1                                                                                                                                           |
| `ResearchCortex` / `ResearchEntityType` out of public surface                                                                                   | Task 5.1                                                                                                                                           |
| `ResearchFindingType` / `ResearchRelation` / `ResearchStatus` / `ResearchUrgency` / `ResearchCycleTrigger` / `ResearchCycleStatus` stay generic | §2 file-structure lock + Task 5.1 (no-change on those)                                                                                             |
| No DB migration                                                                                                                                 | §0 out-of-scope                                                                                                                                    |
| CLI via HTTP                                                                                                                                    | Task 7.1                                                                                                                                           |
| llm-json-parser dedup                                                                                                                           | Task 8.1                                                                                                                                           |
| Stale sweep auth dedup                                                                                                                          | Task 8.1                                                                                                                                           |
| Shadow front/api contract dedup                                                                                                                 | §0 out-of-scope (separate plan)                                                                                                                    |
| Daemon-dags dedup                                                                                                                               | Task 8.1                                                                                                                                           |
| Tests: typecheck, arch:check, arch:check:repo, dup:report                                                                                       | Task 8.3                                                                                                                                           |
| Arch guard: no SSA tokens in `packages/thalamus/src`                                                                                            | Task 8.2                                                                                                                                           |
| "Breaking changes package autorisés"                                                                                                            | Accepted in §1 + Task 5.1 header                                                                                                                   |

Coverage: complete. Corrections to the draft documented in §0.

Additions beyond the draft:

- `busContext` → `extensions` (Task 6.1) — missing from draft.
- `opacity-scout.prompt.ts` explicit move (Task 3.3) — missing from draft.
- `StrategistStrategy` name-based match via `DomainConfig.synthesisCortexName` (Task 5.1) — missing from draft.
- `cycle-loop.service.ts` verification heuristic decoupling (Task 5.1) — missing from draft.
- Baseline capture + diff (Tasks 0.1, 8.3) — missing from draft.
- Grep-based arch sanity check (Task 8.2) — missing from draft.
- Phase-pair rollback strategy (§6) — missing from draft.
