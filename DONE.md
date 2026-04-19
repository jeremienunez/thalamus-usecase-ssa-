# DONE

Items verified as fully implemented. Audited 2026-04-19 against the live tree.

Sister files: [TODO.md](TODO.md) (open), [TO-REVIEW.md](TO-REVIEW.md) (partial).

---

## Console front 5-layer — 2026-04-19

`apps/console/src/**` refactored to a 5-layer architecture on
`feature/console-front-5l` (15 commits, all pre-commit gates green).
Mirrors the backend layering vocabulary with React-idiomatic names.
Full write-up in `CHANGELOG.md` top entry "Console front 5-layer
architecture". Spec: `docs/superpowers/specs/2026-04-19-console-front-five-layer-design.md`.
Plan: `docs/superpowers/plans/2026-04-19-console-front-five-layer.md`.

- [x] **Phase 0** — vitest + `@testing-library/react` + jsdom infra;
      `apps/console/vitest.config.ts` registered in workspace; 5-layer
      folder scaffold; 6 dep-cruiser rules staged (4 error-level + 2 info).
- [x] **Phase 1** — 9 domain API adapters (satellites, conjunctions, kg,
      findings, stats, cycles, sweep, mission, autonomy) on top of
      `ApiFetcher` port + fetch impl; `createApiClient()` aggregate
      factory; 18 adapter tests.
- [x] **Phase 2** — SSE adapter (`SseClient` + REPL stream parser moved
      from `lib/repl-stream.ts`); renderer adapter (textures + palette
      extracted from `SatelliteField`); propagator adapter (SGP4 + Kepler
      moved from `lib/orbit.ts`); `shared/types/satellite-classification`
      table-driven (replaces 40-entry `startsWith` chain).
- [x] **Phase 3** — 4 React Contexts (`ApiClientContext`,
      `SseClientContext`, `RendererContext`, `PropagatorContext`) + 2
      test scenarios per; `AppProviders` cascade + `buildDefaultAdapters()`
      bootstrap factory; `shared/types/entity-id` single-source-of-truth
      `entityKind()`.
- [x] **Phase 4** — 10 UI primitives moved to `shared/ui/` + barrel;
      generic hooks to `hooks/`; `lib/queries.ts` dissolved into 16
      `usecases/*.ts` consuming `useApiClient()` via Context; `main.tsx`
      wraps router with `AppProviders`.
- [x] **Phase 5** — god-components relocated to `features/*`:
      `ThalamusMode` (763 LOC) → `features/thalamus/Entry`, `OpsMode` + `SatelliteField` + 11 siblings → `features/ops/*`, sweep 6 files
      → `features/sweep/*`, repl → `features/repl/*`, autonomy/config
      → own features. Routes rewired. SweepEntry RTL (3 scenarios) +
      ThalamusEntry smoke.
- [x] **Phase 6** — scoped `uiStore` in `shared/ui/` (rail + drawer are
      the only genuinely cross-feature UI state); bootstrap wiring
      verified.
- [x] **Phase 7** — `lib/` folder deleted (4 shims + 8 utility files
      redistributed); `modes/` and `components/` folders gone;
      dep-cruiser rules flipped to `error` severity;
      `apps/console/README.md` written (layer map + how-to-add guides +
      skill reference).

**Skill** — `~/.claude/skills/coding-feature-vertical-slice/SKILL.md`
landed as the frontend sibling of `coding-route-vertical-slice` (13-step
vertical slice). Auto-memory pointer in
`~/.claude/projects/-home-jerem-interview-thalamus-sweep/memory/`.

**Tests**: 48 passing across 17 files. Zero dep-cruiser violations (666
modules, 2094 edges). Build clean.

## Runtime config registry + 4 LLM providers — 2026-04-19

Previously tracked under TODO "Runtime config registry + admin UI";
phases 1-7 shipped. Remaining knobs tracked in TODO under the same
heading.

- [x] Phase 1 — `RuntimeConfigService` refactored to registry pattern
      (OCP). Schemas no longer live in the service — each package ships
      its own registrar.
- [x] Phase 2 — 6 new domains declared (`thalamus.{planner,cortex,reflexion}`,
      `sim.{swarm,fish,embedding}`).
- [x] Phase 3 — all 4 LLM providers (Local, Kimi, MiniMax, OpenAI) read
      `LlmProviderCallOpts` overrides + honour `preferredProvider` chain
      reordering.
- [x] Phase 4 — MiniMax provider added to the chain.
- [x] Phase 5 — `<think>` leak closed across every provider + `callNano`.
- [x] Phase 6 — Admin `/config` tab with typed field renderers, model
      dropdown with provider auto-sync, left-rail jump-links, scroll
      container.
- [x] Phase 7 — 5 cortex skill `description:` frontmatter rewritten in
      analyst-intent voice so the Kimi planner has a chance to dispatch
      them (Tier 1 of planner-bias fix).

## PG functions pass — 2026-04-19

All 4 steps shipped. Write-up in `CHANGELOG.md` top entry "PG functions:
4 param-drop bugs fixed + conjunction KNN + fleet rollup dedup".

- [x] Step 1 — `ef_search = <ef>` wired into
      `apps/console-api/src/repositories/satellite.repository.ts:114`
      `knnNeighboursForField` (parity with `findKnnCandidates`).
- [x] Step 2 — `packages/db-schema/migrations/0012_orbital_analytics_fns.sql`
      creates `fn_plan_orbit_slots`, `fn_analyze_orbital_traffic`,
      `fn_forecast_debris`, `fn_list_launch_manifest`. Each honest about
      which branches honor `regimeId` via a `branch_filter_applied`
      column. Dead params dropped from Zod + service + repo.
- [x] Step 3 — `packages/db-schema/migrations/0013_conjunction_knn_fn.sql`
      creates `fn_conjunction_candidates_knn` in PL/pgSQL with
      transaction-local `set_config('hnsw.ef_search', …, true)`.
- [x] Step 4 — shared SQL builder
      `apps/console-api/src/repositories/queries/operator-fleet-rollup.ts`
      backs both `FleetAnalysisRepository.analyzeOperatorFleet` and
      `SatelliteFleetRepository.getOperatorFleetSnapshot`. Unified mix
      shape: `Array<{key, count}>` sorted desc, top-5. Dropped dead
      `userId` param.

---

## Sweep agnostic refactor — Plan 1 — 2026-04-18

23 tasks / 7 phases shipped on `refactor/sim-agnostic`. `packages/sweep/` is now a generic sweep/finding engine; all SSA business logic lives in `apps/console-api/src/agent/ssa/sweep/` + console-api's 5-layer stack.

- [x] **Phase 0** — 6 ports in `packages/sweep/src/ports/`, arch-guard skeleton, `BuildSweepOpts.ports?` widened.
- [x] **Phase 1** — SSA pack impls in `apps/console-api/src/agent/ssa/sweep/` (finding-schema, promotion, 5 resolution handlers, audit provider, finding-routing, doctrine-parser, 6 ingesters + provider).
- [x] **Phase 2** — kernel façades: SweepRepository dual API, NanoSweepService.sweep delegates to DomainAuditProvider, SweepResolutionService.resolve delegates to ResolutionHandlerRegistry + SweepPromotionAdapter, IngestionRegistry accepts providers[], FindingRouterService.
- [x] **Phase 3** — console-api wires all 6 ports through buildSweepContainer.
- [x] **Phase 4** — folded 4 audit queries from sweep's SatelliteRepository into console-api's SatelliteRepository; SSA pack rewired.
- [x] **Phase 5** — moved satellite-sweep-chat stack (5 files) + viz stub + satellite-ephemeris.service to console-api.
- [x] **Phase 6** — deleted dead AdminSweepController + admin.routes + stripped sweep index.ts.
- [x] **Phase 7** — arch-guard green (with Plan 2 allowlist), CHANGELOG + TODO updated.

**Full test count**: 652 passing · 23 todo · 0 skipped · 0 failing.

## Sim agnostic refactor — Plan 2 — 2026-04-18 (B.1–B.11 shipped)

- [x] **Scaffolding** — 10 port stubs + SSA sim pack dirs + sim arch-guard.
- [x] **B.1** SimFleetProvider.
- [x] **B.2** SimTurnTargetProvider.
- [x] **B.3** SimAgentPersonaComposer.
- [x] **B.4** SimPromptComposer + SimCortexSelector.
- [x] **B.5** SimActionSchemaProvider.
- [x] **B.6** SimPerturbationPack.
- [x] **B.8** SimAggregationStrategy.
- [x] **B.9** SimKindGuard.
- [x] **B.10** Moved telemetry-swarm + pc-swarm + pc-aggregator + bus-datasheets to console-api SSA pack.
- [x] **B.11** Sim ports required; 7 legacy adapters deleted.

**Newly verified (2026-04-19):**

- [x] `aggregator-telemetry.ts` moved — evidence: `apps/console-api/src/agent/ssa/sim/aggregators/telemetry.ts` exists; source gone from kernel.
- [x] `god-channel.service.ts` moved + `legacy-ssa-schema.ts` + `legacy-ssa-perturbation-pack.ts` deleted — evidence: `apps/console-api/src/services/sim-god-channel.service.ts` present; kernel files absent.

## Thalamus deep audit — 2026-04-17

- [x] Bug #1 — all findings attributed to `plan.nodes[0]`. Fix: `sourceCortex` field stamped in `normalizeFinding`, read by `findingCortex()`. Migration re-tagged 286 historical rows.
- [x] Bug #2 — user-scoped cortices burning DAG slots when no user. Fix: `stripUserScoped()` + `hasUser` threading.
- [x] Bug #3 L1 — silent cortices invisible. Fix: `buildDataGapFinding()` emits `Anomaly` meta-finding when LLM returns 0 from non-empty data.
- [x] Bug #4 — runaway iterations. Coverage metric reads `sourceCortex`; gap-plateau circuit-breaker added.

## Thalamus reliability sweep #2 — 2026-04-17

- [x] Bug #5 — `listLaunchManifest` horizon param never used in SQL + wrong ORDER BY.
- [x] Bug #6 — `listLaunchManifest` UNION column-count mismatch after ITU ingester.
- [x] Bug #7 — planner param-name mismatch. Added `pickNumber()` alias resolver at cortex-data-provider.
- [x] Bug #8 — `findByCycleId(N)` missed re-emissions. Fix: new `research_cycle_finding` junction (migration 0011).
- [x] Bug #9 — semantic dedup collapsed per-launch findings. Fix: skip dedup on entityId=0; require matching findingType.
- [x] Bug #10 — `maxFindings: 5` hardcoded. Now `clamp(authoritativeData.length, 5, 30)`.
- [x] Bug #11 — `repl-chat.service.ts` sliced cycle findings at 8. Bumped to 25.
- [x] Bug #12 — StandardStrategy merged SQL + web-search. Fix: two-tier payload AUTHORITATIVE/WEB CONTEXT.
- [x] Bug #13 — LLM hallucinated mission names. Added MISSION NAME FIDELITY + OPERATOR VS CUSTOMER clauses.
- [x] Bug #14 — NUMERIC FIDELITY rule extended to temporal projections.

## Phase 1 — L2 skill rewrites

- [x] launch-scout.md — one-per-row pattern, confidence tiers.
- [x] debris-forecaster.md — density 0.7, paper/news lower-tier, empty sentinel 0.7.
- [x] apogee-tracker.md — satellite snapshot 0.7, slope-based rules.
- [x] Verified end-to-end: cycle 299 produced 15 findings vs 0 in cycle 298.

## Phase 2 — L3 ingestion worker harness

- [x] `ingestionQueue` + `ingestionQueueEvents` added.
- [x] `ingestion.worker.ts` dispatcher.
- [x] `IngestionRegistry` + `createIngestionRegistry()`.
- [x] `schedulers.ts` extended with `ingestion-noop` cron.
- [x] Worker booted from `container.ts`; `IngestionService` exposed.
- [x] `routes/ingestion.routes.ts` — `POST /api/ingestion/run/:jobName` + `GET /api/ingestion/jobs`.
- [x] Verified: `GET /api/ingestion/jobs` → `{"jobs":["noop"]}`; `POST /api/ingestion/run/noop` → enqueue + 2 ms worker.

## Phase 3 — L3 ingesters (3a–3f all shipped)

- [x] **3a** TLE history time-series — `tle_history` table (migration 0005), 40 CelesTrak GP groups every 6 h, 2369 TLEs on first run.
- [x] **3b** Space weather — NOAA SWPC + GFZ Potsdam + SIDC/STCE into `space_weather_forecast` table (migration 0006), 59 rows first fetch.
- [x] **3c** Launch manifest enrichment — Launch Library 2 every 12 h, 100 launches from 9 countries on first fetch.
- [x] **3d** NOTAMs — FAA TFR every 6 h, 90 TFRs ingested on first run.
- [x] **3e** Fragmentation events — curated seed of 20 major events, 4 operator countries.
- [x] **3f** ITU filings — curated seed of 15 mega-constellations, 416,150 total planned sats.

## Extraction

- [x] pnpm workspace + 4 packages (shared, db-schema, thalamus, sweep).
- [x] Extracted shared (utils, types, enums, normalizers, observability).
- [x] Extracted db-schema (Drizzle + query helpers).
- [x] Extracted thalamus (cortices, orchestrator, explorer/nano-swarm, 20 skills).
- [x] Extracted sweep (nano-sweep, resolution, editorial copilot, admin routes).
- [x] Rewrote imports to `@interview/*`.
- [x] Stubbed downstream services.
- [x] Stubbed Redis, auth, messaging, DI infra.
- [x] Trimmed admin routes to sweep-only.
- [x] Trimmed BullMQ queues/schedulers to sweep-only.
- [x] Sanitized client-specific identifiers.
- [x] README with CortAIx + Threat Intel transposition.

## Spec-first workflow

- [x] LaTeX scaffolding (preamble, template, Makefile).
- [x] Custom envs + Given/When/Then/And macros.
- [x] 24 retroactive specs written by 10 parallel opus agents.
- [x] Preamble compilation fixes.
- [x] All 24 PDFs compile.

## console-api 5-layer refactor — done 2026-04-16

- [x] Decompose `server.ts` 2001 → 61 lines — routes/controllers/services/repositories/types/utils/prompts.
- [x] Hoist shared DTO helpers to `packages/shared/src/ssa/`.
- [x] Tighten repository id signatures to `bigint`.
- [x] `StatsService.snapshot` parallelises 3 count queries.
- [x] Composition root in `container.ts` (134 lines).
- [x] vitest workspace picks up `packages/*/src/**/*.test.ts`.
- [x] All 4 integration specs green. Final: 385 passed / 23 todo.
- [x] Transformers layer — 5 modules, 51 new pure-function tests.

## Domain pivot to SSA — done 2026-04-13

- [x] Rename schema (wine.ts → satellite.ts).
- [x] Rewrite 22 cortex skill prompts.
- [x] Rename sql-helpers + 7 source fetchers.
- [x] Orchestrator: cortex registry, executor, guardrails, dynamic SQL_HELPER_MAP, 30 SSA RSS feeds.
- [x] Thalamus services/utils/explorer rewritten.
- [x] Sweep package: wine* → satellite*; editorial → briefing; cdc → doctrine.
- [x] `grape-profile.schema.ts` → `payload-profile.schema.ts`.
- [x] Removed 3 compat shims.
- [x] Zero wine/grape/vintage/appellation/terroir references remain.

## Priority 1 — CLI foundation — DONE 2026-04-14

Shipped as `@interview/cli` via 22-task TDD plan. 46 specs green.

- [x] `pnpm run ssa` entrypoint — two-lane router.
- [x] Commands: query, telemetry, logs, graph, accept, explain.
- [x] Source-class color bar + confidence sparkline + cost dial + rolling ETA.
- [x] Animated emoji logs + ASCII satellite loader.
- [x] 6 renderers.
- [x] Memory buffer + palace (`sim_agent_memory` HNSW).
- [x] `analyst_briefing` + `interpreter` cortex skills.
- [x] E2E happy-path test.

## Priority 4 — Debris ingestion — DONE 2026-04-15

504 payloads → **33,564 objects**. Voyage embeddings + HNSW cosine index. KNN-based conjunction candidate cortex wired.

- [x] `satellite.object_class` text + CHECK constraint.
- [x] `seed/populate-space-catalog.ts` — CelesTrak SATCAT ingestion.
- [x] `seed/enrich-gcat.ts` — 20.5k mass + 20.2k bus backfilled.
- [x] `seed/screen-broadphase.ts` — 542 M pairs → 145 M in 32 s.
- [x] `seed/screen-narrow-phase.ts` — SGP4 + Foster-1992 Pc.
- [x] `seed/embed-catalog.ts` — 33,564 objects in 3 m 39 s ($0.08).
- [x] `thalamus/cortices/queries/conjunction-candidates.ts` + skill — auto-discovered (28 skills).
- [x] CLI `/candidates <norad>` — 55/55 tests green.

## Priority 6 — OPS globe — done 2026-04-16

- [x] `packages/shared/src/ssa/conjunction-view.ts` — Zod schema + helpers.
- [x] `GET /api/conjunctions` joins satellite rows, derives regime/covarianceQuality/action.
- [x] `conjunctions.spec.ts` — integration test.
- [x] `apps/console/src/lib/orbit.ts` — `orbitRing(s, n=128)` sampler.
- [x] `OrbitTrails.tsx` — hybrid renderer.
- [x] `ConjunctionMarkers.tsx` — severity sprites + info card portal.
- [x] Hover wiring in `ConjunctionArcs.tsx`.
- [x] `apps/` unignored.

## Priority 5 — Enrichment pipeline + KG bridge — done 2026-04-16

### Sweep mission — hardened

- [x] Structured-outputs JSON schema on gpt-5.4-nano `/v1/responses`.
- [x] Hedging-token post-hoc blocklist.
- [x] Source validation against `web_search` URL list.
- [x] Range guards per column.
- [x] Unit mismatch check.
- [x] 2-vote corroboration ±10 %.
- [x] `object_class='payload'` filter.
- [x] Per-satellite granularity.

### KNN propagation — zero-LLM

- [x] `POST /api/sweep/mission/knn-propagate`.
- [x] Consensus rule: numeric median ±10 %, text mode ≥⅔.
- [x] Range guards on neighbour values.
- [x] UI: LAUNCH FISH MISSION button.

### Enrichment findings — KG bridge

- [x] `emitEnrichmentFinding()` from both fill paths.
- [x] `research_edge` rows (about + similar_to).
- [x] Feedback loop: enrichment push to `sweep:feedback`.
- [x] Lazy long-running cycle persists findings.
- [x] Every PG param cast explicitly.

### Orbital reflexion pass

- [x] `POST /api/sweep/reflexion-pass` — 2 SQL cross-tabs.
- [x] MIL-lineage name-match.
- [x] Emits anomaly finding with urgency=high when MIL-peers ≥ 1.
- [x] Live verified on FENGYUN 3A.

### Autonomy controller

- [x] `POST /api/autonomy/start|stop|status`.
- [x] UI topbar AUTONOMY pill + FEED panel.
- [x] Briefing mode dropped from rotation.

### Catalog gap-fill — heuristic

- [x] `seed/fill-catalog-gaps.ts` — 500/504 regime, 504/504 tier, 504/504 experimental.

### REPL chat → real Thalamus dispatch

- [x] `/api/repl/chat` classifier dispatches Thalamus on cycle intent.
- [x] Command palette bare text falls through to REPL chat.

### Tests — 13/13 integration specs green

- [x] `sweep-mission.spec.ts` (6).
- [x] `knn-propagation.spec.ts` (5).
- [x] `enrichment-findings.spec.ts` (1).
- [x] `sweep:index:pending` snapshot/restore isolation.

## Multi-agent simulation swarm — Phases 1–7

Newly verified (2026-04-19): `packages/db-schema/src/schema/sim.ts` has sim_swarm/sim_run/sim_agent/sim_turn/sim_agent_memory tables; routes + services + swarms + aggregators shipped; `swarm-uc3.e2e.spec.ts` exists.

- [x] Phase 1 — DB schema.
- [x] Phase 2 — Types, Zod schemas, agent-builder, memory service.
- [x] Phase 3 — Shared `sim_operator_agent` cortex + DAG + Sequential drivers.
- [x] Phase 4 — Per-fish orchestrator.
- [x] Phase 4.5 — Swarm service + perturbation generators + aggregator + quorum.
- [x] Phase 5 — `sim_reporter` + `sim_swarm_reporter` skills + promotion to suggestion.
- [x] Phase 6 — Auto-spawn from conjunction findings, `/admin/swarm/*` routes, chat scope.
- [x] Phase 7 — Demos `swarm-uc3.ts` / `swarm-uc1.ts` + Makefile + fixtures.

## Pre-commit + CI — native hook

- [x] `.githooks/pre-commit` — blocks `.env*` staged → typecheck → spec:check → test. Installed via `pnpm hooks:install`.

## Build cleanup

- [x] Added `packages/sweep/package.json` + `tsconfig.json`.
- [x] `pnpm -r typecheck` passes on 7 workspace projects.
- [x] Drizzle `using/op` index resolved via raw SQL migration (0001_hnsw_index.sql, 0002_embedding_2048.sql).
- [x] **(2026-04-19)** Removed unused `csv-reader.ts` / `pdf-table-reader.ts` from shared — neither file exists in `packages/shared/src/`.

## Docs (base set)

- [x] README.md — system overview + CortAIx framing + Threat Intel transposition.
- [x] TODO.md maintained.
- [x] CHANGELOG.md — extraction history.
- [x] `docs/specs/` — 24 LaTeX specs.

## Strategic tests — shared (verified 2026-04-19)

- [x] `tryAsync` tuple semantics.
- [x] `AppError` hierarchy + structured-cause serialization.
- [x] Domain normalizers — edge cases.
- [x] `completeness-scorer` adaptive weight normalization.

Evidence: all four specs in `packages/shared/tests/`.

## Spec tests — shared / db-schema / thalamus (verified 2026-04-19)

### shared

- [x] `tests/try-async.spec.ts` — SPEC-SH-001.
- [x] `tests/app-error.spec.ts` — SPEC-SH-002.
- [x] `tests/completeness-scorer.spec.ts` — SPEC-SH-003.
- [x] `tests/domain-normalizer.spec.ts` — SPEC-SH-004.
- [x] `tests/logger.spec.ts` + `tests/metrics.spec.ts` — SPEC-SH-005.

### db-schema

- [x] `tests/schema-contract.spec.ts` — SPEC-DB-001.
- [x] `tests/typed-repos.spec.ts` — SPEC-DB-002.

### thalamus

- [x] `tests/orchestrator.spec.ts` — SPEC-TH-001.
- [x] `tests/cortex-registry.spec.ts` — SPEC-TH-002.
- [x] `tests/cortex-pattern.spec.ts` — SPEC-TH-003.
- [x] `tests/nano-swarm.spec.ts` — SPEC-TH-010.
- [x] `tests/source-fetchers.spec.ts` — SPEC-TH-011.
- [x] `tests/curator.spec.ts` — SPEC-TH-012.
- [x] `tests/guardrails.spec.ts` — SPEC-TH-020.
- [x] `tests/knowledge-graph-write.spec.ts` — SPEC-TH-030.
- [x] `tests/skills-as-files.spec.ts` — SPEC-TH-031.
- [x] `tests/dual-stream-confidence.spec.ts` — SPEC-TH-040.
- [x] `tests/field-correlation.spec.ts` — SPEC-TH-041.
