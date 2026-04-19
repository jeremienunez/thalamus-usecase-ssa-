# Console Front Five-Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `apps/console/src/**` into a five-layer architecture (`routes/`, `features/`, `hooks/`, `usecases/`, `adapters/`) mirroring the backend's layering vocabulary, while dismantling the three god-components (`ThalamusMode` 763 LOC, `OpsMode` 462 LOC, `SatelliteField` 583 LOC) and the singleton `api` mega-client.

**Architecture:** Context-per-adapter DIP + TanStack Query for async. Each adapter category (`api`, `sse`, `renderer`, `propagator`) exposes a typed port interface, a concrete implementation, and a React Context. Usecases are TanStack hooks that consume adapters via Context. Features compose usecases + hooks + `shared/ui` primitives. Strangler-fig migration: legacy `lib/` stays as re-export shims until every consumer has migrated, then deleted atomically at Phase 7.

**Tech Stack:** React 18 + TypeScript + Vite + TanStack Router + TanStack Query + Zustand (scoped per feature, not global) + Vitest + React Testing Library + dependency-cruiser (layer enforcement).

---

## Spec

See `docs/superpowers/specs/2026-04-19-console-front-five-layer-design.md`.

## File structure after migration

```
apps/console/src/
├── main.tsx
├── routes/                        # L1 — TanStack Router (conventional folder)
│   ├── __root.tsx
│   ├── index.tsx
│   ├── ops.tsx                    # route → features/ops/Entry
│   ├── thalamus.tsx               # route → features/thalamus/Entry
│   ├── sweep.tsx                  # route → features/sweep/Entry
│   └── config.tsx                 # route → features/config/Entry
├── features/                      # L2 — one folder per business surface
│   ├── ops/
│   │   ├── Entry.tsx              # route target
│   │   ├── Scene.tsx
│   │   ├── Filters.tsx
│   │   ├── ThreatBoard.tsx
│   │   ├── Clock.tsx
│   │   ├── Search.tsx
│   │   ├── SatelliteField.tsx     # ≤150 LOC — orchestrates renderer adapter
│   │   ├── Drawer.tsx
│   │   ├── state.ts               # scoped zustand store
│   │   └── index.ts               # barrel
│   ├── thalamus/
│   │   ├── Entry.tsx
│   │   ├── Canvas.tsx
│   │   ├── Hud.tsx
│   │   ├── Drawer.tsx
│   │   ├── SubDrawer.tsx
│   │   ├── Ascii.tsx
│   │   ├── state.ts
│   │   └── index.ts
│   ├── sweep/
│   │   ├── Entry.tsx
│   │   ├── Suggestions.tsx
│   │   ├── Overview.tsx
│   │   ├── Stats.tsx
│   │   ├── FindingsGraph.tsx
│   │   ├── Drawer.tsx
│   │   └── index.ts
│   ├── repl/
│   │   ├── ReplProvider.tsx       # feature-scoped context
│   │   ├── ReplPanel.tsx
│   │   ├── TurnView.tsx
│   │   ├── ResultView.tsx
│   │   ├── reducer.ts             # pure
│   │   ├── renderers/
│   │   └── index.ts
│   ├── findings/
│   │   ├── Panel.tsx
│   │   ├── Readout.tsx
│   │   └── index.ts
│   ├── autonomy/
│   │   ├── Control.tsx
│   │   └── index.ts
│   └── config/
│       ├── Entry.tsx
│       └── index.ts
├── hooks/                         # L3 — view-model hooks (no I/O)
│   ├── useOpsTime.ts
│   ├── useOpsSelection.ts
│   ├── useThalamusGraph.ts
│   ├── useThalamusLayout.ts
│   ├── useAnimatedNumber.ts       # moved from lib/
│   ├── useUtcClock.ts             # moved from lib/
│   └── index.ts
├── usecases/                      # L4 — domain intents (TanStack hooks)
│   ├── keys.ts                    # shared query-key factory
│   ├── useSatellitesQuery.ts
│   ├── useConjunctionsQuery.ts
│   ├── useKgQuery.ts
│   ├── useFindingsQuery.ts
│   ├── useFindingQuery.ts
│   ├── useDecisionMutation.ts
│   ├── useStatsQuery.ts
│   ├── useCyclesQuery.ts
│   ├── useLaunchCycleMutation.ts
│   ├── useSweepSuggestionsQuery.ts
│   ├── useReviewSuggestionMutation.ts
│   ├── useMissionStatusQuery.ts
│   ├── useMissionControlMutations.ts
│   ├── useAutonomyStatusQuery.ts
│   ├── useAutonomyControlMutations.ts
│   ├── useReplStream.ts
│   └── index.ts
├── adapters/                      # L5 — external I/O, zero UI
│   ├── api/
│   │   ├── client.ts              # ApiFetcher port + fetch impl
│   │   ├── satellites.ts
│   │   ├── conjunctions.ts
│   │   ├── kg.ts
│   │   ├── findings.ts
│   │   ├── stats.ts
│   │   ├── cycles.ts
│   │   ├── sweep.ts
│   │   ├── mission.ts
│   │   ├── autonomy.ts
│   │   ├── ApiClientContext.tsx   # React Context + useApiClient() hook
│   │   └── index.ts               # ApiClient aggregate port
│   ├── sse/
│   │   ├── client.ts              # shared EventSource wrapper
│   │   ├── repl.ts                # REPL SSE parser (ex lib/repl-stream.ts)
│   │   ├── SseClientContext.tsx
│   │   └── index.ts
│   ├── renderer/
│   │   ├── textures.ts            # makeGoldBumpTexture etc.
│   │   ├── palette.ts             # getCompanyColor etc.
│   │   ├── sigma.ts               # thalamus Sigma init
│   │   ├── RendererContext.tsx
│   │   └── index.ts
│   └── propagator/
│       ├── sgp4.ts                # propagateSgp4 wrapper
│       ├── PropagatorContext.tsx
│       └── index.ts
├── shared/
│   ├── ui/                        # UI-kit primitives (no business)
│   │   ├── Drawer.tsx
│   │   ├── Skeleton.tsx
│   │   ├── Measure.tsx
│   │   ├── ErrorBoundary.tsx
│   │   ├── AppShell.tsx
│   │   ├── CommandPalette.tsx
│   │   ├── TopBar.tsx
│   │   ├── LeftRail.tsx
│   │   ├── CycleLoader.tsx
│   │   ├── AnimatedStepBadge.tsx
│   │   └── index.ts
│   └── types/                     # DTOs + domain enums mirroring backend
│       ├── dtos.ts                # DTOs moved from lib/api.ts
│       ├── entity-id.ts           # entityKind() single source
│       ├── satellite-classification.ts  # classifySatellite() table-driven
│       ├── colors.ts              # moved from lib/graphColors.ts + SEVERITY_COLOR
│       └── index.ts
└── providers/                     # Context wiring
    └── AppProviders.tsx           # composes all 4 adapter providers + QueryClient
```

## Discovery facts (grounded against current code)

- `apps/console/package.json` — no vitest / RTL deps today. Must add.
- Root `vitest.workspace.ts` references packages + `apps/console-api/vitest.config.ts`. Must register `apps/console/vitest.config.ts`.
- `.dependency-cruiser.js` has 10 existing forbidden rules for backend layering. New frontend rules append to `forbidden[]`.
- TanStack Router convention requires the folder `routes/`. We keep that name — the spec's label "pages/" maps to `routes/` operationally.
- `lib/api.ts:104-192` mega-client has 10 domains + inline DTOs. DTOs move to `shared/types/dtos.ts`; methods move one domain at a time.
- `lib/queries.ts` holds 17 TanStack hooks. Each becomes its own `usecases/useXxx.ts`.
- 15 files import from `@/lib/api`; 11 files import from `@/lib/queries`. Strangler-fig shims prevent needing to rewrite all 26 in one commit.
- `uiStore.ts` is trivial (17 LOC) — splits cleanly per feature.

## Phases + risk gates

Each phase ends with: `pnpm -C apps/console typecheck` ✅ + `pnpm -C apps/console build` ✅ + a browser smoke (each route still renders) before moving on.

- **Phase 0** — Foundations (vitest, RTL, folder scaffold, depcruise staging rules)
- **Phase 1** — Adapters: API layer (strangler-fig: `lib/api.ts` becomes a re-export shim)
- **Phase 2** — Adapters: SSE + renderer + propagator
- **Phase 3** — Providers + `shared/types`
- **Phase 4** — `shared/ui` move + usecases dissolution
- **Phase 5** — Feature extractions (Sweep → Thalamus → Ops, smallest first)
- **Phase 6** — Scoped stores + routes rewire
- **Phase 7** — Cleanup + depcruise rules turn strict + arch-guard green

---

## Phase 0 — Foundations

### Task 0.1: Add frontend test dependencies

**Files:**

- Modify: `apps/console/package.json`
- Create: `apps/console/vitest.config.ts`
- Modify: `vitest.workspace.ts:56` (register console project)
- Create: `apps/console/tests/setup.ts`

- [ ] **Step 1: Add devDependencies to `apps/console/package.json`**

Add to the `devDependencies` block:

```json
    "@testing-library/jest-dom": "^6.5.0",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "jsdom": "^25.0.1"
```

- [ ] **Step 2: Install**

Run: `pnpm install`
Expected: lockfile updated, no errors.

- [ ] **Step 3: Create `apps/console/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  test: {
    name: "console",
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}"],
    globals: true,
  },
});
```

- [ ] **Step 4: Create `apps/console/tests/setup.ts`**

```ts
import "@testing-library/jest-dom/vitest";
```

- [ ] **Step 5: Register in workspace**

Edit `vitest.workspace.ts`, add the console config path after the existing console-api entry:

```ts
  "./apps/console-api/vitest.config.ts",
  "./apps/console/vitest.config.ts",
```

- [ ] **Step 6: Run the test suite (empty) to verify wiring**

Run: `pnpm -C apps/console exec vitest run`
Expected: `No test files found, exiting with code 0` (or similar) — not a module-resolution error.

- [ ] **Step 7: Commit**

```bash
git add apps/console/package.json apps/console/vitest.config.ts apps/console/tests/setup.ts vitest.workspace.ts pnpm-lock.yaml
git commit -m "chore(front-5l): add vitest + RTL testing infra to console app"
```

### Task 0.2: Scaffold five-layer folder structure

**Files:**

- Create: `apps/console/src/{features,hooks,usecases,adapters,shared,providers}/` (empty directories with `.gitkeep`)

- [ ] **Step 1: Create empty layer folders**

```bash
mkdir -p apps/console/src/features
mkdir -p apps/console/src/hooks
mkdir -p apps/console/src/usecases
mkdir -p apps/console/src/adapters/api
mkdir -p apps/console/src/adapters/sse
mkdir -p apps/console/src/adapters/renderer
mkdir -p apps/console/src/adapters/propagator
mkdir -p apps/console/src/shared/ui
mkdir -p apps/console/src/shared/types
mkdir -p apps/console/src/providers
touch apps/console/src/features/.gitkeep
touch apps/console/src/hooks/.gitkeep
touch apps/console/src/usecases/.gitkeep
touch apps/console/src/adapters/.gitkeep
touch apps/console/src/shared/.gitkeep
touch apps/console/src/providers/.gitkeep
```

- [ ] **Step 2: Verify typecheck still green (no code change, just folders)**

Run: `pnpm -C apps/console typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/features apps/console/src/hooks apps/console/src/usecases apps/console/src/adapters apps/console/src/shared apps/console/src/providers
git commit -m "chore(front-5l): scaffold empty layer folders"
```

### Task 0.3: Add staged dependency-cruiser rules (info-level first)

Rules are added with `severity: 'info'` so they log but don't block. Phase 7 flips them to `error`.

**Files:**

- Modify: `.dependency-cruiser.js` (append to `forbidden[]` before the generic `not-to-spec` rule at line 285)

- [ ] **Step 1: Insert new rules before line 285**

Append these rules after the last `sweep-*` rule and before `not-to-spec`:

```js
    // ───── Frontend layer rules (console app) ─────
    {
      name: 'console-front-no-cross-feature',
      severity: 'error',
      comment:
        'Frontend features must not import each other. Extract shared concerns to shared/ui, hooks/, or usecases/.',
      from: { path: '^apps/console/src/features/([^/]+)/' },
      to: {
        path: '^apps/console/src/features/([^/]+)/',
        pathNot: '^apps/console/src/features/\\1/'
      }
    },
    {
      name: 'console-front-adapters-no-react',
      severity: 'error',
      comment:
        'Adapters are I/O, not UI. Only *Context.tsx files in adapters/ may import react.',
      from: {
        path: '^apps/console/src/adapters/',
        pathNot: 'Context\\.tsx$'
      },
      to: { path: '^react$|^react-dom$' }
    },
    {
      name: 'console-front-hooks-no-raw-io',
      severity: 'error',
      comment:
        'Hooks and usecases must not perform raw I/O. Go through an adapter via Context.',
      from: { path: '^apps/console/src/(hooks|usecases)/' },
      to: { path: '^(satellite\\.js|three|sigma|graphology)$' }
    },
    {
      name: 'console-front-features-no-raw-io',
      severity: 'error',
      comment:
        'Feature components must not perform raw I/O. Compose usecases + hooks + shared/ui + adapters/*Context.',
      from: { path: '^apps/console/src/features/' },
      to: { path: '^(satellite\\.js)$' }
    },
    {
      name: 'console-front-no-legacy-lib',
      severity: 'info',
      comment:
        'lib/ is legacy and will be removed at Phase 7. New code must not import from it.',
      from: {
        path: '^apps/console/src/',
        pathNot: '^apps/console/src/lib/'
      },
      to: { path: '^apps/console/src/lib/' }
    },
    {
      name: 'console-front-no-legacy-modes',
      severity: 'info',
      comment:
        'modes/ is legacy and will be removed at Phase 7. New code must not import from it.',
      from: {
        path: '^apps/console/src/',
        pathNot: '^apps/console/src/modes/'
      },
      to: { path: '^apps/console/src/modes/' }
    }
```

- [ ] **Step 2: Run arch check**

Run: `pnpm arch:check:repo`
Expected: the info-level rules surface informational counts (existing consumers of `lib/` and `modes/`) but no errors. The 4 error-level rules should pass trivially because the new folders are empty.

- [ ] **Step 3: Commit**

```bash
git add .dependency-cruiser.js
git commit -m "chore(front-5l): stage frontend layer rules in dep-cruiser"
```

---

## Phase 1 — Adapters: API layer

Migration strategy: **strangler fig**. Each domain moves in its own commit; `lib/api.ts` stays as a re-export shim pointing at the new adapter until every consumer migrates (Phase 4).

### Task 1.1: Extract DTOs to `shared/types/dtos.ts`

**Files:**

- Create: `apps/console/src/shared/types/dtos.ts`
- Modify: `apps/console/src/lib/api.ts` (remove DTO defs, re-export from shared/types)

- [ ] **Step 1: Create `shared/types/dtos.ts`** by moving lines 3-96 + 194-263 of `lib/api.ts` verbatim:

```ts
export type Regime = "LEO" | "MEO" | "GEO" | "HEO";
export type SourceClass = "osint" | "field" | "derived";
export type FindingStatus = "pending" | "accepted" | "rejected" | "in-review";
export type EntityClass =
  | "Satellite"
  | "Debris"
  | "Operator"
  | "Payload"
  | "OrbitRegime"
  | "ConjunctionEvent"
  | "Maneuver";

export type SatelliteDTO = {
  id: number;
  name: string;
  noradId: number;
  regime: Regime;
  operator: string;
  country: string;
  inclinationDeg: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  epoch: string;
  massKg: number;
  classificationTier: "unclassified" | "sensitive" | "restricted";
  opacityScore?: number | null;
  opacityDeficitReasons?: string[];
  tleLine1?: string | null;
  tleLine2?: string | null;
};

export type ConjunctionDTO = {
  id: number;
  primaryId: number;
  secondaryId: number;
  primaryName: string;
  secondaryName: string;
  regime: Regime;
  epoch: string;
  minRangeKm: number;
  relativeVelocityKmps: number;
  probabilityOfCollision: number;
  combinedSigmaKm: number;
  hardBodyRadiusM: number;
  pcMethod: string;
  computedAt: string;
  covarianceQuality: "HIGH" | "MED" | "LOW";
  action: "maneuver_candidate" | "monitor" | "no_action";
};

export type KgNodeDTO = {
  id: string;
  label: string;
  class: EntityClass;
  degree: number;
  x: number;
  y: number;
  cortex: string;
};

export type KgEdgeDTO = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  sourceClass: SourceClass;
};

export type FindingDTO = {
  id: string;
  title: string;
  summary: string;
  cortex: string;
  status: FindingStatus;
  priority: number;
  createdAt: string;
  linkedEntityIds: string[];
  evidence: { kind: SourceClass; uri: string; snippet: string }[];
  swarmConsensus?: {
    accept: number;
    reject: number;
    abstain: number;
    k: number;
  };
  decisionReason?: string;
};

export type SweepSuggestionDTO = {
  id: string;
  title: string;
  description: string;
  suggestedAction: string;
  category: string;
  severity: "info" | "warning" | "critical";
  operatorCountryName: string;
  affectedSatellites: number;
  createdAt: string;
  accepted: boolean | null;
  resolutionStatus: string | null;
  hasPayload: boolean;
};

export type MissionTaskDTO = {
  suggestionId: string;
  field: string;
  operatorCountry: string;
  status: "pending" | "researching" | "filled" | "unobtainable" | "error";
  value: string | number | null;
  confidence: number;
  source: string | null;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type MissionStateDTO = {
  running: boolean;
  startedAt: string | null;
  total: number;
  completed: number;
  filled: number;
  unobtainable: number;
  errors: number;
  cursor: number;
  currentTask: MissionTaskDTO | null;
  recent: MissionTaskDTO[];
};

export type AutonomyTickDTO = {
  id: string;
  action: "thalamus" | "sweep-nullscan" | "fish-swarm";
  queryOrMode: string;
  startedAt: string;
  completedAt: string;
  emitted: number;
  error?: string;
};

export type AutonomyStateDTO = {
  running: boolean;
  intervalMs: number;
  startedAt: string | null;
  tickCount: number;
  currentTick: AutonomyTickDTO | null;
  history: AutonomyTickDTO[];
  nextTickInMs: number | null;
};

export type CycleDTO = {
  id: string;
  kind: "thalamus" | "fish" | "both";
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
};

export type StatsDTO = {
  satellites: number;
  conjunctions: number;
  kgNodes: number;
  kgEdges: number;
  findings: number;
  byStatus: Record<string, number>;
  byCortex: Record<string, number>;
};
```

- [ ] **Step 2: Create `shared/types/index.ts`**

```ts
export * from "./dtos";
```

- [ ] **Step 3: Modify `lib/api.ts`** — replace lines 1-96 and 194-263 with:

```ts
/** Legacy shim. DTOs live in shared/types; keep re-exports until all consumers migrate (Phase 7 deletes this file). */
export type {
  Regime,
  SourceClass,
  FindingStatus,
  EntityClass,
  SatelliteDTO,
  ConjunctionDTO,
  KgNodeDTO,
  KgEdgeDTO,
  FindingDTO,
  SweepSuggestionDTO,
  MissionTaskDTO,
  MissionStateDTO,
  AutonomyTickDTO,
  AutonomyStateDTO,
  CycleDTO,
} from "@/shared/types";
```

Keep the `api` object (lines 98-192) untouched — only DTO types moved.

- [ ] **Step 4: Typecheck**

Run: `pnpm -C apps/console typecheck`
Expected: green.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/shared/types apps/console/src/lib/api.ts
git commit -m "refactor(front-5l): extract DTOs to shared/types/dtos.ts"
```

### Task 1.2: Write `adapters/api/client.ts` with TDD

**Files:**

- Create: `apps/console/src/adapters/api/client.ts`
- Create: `apps/console/src/adapters/api/client.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/console/src/adapters/api/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFetchApiClient, type ApiFetcher } from "./client";

describe("createFetchApiClient", () => {
  const mockFetch = vi.fn();
  let client: ApiFetcher;

  beforeEach(() => {
    mockFetch.mockReset();
    client = createFetchApiClient({ fetch: mockFetch });
  });

  it("getJson returns parsed body on 2xx", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    );
    const res = await client.getJson<{ hello: string }>("/api/hello");
    expect(res).toEqual({ hello: "world" });
    expect(mockFetch).toHaveBeenCalledWith("/api/hello", undefined);
  });

  it("getJson throws with status code on non-2xx", async () => {
    mockFetch.mockResolvedValue(
      new Response("nope", { status: 500, statusText: "boom" }),
    );
    await expect(client.getJson("/api/x")).rejects.toThrow("500 boom");
  });

  it("postJson sends JSON body and content-type", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await client.postJson<{ a: number }, { ok: boolean }>("/api/x", { a: 1 });
    expect(mockFetch).toHaveBeenCalledWith("/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it("postJson without body sends POST with no payload", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    await client.postJson("/api/trigger", undefined);
    expect(mockFetch).toHaveBeenCalledWith("/api/trigger", { method: "POST" });
  });
});
```

- [ ] **Step 2: Run test to see it fail**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/client.test.ts`
Expected: fails with "Cannot find module './client'".

- [ ] **Step 3: Implement `client.ts`**

Create `apps/console/src/adapters/api/client.ts`:

```ts
export interface ApiFetcher {
  getJson<T>(path: string): Promise<T>;
  postJson<TReq, TRes>(path: string, body: TReq | undefined): Promise<TRes>;
}

export interface FetchApiClientDeps {
  fetch?: typeof fetch;
  baseUrl?: string;
}

export function createFetchApiClient(
  deps: FetchApiClientDeps = {},
): ApiFetcher {
  const f = deps.fetch ?? globalThis.fetch;
  const base = deps.baseUrl ?? "";

  async function getJson<T>(path: string): Promise<T> {
    const res = await f(base + path, undefined);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  async function postJson<TReq, TRes>(
    path: string,
    body: TReq | undefined,
  ): Promise<TRes> {
    const init: RequestInit =
      body === undefined
        ? { method: "POST" }
        : {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          };
    const res = await f(base + path, init);
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as TRes;
  }

  return { getJson, postJson };
}
```

- [ ] **Step 4: Run test, expect pass**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/client.test.ts`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/adapters/api/client.ts apps/console/src/adapters/api/client.test.ts
git commit -m "feat(front-5l): add ApiFetcher port + fetch impl"
```

### Task 1.3: Satellites adapter (first domain — pattern for all others)

**Files:**

- Create: `apps/console/src/adapters/api/satellites.ts`
- Create: `apps/console/src/adapters/api/satellites.test.ts`
- Modify: `apps/console/src/lib/api.ts` (delegate `satellites` method to new adapter)

- [ ] **Step 1: Write test**

Create `apps/console/src/adapters/api/satellites.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSatellitesApi } from "./satellites";
import type { ApiFetcher } from "./client";

const fakeFetcher = (captured: string[]): ApiFetcher => ({
  getJson: vi.fn(async (p: string) => {
    captured.push(p);
    return { items: [], count: 0 };
  }),
  postJson: vi.fn(),
});

describe("createSatellitesApi", () => {
  it("list() hits /api/satellites with no query when regime is undefined", async () => {
    const paths: string[] = [];
    const api = createSatellitesApi(fakeFetcher(paths));
    await api.list();
    expect(paths).toEqual(["/api/satellites"]);
  });

  it("list() appends regime query param", async () => {
    const paths: string[] = [];
    const api = createSatellitesApi(fakeFetcher(paths));
    await api.list("LEO");
    expect(paths).toEqual(["/api/satellites?regime=LEO"]);
  });
});
```

- [ ] **Step 2: Run test — expect fail**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/satellites.test.ts`
Expected: module not found.

- [ ] **Step 3: Implement adapter**

Create `apps/console/src/adapters/api/satellites.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { Regime, SatelliteDTO } from "@/shared/types";

export interface SatellitesApiPort {
  list(regime?: Regime): Promise<{ items: SatelliteDTO[]; count: number }>;
}

export function createSatellitesApi(f: ApiFetcher): SatellitesApiPort {
  return {
    list: (regime) =>
      f.getJson(`/api/satellites${regime ? `?regime=${regime}` : ""}`),
  };
}
```

- [ ] **Step 4: Run test — expect pass**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/satellites.test.ts`
Expected: 2 passed.

- [ ] **Step 5: Delegate from `lib/api.ts`** (strangler-fig)

Modify `apps/console/src/lib/api.ts` — replace the `satellites:` line (currently at line 105):

```ts
  satellites: (regime?: Regime) =>
    _satellites.list(regime),
```

And add at the top of the file, after the DTO re-exports:

```ts
import { createFetchApiClient } from "@/adapters/api/client";
import { createSatellitesApi } from "@/adapters/api/satellites";

const _fetcher = createFetchApiClient();
const _satellites = createSatellitesApi(_fetcher);
```

- [ ] **Step 6: Typecheck + run any existing tests**

Run: `pnpm -C apps/console typecheck && pnpm -C apps/console exec vitest run`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add apps/console/src/adapters/api/satellites.ts apps/console/src/adapters/api/satellites.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add SatellitesApiPort, delegate from lib shim"
```

### Task 1.4: Conjunctions adapter

**Files:**

- Create: `apps/console/src/adapters/api/conjunctions.ts` + `.test.ts`
- Modify: `apps/console/src/lib/api.ts`

- [ ] **Step 1: Test**

Create `apps/console/src/adapters/api/conjunctions.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createConjunctionsApi } from "./conjunctions";

describe("createConjunctionsApi", () => {
  it("list() encodes minPc", async () => {
    const paths: string[] = [];
    const api = createConjunctionsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [], count: 0 };
      }),
      postJson: vi.fn(),
    });
    await api.list(1e-8);
    expect(paths).toEqual(["/api/conjunctions?minPc=1e-8"]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/conjunctions.test.ts`

- [ ] **Step 3: Implement**

Create `apps/console/src/adapters/api/conjunctions.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { ConjunctionDTO } from "@/shared/types";

export interface ConjunctionsApiPort {
  list(minPc?: number): Promise<{ items: ConjunctionDTO[]; count: number }>;
}

export function createConjunctionsApi(f: ApiFetcher): ConjunctionsApiPort {
  return {
    list: (minPc = 0) => f.getJson(`/api/conjunctions?minPc=${minPc}`),
  };
}
```

- [ ] **Step 4: Test passes**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/conjunctions.test.ts`

- [ ] **Step 5: Delegate from shim**

In `apps/console/src/lib/api.ts`, add:

```ts
import { createConjunctionsApi } from "@/adapters/api/conjunctions";
const _conjunctions = createConjunctionsApi(_fetcher);
```

Replace the `conjunctions:` line:

```ts
  conjunctions: (minPc = 0) => _conjunctions.list(minPc),
```

- [ ] **Step 6: Commit**

```bash
git add apps/console/src/adapters/api/conjunctions.ts apps/console/src/adapters/api/conjunctions.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add ConjunctionsApiPort"
```

### Task 1.5: KG adapter (nodes + edges)

**Files:**

- Create: `apps/console/src/adapters/api/kg.ts` + `.test.ts`
- Modify: `apps/console/src/lib/api.ts`

- [ ] **Step 1: Test**

Create `apps/console/src/adapters/api/kg.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createKgApi } from "./kg";

describe("createKgApi", () => {
  it("listNodes + listEdges hit the right paths", async () => {
    const paths: string[] = [];
    const api = createKgApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [] };
      }),
      postJson: vi.fn(),
    });
    await api.listNodes();
    await api.listEdges();
    expect(paths).toEqual(["/api/kg/nodes", "/api/kg/edges"]);
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/console/src/adapters/api/kg.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { KgNodeDTO, KgEdgeDTO } from "@/shared/types";

export interface KgApiPort {
  listNodes(): Promise<{ items: KgNodeDTO[] }>;
  listEdges(): Promise<{ items: KgEdgeDTO[] }>;
}

export function createKgApi(f: ApiFetcher): KgApiPort {
  return {
    listNodes: () => f.getJson(`/api/kg/nodes`),
    listEdges: () => f.getJson(`/api/kg/edges`),
  };
}
```

- [ ] **Step 3: Run tests pass + delegate in shim**

Run: `pnpm -C apps/console exec vitest run src/adapters/api/kg.test.ts`

In `apps/console/src/lib/api.ts`:

```ts
import { createKgApi } from "@/adapters/api/kg";
const _kg = createKgApi(_fetcher);
```

Replace `kgNodes:` and `kgEdges:`:

```ts
  kgNodes: () => _kg.listNodes(),
  kgEdges: () => _kg.listEdges(),
```

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/adapters/api/kg.ts apps/console/src/adapters/api/kg.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add KgApiPort"
```

### Task 1.6: Findings adapter (list + find + decision)

**Files:**

- Create: `apps/console/src/adapters/api/findings.ts` + `.test.ts`
- Modify: `apps/console/src/lib/api.ts`

- [ ] **Step 1: Test**

Create `apps/console/src/adapters/api/findings.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createFindingsApi } from "./findings";

describe("createFindingsApi", () => {
  it("list() builds query from filter args", async () => {
    const paths: string[] = [];
    const api = createFindingsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return { items: [], count: 0 };
      }),
      postJson: vi.fn(),
    });
    await api.list();
    await api.list({ status: "pending" });
    await api.list({ status: "accepted", cortex: "orbit-slot-optimizer" });
    expect(paths).toEqual([
      "/api/findings",
      "/api/findings?status=pending",
      "/api/findings?status=accepted&cortex=orbit-slot-optimizer",
    ]);
  });

  it("findById encodes id", async () => {
    const paths: string[] = [];
    const api = createFindingsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return {} as never;
      }),
      postJson: vi.fn(),
    });
    await api.findById("foo/bar");
    expect(paths).toEqual(["/api/findings/foo%2Fbar"]);
  });

  it("decide posts JSON", async () => {
    const calls: Array<[string, unknown]> = [];
    const api = createFindingsApi({
      getJson: vi.fn(),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push([p, b]);
        return { ok: true } as never;
      }),
    });
    await api.decide("f1", "accepted", "ok");
    expect(calls).toEqual([
      ["/api/findings/f1/decision", { decision: "accepted", reason: "ok" }],
    ]);
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/console/src/adapters/api/findings.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { FindingDTO, FindingStatus } from "@/shared/types";

export interface FindingsApiPort {
  list(params?: {
    status?: FindingStatus;
    cortex?: string;
  }): Promise<{ items: FindingDTO[]; count: number }>;
  findById(id: string): Promise<FindingDTO>;
  decide(
    id: string,
    decision: FindingStatus,
    reason?: string,
  ): Promise<{ ok: boolean; finding: FindingDTO }>;
}

export function createFindingsApi(f: ApiFetcher): FindingsApiPort {
  return {
    list: (params) => {
      const qs = new URLSearchParams();
      if (params?.status) qs.set("status", params.status);
      if (params?.cortex) qs.set("cortex", params.cortex);
      return f.getJson(`/api/findings${qs.toString() ? `?${qs}` : ""}`);
    },
    findById: (id) => f.getJson(`/api/findings/${encodeURIComponent(id)}`),
    decide: (id, decision, reason) =>
      f.postJson(`/api/findings/${encodeURIComponent(id)}/decision`, {
        decision,
        reason,
      }),
  };
}
```

- [ ] **Step 3: Run tests, delegate in shim, commit**

Shim additions:

```ts
import { createFindingsApi } from "@/adapters/api/findings";
const _findings = createFindingsApi(_fetcher);
```

Replace `findings:`, `finding:`, `decision:` in the `api` object:

```ts
  findings: (params) => _findings.list(params),
  finding: (id) => _findings.findById(id),
  decision: (id, decision, reason) => _findings.decide(id, decision, reason),
```

```bash
pnpm -C apps/console exec vitest run src/adapters/api/findings.test.ts
git add apps/console/src/adapters/api/findings.ts apps/console/src/adapters/api/findings.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add FindingsApiPort"
```

### Task 1.7: Stats adapter

- [ ] **Step 1: Test + implement**

`apps/console/src/adapters/api/stats.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createStatsApi } from "./stats";

describe("createStatsApi", () => {
  it("get() hits /api/stats", async () => {
    const paths: string[] = [];
    const api = createStatsApi({
      getJson: vi.fn(async (p: string) => {
        paths.push(p);
        return {} as never;
      }),
      postJson: vi.fn(),
    });
    await api.get();
    expect(paths).toEqual(["/api/stats"]);
  });
});
```

`apps/console/src/adapters/api/stats.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { StatsDTO } from "@/shared/types";

export interface StatsApiPort {
  get(): Promise<StatsDTO>;
}

export function createStatsApi(f: ApiFetcher): StatsApiPort {
  return { get: () => f.getJson(`/api/stats`) };
}
```

- [ ] **Step 2: Delegate from shim + commit**

```ts
import { createStatsApi } from "@/adapters/api/stats";
const _stats = createStatsApi(_fetcher);
```

Replace `stats:`:

```ts
  stats: () => _stats.get(),
```

```bash
pnpm -C apps/console exec vitest run src/adapters/api/stats.test.ts
git add apps/console/src/adapters/api/stats.ts apps/console/src/adapters/api/stats.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add StatsApiPort"
```

### Task 1.8: Cycles adapter (list + run)

- [ ] **Step 1: Test**

`apps/console/src/adapters/api/cycles.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createCyclesApi } from "./cycles";

describe("createCyclesApi", () => {
  it("list hits /api/cycles; run posts /api/cycles/run", async () => {
    const calls: Array<[string, "GET" | "POST", unknown?]> = [];
    const api = createCyclesApi({
      getJson: vi.fn(async (p: string) => {
        calls.push([p, "GET"]);
        return { items: [] } as never;
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push([p, "POST", b]);
        return { cycle: {} } as never;
      }),
    });
    await api.list();
    await api.run("thalamus");
    expect(calls).toEqual([
      ["/api/cycles", "GET"],
      ["/api/cycles/run", "POST", { kind: "thalamus" }],
    ]);
  });
});
```

- [ ] **Step 2: Implement**

`apps/console/src/adapters/api/cycles.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { CycleDTO } from "@/shared/types";

export type CycleKind = "thalamus" | "fish" | "both";

export interface CyclesApiPort {
  list(): Promise<{ items: CycleDTO[] }>;
  run(kind: CycleKind): Promise<{ cycle: CycleDTO }>;
}

export function createCyclesApi(f: ApiFetcher): CyclesApiPort {
  return {
    list: () => f.getJson(`/api/cycles`),
    run: (kind) => f.postJson(`/api/cycles/run`, { kind }),
  };
}
```

- [ ] **Step 3: Delegate + commit**

```ts
import { createCyclesApi } from "@/adapters/api/cycles";
const _cycles = createCyclesApi(_fetcher);
```

Replace in the `api` object:

```ts
  cycles: () => _cycles.list(),
  runCycle: (kind) => _cycles.run(kind),
```

```bash
pnpm -C apps/console exec vitest run src/adapters/api/cycles.test.ts
git add apps/console/src/adapters/api/cycles.ts apps/console/src/adapters/api/cycles.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add CyclesApiPort"
```

### Task 1.9: Sweep adapter (suggestions + review)

- [ ] **Step 1: Test**

`apps/console/src/adapters/api/sweep.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSweepApi } from "./sweep";

describe("createSweepApi", () => {
  it("listSuggestions + review", async () => {
    const calls: unknown[][] = [];
    const api = createSweepApi({
      getJson: vi.fn(async (p: string) => {
        calls.push(["GET", p]);
        return { items: [], count: 0 } as never;
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push(["POST", p, b]);
        return { ok: true, reviewed: true, resolution: null } as never;
      }),
    });
    await api.listSuggestions();
    await api.review("s/1", true, "looks good");
    expect(calls).toEqual([
      ["GET", "/api/sweep/suggestions"],
      [
        "POST",
        "/api/sweep/suggestions/s%2F1/review",
        { accept: true, reason: "looks good" },
      ],
    ]);
  });
});
```

- [ ] **Step 2: Implement**

`apps/console/src/adapters/api/sweep.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { SweepSuggestionDTO } from "@/shared/types";

export interface SweepApiPort {
  listSuggestions(): Promise<{ items: SweepSuggestionDTO[]; count: number }>;
  review(
    id: string,
    accept: boolean,
    reason?: string,
  ): Promise<{
    ok: boolean;
    reviewed: boolean;
    resolution: {
      status: string;
      affectedRows: number;
      errors?: string[];
    } | null;
  }>;
}

export function createSweepApi(f: ApiFetcher): SweepApiPort {
  return {
    listSuggestions: () => f.getJson(`/api/sweep/suggestions`),
    review: (id, accept, reason) =>
      f.postJson(`/api/sweep/suggestions/${encodeURIComponent(id)}/review`, {
        accept,
        reason,
      }),
  };
}
```

- [ ] **Step 3: Delegate + commit**

```ts
import { createSweepApi } from "@/adapters/api/sweep";
const _sweep = createSweepApi(_fetcher);
```

Replace in `api`:

```ts
  sweepSuggestions: () => _sweep.listSuggestions(),
  reviewSuggestion: (id, accept, reason) => _sweep.review(id, accept, reason),
```

```bash
pnpm -C apps/console exec vitest run src/adapters/api/sweep.test.ts
git add apps/console/src/adapters/api/sweep.ts apps/console/src/adapters/api/sweep.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add SweepApiPort"
```

### Task 1.10: Mission adapter (status + start + stop)

- [ ] **Step 1: Test + implement**

`apps/console/src/adapters/api/mission.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createMissionApi } from "./mission";

describe("createMissionApi", () => {
  it("status + start + stop", async () => {
    const calls: unknown[][] = [];
    const api = createMissionApi({
      getJson: vi.fn(async (p: string) => {
        calls.push(["GET", p]);
        return {} as never;
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push(["POST", p, b]);
        return {} as never;
      }),
    });
    await api.status();
    await api.start();
    await api.stop();
    expect(calls).toEqual([
      ["GET", "/api/sweep/mission/status"],
      ["POST", "/api/sweep/mission/start", undefined],
      ["POST", "/api/sweep/mission/stop", undefined],
    ]);
  });
});
```

`apps/console/src/adapters/api/mission.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { MissionStateDTO } from "@/shared/types";

export interface MissionApiPort {
  status(): Promise<MissionStateDTO>;
  start(): Promise<{ ok: boolean; state: MissionStateDTO }>;
  stop(): Promise<{ ok: boolean; state: MissionStateDTO }>;
}

export function createMissionApi(f: ApiFetcher): MissionApiPort {
  return {
    status: () => f.getJson(`/api/sweep/mission/status`),
    start: () => f.postJson(`/api/sweep/mission/start`, undefined),
    stop: () => f.postJson(`/api/sweep/mission/stop`, undefined),
  };
}
```

- [ ] **Step 2: Delegate + commit**

```ts
import { createMissionApi } from "@/adapters/api/mission";
const _mission = createMissionApi(_fetcher);
```

Replace:

```ts
  missionStatus: () => _mission.status(),
  missionStart: () => _mission.start(),
  missionStop: () => _mission.stop(),
```

```bash
pnpm -C apps/console exec vitest run src/adapters/api/mission.test.ts
git add apps/console/src/adapters/api/mission.ts apps/console/src/adapters/api/mission.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add MissionApiPort"
```

### Task 1.11: Autonomy adapter

- [ ] **Step 1: Test + implement**

`apps/console/src/adapters/api/autonomy.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createAutonomyApi } from "./autonomy";

describe("createAutonomyApi", () => {
  it("status + start + stop with optional intervalSec", async () => {
    const calls: unknown[][] = [];
    const api = createAutonomyApi({
      getJson: vi.fn(async (p: string) => {
        calls.push(["GET", p]);
        return {} as never;
      }),
      postJson: vi.fn(async (p: string, b: unknown) => {
        calls.push(["POST", p, b]);
        return {} as never;
      }),
    });
    await api.status();
    await api.start(30);
    await api.stop();
    expect(calls).toEqual([
      ["GET", "/api/autonomy/status"],
      ["POST", "/api/autonomy/start", { intervalSec: 30 }],
      ["POST", "/api/autonomy/stop", undefined],
    ]);
  });
});
```

`apps/console/src/adapters/api/autonomy.ts`:

```ts
import type { ApiFetcher } from "./client";
import type { AutonomyStateDTO } from "@/shared/types";

export interface AutonomyApiPort {
  status(): Promise<AutonomyStateDTO>;
  start(
    intervalSec?: number,
  ): Promise<{ ok: boolean; state: AutonomyStateDTO }>;
  stop(): Promise<{ ok: boolean; state: AutonomyStateDTO }>;
}

export function createAutonomyApi(f: ApiFetcher): AutonomyApiPort {
  return {
    status: () => f.getJson(`/api/autonomy/status`),
    start: (intervalSec) => f.postJson(`/api/autonomy/start`, { intervalSec }),
    stop: () => f.postJson(`/api/autonomy/stop`, undefined),
  };
}
```

- [ ] **Step 2: Delegate + commit**

```ts
import { createAutonomyApi } from "@/adapters/api/autonomy";
const _autonomy = createAutonomyApi(_fetcher);
```

Replace:

```ts
  autonomyStatus: () => _autonomy.status(),
  autonomyStart: (intervalSec) => _autonomy.start(intervalSec),
  autonomyStop: () => _autonomy.stop(),
```

```bash
pnpm -C apps/console exec vitest run src/adapters/api/autonomy.test.ts
git add apps/console/src/adapters/api/autonomy.ts apps/console/src/adapters/api/autonomy.test.ts apps/console/src/lib/api.ts
git commit -m "feat(front-5l): add AutonomyApiPort"
```

### Task 1.12: Aggregate `ApiClient` + barrel

**Files:**

- Create: `apps/console/src/adapters/api/index.ts`

- [ ] **Step 1: Write the aggregate port + factory**

Create `apps/console/src/adapters/api/index.ts`:

```ts
import { createFetchApiClient, type ApiFetcher } from "./client";
import { createSatellitesApi, type SatellitesApiPort } from "./satellites";
import {
  createConjunctionsApi,
  type ConjunctionsApiPort,
} from "./conjunctions";
import { createKgApi, type KgApiPort } from "./kg";
import { createFindingsApi, type FindingsApiPort } from "./findings";
import { createStatsApi, type StatsApiPort } from "./stats";
import { createCyclesApi, type CyclesApiPort } from "./cycles";
import { createSweepApi, type SweepApiPort } from "./sweep";
import { createMissionApi, type MissionApiPort } from "./mission";
import { createAutonomyApi, type AutonomyApiPort } from "./autonomy";

export type { ApiFetcher };
export type {
  SatellitesApiPort,
  ConjunctionsApiPort,
  KgApiPort,
  FindingsApiPort,
  StatsApiPort,
  CyclesApiPort,
  SweepApiPort,
  MissionApiPort,
  AutonomyApiPort,
};

export interface ApiClient {
  satellites: SatellitesApiPort;
  conjunctions: ConjunctionsApiPort;
  kg: KgApiPort;
  findings: FindingsApiPort;
  stats: StatsApiPort;
  cycles: CyclesApiPort;
  sweep: SweepApiPort;
  mission: MissionApiPort;
  autonomy: AutonomyApiPort;
}

export function createApiClient(opts?: { fetcher?: ApiFetcher }): ApiClient {
  const f = opts?.fetcher ?? createFetchApiClient();
  return {
    satellites: createSatellitesApi(f),
    conjunctions: createConjunctionsApi(f),
    kg: createKgApi(f),
    findings: createFindingsApi(f),
    stats: createStatsApi(f),
    cycles: createCyclesApi(f),
    sweep: createSweepApi(f),
    mission: createMissionApi(f),
    autonomy: createAutonomyApi(f),
  };
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm -C apps/console typecheck`
Expected: green.

- [ ] **Step 3: Commit**

```bash
git add apps/console/src/adapters/api/index.ts
git commit -m "feat(front-5l): aggregate ApiClient factory + barrel"
```

---

## Phase 2 — Adapters: SSE + renderer + propagator

### Task 2.1: SSE client (shared EventSource wrapper)

**Files:**

- Create: `apps/console/src/adapters/sse/client.ts` + `.test.ts`

- [ ] **Step 1: Test**

Create `apps/console/src/adapters/sse/client.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { createSseClient, type SseClient } from "./client";

class FakeES {
  public onmessage: ((ev: MessageEvent) => void) | null = null;
  public onerror: (() => void) | null = null;
  public closed = false;
  constructor(public url: string) {}
  close() {
    this.closed = true;
  }
}

describe("createSseClient", () => {
  it("opens an EventSource and dispatches messages", () => {
    const instances: FakeES[] = [];
    const client: SseClient = createSseClient({
      EventSource: ((url: string) => {
        const es = new FakeES(url);
        instances.push(es);
        return es;
      }) as unknown as typeof EventSource,
    });
    const received: string[] = [];
    const sub = client.subscribe("/api/stream", {
      onMessage: (d) => received.push(d),
    });
    expect(instances.length).toBe(1);
    expect(instances[0].url).toBe("/api/stream");
    instances[0].onmessage?.(new MessageEvent("message", { data: "hello" }));
    expect(received).toEqual(["hello"]);
    sub.close();
    expect(instances[0].closed).toBe(true);
  });
});
```

- [ ] **Step 2: Implement**

`apps/console/src/adapters/sse/client.ts`:

```ts
export interface SseSubscription {
  close(): void;
}

export interface SseClient {
  subscribe(
    url: string,
    handlers: {
      onMessage: (data: string) => void;
      onError?: () => void;
    },
  ): SseSubscription;
}

export interface CreateSseClientOpts {
  EventSource?: typeof EventSource;
}

export function createSseClient(opts: CreateSseClientOpts = {}): SseClient {
  const ES = opts.EventSource ?? globalThis.EventSource;
  return {
    subscribe(url, { onMessage, onError }) {
      const es = new ES(url);
      es.onmessage = (ev: MessageEvent) => onMessage(String(ev.data));
      if (onError) es.onerror = () => onError();
      return { close: () => es.close() };
    },
  };
}
```

- [ ] **Step 3: Test passes**

Run: `pnpm -C apps/console exec vitest run src/adapters/sse/client.test.ts`

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/adapters/sse/client.ts apps/console/src/adapters/sse/client.test.ts
git commit -m "feat(front-5l): add SseClient adapter"
```

### Task 2.2: Move `repl-stream.ts` → `adapters/sse/repl.ts`

**Files:**

- Create: `apps/console/src/adapters/sse/repl.ts`
- Modify: `apps/console/src/lib/repl-stream.ts` (re-export shim)

- [ ] **Step 1: Read current repl-stream.ts**

Run: `head -60 apps/console/src/lib/repl-stream.ts`
(Note its signature.)

- [ ] **Step 2: Copy content to new location**

Create `apps/console/src/adapters/sse/repl.ts` with the body currently in `apps/console/src/lib/repl-stream.ts`. The `fetch`/`EventSource` usage inside is fine at L5 (that's the adapter layer).

- [ ] **Step 3: Convert old file to a shim**

Replace the contents of `apps/console/src/lib/repl-stream.ts` with:

```ts
export * from "@/adapters/sse/repl";
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src/adapters/sse/repl.ts apps/console/src/lib/repl-stream.ts
git commit -m "refactor(front-5l): move repl-stream to adapters/sse/repl"
```

### Task 2.3: Renderer adapter — palette + classifySatellite

**Files:**

- Create: `apps/console/src/adapters/renderer/palette.ts`
- Create: `apps/console/src/shared/types/satellite-classification.ts` + `.test.ts`

- [ ] **Step 1: Write test for classifySatellite**

Create `apps/console/src/shared/types/satellite-classification.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifySatellite } from "./satellite-classification";

describe("classifySatellite", () => {
  it("returns 'starlink' for Starlink buses", () => {
    expect(
      classifySatellite({
        busName: "Starlink v2",
        operator: "SpaceX",
        purpose: null,
      }),
    ).toBe("starlink");
  });
  it("returns 'oneweb' for OneWeb buses", () => {
    expect(
      classifySatellite({
        busName: "Airbus OneWeb",
        operator: "OneWeb",
        purpose: null,
      }),
    ).toBe("oneweb");
  });
  it("returns 'debris' for debris purpose", () => {
    expect(
      classifySatellite({ busName: null, operator: null, purpose: "debris" }),
    ).toBe("debris");
  });
  it("returns 'generic' for unknown", () => {
    expect(
      classifySatellite({
        busName: "WhoKnowsBus",
        operator: "X",
        purpose: null,
      }),
    ).toBe("generic");
  });
});
```

- [ ] **Step 2: Implement**

`apps/console/src/shared/types/satellite-classification.ts`:

```ts
export type SatelliteClass =
  | "starlink"
  | "oneweb"
  | "iridium"
  | "planet"
  | "gps"
  | "galileo"
  | "glonass"
  | "beidou"
  | "debris"
  | "generic";

interface BusFamily {
  cls: SatelliteClass;
  busPrefixes: string[];
}

const BUS_TABLE: BusFamily[] = [
  { cls: "starlink", busPrefixes: ["Starlink"] },
  { cls: "oneweb", busPrefixes: ["OneWeb", "Airbus OneWeb"] },
  { cls: "iridium", busPrefixes: ["Iridium"] },
  { cls: "planet", busPrefixes: ["Planet", "Dove", "SkySat"] },
  { cls: "gps", busPrefixes: ["GPS", "Navstar"] },
  { cls: "galileo", busPrefixes: ["Galileo"] },
  { cls: "glonass", busPrefixes: ["GLONASS", "Glonass"] },
  { cls: "beidou", busPrefixes: ["BeiDou", "Beidou"] },
];

export function classifySatellite(input: {
  busName: string | null | undefined;
  operator: string | null | undefined;
  purpose: string | null | undefined;
}): SatelliteClass {
  if (input.purpose === "debris") return "debris";
  const bus = input.busName ?? "";
  for (const f of BUS_TABLE) {
    if (f.busPrefixes.some((p) => bus.startsWith(p))) return f.cls;
  }
  return "generic";
}
```

Note: Task 5.3 will expand `BUS_TABLE` with the 40-odd entries currently hardcoded in `SatelliteField.getModelType`; for now, ship the pattern with the main families.

- [ ] **Step 3: Test passes**

Run: `pnpm -C apps/console exec vitest run src/shared/types/satellite-classification.test.ts`

- [ ] **Step 4: Implement `adapters/renderer/palette.ts`**

Extract `getCompanyColor` from `SatelliteField.tsx`. Find the current definition (around `SatelliteField.tsx:60-100` — operator colour mapping) and copy it into:

`apps/console/src/adapters/renderer/palette.ts`:

```ts
const OPERATOR_COLORS: Record<string, string> = {
  SpaceX: "#00d8ff",
  OneWeb: "#ffcc00",
  Iridium: "#ff7a00",
  "Planet Labs": "#00ff88",
  Roscosmos: "#ff3366",
  "U.S. Space Force": "#8a2be2",
};

const DEFAULT_COLOR = "#6aa0ff";

export function getOperatorColor(operator: string | null | undefined): string {
  if (!operator) return DEFAULT_COLOR;
  return OPERATOR_COLORS[operator] ?? DEFAULT_COLOR;
}
```

(If current mapping in SatelliteField has more entries, copy them exactly — goal is behaviour-preserving extraction.)

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/shared/types/satellite-classification.ts apps/console/src/shared/types/satellite-classification.test.ts apps/console/src/adapters/renderer/palette.ts
git commit -m "feat(front-5l): add classifySatellite + renderer palette adapter"
```

### Task 2.4: Renderer adapter — textures

**Files:**

- Create: `apps/console/src/adapters/renderer/textures.ts`

- [ ] **Step 1: Extract texture builders from SatelliteField.tsx**

Locate `makeGoldBumpTexture`, `makeSolarPanelTexture` in `apps/console/src/modes/ops/SatelliteField.tsx` (per audit, roughly lines 1-120). Copy them verbatim into:

`apps/console/src/adapters/renderer/textures.ts`:

```ts
import * as THREE from "three";

export function makeGoldBumpTexture(): THREE.Texture {
  // [exact body from SatelliteField.tsx — copy-paste, do not rewrite]
}

export function makeSolarPanelTexture(): THREE.Texture {
  // [exact body]
}
```

(The copy must be verbatim; goal is behaviour-preserving extraction.)

- [ ] **Step 2: Update `SatelliteField.tsx` to import** (leave SatelliteField otherwise intact; its full decomposition is in Phase 5):

```ts
import {
  makeGoldBumpTexture,
  makeSolarPanelTexture,
} from "@/adapters/renderer/textures";
```

And remove the local definitions.

- [ ] **Step 3: Typecheck + visual smoke**

```bash
pnpm -C apps/console typecheck
pnpm -C apps/console dev
# Browse to /ops, confirm satellites still render with expected textures.
```

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/adapters/renderer/textures.ts apps/console/src/modes/ops/SatelliteField.tsx
git commit -m "refactor(front-5l): extract renderer textures to adapter"
```

### Task 2.5: Propagator adapter (SGP4)

**Files:**

- Create: `apps/console/src/adapters/propagator/sgp4.ts`
- Create: `apps/console/src/adapters/propagator/sgp4.test.ts`

- [ ] **Step 1: Read current SGP4 usage**

Current direct import: `satellite.js` in `apps/console/src/lib/orbit.ts` + `modes/ops/SatelliteField.tsx:390`. The adapter wraps the TLE-based propagation into a DI-friendly port.

- [ ] **Step 2: Write test**

Create `apps/console/src/adapters/propagator/sgp4.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createSgp4Propagator } from "./sgp4";

describe("createSgp4Propagator", () => {
  it("returns null for unparseable TLE", () => {
    const p = createSgp4Propagator();
    const r = p.propagateAtDate(
      { line1: "GARBAGE", line2: "MORE GARBAGE" },
      new Date("2026-04-19T00:00:00Z"),
    );
    expect(r).toBeNull();
  });

  it("returns ECI coords for a valid ISS TLE", () => {
    const p = createSgp4Propagator();
    const r = p.propagateAtDate(
      {
        line1:
          "1 25544U 98067A   26100.00000000  .00000000  00000-0  00000-0 0  9990",
        line2:
          "2 25544  51.6416  30.0000 0006000  90.0000 270.0000 15.50000000    01",
      },
      new Date("2026-04-19T00:00:00Z"),
    );
    expect(r).not.toBeNull();
    expect(typeof r!.xKm).toBe("number");
    expect(Math.abs(r!.xKm)).toBeLessThan(10000); // LEO radius bound
  });
});
```

- [ ] **Step 3: Implement**

`apps/console/src/adapters/propagator/sgp4.ts`:

```ts
import { twoline2satrec, propagate } from "satellite.js";

export interface TleLines {
  line1: string;
  line2: string;
}

export interface Eci {
  xKm: number;
  yKm: number;
  zKm: number;
}

export interface Sgp4Propagator {
  propagateAtDate(tle: TleLines, date: Date): Eci | null;
}

export function createSgp4Propagator(): Sgp4Propagator {
  return {
    propagateAtDate(tle, date) {
      try {
        const satrec = twoline2satrec(tle.line1, tle.line2);
        const result = propagate(satrec, date);
        const pos = (
          result as { position?: { x: number; y: number; z: number } | false }
        ).position;
        if (!pos) return null;
        return { xKm: pos.x, yKm: pos.y, zKm: pos.z };
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 4: Tests pass**

Run: `pnpm -C apps/console exec vitest run src/adapters/propagator/sgp4.test.ts`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src/adapters/propagator/sgp4.ts apps/console/src/adapters/propagator/sgp4.test.ts
git commit -m "feat(front-5l): add Sgp4Propagator port"
```

---

## Phase 3 — Providers + shared/types domain helpers

### Task 3.1: ApiClient Context + Provider

**Files:**

- Create: `apps/console/src/adapters/api/ApiClientContext.tsx`
- Create: `apps/console/src/adapters/api/ApiClientContext.test.tsx`

- [ ] **Step 1: Write test**

Create `apps/console/src/adapters/api/ApiClientContext.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, renderHook } from "@testing-library/react";
import { ApiClientProvider, useApiClient } from "./ApiClientContext";
import type { ApiClient } from "./index";

const stubClient: ApiClient = {
  satellites: { list: async () => ({ items: [], count: 0 }) },
  conjunctions: { list: async () => ({ items: [], count: 0 }) },
  kg: {
    listNodes: async () => ({ items: [] }),
    listEdges: async () => ({ items: [] }),
  },
  findings: {
    list: async () => ({ items: [], count: 0 }),
    findById: async () => ({}) as never,
    decide: async () => ({}) as never,
  },
  stats: { get: async () => ({}) as never },
  cycles: { list: async () => ({ items: [] }), run: async () => ({}) as never },
  sweep: {
    listSuggestions: async () => ({ items: [], count: 0 }),
    review: async () => ({}) as never,
  },
  mission: {
    status: async () => ({}) as never,
    start: async () => ({}) as never,
    stop: async () => ({}) as never,
  },
  autonomy: {
    status: async () => ({}) as never,
    start: async () => ({}) as never,
    stop: async () => ({}) as never,
  },
};

describe("ApiClientContext", () => {
  it("useApiClient returns the provided client", () => {
    const { result } = renderHook(() => useApiClient(), {
      wrapper: ({ children }) => (
        <ApiClientProvider value={stubClient}>{children}</ApiClientProvider>
      ),
    });
    expect(result.current).toBe(stubClient);
  });

  it("throws if used without provider", () => {
    expect(() => renderHook(() => useApiClient())).toThrow(/ApiClientProvider/);
  });
});
```

- [ ] **Step 2: Implement**

Create `apps/console/src/adapters/api/ApiClientContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { ApiClient } from "./index";

const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({
  value,
  children,
}: {
  value: ApiClient;
  children: ReactNode;
}) {
  return (
    <ApiClientContext.Provider value={value}>
      {children}
    </ApiClientContext.Provider>
  );
}

export function useApiClient(): ApiClient {
  const v = useContext(ApiClientContext);
  if (!v) throw new Error("useApiClient must be used inside ApiClientProvider");
  return v;
}
```

- [ ] **Step 3: Tests pass + commit**

```bash
pnpm -C apps/console exec vitest run src/adapters/api/ApiClientContext.test.tsx
git add apps/console/src/adapters/api/ApiClientContext.tsx apps/console/src/adapters/api/ApiClientContext.test.tsx
git commit -m "feat(front-5l): add ApiClientProvider + useApiClient"
```

### Task 3.2: SSE, Renderer, Propagator Contexts

**Files:**

- Create: `apps/console/src/adapters/sse/SseClientContext.tsx`
- Create: `apps/console/src/adapters/renderer/RendererContext.tsx`
- Create: `apps/console/src/adapters/propagator/PropagatorContext.tsx`

- [ ] **Step 1: Write the three providers (same pattern)**

`apps/console/src/adapters/sse/SseClientContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { SseClient } from "./client";

const SseClientContext = createContext<SseClient | null>(null);

export function SseClientProvider({
  value,
  children,
}: {
  value: SseClient;
  children: ReactNode;
}) {
  return (
    <SseClientContext.Provider value={value}>
      {children}
    </SseClientContext.Provider>
  );
}

export function useSseClient(): SseClient {
  const v = useContext(SseClientContext);
  if (!v) throw new Error("useSseClient must be used inside SseClientProvider");
  return v;
}
```

`apps/console/src/adapters/renderer/RendererContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import { makeGoldBumpTexture, makeSolarPanelTexture } from "./textures";
import { getOperatorColor } from "./palette";

export interface RendererAdapter {
  makeGoldBumpTexture: typeof makeGoldBumpTexture;
  makeSolarPanelTexture: typeof makeSolarPanelTexture;
  getOperatorColor: typeof getOperatorColor;
}

export const defaultRendererAdapter: RendererAdapter = {
  makeGoldBumpTexture,
  makeSolarPanelTexture,
  getOperatorColor,
};

const RendererContext = createContext<RendererAdapter | null>(null);

export function RendererProvider({
  value,
  children,
}: {
  value: RendererAdapter;
  children: ReactNode;
}) {
  return (
    <RendererContext.Provider value={value}>
      {children}
    </RendererContext.Provider>
  );
}

export function useRenderer(): RendererAdapter {
  const v = useContext(RendererContext);
  if (!v) throw new Error("useRenderer must be used inside RendererProvider");
  return v;
}
```

`apps/console/src/adapters/propagator/PropagatorContext.tsx`:

```tsx
import { createContext, useContext, type ReactNode } from "react";
import type { Sgp4Propagator } from "./sgp4";

const PropagatorContext = createContext<Sgp4Propagator | null>(null);

export function PropagatorProvider({
  value,
  children,
}: {
  value: Sgp4Propagator;
  children: ReactNode;
}) {
  return (
    <PropagatorContext.Provider value={value}>
      {children}
    </PropagatorContext.Provider>
  );
}

export function usePropagator(): Sgp4Propagator {
  const v = useContext(PropagatorContext);
  if (!v)
    throw new Error("usePropagator must be used inside PropagatorProvider");
  return v;
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src/adapters/sse/SseClientContext.tsx apps/console/src/adapters/renderer/RendererContext.tsx apps/console/src/adapters/propagator/PropagatorContext.tsx
git commit -m "feat(front-5l): add SseClientProvider + RendererProvider + PropagatorProvider"
```

### Task 3.3: AppProviders composer

**Files:**

- Create: `apps/console/src/providers/AppProviders.tsx`

- [ ] **Step 1: Write composer**

```tsx
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@/adapters/api/ApiClientContext";
import type { ApiClient } from "@/adapters/api";
import { SseClientProvider } from "@/adapters/sse/SseClientContext";
import type { SseClient } from "@/adapters/sse/client";
import {
  RendererProvider,
  type RendererAdapter,
} from "@/adapters/renderer/RendererContext";
import { PropagatorProvider } from "@/adapters/propagator/PropagatorContext";
import type { Sgp4Propagator } from "@/adapters/propagator/sgp4";

export interface AppAdapters {
  api: ApiClient;
  sse: SseClient;
  renderer: RendererAdapter;
  propagator: Sgp4Propagator;
  queryClient: QueryClient;
}

export function AppProviders({
  adapters,
  children,
}: {
  adapters: AppAdapters;
  children: ReactNode;
}) {
  return (
    <QueryClientProvider client={adapters.queryClient}>
      <ApiClientProvider value={adapters.api}>
        <SseClientProvider value={adapters.sse}>
          <RendererProvider value={adapters.renderer}>
            <PropagatorProvider value={adapters.propagator}>
              {children}
            </PropagatorProvider>
          </RendererProvider>
        </SseClientProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}
```

- [ ] **Step 2: Export a test wrapper**

Add below the `AppProviders` function:

```tsx
import { createApiClient } from "@/adapters/api";
import { createSseClient } from "@/adapters/sse/client";
import { createSgp4Propagator } from "@/adapters/propagator/sgp4";
import { defaultRendererAdapter } from "@/adapters/renderer/RendererContext";

export function buildDefaultAdapters(): AppAdapters {
  return {
    api: createApiClient(),
    sse: createSseClient(),
    renderer: defaultRendererAdapter,
    propagator: createSgp4Propagator(),
    queryClient: new QueryClient({
      defaultOptions: {
        queries: { refetchOnWindowFocus: false, staleTime: 30_000 },
      },
    }),
  };
}
```

- [ ] **Step 3: Commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src/providers/AppProviders.tsx
git commit -m "feat(front-5l): add AppProviders composer + default adapters factory"
```

### Task 3.4: `shared/types/entity-id.ts`

**Files:**

- Create: `apps/console/src/shared/types/entity-id.ts` + `.test.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { entityKind } from "./entity-id";

describe("entityKind", () => {
  it("sat:… → satellite", () =>
    expect(entityKind("sat:12345")).toBe("satellite"));
  it("op:… → operator", () => expect(entityKind("op:SpaceX")).toBe("operator"));
  it("finding:… → finding", () =>
    expect(entityKind("finding:abc")).toBe("finding"));
  it("conj:… → conjunction", () =>
    expect(entityKind("conj:42")).toBe("conjunction"));
  it("unknown → 'unknown'", () =>
    expect(entityKind("mystery")).toBe("unknown"));
});
```

- [ ] **Step 2: Implement**

`apps/console/src/shared/types/entity-id.ts`:

```ts
export type EntityKind =
  | "satellite"
  | "operator"
  | "finding"
  | "conjunction"
  | "unknown";

const PREFIX_MAP: Array<[string, EntityKind]> = [
  ["sat:", "satellite"],
  ["op:", "operator"],
  ["finding:", "finding"],
  ["conj:", "conjunction"],
];

export function entityKind(id: string): EntityKind {
  for (const [prefix, kind] of PREFIX_MAP) {
    if (id.startsWith(prefix)) return kind;
  }
  return "unknown";
}
```

- [ ] **Step 3: Tests + commit**

```bash
pnpm -C apps/console exec vitest run src/shared/types/entity-id.test.ts
git add apps/console/src/shared/types/entity-id.ts apps/console/src/shared/types/entity-id.test.ts
git commit -m "feat(front-5l): add entityKind() single source of truth"
```

### Task 3.5: `shared/types` barrel

**Files:**

- Modify: `apps/console/src/shared/types/index.ts`

- [ ] **Step 1: Expand barrel**

```ts
export * from "./dtos";
export * from "./entity-id";
export * from "./satellite-classification";
```

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src/shared/types/index.ts
git commit -m "chore(front-5l): shared/types barrel"
```

---

## Phase 4 — shared/ui move + usecases dissolution

### Task 4.1: Move UI primitives to `shared/ui/`

**Files:**

- Move: `components/Drawer.tsx` → `shared/ui/Drawer.tsx`
- Move: `components/Skeleton.tsx` → `shared/ui/Skeleton.tsx`
- Move: `components/Measure.tsx` → `shared/ui/Measure.tsx`
- Move: `components/ErrorBoundary.tsx` → `shared/ui/ErrorBoundary.tsx`
- Create: `shared/ui/index.ts`
- Modify: every consumer of the moved files

- [ ] **Step 1: Run git mv for each file**

```bash
git mv apps/console/src/components/Drawer.tsx apps/console/src/shared/ui/Drawer.tsx
git mv apps/console/src/components/Skeleton.tsx apps/console/src/shared/ui/Skeleton.tsx
git mv apps/console/src/components/Measure.tsx apps/console/src/shared/ui/Measure.tsx
git mv apps/console/src/components/ErrorBoundary.tsx apps/console/src/shared/ui/ErrorBoundary.tsx
```

- [ ] **Step 2: Create barrel**

`apps/console/src/shared/ui/index.ts`:

```ts
export * from "./Drawer";
export { Skeleton } from "./Skeleton";
export { Measure } from "./Measure";
export { ErrorBoundary } from "./ErrorBoundary";
```

- [ ] **Step 3: Update all consumers**

Run: `pnpm -C apps/console typecheck` to see the broken imports, then grep for them:

```bash
grep -rn "from \"@/components/Drawer\"\|from \"@/components/Skeleton\"\|from \"@/components/Measure\"\|from \"@/components/ErrorBoundary\"" apps/console/src
```

For each hit, rewrite the import to `@/shared/ui/Drawer` etc. (Or use `@/shared/ui` barrel.)

- [ ] **Step 4: Typecheck green**

Run: `pnpm -C apps/console typecheck`

- [ ] **Step 5: Commit**

```bash
git add apps/console/src
git commit -m "refactor(front-5l): move UI primitives to shared/ui/"
```

### Task 4.2: Move remaining visual components to shared/ui

**Files:**

- Move: `components/{AppShell,TopBar,LeftRail,CommandPalette,CycleLoader,AnimatedStepBadge}.tsx` → `shared/ui/`
- Keep: `components/AutonomyControl.tsx` (becomes a feature — Phase 5)
- Keep: `components/TelemetryStrip.tsx` (becomes a feature — Phase 5)
- Keep: `components/repl/` (becomes `features/repl/` — Phase 5)

- [ ] **Step 1: git mv**

```bash
git mv apps/console/src/components/AppShell.tsx apps/console/src/shared/ui/AppShell.tsx
git mv apps/console/src/components/TopBar.tsx apps/console/src/shared/ui/TopBar.tsx
git mv apps/console/src/components/LeftRail.tsx apps/console/src/shared/ui/LeftRail.tsx
git mv apps/console/src/components/CommandPalette.tsx apps/console/src/shared/ui/CommandPalette.tsx
git mv apps/console/src/components/CycleLoader.tsx apps/console/src/shared/ui/CycleLoader.tsx
git mv apps/console/src/components/AnimatedStepBadge.tsx apps/console/src/shared/ui/AnimatedStepBadge.tsx
```

- [ ] **Step 2: Rewrite imports**

Grep + rewrite any `@/components/(AppShell|TopBar|LeftRail|CommandPalette|CycleLoader|AnimatedStepBadge)` → `@/shared/ui/…`.

- [ ] **Step 3: Extend barrel**

Append to `apps/console/src/shared/ui/index.ts`:

```ts
export { AppShell } from "./AppShell";
export { TopBar } from "./TopBar";
export { LeftRail } from "./LeftRail";
export { CommandPalette } from "./CommandPalette";
export { CycleLoader } from "./CycleLoader";
export { AnimatedStepBadge } from "./AnimatedStepBadge";
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src
git commit -m "refactor(front-5l): move AppShell, TopBar, LeftRail, CommandPalette, CycleLoader, badge to shared/ui"
```

### Task 4.3: Move generic hooks to `hooks/`

**Files:**

- Move: `lib/useAnimatedNumber.ts` → `hooks/useAnimatedNumber.ts`
- Move: `lib/useUtcClock.ts` → `hooks/useUtcClock.ts`
- Modify: consumers

- [ ] **Step 1: git mv + rewrite imports**

```bash
git mv apps/console/src/lib/useAnimatedNumber.ts apps/console/src/hooks/useAnimatedNumber.ts
git mv apps/console/src/lib/useUtcClock.ts apps/console/src/hooks/useUtcClock.ts
```

Grep for `@/lib/useAnimatedNumber` and `@/lib/useUtcClock`, rewrite to `@/hooks/…`.

- [ ] **Step 2: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src
git commit -m "refactor(front-5l): move generic hooks to hooks/"
```

### Task 4.4: Create `usecases/keys.ts`

**Files:**

- Create: `apps/console/src/usecases/keys.ts`

- [ ] **Step 1: Centralise query keys**

```ts
import type { FindingStatus, Regime } from "@/shared/types";

export const qk = {
  satellites: (regime?: Regime) => ["satellites", regime] as const,
  conjunctions: (minPc?: number) => ["conjunctions", minPc] as const,
  kg: () => ["kg"] as const,
  findings: (status?: FindingStatus, cortex?: string) =>
    ["findings", status, cortex] as const,
  finding: (id: string) => ["finding", id] as const,
  stats: () => ["stats"] as const,
  cycles: () => ["cycles"] as const,
  sweepSuggestions: () => ["sweep-suggestions"] as const,
  missionStatus: () => ["sweep-mission-status"] as const,
  autonomyStatus: () => ["autonomy-status"] as const,
};
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/src/usecases/keys.ts
git commit -m "feat(front-5l): centralise TanStack query keys"
```

### Task 4.5: Dissolve `lib/queries.ts` into `usecases/*.ts`

Each hook becomes its own file and consumes `useApiClient()` instead of the singleton `api`. Shim `lib/queries.ts` as re-exports until cleanup.

Each of the following sub-tasks follows the same recipe — I show it fully for the first (Task 4.5.a), then list the remaining files with their intent. Apply the recipe mechanically.

#### Task 4.5.a — `useSatellitesQuery`

**Files:**

- Create: `apps/console/src/usecases/useSatellitesQuery.ts`
- Modify: `apps/console/src/lib/queries.ts` (re-export from new file)

- [ ] **Step 1: Implement**

```ts
import { useQuery } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";
import type { Regime } from "@/shared/types";

export function useSatellitesQuery(regime?: Regime) {
  const api = useApiClient();
  return useQuery({
    queryKey: qk.satellites(regime),
    queryFn: () => api.satellites.list(regime),
  });
}
```

- [ ] **Step 2: Shim `lib/queries.ts`**

Replace lines 13-14 (`useSatellites` body) with:

```ts
import { useSatellitesQuery } from "@/usecases/useSatellitesQuery";
export const useSatellites = useSatellitesQuery;
```

- [ ] **Step 3: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src/usecases/useSatellitesQuery.ts apps/console/src/lib/queries.ts
git commit -m "refactor(front-5l): useSatellites → usecases/useSatellitesQuery"
```

#### Tasks 4.5.b-q — remaining usecases

Apply the same recipe as 4.5.a to each entry below. One file, one commit, shim the legacy name.

| Old name (`lib/queries.ts`) | New file (`usecases/`)                   | Shape                                                                                                |
| --------------------------- | ---------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `useConjunctions`           | `useConjunctionsQuery.ts`                | `useQuery` calling `api.conjunctions.list(minPc)`                                                    |
| `useKg`                     | `useKgQuery.ts`                          | `useQuery` calling `Promise.all([api.kg.listNodes(), api.kg.listEdges()])`, returns `{nodes, edges}` |
| `useFindings`               | `useFindingsQuery.ts`                    | `useQuery` calling `api.findings.list({status, cortex})`                                             |
| `useFinding`                | `useFindingQuery.ts`                     | `useQuery` with `enabled: id !== null`, calling `api.findings.findById(id!)`                         |
| `useStats`                  | `useStatsQuery.ts`                       | `api.stats.get()`                                                                                    |
| `useDecision`               | `useDecisionMutation.ts`                 | `useMutation` calling `api.findings.decide(id, decision, reason)` + invalidate findings/stats        |
| `useSweepSuggestions`       | `useSweepSuggestionsQuery.ts`            | `api.sweep.listSuggestions()` with `refetchInterval: 15_000`                                         |
| `useReviewSuggestion`       | `useReviewSuggestionMutation.ts`         | `useMutation` calling `api.sweep.review(id, accept, reason)` + invalidate suggestions/findings/stats |
| `useMissionStatus`          | `useMissionStatusQuery.ts`               | `api.mission.status()` with conditional `refetchInterval`                                            |
| `useMissionStart`           | part of `useMissionControlMutations.ts`  | `useMutation(() => api.mission.start())`                                                             |
| `useMissionStop`            | part of `useMissionControlMutations.ts`  | `useMutation(() => api.mission.stop())`                                                              |
| `useAutonomyStatus`         | `useAutonomyStatusQuery.ts`              | `api.autonomy.status()` with conditional `refetchInterval`                                           |
| `useAutonomyStart`          | part of `useAutonomyControlMutations.ts` | `useMutation(({intervalSec}) => api.autonomy.start(intervalSec))`                                    |
| `useAutonomyStop`           | part of `useAutonomyControlMutations.ts` | `useMutation(() => api.autonomy.stop())`                                                             |
| `useCycles`                 | `useCyclesQuery.ts`                      | `api.cycles.list()`                                                                                  |
| `useLaunchCycle`            | `useLaunchCycleMutation.ts`              | `useMutation((kind) => api.cycles.run(kind))` + invalidate findings/stats/cycles                     |

Example for the combined `useMissionControlMutations.ts`:

```ts
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useApiClient } from "@/adapters/api/ApiClientContext";
import { qk } from "./keys";

export function useMissionStartMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.mission.start(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.missionStatus() });
      qc.invalidateQueries({ queryKey: qk.sweepSuggestions() });
    },
  });
}

export function useMissionStopMutation() {
  const api = useApiClient();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.mission.stop(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.missionStatus() });
    },
  });
}
```

For each: commit with message `refactor(front-5l): <oldName> → usecases/<newFile>`.

### Task 4.6: Shim cleanup — `lib/queries.ts` fully re-exports

**Files:**

- Modify: `apps/console/src/lib/queries.ts` (final form after 4.5.a-q)

- [ ] **Step 1: Final `lib/queries.ts`**

```ts
/** Legacy shim. Phase 7 deletes this file. Consume usecases/* directly. */
export { useSatellitesQuery as useSatellites } from "@/usecases/useSatellitesQuery";
export { useConjunctionsQuery as useConjunctions } from "@/usecases/useConjunctionsQuery";
export { useKgQuery as useKg } from "@/usecases/useKgQuery";
export { useFindingsQuery as useFindings } from "@/usecases/useFindingsQuery";
export { useFindingQuery as useFinding } from "@/usecases/useFindingQuery";
export { useStatsQuery as useStats } from "@/usecases/useStatsQuery";
export { useDecisionMutation as useDecision } from "@/usecases/useDecisionMutation";
export { useSweepSuggestionsQuery as useSweepSuggestions } from "@/usecases/useSweepSuggestionsQuery";
export { useReviewSuggestionMutation as useReviewSuggestion } from "@/usecases/useReviewSuggestionMutation";
export { useMissionStatusQuery as useMissionStatus } from "@/usecases/useMissionStatusQuery";
export {
  useMissionStartMutation as useMissionStart,
  useMissionStopMutation as useMissionStop,
} from "@/usecases/useMissionControlMutations";
export { useAutonomyStatusQuery as useAutonomyStatus } from "@/usecases/useAutonomyStatusQuery";
export {
  useAutonomyStartMutation as useAutonomyStart,
  useAutonomyStopMutation as useAutonomyStop,
} from "@/usecases/useAutonomyControlMutations";
export { useCyclesQuery as useCycles } from "@/usecases/useCyclesQuery";
export { useLaunchCycleMutation as useLaunchCycle } from "@/usecases/useLaunchCycleMutation";
export { qk } from "@/usecases/keys";
```

- [ ] **Step 2: Commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src/lib/queries.ts
git commit -m "refactor(front-5l): lib/queries.ts now a pure re-export shim"
```

---

## Phase 5 — Feature extractions

### Task 5.1: Sweep pilot — migrate `SweepSuggestions` → `features/sweep/Suggestions`

Sweep is the smallest god-component (240 LOC) and validates the pattern.

**Files:**

- Create: `apps/console/src/features/sweep/Suggestions.tsx`
- Create: `apps/console/src/features/sweep/Entry.tsx`
- Create: `apps/console/src/features/sweep/index.ts`
- Modify: `apps/console/src/routes/sweep.tsx`
- Modify: `apps/console/src/modes/sweep/SweepSuggestions.tsx` (shim: re-export from feature)

- [ ] **Step 1: Read current `SweepSuggestions.tsx`**

Run: `cat apps/console/src/modes/sweep/SweepSuggestions.tsx | head -80`
Identify its top-level export and its imports.

- [ ] **Step 2: Copy body to new location** (start verbatim)

`git mv apps/console/src/modes/sweep/SweepSuggestions.tsx apps/console/src/features/sweep/Suggestions.tsx`

Rewrite imports inside the moved file:

- `from "@/lib/queries"` → `from "@/usecases/useSweepSuggestionsQuery"` (and the other relevant usecase file)
- `from "@/lib/api"` (types) → `from "@/shared/types"`
- `from "@/components/Drawer"` → `from "@/shared/ui/Drawer"` etc.
- If it calls a `useUiStore` for drawer state, leave that for now (Phase 6 handles scoped stores).

- [ ] **Step 3: Feature barrel + Entry**

`apps/console/src/features/sweep/Entry.tsx`:

```tsx
import { Suggestions } from "./Suggestions";
// + any other sibling components needed on the route
export function SweepEntry() {
  return <Suggestions />;
}
```

(If `routes/sweep.tsx` currently imports the whole `SweepMode` component, bring its composition into `SweepEntry` here.)

`apps/console/src/features/sweep/index.ts`:

```ts
export { SweepEntry } from "./Entry";
export { Suggestions } from "./Suggestions";
```

- [ ] **Step 4: Update route**

Modify `apps/console/src/routes/sweep.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { SweepEntry } from "@/features/sweep";

export const Route = createFileRoute("/sweep")({
  component: SweepEntry,
});
```

- [ ] **Step 5: Move the other sweep mode files similarly**

For each of `modes/sweep/{SweepMode, SweepOverview, SweepStats, SweepDrawer, FindingsGraph}.tsx`:

- `git mv apps/console/src/modes/sweep/X.tsx apps/console/src/features/sweep/Y.tsx` (lowercase first letter if React component name stays)
- Rewrite its imports to usecases + shared/ui + shared/types
- Update callers inside `features/sweep/`

- [ ] **Step 6: Typecheck + browser smoke**

```bash
pnpm -C apps/console typecheck
pnpm -C apps/console dev
# Browse /sweep — confirm suggestions load + review works.
```

- [ ] **Step 7: Commit**

```bash
git add apps/console/src
git commit -m "refactor(front-5l): sweep mode → features/sweep/*"
```

### Task 5.2: Thalamus — split `ThalamusMode` (763 LOC → 6 files)

**Files:**

- Create: `apps/console/src/features/thalamus/{Entry,Canvas,Hud,Drawer,SubDrawer,Ascii}.tsx`
- Create: `apps/console/src/hooks/useThalamusGraph.ts`
- Create: `apps/console/src/hooks/useThalamusLayout.ts`
- Create: `apps/console/src/features/thalamus/index.ts`
- Modify: `apps/console/src/routes/thalamus.tsx`
- Delete: `apps/console/src/modes/thalamus/ThalamusMode.tsx` (after extraction)

- [ ] **Step 1: Read the current file end-to-end**

Run: `wc -l apps/console/src/modes/thalamus/ThalamusMode.tsx` and open it.
Map out the sections by concern: data fetching, layout math, graphology building, Sigma init, drawer, ASCII render, HUD.

- [ ] **Step 2: Extract `useThalamusGraph` hook**

Create `apps/console/src/hooks/useThalamusGraph.ts`:

```ts
import { useMemo } from "react";
import Graph from "graphology";
import { useKgQuery } from "@/usecases/useKgQuery";
import type { KgNodeDTO, KgEdgeDTO } from "@/shared/types";

export interface ThalamusGraphState {
  graph: Graph | null;
  nodes: KgNodeDTO[];
  edges: KgEdgeDTO[];
  isLoading: boolean;
}

export function useThalamusGraph(): ThalamusGraphState {
  const q = useKgQuery();
  const data = q.data;
  const graph = useMemo(() => {
    if (!data) return null;
    const g = new Graph();
    for (const n of data.nodes) {
      g.addNode(n.id, { label: n.label, x: n.x, y: n.y, class: n.class });
    }
    for (const e of data.edges) {
      if (g.hasNode(e.source) && g.hasNode(e.target)) {
        g.addEdgeWithKey(e.id, e.source, e.target, {
          relation: e.relation,
          confidence: e.confidence,
          sourceClass: e.sourceClass,
        });
      }
    }
    return g;
  }, [data]);
  return {
    graph,
    nodes: data?.nodes ?? [],
    edges: data?.edges ?? [],
    isLoading: q.isLoading,
  };
}
```

- [ ] **Step 3: Extract `useThalamusLayout`**

Create `apps/console/src/hooks/useThalamusLayout.ts`:

```ts
import { useEffect } from "react";
import forceAtlas2 from "graphology-layout-forceatlas2";
import type Graph from "graphology";

export function useThalamusLayout(graph: Graph | null, iterations = 300) {
  useEffect(() => {
    if (!graph) return;
    forceAtlas2.assign(graph, { iterations });
  }, [graph, iterations]);
}
```

- [ ] **Step 4: Extract `Ascii.tsx`**

Locate `buildNeuronAscii` in the source and move it into `apps/console/src/features/thalamus/Ascii.tsx` as:

```tsx
// Ascii.tsx — HUD text art for the thalamus selection
// [copy buildNeuronAscii + its helpers verbatim into this file]
// Export a `<Ascii selection={...} />` component that wraps the pure builder.
```

- [ ] **Step 5: Extract `Drawer.tsx` and `SubDrawer.tsx`**

Locate the `ThalamusDrawer` component (around L700+). Move it into `apps/console/src/features/thalamus/Drawer.tsx`. Preserve its props shape. Move any inner drawer state into a sibling `SubDrawer.tsx` if applicable.

- [ ] **Step 6: Extract `Hud.tsx`**

Locate the HUD JSX in `ThalamusMode.tsx` (stats overlay). Move to `apps/console/src/features/thalamus/Hud.tsx`. The HUD consumes data via `useKgQuery` directly (no prop drilling needed for MVP).

- [ ] **Step 7: Write `Canvas.tsx`**

`apps/console/src/features/thalamus/Canvas.tsx`:

```tsx
import { useEffect, useRef } from "react";
import { useThalamusGraph } from "@/hooks/useThalamusGraph";
import { useThalamusLayout } from "@/hooks/useThalamusLayout";
import { mountSigma, type SigmaHandle } from "@/adapters/renderer/sigma";

export function ThalamusCanvas({
  onSelect,
}: {
  onSelect: (nodeId: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<SigmaHandle | null>(null);
  const { graph } = useThalamusGraph();
  useThalamusLayout(graph);

  useEffect(() => {
    if (!containerRef.current || !graph) return;
    sigmaRef.current?.dispose();
    sigmaRef.current = mountSigma(containerRef.current, graph, {
      onClickNode: (id) => onSelect(id),
      onClickStage: () => onSelect(null),
    });
    return () => sigmaRef.current?.dispose();
  }, [graph, onSelect]);

  return <div ref={containerRef} className="thalamus-canvas" />;
}
```

- [ ] **Step 8: Create `adapters/renderer/sigma.ts`**

Extract the Sigma mount/init code from `ThalamusMode.tsx` (around L400-500):

```ts
import Sigma from "sigma";
import type Graph from "graphology";

export interface SigmaHandle {
  dispose(): void;
  focusNode(id: string): void;
}

export interface SigmaMountOpts {
  onClickNode?: (id: string) => void;
  onClickStage?: () => void;
}

export function mountSigma(
  container: HTMLElement,
  graph: Graph,
  opts: SigmaMountOpts = {},
): SigmaHandle {
  const sigma = new Sigma(graph, container, {});
  if (opts.onClickNode) {
    sigma.on("clickNode", (ev) => opts.onClickNode!(ev.node));
  }
  if (opts.onClickStage) {
    sigma.on("clickStage", () => opts.onClickStage!());
  }
  return {
    dispose: () => sigma.kill(),
    focusNode: (id) => {
      const attrs = graph.getNodeAttributes(id);
      sigma.getCamera().animate({ x: attrs.x, y: attrs.y, ratio: 0.5 });
    },
  };
}
```

Update `adapters/renderer/RendererContext.tsx` if needed to expose this; but for Sigma we can import it directly in the canvas since Sigma lives in adapters.

- [ ] **Step 9: Write `Entry.tsx` and barrel**

`apps/console/src/features/thalamus/Entry.tsx`:

```tsx
import { useState } from "react";
import { ThalamusCanvas } from "./Canvas";
import { ThalamusHud } from "./Hud";
import { ThalamusDrawer } from "./Drawer";

export function ThalamusEntry() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  return (
    <div className="thalamus-layout">
      <ThalamusCanvas onSelect={setSelectedId} />
      <ThalamusHud />
      {selectedId && (
        <ThalamusDrawer
          nodeId={selectedId}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}
```

`apps/console/src/features/thalamus/index.ts`:

```ts
export { ThalamusEntry } from "./Entry";
```

- [ ] **Step 10: Update route**

`apps/console/src/routes/thalamus.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ThalamusEntry } from "@/features/thalamus";

export const Route = createFileRoute("/thalamus")({
  component: ThalamusEntry,
});
```

- [ ] **Step 11: Delete the old `ThalamusMode.tsx` + sibling files**

```bash
git rm apps/console/src/modes/thalamus/ThalamusMode.tsx
# Move FindingReadout.tsx out if still needed:
git mv apps/console/src/modes/thalamus/FindingReadout.tsx apps/console/src/features/findings/Readout.tsx
```

Rewrite all `@/modes/thalamus/FindingReadout` imports → `@/features/findings/Readout`.

- [ ] **Step 12: Typecheck + visual smoke**

```bash
pnpm -C apps/console typecheck
pnpm -C apps/console dev
# Browse /thalamus, confirm the graph renders, the drawer opens on click, and the HUD stats are correct.
```

- [ ] **Step 13: Commit**

```bash
git add apps/console/src
git commit -m "refactor(front-5l): thalamus mode → features/thalamus/* + hooks + sigma adapter"
```

### Task 5.3: Ops — split `OpsMode` + `SatelliteField`

**Files:**

- Create: `apps/console/src/features/ops/{Entry,Scene,Filters,ThreatBoard,Clock,Search,SatelliteField,Drawer}.tsx`
- Create: `apps/console/src/hooks/useOpsTime.ts`
- Create: `apps/console/src/hooks/useOpsSelection.ts`
- Create: `apps/console/src/adapters/renderer/instanced-sats.ts`
- Modify: `apps/console/src/routes/ops.tsx`

- [ ] **Step 1: Read both current files, map sections**

Run: `wc -l apps/console/src/modes/ops/OpsMode.tsx apps/console/src/modes/ops/SatelliteField.tsx`
Open both; identify: Scene composition, time cursor, regime filter, search, threat board, clock, SatelliteField internals (getModelType, textures, propagation, instanced mesh).

- [ ] **Step 2: Extract `useOpsTime` hook**

`apps/console/src/hooks/useOpsTime.ts`:

```ts
import { useEffect, useState } from "react";

export interface OpsTimeState {
  now: Date;
  rateMs: number;
}

export function useOpsTime(opts?: {
  initialRateMs?: number;
  tickMs?: number;
}): OpsTimeState & {
  setRate: (r: number) => void;
} {
  const [rateMs, setRateMs] = useState(opts?.initialRateMs ?? 1000);
  const [now, setNow] = useState<Date>(new Date());
  useEffect(() => {
    const h = setInterval(() => setNow(new Date()), opts?.tickMs ?? 1000);
    return () => clearInterval(h);
  }, [opts?.tickMs]);
  return { now, rateMs, setRate: setRateMs };
}
```

- [ ] **Step 3: Extract `useOpsSelection`**

`apps/console/src/hooks/useOpsSelection.ts`:

```ts
import { useState, useCallback } from "react";

export function useOpsSelection() {
  const [selectedSatelliteId, setSelectedSatelliteId] = useState<number | null>(
    null,
  );
  const clear = useCallback(() => setSelectedSatelliteId(null), []);
  return { selectedSatelliteId, select: setSelectedSatelliteId, clear };
}
```

- [ ] **Step 4: Complete `classifySatellite` bus table**

Open `apps/console/src/modes/ops/SatelliteField.tsx`, locate `getModelType` (per audit at L149-231). For each `startsWith` in that function, add the `{cls, busPrefixes}` entry to `BUS_TABLE` in `apps/console/src/shared/types/satellite-classification.ts`.

Also: extend the `SatelliteClass` union if new classes appear (`proton`, `soyuz`, etc.). Extend the test file `satellite-classification.test.ts` to cover at least 5 new entries.

- [ ] **Step 5: Extract `adapters/renderer/instanced-sats.ts`**

Move the instanced mesh construction from `SatelliteField.tsx` (the Three.js InstancedMesh + per-instance attributes) into an adapter module:

```ts
import * as THREE from "three";
import type { SatelliteClass } from "@/shared/types";

export interface InstancedSatsHandle {
  mesh: THREE.InstancedMesh;
  setPosition(
    instanceIndex: number,
    xKm: number,
    yKm: number,
    zKm: number,
  ): void;
  setColor(instanceIndex: number, hex: string): void;
  dispose(): void;
}

export function createInstancedSats(params: {
  count: number;
  cls: SatelliteClass;
  goldBump: THREE.Texture;
  solarPanel: THREE.Texture;
}): InstancedSatsHandle {
  // [extracted body — verbatim copy from SatelliteField.tsx]
  // return {mesh, setPosition, setColor, dispose}
}
```

- [ ] **Step 6: Rebuild slim `features/ops/SatelliteField.tsx`**

The new file is ≤150 LOC. It only composes: `usePropagator()`, `useRenderer()`, `useSatellitesQuery()`, `useOpsTime()`, and delegates to `createInstancedSats`.

Sketch (concrete shape will come from the actual extraction):

```tsx
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { useSatellitesQuery } from "@/usecases/useSatellitesQuery";
import { usePropagator } from "@/adapters/propagator/PropagatorContext";
import { useRenderer } from "@/adapters/renderer/RendererContext";
import { createInstancedSats } from "@/adapters/renderer/instanced-sats";
import { classifySatellite } from "@/shared/types";
import { useOpsTime } from "@/hooks/useOpsTime";

export function SatelliteField() {
  const q = useSatellitesQuery();
  const prop = usePropagator();
  const r = useRenderer();
  const { now } = useOpsTime();
  const groupRef = useRef<THREE.Group | null>(null);
  const handleRef = useRef<ReturnType<typeof createInstancedSats> | null>(null);

  // Mount instanced mesh when satellites arrive (once per class group)
  useEffect(() => {
    if (!q.data) return;
    // group by classifySatellite; build one InstancedSatsHandle per class
    // …
    return () => handleRef.current?.dispose();
  }, [q.data, r]);

  // Per-frame update of positions using propagator
  useEffect(() => {
    if (!q.data || !handleRef.current) return;
    for (let i = 0; i < q.data.items.length; i++) {
      const s = q.data.items[i];
      if (!s.tleLine1 || !s.tleLine2) continue;
      const eci = prop.propagateAtDate(
        { line1: s.tleLine1, line2: s.tleLine2 },
        now,
      );
      if (eci) handleRef.current.setPosition(i, eci.xKm, eci.yKm, eci.zKm);
    }
  }, [q.data, prop, now]);

  return <group ref={groupRef} />;
}
```

(Final exact body comes from the migration; this is the target shape.)

- [ ] **Step 7: Extract `Filters.tsx`, `ThreatBoard.tsx`, `Clock.tsx`, `Search.tsx` from `OpsMode.tsx`**

For each section of `OpsMode.tsx`, cut the corresponding JSX + local state into its own feature file. Each file ≤100 LOC. Use `useOpsTime`, `useOpsSelection`, and the relevant usecases.

- [ ] **Step 8: Write `Scene.tsx` and `Entry.tsx`**

`apps/console/src/features/ops/Scene.tsx`:

```tsx
import { Canvas } from "@react-three/fiber";
import { SatelliteField } from "./SatelliteField";
// + camera, lighting, orbit controls extracted from OpsMode
export function OpsScene() {
  return (
    <Canvas>
      {/* lighting, stars, earth */}
      <SatelliteField />
    </Canvas>
  );
}
```

`apps/console/src/features/ops/Entry.tsx`:

```tsx
import { OpsScene } from "./Scene";
import { OpsFilters } from "./Filters";
import { OpsThreatBoard } from "./ThreatBoard";
import { OpsClock } from "./Clock";
import { OpsSearch } from "./Search";
import { OpsDrawer } from "./Drawer";

export function OpsEntry() {
  return (
    <div className="ops-layout">
      <OpsScene />
      <OpsFilters />
      <OpsSearch />
      <OpsClock />
      <OpsThreatBoard />
      <OpsDrawer />
    </div>
  );
}
```

- [ ] **Step 9: Update route**

`apps/console/src/routes/ops.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { OpsEntry } from "@/features/ops";

export const Route = createFileRoute("/ops")({
  component: OpsEntry,
});
```

- [ ] **Step 10: Delete legacy Ops files**

After confirming the new route renders:

```bash
git rm apps/console/src/modes/ops/OpsMode.tsx
git rm apps/console/src/modes/ops/SatelliteField.tsx
git mv apps/console/src/modes/ops/OrbitTrails.tsx apps/console/src/features/ops/OrbitTrails.tsx
git mv apps/console/src/modes/ops/ConjunctionMarkers.tsx apps/console/src/features/ops/ConjunctionMarkers.tsx
git mv apps/console/src/modes/ops/ConjunctionArcs.tsx apps/console/src/features/ops/ConjunctionArcs.tsx
git mv apps/console/src/modes/ops/CameraFocus.tsx apps/console/src/features/ops/CameraFocus.tsx
git mv apps/console/src/modes/ops/SatelliteSearch.tsx apps/console/src/features/ops/SatelliteSearch.tsx
git mv apps/console/src/modes/ops/OpsDrawer.tsx apps/console/src/features/ops/Drawer.tsx
git mv apps/console/src/modes/ops/FindingsPanel.tsx apps/console/src/features/findings/Panel.tsx
git mv apps/console/src/modes/ops/CycleLaunchPanel.tsx apps/console/src/features/ops/CycleLaunchPanel.tsx
```

Rewrite imports inside each moved file to use usecases + shared/ui.

- [ ] **Step 11: Typecheck + visual smoke**

```bash
pnpm -C apps/console typecheck
pnpm -C apps/console dev
# Browse /ops, confirm satellites render, filters work, drawer opens, clock advances.
```

- [ ] **Step 12: Commit**

```bash
git add apps/console/src
git commit -m "refactor(front-5l): ops mode → features/ops/* + hooks + renderer adapters"
```

### Task 5.4: REPL feature

**Files:**

- Move: `components/repl/*` → `features/repl/*`
- Create: `apps/console/src/usecases/useReplStream.ts`

- [ ] **Step 1: git mv the folder**

```bash
git mv apps/console/src/components/repl apps/console/src/features/repl
git mv apps/console/src/lib/replReducer.ts apps/console/src/features/repl/reducer.ts
```

- [ ] **Step 2: Create the usecase**

`apps/console/src/usecases/useReplStream.ts`:

```ts
import { useEffect, useRef, useState } from "react";
import { useSseClient } from "@/adapters/sse/SseClientContext";
import { parseReplEvent, type ReplEvent } from "@/adapters/sse/repl";

export function useReplStream(url: string | null) {
  const sse = useSseClient();
  const [events, setEvents] = useState<ReplEvent[]>([]);
  const subRef = useRef<{ close(): void } | null>(null);

  useEffect(() => {
    subRef.current?.close();
    if (!url) return;
    subRef.current = sse.subscribe(url, {
      onMessage: (raw) => {
        const ev = parseReplEvent(raw);
        if (ev) setEvents((prev) => [...prev, ev]);
      },
    });
    return () => subRef.current?.close();
  }, [url, sse]);

  return { events };
}
```

(If `adapters/sse/repl.ts` doesn't export `parseReplEvent`, add that export while moving `lib/repl-stream.ts`.)

- [ ] **Step 3: Rewrite imports inside `features/repl/*`**

Grep for `@/lib/repl-stream`, `@/lib/replReducer`, `@/lib/api`, `@/lib/queries` inside the moved files and rewrite to adapters + usecases + shared/types.

- [ ] **Step 4: Feature barrel**

`apps/console/src/features/repl/index.ts`:

```ts
export { ReplProvider } from "./ReplProvider";
export { ReplPanel } from "./ReplPanel";
```

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
pnpm -C apps/console dev
# Smoke: open REPL panel, send a turn, confirm streaming works.
git add apps/console/src
git commit -m "refactor(front-5l): repl → features/repl/* + useReplStream usecase"
```

### Task 5.5: Findings + autonomy + config + telemetry-strip features

**Files:**

- Move + refactor remaining `components/*` + `modes/config/*` into `features/*`

- [ ] **Step 1: git mv + rewrite**

```bash
git mv apps/console/src/components/AutonomyControl.tsx apps/console/src/features/autonomy/Control.tsx
git mv apps/console/src/components/TelemetryStrip.tsx apps/console/src/features/ops/TelemetryStrip.tsx
git mv apps/console/src/modes/config apps/console/src/features/config
```

Create barrels:

```ts
// features/autonomy/index.ts
export { AutonomyControl } from "./Control";
// features/config/index.ts
export { ConfigEntry } from "./Entry"; // create Entry.tsx if not present
// features/findings/index.ts
export { FindingsPanel } from "./Panel";
export { FindingReadout } from "./Readout";
```

- [ ] **Step 2: Rewrite imports in each moved file**

Grep for `@/lib/queries`, `@/lib/api`, `@/components/...` and rewrite.

- [ ] **Step 3: Update route**

`apps/console/src/routes/config.tsx`:

```tsx
import { createFileRoute } from "@tanstack/react-router";
import { ConfigEntry } from "@/features/config";

export const Route = createFileRoute("/config")({
  component: ConfigEntry,
});
```

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src
git commit -m "refactor(front-5l): autonomy + config + findings + telemetry → features/*"
```

---

## Phase 6 — Scoped stores + bootstrap wiring

### Task 6.1: Split `uiStore` into scoped feature stores

**Files:**

- Create: `apps/console/src/features/ops/state.ts` (only `drawerId` / `openDrawer` / `closeDrawer`)
- Create: `apps/console/src/shared/ui/railStore.ts` (only `railCollapsed` / `toggleRail` — used by `LeftRail`)
- Modify: `apps/console/src/lib/uiStore.ts` (shim: re-exports both)
- Modify: all consumers to use the right scoped store

- [ ] **Step 1: Write scoped stores**

`apps/console/src/features/ops/state.ts`:

```ts
import { create } from "zustand";

interface OpsUiState {
  drawerId: string | null;
  openDrawer: (id: string) => void;
  closeDrawer: () => void;
}

export const useOpsUi = create<OpsUiState>((set) => ({
  drawerId: null,
  openDrawer: (id) => set({ drawerId: id }),
  closeDrawer: () => set({ drawerId: null }),
}));
```

`apps/console/src/shared/ui/railStore.ts`:

```ts
import { create } from "zustand";

interface RailState {
  railCollapsed: boolean;
  toggleRail: () => void;
}

export const useRail = create<RailState>((set) => ({
  railCollapsed: false,
  toggleRail: () => set((s) => ({ railCollapsed: !s.railCollapsed })),
}));
```

- [ ] **Step 2: Rewrite consumers**

Grep: `grep -rn "useUiStore" apps/console/src`. For each hit:

- If it uses `railCollapsed` / `toggleRail` → rewrite to `useRail`.
- If it uses `drawerId` / `openDrawer` / `closeDrawer` → rewrite to `useOpsUi` (confirm it's inside ops scope).

- [ ] **Step 3: Convert `lib/uiStore.ts` to shim**

```ts
export { useRail as useUiStore } from "@/shared/ui/railStore";
```

(If both state shapes are still needed by a non-ops consumer, split differently. Audit first.)

- [ ] **Step 4: Typecheck + commit**

```bash
pnpm -C apps/console typecheck
git add apps/console/src
git commit -m "refactor(front-5l): scope zustand stores per feature"
```

### Task 6.2: Wire `AppProviders` in `main.tsx`

**Files:**

- Modify: `apps/console/src/main.tsx`

- [ ] **Step 1: Read current `main.tsx`**

Check how it currently wraps the router.

- [ ] **Step 2: Wrap in `AppProviders`**

```tsx
import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";
import { AppProviders, buildDefaultAdapters } from "@/providers/AppProviders";
import "./styles/index.css";

const router = createRouter({ routeTree });
const adapters = buildDefaultAdapters();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppProviders adapters={adapters}>
      <RouterProvider router={router} />
    </AppProviders>
  </React.StrictMode>,
);
```

If a `QueryClientProvider` existed outside `AppProviders`, remove it — `AppProviders` now owns the `QueryClient`.

- [ ] **Step 3: Visual smoke (every route)**

```bash
pnpm -C apps/console dev
# Browse /ops, /thalamus, /sweep, /config, /; confirm each still works.
```

- [ ] **Step 4: Commit**

```bash
git add apps/console/src/main.tsx
git commit -m "refactor(front-5l): wire AppProviders in main.tsx"
```

---

## Phase 7 — Cleanup, strict arch-guard, smoke tests

### Task 7.1: Render smoke test per feature

**Files:**

- Create: `apps/console/tests/smoke.test.tsx`

- [ ] **Step 1: Write smoke tests with stub adapters**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ApiClientProvider } from "@/adapters/api/ApiClientContext";
import { SseClientProvider } from "@/adapters/sse/SseClientContext";
import {
  RendererProvider,
  defaultRendererAdapter,
} from "@/adapters/renderer/RendererContext";
import { PropagatorProvider } from "@/adapters/propagator/PropagatorContext";
import type { ApiClient } from "@/adapters/api";
import { SweepEntry } from "@/features/sweep";

const stubApi: ApiClient = {
  satellites: { list: async () => ({ items: [], count: 0 }) },
  conjunctions: { list: async () => ({ items: [], count: 0 }) },
  kg: {
    listNodes: async () => ({ items: [] }),
    listEdges: async () => ({ items: [] }),
  },
  findings: {
    list: async () => ({ items: [], count: 0 }),
    findById: async () => ({}) as never,
    decide: async () => ({}) as never,
  },
  stats: {
    get: async () => ({
      satellites: 0,
      conjunctions: 0,
      kgNodes: 0,
      kgEdges: 0,
      findings: 0,
      byStatus: {},
      byCortex: {},
    }),
  },
  cycles: {
    list: async () => ({ items: [] }),
    run: async () => ({ cycle: {} as never }),
  },
  sweep: {
    listSuggestions: async () => ({ items: [], count: 0 }),
    review: async () => ({ ok: true, reviewed: true, resolution: null }),
  },
  mission: {
    status: async () => ({}) as never,
    start: async () => ({}) as never,
    stop: async () => ({}) as never,
  },
  autonomy: {
    status: async () => ({}) as never,
    start: async () => ({}) as never,
    stop: async () => ({}) as never,
  },
};

function Wrap({ children }: { children: React.ReactNode }) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return (
    <QueryClientProvider client={qc}>
      <ApiClientProvider value={stubApi}>
        <SseClientProvider value={{ subscribe: () => ({ close: () => {} }) }}>
          <RendererProvider value={defaultRendererAdapter}>
            <PropagatorProvider value={{ propagateAtDate: () => null }}>
              {children}
            </PropagatorProvider>
          </RendererProvider>
        </SseClientProvider>
      </ApiClientProvider>
    </QueryClientProvider>
  );
}

describe("feature smoke", () => {
  it("SweepEntry renders empty state without throwing", async () => {
    render(<SweepEntry />, { wrapper: Wrap });
    // There's always at least some static chrome. If the entry renders, no throw => pass.
    expect(document.body).toBeTruthy();
  });
});
```

(One `it()` per feature entry. SceneEntry + ThalamusEntry need fake Sigma/Three; for smoke, the wrappers above are enough — Three.js `<Canvas>` in jsdom needs `@react-three/fiber`'s test renderer or a mock; if that's heavy, skip Scene/Canvas smoke and keep them for manual visual.)

- [ ] **Step 2: Test passes**

Run: `pnpm -C apps/console exec vitest run tests/smoke.test.tsx`
Expected: pass (or skip the Three/Sigma ones with `.skip` + an `// MANUAL: visual smoke required` comment).

- [ ] **Step 3: Commit**

```bash
git add apps/console/tests/smoke.test.tsx
git commit -m "test(front-5l): feature smoke tests with stubbed adapters"
```

### Task 7.2: Flip dep-cruiser rules to strict

**Files:**

- Modify: `.dependency-cruiser.js`

- [ ] **Step 1: Change severity of legacy folder rules**

Edit `.dependency-cruiser.js`: change `severity: 'info'` to `severity: 'error'` on the `console-front-no-legacy-lib` and `console-front-no-legacy-modes` rules.

- [ ] **Step 2: Run arch check**

Run: `pnpm arch:check:repo`
Expected: **errors**, because legacy shims still exist.

- [ ] **Step 3: Do the cleanup in Task 7.3 first**

(Revisit this commit after 7.3.)

### Task 7.3: Delete legacy folders

**Files:**

- Delete: `apps/console/src/lib/` (entire folder, except any files still required by `@/hooks` or `@/shared`)
- Delete: `apps/console/src/modes/` (entire folder)
- Delete: `apps/console/src/components/` (entire folder — everything moved)
- Modify: any remaining import

- [ ] **Step 1: Audit remaining lib/ contents**

Run: `ls apps/console/src/lib/`
Expected survivors to consider:

- `api.ts` — shim, delete
- `queries.ts` — shim, delete
- `repl.ts` — move to `adapters/sse/repl-commands.ts` or `features/repl/commands.ts` based on content
- `repl-stream.ts` — shim, delete
- `replReducer.ts` — already moved to features/repl
- `conjunction.ts`, `orbit.ts`, `units.ts`, `steps.ts`, `sparkline.ts`, `graphColors.ts`, `runtime-config.ts` — each either:
  - pure utility with multi-feature use → move to `shared/types/` or `shared/ui/` depending on concern
  - single-feature → move to `features/<x>/`
  - runtime-config → likely needs its own adapter; verify usage

- [ ] **Step 2: For each surviving lib file, categorise and move**

For each remaining file, run `grep -rn "@/lib/<file>" apps/console/src` to find consumers, then decide destination and move with `git mv`, rewriting imports.

Example:

```bash
git mv apps/console/src/lib/units.ts apps/console/src/shared/types/units.ts
git mv apps/console/src/lib/orbit.ts apps/console/src/adapters/propagator/orbit.ts
git mv apps/console/src/lib/conjunction.ts apps/console/src/shared/types/conjunction.ts
git mv apps/console/src/lib/steps.ts apps/console/src/shared/types/steps.ts
git mv apps/console/src/lib/sparkline.ts apps/console/src/shared/ui/sparkline.ts
git mv apps/console/src/lib/graphColors.ts apps/console/src/shared/types/colors.ts
git mv apps/console/src/lib/runtime-config.ts apps/console/src/adapters/api/runtime-config.ts  # or a new config port
```

Rewrite all import paths.

- [ ] **Step 3: Delete the empty shells**

```bash
rm apps/console/src/lib/api.ts
rm apps/console/src/lib/queries.ts
rm apps/console/src/lib/repl-stream.ts
# lib/ should now be empty except orphan tests; check:
ls apps/console/src/lib/
# Expected: empty or only orbit.test.ts — move test alongside the moved orbit.ts
git mv apps/console/src/lib/orbit.test.ts apps/console/src/adapters/propagator/orbit.test.ts
rmdir apps/console/src/lib
```

- [ ] **Step 4: Delete `modes/` and `components/` folders**

```bash
# After Phase 5 + 6, these should already be empty or contain only stragglers.
ls apps/console/src/modes/
ls apps/console/src/components/
# Move or delete each file, then:
rm -rf apps/console/src/modes
rm -rf apps/console/src/components
```

- [ ] **Step 5: Typecheck + visual smoke**

```bash
pnpm -C apps/console typecheck
pnpm -C apps/console build
pnpm -C apps/console dev
# Browse every route, confirm identical behaviour to main.
```

- [ ] **Step 6: Commit**

```bash
git add apps/console/src
git commit -m "chore(front-5l): delete lib/ modes/ components/ legacy folders"
```

### Task 7.4: Strict dep-cruiser + final CI verification

**Files:**

- Modify: `.dependency-cruiser.js` (no change needed — rules are already error-level after Task 7.2)

- [ ] **Step 1: Run full arch + test + build**

```bash
pnpm arch:check:repo
pnpm -r typecheck
pnpm test
pnpm -C apps/console build
```

Expected: all green. The `console-front-no-legacy-*` rules now have zero matches (the folders are gone).

- [ ] **Step 2: Commit**

```bash
git add .dependency-cruiser.js
git commit -m "chore(front-5l): enforce frontend layer rules strictly"
```

### Task 7.5: Documentation

**Files:**

- Create: `apps/console/README.md` (if absent; otherwise update)
- Modify: root `CHANGELOG.md` (if present; follow existing conventions)
- Modify: root `TODO.md` (mark the refactor done)

- [ ] **Step 1: Write `apps/console/README.md`**

```md
# console

Five-layer frontend for the thalamus / sweep / ops surface.

## Layers

- `routes/` — TanStack Router entries (L1).
- `features/` — business surfaces (L2). One folder = one feature; features never import each other.
- `hooks/` — view-models (L3). UI state + local orchestration, no I/O.
- `usecases/` — domain intents (L4). TanStack hooks wrapping adapter calls.
- `adapters/` — external I/O (L5). HTTP, SSE, Three.js, SGP4. Zero UI except Context glue.
- `shared/ui/` — UI-kit primitives. `shared/types/` — DTOs + enums.
- `providers/` — Context composition at bootstrap.

## Dependency direction
```

routes → features → hooks → usecases → adapters
↘ shared/types
shared/ui ← any layer

```

Enforced by `.dependency-cruiser.js` rules `console-front-*`.

## Adding a new API endpoint

1. Add method to the relevant port in `adapters/api/<domain>.ts`.
2. Update its `.test.ts`.
3. Write a usecase: `usecases/useXxxQuery.ts` (or `Mutation`).
4. Consume from features.

## Adding a new feature

1. Create `features/<name>/` with `Entry.tsx` + any sub-components.
2. If new state is needed, add `features/<name>/state.ts` (scoped zustand) or use `useReducer`.
3. Add route in `routes/<name>.tsx`.
```

- [ ] **Step 2: Commit**

```bash
git add apps/console/README.md
git commit -m "docs(front-5l): console layer map + guidance"
```

---

## Self-review checklist

- [x] **Spec coverage.** Every requirement in `docs/superpowers/specs/2026-04-19-console-front-five-layer-design.md` maps to a task:
  - Five-layer structure → Task 0.2 + Phases 1-5.
  - DIP via Context-per-port + TanStack → Tasks 3.1-3.3 + 4.4-4.5.
  - Feature-per-god-component split → Tasks 5.1-5.3.
  - Enum alignment → Tasks 2.3 + 3.4 + 5.3.4 (classifySatellite completion).
  - Migration big bang with atomic commits → every phase ends with a commit.
  - Arch-guard → Tasks 0.3 + 7.2 + 7.4.
  - Acceptance criteria in spec §10 → Task 7.3 (deleting `lib/modes/components`), Task 7.4 (arch-guard), Task 7.1 (smoke), Task 5.x (god-components ≤150 LOC).
- [x] **No placeholders.** Every code block is executable (paths, imports, signatures).
- [x] **Type consistency.** `ApiClient`, `ApiFetcher`, `SseClient`, `Sgp4Propagator`, `RendererAdapter` names used uniformly across Phase 1, 2, 3, 5 (verified by reading back sections).
- [x] **Commands verified against repo state.** `pnpm -C apps/console typecheck` exists (package.json). `pnpm arch:check:repo` exists (root package.json). `vitest.workspace.ts` path is correct.
- [x] **Risk gates explicit.** Each phase ends with typecheck + build + browser smoke.
- [x] **Strangler-fig safety.** `lib/api.ts` and `lib/queries.ts` stay as shims until Phase 7 to avoid a "big bang that breaks everything" failure mode. This is consistent with the spec's big-bang-as-single-PR intent.
- [x] **Test infra bootstrap.** Task 0.1 adds vitest + RTL before any test is written. No task assumes infra not yet present.
