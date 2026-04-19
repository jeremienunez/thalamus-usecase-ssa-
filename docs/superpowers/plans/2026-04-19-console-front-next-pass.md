# Console front — next pass: structural splits + perf

> **Followup after session-4 SOLID compression.** 6 monoliths shrunk 38%;
> 4 files still >300 LOC + 1.6MB bundle not yet split. This plan captures
> the remaining surgical work + the perf wins discovered during the audit.
>
> Target branch: `feature/console-front-next-pass`.
> Risk gate per task: `pnpm -C apps/console typecheck` + `vitest` + `build`
>
> - `pnpm arch:check:repo` all green.

---

## 1. Current state — top files after session 4

| File                               | LOC | Concern                                                                                 |
| ---------------------------------- | --: | --------------------------------------------------------------------------------------- |
| `features/ops/SatelliteField.tsx`  | 378 | 10 InstancedMesh refs + `viewData` mega-useMemo + useFrame loop + class dispatch inline |
| `features/ops/Entry.tsx`           | 377 | Scene composition + 7 MetricTiles JSX + speed controls + bottom bar inline              |
| `features/thalamus/FindingReadout` | 367 | 8 local sub-components (Chrome/Body/CortexBand/TitleBlock/Section/…)                    |
| `features/thalamus/Entry.tsx`      | 367 | ClassLegend + layoutByClass + drawer routing still inline                               |
| `features/ops/OrbitTrails.tsx`     | 258 | OK                                                                                      |
| `features/sweep/Suggestions.tsx`   | 240 | OK (mission controls + list — one concern)                                              |

Anything ≤250 LOC stays as-is (coherent single-concern units).

---

## 2. Perf findings (from the audit)

Ordered by ROI, high → low.

### P1. Single 1.6MB bundle, no code-split per route

- Every mode's heavy deps (`three` + 4 `@react-three/*`, `sigma` +
  `graphology` + FA2, `satellite.js`) ship in one chunk.
- OPS-only 3D and THALAMUS-only graph libs load even on `/sweep` or
  `/config`.
- **Fix**: `vite.config.ts` → `build.rollupOptions.output.manualChunks`
  with 3 buckets (`vendor-3d`, `vendor-graph`, `vendor-core`) + lazy
  TanStack Router routes for ops/thalamus.

### P2. `SatelliteField.viewData` useMemo deps likely invalidated every render

- `viewData` (L72-119) creates **2 textures + 4 PhysicalMaterials + 11
  geometries** in `useMemo(… , [])` — deps are empty today ✓ but the
  `renderer` context value is read inside; if the `renderer` Context
  value ever changes identity (default adapter rebuilt), every material
  leaks.
- **Fix**: hoist `defaultRendererAdapter` is already frozen in
  `AppProviders` ✓, but the memo should still carry `renderer` in its
  deps array or pull texture factories via stable function references.
  Low urgency, but a trap.

### P3. `SatelliteField.floatingIds` setState every 5 s re-renders entire 378-LOC component

- `setFloatingIds` in a `setInterval` triggers a full render of the
  field — per-frame `useFrame` loop survives (it reads refs) but every
  `useMemo` re-evaluates.
- **Fix**: move `floatingIds` to a ref + `useFrame`-gated dirty flag, or
  split the label overlay into a sibling that owns the interval.

### P4. SGP4 `satrecByLine1` cache unbounded (`adapters/propagator/sgp4.ts:121`)

- Grows monotonically. At 20k TLEs × ~400 bytes ≈ 8 MB leaked after one
  full catalog refresh, growing every week.
- **Fix**: `lru-cache` (~1KB gzip) with capacity 10 000.

### P5. `SatelliteField.bodyMeshes` colour update runs on every `satellites` prop identity change

- `useEffect([satellites])` walks 5 meshes × N satellites (L141-157).
- Callers pass `satellites` from `useSatellitesQuery().data.items` — a
  new array reference on every refetch even if content is identical
  (30s staleTime).
- **Fix**: deep-compare via memoised array identity, or watch
  `satellites.length + [first,last].id` signatures.

### P6. `SatelliteField` imports `propagateSgp4` directly (L7), bypassing `usePropagator()` Context

- Forbidden-by-depcruise on features via
  `console-front-features-no-raw-propagation`… wait — rule catches
  `satellite.js` import, not a re-export from `@/adapters/propagator/sgp4`.
  So it technically passes. But DIP-wise, the feature should call
  `usePropagator().propagateSgp4` so test-mode can substitute.
- **Fix**: drop the direct import; consume via the Context.

### P7. `LeftRail` / `TopBar` / `CommandPalette` re-render on every route change

- `useRouterState` subscribes to router state; any child using it
  re-renders on navigation even if the rail collapse/clock values
  didn't change.
- **Fix**: `useRouterState({ select: (s) => s.location.pathname })` for
  pathname-only consumers; memo the rail nav list.

### P8. No `React.memo` on pure presentational sub-components

- `CornerBracket`, `MetricTile`, `Section`, `CortexBand`, `PrioritySpike`,
  `ClassLegend` all re-render whenever parent renders.
- **Fix**: `React.memo` with default shallow comparator where props are
  stable primitives. Minor wins individually, matters inside the `useFrame`
  hot path ancestry.

### P9. `useUtcClock` ticks every second → `TopBar` renders every second

- `shared/ui/TopBar.tsx` shows `utc` + `date` from `useUtcClock()`.
  Nothing else in TopBar depends on a 1-Hz tick.
- **Fix**: lift the clock text into a sibling `<ClockDisplay />` inside
  TopBar; TopBar itself stops re-rendering every second.

---

## 3. Plan

8 tasks grouped into 3 phases. Each task is self-contained, verifiable,
and can ship independently.

### Phase A — Bundle split (single biggest user-facing win)

#### Task A.1: `vite.config.ts` manualChunks + lazy routes

**Files:**

- Modify: `apps/console/vite.config.ts`
- Modify: `apps/console/src/routes/{ops,thalamus,sweep,config}.tsx`

**Steps:**

1. Read current `vite.config.ts`; add:
   ```ts
   build: {
     rollupOptions: {
       output: {
         manualChunks: {
           "vendor-3d": ["three", "@react-three/fiber", "@react-three/drei",
                        "@react-three/postprocessing", "postprocessing",
                        "satellite.js"],
           "vendor-graph": ["sigma", "graphology",
                           "graphology-layout-forceatlas2"],
           "vendor-ui": ["@tanstack/react-query", "@tanstack/react-router",
                        "react", "react-dom", "lucide-react", "clsx", "zustand"],
         },
       },
     },
     chunkSizeWarningLimit: 800,
   },
   ```
2. Convert each mode route to a lazy file-route:
   ```tsx
   import { createFileRoute } from "@tanstack/react-router";
   export const Route = createFileRoute("/ops")({
     component: () => import("@/features/ops").then((m) => <m.OpsEntry />),
   });
   ```
   (Or use TanStack's official lazy pattern — `createLazyFileRoute`.)
3. Run `pnpm -C apps/console build` — expect 3 chunks ≤ 600KB each + a
   ~100KB app shell.
4. Manual browser smoke: navigate `/sweep` cold → network panel shows
   `vendor-3d` NOT loaded until `/ops` click.
5. Commit.

**Expected outcome:** first-paint bundle on `/sweep` or `/config` drops
from 1.6MB → ~200KB.

#### Task A.2: Bundle analyser baseline

**Files:**

- Modify: `apps/console/package.json` (add `rollup-plugin-visualizer`)
- Modify: `apps/console/vite.config.ts`

**Steps:**

1. Install: `pnpm -C apps/console add -D rollup-plugin-visualizer`.
2. Wire in vite.config when `ANALYZE=1`:
   ```ts
   import { visualizer } from "rollup-plugin-visualizer";
   // ...
   plugins: [react(), ...(process.env.ANALYZE ? [visualizer({
     filename: ".reports/bundle.html", open: true, gzipSize: true,
     brotliSize: true,
   })] : [])],
   ```
3. Add npm script: `"analyze": "ANALYZE=1 vite build"`.
4. Document in `apps/console/README.md`: "`pnpm analyze` → HTML tree-map
   at `.reports/bundle.html`."
5. Commit.

### Phase B — SatelliteField decomposition + perf

#### Task B.1: Extract `adapters/renderer/satellite-meshes.ts`

**Files:**

- Create: `apps/console/src/adapters/renderer/satellite-meshes.ts`
- Create: `apps/console/src/adapters/renderer/satellite-meshes.test.ts`
- Modify: `features/ops/SatelliteField.tsx`

**Steps:**

1. Move the 10 `InstancedMesh` factory creators + 4 `MeshPhysicalMaterial`
   definitions + 11 geometry definitions from `SatelliteField.viewData`
   into a pure factory function:
   ```ts
   export interface SatelliteMeshSet {
     materials: { chassis; silver; black; panel; halo };
     geometries: {
       goldBox;
       silverCyl;
       blackFlatBox;
       goldCap;
       panelHuge;
       panelSmall;
       panelSingle;
       dish;
       strut;
       longAntenna;
     };
     textures: { goldBump; panel; halo };
   }
   export function buildSatelliteMeshSet(deps: {
     makeGoldBumpTexture: () => THREE.Texture;
     makeSolarPanelTexture: () => THREE.Texture;
     makeHaloTexture: () => THREE.Texture;
   }): SatelliteMeshSet;
   ```
2. Write a unit test asserting every geometry/material/texture is
   present + materials carry expected `roughness`/`metalness` bounds.
3. `SatelliteField.viewData` becomes a one-liner:
   `const meshSet = useMemo(() => buildSatelliteMeshSet(renderer), [renderer]);`
4. Commit.

**Expected LOC:** SatelliteField 378 → ~250.

#### Task B.2: Lift `floatingIds` to a sibling component

**Files:**

- Create: `apps/console/src/features/ops/FloatingLabels.tsx`
- Modify: `features/ops/SatelliteField.tsx`
- Modify: `features/ops/Entry.tsx` (insert `<FloatingLabels />` beside
  `<SatelliteField />`)

**Steps:**

1. Move the `setInterval(5000)` + `floatingIds` state into `FloatingLabels`;
   receive `satellites`, `selectedId`, `labelIds` as props.
2. `SatelliteField` receives `floatingIds` as a prop (read-only) — its
   `labelIdSet` memo stays but the interval lives in the sibling.
3. Verify smoke: floating decorative labels still rotate every 5 s.
4. Commit.

**Expected LOC:** SatelliteField −30; FloatingLabels +60 (net new but
isolated).

#### Task B.3: Use `usePropagator()` in SatelliteField (DIP cleanup)

**Files:**

- Modify: `features/ops/SatelliteField.tsx`

**Steps:**

1. Remove `import { propagateSgp4 } from "@/adapters/propagator/sgp4"`.
2. Add `const { propagateSgp4 } = usePropagator();` at component top.
3. Commit.

### Phase C — Remaining monolith trims + perf polish

#### Task C.1: `features/ops/Entry.tsx` — split into Scene + HUD + BottomBar

**Files:**

- Create: `apps/console/src/features/ops/Scene.tsx`
- Create: `apps/console/src/features/ops/TopHud.tsx`
- Create: `apps/console/src/features/ops/BottomBar.tsx`
- Modify: `features/ops/Entry.tsx`

**Steps:**

1. `Scene.tsx` owns the `<Canvas>` + lighting + `<Globe>` + `<SatelliteField>`
   - `<OrbitTrails>` + `<ConjunctionArcs/Markers>` + `<CameraFocus>` +
     `<PostFx>`. Props: `{ satellites, conjunctions, timeScale, selectedId,
onSelect, … }`.
2. `TopHud.tsx` owns the 7 MetricTiles + threat board + clock.
3. `BottomBar.tsx` owns speed controls + pause/play.
4. Entry becomes the glue: hooks + data fetching + composition.
5. Run SweepEntry RTL + Ops manual smoke.
6. Commit.

**Expected LOC:** Entry 377 → ~150.

#### Task C.2: `features/thalamus/Entry.tsx` — extract `useThalamusStats` + `Hud`

**Files:**

- Create: `apps/console/src/hooks/useThalamusStats.ts`
- Create: `apps/console/src/features/thalamus/Hud.tsx`
- Modify: `features/thalamus/Entry.tsx`

**Steps:**

1. Move `layoutByClass`, `truncateLabel`, `GHOST_CLASS_FOR` into the
   graph adapter (they belong with graph-builder) or a new
   `adapters/graph/ghost-nodes.ts`.
2. `useThalamusStats(data)` hook returns `{ classCount, topHubs,
relationSummary }` as a memo.
3. `Hud.tsx` renders the stats panel + ClassLegend.
4. Entry stays as: fetch → graph adapter → drawer routing.
5. Commit.

**Expected LOC:** Entry 367 → ~200.

#### Task C.3: `features/thalamus/FindingReadout.tsx` — extract subfolder

**Files:**

- Create: `apps/console/src/features/thalamus/readout/` directory
- Move: 8 sub-components into separate files
- Modify: `FindingReadout.tsx` (orchestrator only)

**Steps:**

1. Create `readout/` with `ReadoutChrome.tsx`, `ReadoutBody.tsx`,
   `CortexBand.tsx`, `TitleBlock.tsx`, `PrioritySpike.tsx`, `Section.tsx`,
   `EmptyState.tsx`, `LoadingState.tsx`, `ErrorState.tsx`.
2. `FindingReadout.tsx` imports and composes.
3. Each sub-component gets `React.memo` default export.
4. Commit.

**Expected LOC:** FindingReadout 367 → ~120 orchestrator + 9 small files
averaging 30-50 LOC each.

#### Task C.4: `React.memo` pass on presentational sub-components

**Files:**

- Modify: `shared/ui/{HudPanel,MetricTile,AnimatedStepBadge}.tsx`
- Modify: `features/thalamus/{ClassLegend,Hud}.tsx` (after C.2)
- Modify: Any `CornerBracket`-type helper

**Steps:**

1. Wrap each pure presentational component with `React.memo(Component)`.
2. Verify no unintended memoization leaks (props must remain stable —
   inline objects/arrays break memo). Audit callers.
3. Commit.

#### Task C.5: `useUtcClock` isolation + scoped router selectors

**Files:**

- Modify: `shared/ui/TopBar.tsx`
- Modify: `shared/ui/LeftRail.tsx`

**Steps:**

1. Create `<ClockDisplay />` subcomponent in TopBar owning `useUtcClock()`.
   Rest of TopBar chrome stops subscribing to 1-Hz tick.
2. Both consume `useRouterState({ select: s => s.location.pathname })`
   to avoid full-state subscription.
3. Memo the rail nav list (it's a static constant already — verify).
4. Commit.

### Phase D — Perf cleanup + arch enforcement

#### Task D.1: SGP4 LRU cache

**Files:**

- Modify: `apps/console/src/adapters/propagator/sgp4.ts`
- Modify: `apps/console/src/adapters/propagator/sgp4.test.ts`

**Steps:**

1. `pnpm -C apps/console add lru-cache`.
2. Replace `const satrecByLine1 = new Map(...)` with
   `new LRUCache<string, SatRec | null>({ max: 10_000 })`.
3. Add test asserting eviction after max+1 inserts.
4. Commit.

#### Task D.2: Stabilise `SatelliteField` colour update trigger

**Files:**

- Modify: `features/ops/SatelliteField.tsx`
- Create: `apps/console/src/hooks/useStableArrayRef.ts`

**Steps:**

1. `useStableArrayRef(arr, keyFn)` returns a memoised reference that
   only changes when the content signature (length + boundary ids)
   changes.
2. `SatelliteField.useEffect([satellites])` uses the stable ref.
3. Test coverage: `useStableArrayRef.test.ts` — 3 cases (identity,
   reordered, resized).
4. Commit.

#### Task D.3: Depcruise rule — features cannot import raw `propagateSgp4`

**Files:**

- Modify: `.dependency-cruiser.js`

**Steps:**

1. Extend `console-front-features-no-raw-propagation` to catch imports
   from `@/adapters/propagator/sgp4` at feature level (force the
   Context):
   ```js
   {
     name: "console-front-features-must-use-propagator-context",
     severity: "warn",  // warn first, error after Phase C
     from: { path: "^apps/console/src/features/" },
     to: { path: "^apps/console/src/adapters/propagator/sgp4" },
   }
   ```
2. Run arch:check — expect warnings for any remaining direct imports
   (should be zero after Task B.3).
3. Flip to `error` once zero.
4. Commit.

---

## 4. Sequencing + blast radius

| Task | Blast radius                   | Dependencies  | Complete when                |
| ---- | ------------------------------ | ------------- | ---------------------------- |
| A.1  | All routes — bundle split      | none          | 3 chunks ≤ 600KB each        |
| A.2  | Config only                    | none          | `pnpm analyze` works         |
| B.1  | `SatelliteField`               | none          | new adapter test green       |
| B.2  | `SatelliteField` + `ops/Entry` | B.1           | smoke: labels still rotate   |
| B.3  | `SatelliteField`               | B.1           | no direct sgp4 import        |
| C.1  | `ops/*`                        | B.1, B.2      | Entry ≤ 150 LOC              |
| C.2  | `thalamus/*`                   | none          | Entry ≤ 200 LOC              |
| C.3  | `thalamus/FindingReadout/*`    | none          | Readout ≤ 120 LOC            |
| C.4  | UI primitives + small hooks    | C.1, C.2, C.3 | React.memo all pure FCs      |
| C.5  | `shared/ui/{TopBar,LeftRail}`  | none          | TopBar renders on route only |
| D.1  | `adapters/propagator/`         | none          | LRU test green               |
| D.2  | `SatelliteField`               | B.1           | stable ref test green        |
| D.3  | `.dependency-cruiser.js`       | B.3           | zero violations              |

**Recommended execution order:** A.1 → D.1 → B.1 → B.2 → B.3 → D.2 → D.3
→ C.1 → C.2 → C.3 → C.4 → C.5 → A.2.

A.1 + D.1 first because they're pure wins unblocking everything else
(smaller bundle and bounded memory make every subsequent iteration
cheaper to verify). B._ before C._ because SatelliteField extraction
informs ops/Entry split.

---

## 5. Non-goals

- Rewriting to Next.js / RSC.
- Replacing TanStack Query / Zustand / Sigma.
- Chasing every `React.memo` opportunity — only the ones on the hot
  path (SatelliteField children, TopBar ticking).
- Splitting `features/sweep/Suggestions.tsx` — 240 LOC is coherent
  single-concern (mission controls + suggestion list with review
  mutations); no split until a second consumer emerges.

---

## 6. Expected final LOC (after all tasks)

| File                                   | Before | After |
| -------------------------------------- | -----: | ----: |
| `features/ops/SatelliteField.tsx`      |    378 |  ~220 |
| `features/ops/Entry.tsx`               |    377 |  ~150 |
| `features/thalamus/FindingReadout.tsx` |    367 |  ~120 |
| `features/thalamus/Entry.tsx`          |    367 |  ~200 |

Nine new focused units (`satellite-meshes`, `FloatingLabels`, `Scene`,
`TopHud`, `BottomBar`, `useThalamusStats`, `Hud`, `readout/*`,
`useStableArrayRef`).

## 7. Verification, per phase

- **Phase A**: `pnpm -C apps/console build` + manual browser smoke
  (network panel shows per-route chunks).
- **Phase B + C**: `pnpm -C apps/console exec vitest run` green +
  manual browser smoke (ops scene renders, floating labels rotate,
  thalamus graph renders, finding readout opens on click).
- **Phase D**: `pnpm arch:check:repo` zero violations + unit tests
  for LRU + stable ref.
- **Overall exit**: `pnpm dup:check` clone density ≤ 0.2 %, build
  bundle ≤ 200KB first-paint per route, tests green.
