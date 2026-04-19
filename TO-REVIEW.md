# TO-REVIEW

Partially implemented items — shipped work + what's missing. Audited 2026-04-19.

Sister files: [DONE.md](DONE.md) (complete), [TODO.md](TODO.md) (open).

---

## Console front 5-layer — god-components still large internally

- **Shipped**: 5-layer structure, Context-per-adapter DIP, dep-cruiser strict, 48 tests, README.
- **Internal decomposition deferred** (the real god-component fix):
  - `features/thalamus/Entry.tsx` — 762 LOC, should split into
    `Canvas.tsx` + `Hud.tsx` + `Drawer.tsx` + `Ascii.tsx` +
    `hooks/useThalamusGraph.ts` + `hooks/useThalamusLayout.ts`
    (layoutByClass, synthLabel, ghostClassFor, Sigma init).
  - `features/ops/Entry.tsx` — 462 LOC, should split into `Scene.tsx` +
    `Filters.tsx` + `ThreatBoard.tsx` + `Clock.tsx` + `Search.tsx` +
    `hooks/useOpsTime.ts` + `hooks/useOpsSelection.ts`.
  - `features/ops/SatelliteField.tsx` — 583 LOC, should collapse to
    ≤150 LOC shell composing `adapters/renderer/instanced-sats.ts`
    (InstancedMesh builders), `usePropagator()`, `useRenderer()`.
- **Reason for deferral**: each decomposition is a multi-file refactor
  with high rewrite-risk and no behaviour change; better landed on a
  follow-up branch with per-sub-component RTL coverage added as each
  piece moves out.

## Console front — OpsEntry render smoke not automated

- **Reason**: `@react-three/fiber` + `@react-three/drei` + `@react-three/postprocessing`
  need WebGL contexts jsdom lacks; stubbing every transitive import
  (`useLoader`, `useThree`, `useFrame`, `EffectComposer`, `Canvas`, …) is
  brittle and coupled to internal `r3f` shape.
- **Impact**: golden-path Ops behaviour (3D scene, sats, conjunctions,
  time controls) is only covered by manual browser smoke.
- **Fix options**:
  - Playwright or `@playwright/test` e2e in a real browser (heavy infra).
  - `@react-three/test-renderer` (official r3f test renderer) — drops
    WebGL, gives a React tree we can assert on. Recommended.
  - Lift non-3D Ops chrome (Clock, Filters, Search, ThreatBoard) into
    separate sub-components so they can be RTL-tested even if the Canvas
    stays un-mocked.

## Console front — bundle size 1.6MB (>500KB warning)

- `pnpm -C apps/console build` emits the vite chunk-size warning:
  `dist/assets/index-*.js 1,605.22 kB │ gzip: 449.80 kB`.
- **Suspect heavy deps**: `three` + `@react-three/*` (4 packages), `sigma`
  - `graphology`, `satellite.js`, `@tanstack/react-router`.
- **Fix options** (in order of ROI):
  - `build.rollupOptions.output.manualChunks` splitting the 3D libs (ops
    only) from the thalamus libs (sigma/graphology only) from the base
    app shell → smaller first-paint bundle per route.
  - Dynamic `import()` at route boundaries — TanStack Router supports
    lazy file routes; each mode loads its adapters lazily.
  - Tree-shake `lodash-es` or similar hidden deps (run `pnpm why` on
    large transitive imports).

## Console front — Zustand scoped store consolidation

- **Shipped**: `shared/ui/uiStore.ts` scopes the 2 genuinely shared
  fields (railCollapsed, drawerId).
- **Concern**: `drawerId` is cross-feature (OPS opens `sat:…`, Thalamus
  `finding:…`, Sweep `f:…`). That's navigational coupling. Review:
  - Should the drawer be route-driven instead of store-driven? (Would
    survive back/forward + deep-linking.)
  - Or split per-feature drawers with a small route-level state machine?
- **Impact**: today's behaviour is correct, but the store is a single
  global mutable surface that any feature can reach — violates the
  "features are islands" rule in spirit even though dep-cruiser permits
  it via `shared/ui`.

## Console front — satellite.js propagateSgp4 cache is unbounded

- `adapters/propagator/sgp4.ts:121` — `satrecByLine1 = new Map<string, SatRec | null>()`
  grows monotonically until the tab closes. With tens of thousands of
  satellites each having a fresh TLE every 1-7 days, this leaks over
  long sessions.
- **Fix**: bound with an LRU (small — 10_000 entries is enough; TLE ingest
  ≤ ~1_000/day).

## Console front — FindingReadout + FindingsPanel duplicate concerns

- Relocated from `features/findings/` into `features/thalamus/` and
  `features/ops/` respectively (to satisfy the no-cross-feature rule).
- **Concern**: both render finding data with different layouts — the
  structural drift will only grow. Consider:
  - Extracting a `FindingCard` primitive to `shared/ui/finding/` (it's
    genuinely presentational, safe under `shared/ui`).
  - Keep feature-specific shells (Readout = thalamus-themed,
    Panel = ops-themed) but share the inner payload renderer.
- Not urgent — both files are <150 LOC today.

## REPL auto-followups — backend landed, UI pending

- **Shipped**:
  - `packages/thalamus` returns a generic `verification` block with
    `needsVerification`, `reasonCodes`, `targetHints`, `confidence`
  - `packages/shared` streams generic `followup.*` events
  - `apps/console-api/src/agent/ssa/followup/` owns SSA-specific
    follow-up policy and execution (`30d`, `sim_pc`, `sim_telemetry`,
    `sweep_targeted_audit`)
  - `apps/console-api/src/services/repl-chat.service.ts` emits the
    parent summary first, then `followup.plan`, then any auto-launched
    child streams
- **Missing**:
  - front consumption/rendering of `followup.*`
  - one explicit browser sanity-check recorded in docs
  - broader targeted sweep auto-run beyond the current narrow
    `operator_country` path

## Plan 5 — Sim five-layer integration

Spec: [docs/superpowers/plans/2026-04-18-plan5-sim-five-layer.md](docs/superpowers/plans/2026-04-18-plan5-sim-five-layer.md)

- **Shipped**: Phase A (sim-run / sim-agent / sim-swarm / sim-turn / sim-memory / sim-terminal repos), Phase B (sim.routes.ts with controllers), Phase C (sim-run, sim-swarm, sim-promotion services).
- **Missing**: Phase D kernel slim-down — `packages/sweep/src/sim/promote.ts` still owns SQL + Redis + KG + embeddings + formatting. Phase E worker placement. Phase F cleanup.

## Plan 6 — Sweep five-layer + sim↔sweep boundary

Spec: [docs/superpowers/plans/2026-04-18-plan6-sweep-five-layer.md](docs/superpowers/plans/2026-04-18-plan6-sweep-five-layer.md)

- **Shipped**: `SimPromotionAdapter` port (`packages/sweep/src/sim/ports/promotion.port.ts`), `SimRunRepository`, `SimPromotionService`.
- **Missing**: `ResearchKgRepository`, `SatelliteTelemetryRepository`, `ConfidencePromotionService` — none found by name. `promote.ts` still resident in kernel.

## Plan 3 — CLI → HTTP

- **Shipped**: `POST /api/sim/telemetry/start` + `POST /api/sim/pc/start` (`sim.routes.ts:236,239`).
- **Missing**: `GET /api/kg/graph/:id`, `GET /api/why/:findingId`. `packages/cli/src/boot.ts` still 498 L (target ~80). `buildRealAdapters` still present (`boot.ts:179`). Heavy deps still listed in CLI package.json (@interview/sweep, @interview/thalamus, @interview/db-schema, drizzle, pg, ioredis). No `packages/cli/tests/arch-guard.spec.ts`.

## Strategic tests — thalamus

- **Shipped**: `orchestrator.spec.ts`, `nano-swarm.spec.ts`, `guardrails.spec.ts`.
- **Missing**: dedicated "end-to-end cortex path: query → plan → explore → entity write (LLM mocked)" spec.

## E2E tests — thalamus & sweep

- **Shipped**: `apps/console-api/tests/e2e/` has conjunctions, enrichment-findings, knn-propagation, sweep-mission, swarm-uc3, telemetry-swarm specs.
- **Missing**: specific labelled scenarios "Thalamus: one end-to-end query routed through executor, LLM mocked, graph write verified" and "Sweep: trigger → finding → reviewer accept → DB write + audit row (all in-memory/redis-mock)".

## Priority 2 — Fish quick-wins

- **Shipped**: Conjunction Pc probabilistic estimator (`packages/sweep/src/sim/swarms/pc.ts` + `pc-estimator-agent.md`).
- **Missing** (7 items):
  - Maneuver cost estimator (Pareto front)
  - Why? button (provenance trace via `research_edge` → ASCII tree)
  - Anomaly triage (K fish × 3-5 explanation hypotheses, clustered)
  - Operator posture inference (commercial / institutional / military-like vote)
  - "Dig into" follow-up (scoped micro-swarm from previous finding)
  - Debris decay forecaster (live NOAA F10.7 + altitude)
  - What-if scenario (100 sats SSO → conjunction rate distribution)

## Multi-agent sim swarm — Phase 8

- **Shipped**: `swarm-uc3.e2e.spec.ts` covers the basic end-to-end path.
- **Missing**: individually labelled unit/integration tests for quorum fail-soft, determinism, cross-fish isolation. Final anti-pattern sweep not recorded.
