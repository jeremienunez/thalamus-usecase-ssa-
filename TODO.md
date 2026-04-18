# TODO

Interview-readiness checklist for Thalamus + Sweep — **target interview: CortAIx (Thales AI division)**.

## Sweep agnostic refactor — Plan 1 — 2026-04-18 (done)

23 tasks / 7 phases shipped on `refactor/sim-agnostic`. `packages/sweep/`
is now a generic sweep/finding engine; all SSA business logic lives in
`apps/console-api/src/agent/ssa/sweep/` + console-api's 5-layer stack.

- [x] **Phase 0** — 6 ports in `packages/sweep/src/ports/`, arch-guard
      skeleton, `BuildSweepOpts.ports?` widened.
- [x] **Phase 1** — SSA pack impls in `apps/console-api/src/agent/ssa/sweep/`
      (finding-schema, promotion, 5 resolution handlers, audit provider,
      finding-routing, doctrine-parser, 6 ingesters + provider).
- [x] **Phase 2** — kernel façades: SweepRepository dual API,
      NanoSweepService.sweep delegates to DomainAuditProvider,
      SweepResolutionService.resolve delegates to ResolutionHandlerRegistry + SweepPromotionAdapter, IngestionRegistry accepts providers[],
      FindingRouterService.
- [x] **Phase 3** — console-api wires all 6 ports through buildSweepContainer.
- [x] **Phase 4** — folded 4 audit queries from sweep's SatelliteRepository
      into console-api's SatelliteRepository; SSA pack rewired.
- [x] **Phase 5** — moved satellite-sweep-chat stack (5 files) + viz stub + satellite-ephemeris.service to console-api.
- [x] **Phase 6** — deleted dead AdminSweepController + admin.routes +
      stripped sweep index.ts.
- [x] **Phase 7** — arch-guard green (with Plan 2 allowlist), CHANGELOG +
      TODO updated.

**Full test count**: 652 passing · 23 todo · 0 skipped · 0 failing.
UC3 E2E still runs on the sweep-side legacy fallback (Plan 2 moves it).

## Sim agnostic refactor — Plan 2 — 2026-04-18 (B.1–B.11 shipped · HTTP boundary landed)

Ran on `refactor/sim-agnostic` on top of Plan 1. B.1 → B.11 landed; 7 sim
legacy adapters deleted; 3 extra HTTP ports added (`runtime-store`,
`swarm-store`, `queue`). UC3 E2E injects the 10 SSA sim ports + uses the
HTTP adapters. Sweep kernel still hosts `promote.ts` (592 L) +
`aggregator-telemetry.ts` + `god-channel.service.ts` + their 2 supporting
legacy files — the SRP-heavy sim↔sweep glue. Plan 6 addresses these.

- [x] **Scaffolding** — 10 port stubs + SSA sim pack dirs + sim arch-guard
      (describe.skip until C.1).
- [x] **B.1** SimFleetProvider (narrow `satellite-fleet.repository.ts` +
      `SsaFleetProvider`).
- [x] **B.2** SimTurnTargetProvider (fuse telemetry + pc target loaders).
- [x] **B.3** SimAgentPersonaComposer (lift persona/goals/constraints).
- [x] **B.4** SimPromptComposer + SimCortexSelector.
- [x] **B.5** SimActionSchemaProvider (lift turnActionSchema + all SSA Zod).
- [x] **B.6** SimPerturbationPack (uc1/uc3 generators + GOD_EVENT_TEMPLATES + extractGodEvents).
- [x] **B.8** SimAggregationStrategy (labelAction + clusterFallback).
- [x] **B.9** SimKindGuard (validateLaunch + defaultMaxTurns). Promotion
      half deferred to Plan 6 (tied to promote.ts migration).
- [x] **B.10** Moved telemetry-swarm + pc-swarm + pc-aggregator +
      bus-datasheets to `apps/console-api/src/agent/ssa/sim/`. CLI
      telemetry.start throws Plan-3-TODO until HTTP rewire.
- [x] **B.11** Sim ports required; 7 legacy adapters deleted.

### Remaining debt (handled by Plan 5 + Plan 6)

- [ ] Delete `packages/sweep/src/sim/promote.ts` (move the 7 mixed
      responsibilities to repos/services/transformers/utils). See
      **Plan 6** Phase B + C + D.
- [ ] Move `aggregator-telemetry.ts` to the SSA pack (blocked on promote.ts
      migration).
- [ ] Move `god-channel.service.ts` + delete `legacy-ssa-schema.ts` +
      `legacy-ssa-perturbation-pack.ts` (their consumers).
- [ ] Drop the 5 entries from `PLAN2_DEFERRED_ALLOWLIST` in the arch-guard
      (Plan 6 Phase D).
- [ ] Unskip the sim arch-guard (Plan 2 Task C.1) — currently
      `describe.skip` because promote.ts + aggregator-telemetry + god-channel
      still live in kernel.
- [ ] Clean `packages/sweep/src/sim/types.ts` — remove SSA type references
      (Plan 5 Phase D.5).
- [ ] Consolidate sim source-class promotion through SsaPromotionAdapter
      (Plan 6 Phase C — removes the `simHook.cb` bridge).

### Follow-up — Repository split (post-Plan-2)

Plan 2 B.1 introduces a narrow `satellite-fleet.repository.ts` for sim fleet
snapshots. The existing `apps/console-api/src/repositories/satellite.repository.ts`
(575 lines, ~12 methods) stays untouched during Plan 2 to keep blast radius
small. Split after Plan 2 merges:

- [ ] `satellite-view.repository.ts` ← listWithOrbital, findByIdFull,
      listByOperator, listMissionWindows, findPayloadNamesByIds
- [ ] `satellite-audit.repository.ts` (exists) ← absorb nullScanByColumn,
      findSatelliteIdsWithNullColumn, listNullCandidatesForField,
      discoverNullableScalarColumns
- [ ] `satellite-enrichment.repository.ts` (exists) ← absorb
      knnNeighboursForField, updateField, getOperatorCountrySweepStats
- [ ] Delete the monolithic `satellite.repository.ts` once all callers
      migrate; update container wiring + controllers.
- [ ] Parallel split on `packages/sweep/src/repositories/satellite.repository.ts`
      (the legacy one on PLAN2 allowlist) if still alive post-Plan-2.

Rationale: one SQL responsibility per file; sim (and future domains) can
compose narrow repos without dragging the whole 575-line surface.

### Follow-up — Plan 5 + Plan 6 (5-layer integration; SOLID audit)

Two planning agents drafted detailed migration plans for folding sim + sweep
into console-api's existing 5-layer architecture (routes → controllers →
services → repositories → types/transformers/utils). Current state: sim +
sweep mix responsibilities (promote.ts owns SQL + Redis + KG + embeddings +
formatting; sim-orchestrator mixes service + repo + queue; god-channel
leaks SSA Zod into kernel). Plans audit violations by `file:line` and
propose phased migrations.

- [ ] **Plan 5** — Sim five-layer integration. 6 phases (A: repos; B:
      controllers/routes; C: services; D: kernel slim-down; E: worker
      placement; F: cleanup). Draft:
      [docs/superpowers/plans/2026-04-18-plan5-sim-five-layer.md](docs/superpowers/plans/2026-04-18-plan5-sim-five-layer.md).
- [ ] **Plan 6** — Sweep five-layer + sim↔sweep boundary. 4 phases (A:
      formalize SimPromotionAdapter port; B: ResearchKgRepository +
      SatelliteTelemetryRepository + SimRunRepository; C: SimPromotionService + ConfidencePromotionService; D: delete promote.ts + legacy fallbacks).
      Draft:
      [docs/superpowers/plans/2026-04-18-plan6-sweep-five-layer.md](docs/superpowers/plans/2026-04-18-plan6-sweep-five-layer.md).

### Follow-up — Plan 3 (CLI → HTTP)

- [ ] Add 4 new routes on console-api: `POST /api/sim/telemetry/start`,
      `POST /api/sim/pc/start`, `GET /api/kg/graph/:id`, `GET /api/why/:findingId`.
- [ ] Rewrite `packages/cli/src/adapters/*.ts` as fetch clients.
- [ ] Slim `packages/cli/src/boot.ts` (486 → ~80 lines), drop
      @interview/sweep + @interview/thalamus + @interview/db-schema +
      drizzle + pg + ioredis from CLI package.json.
- [ ] Add `packages/cli/tests/arch-guard.spec.ts` enforcing the HTTP-client
      boundary.

---

## Thalamus deep audit — 2026-04-17 (done)

- [x] Bug #1 — all findings attributed to `plan.nodes[0]`. Fix: `sourceCortex` field stamped in [normalizeFinding](packages/thalamus/src/cortices/strategies/helpers.ts), read by [findingCortex()](packages/thalamus/src/services/finding-persister.service.ts). Migration re-tagged 286 historical rows; backup in `research_finding_cortex_backup_20260417`.
- [x] Bug #2 — user-scoped cortices (`fleet_analyst`, `advisory_radar`) burning DAG slots when no user. Fix: `stripUserScoped()` in [thalamus-planner.service.ts](packages/thalamus/src/services/thalamus-planner.service.ts) + `hasUser` threading through [cycle-loop](packages/thalamus/src/services/cycle-loop.service.ts) and [thalamus.service](packages/thalamus/src/services/thalamus.service.ts).
- [x] Bug #3 L1 — silent cortices invisible. Fix: `buildDataGapFinding()` in [standard-strategy.ts](packages/thalamus/src/cortices/strategies/standard-strategy.ts) emits an `Anomaly` meta-finding (confidence 0.7, above gate) when LLM returns 0 from non-empty data.
- [x] Bug #4 — runaway iterations. Fix A: coverage metric in [stop-criteria.service.ts](packages/thalamus/src/services/stop-criteria.service.ts) now reads `sourceCortex` not `entityType` so eagerness can fire. Fix B: gap-plateau circuit-breaker — 2 identical reflexion gap rounds → force-stop.

## Thalamus reliability sweep #2 — 2026-04-17 afternoon (done)

Audit driven by adversarial queries on `launch_scout` (7-day rideshare / SpaceX-vs-non-SpaceX / China-vs-USA posture). Each query exposed a different layer; compounding they produced briefings that paraphrased DB rows into plausible hallucinations (e.g. "Kakushin Rising" → "rideshare Kiwi", operator Rocket Lab → JAXA, Kuiper density projection → fabricated `×200` factor). 8 distinct structural fixes shipped.

**SQL / data-provider layer:**

- [x] Bug #5 — `listLaunchManifest` horizon param declared but never used in SQL + `ORDER BY planned_net DESC` returned year-end TBD placeholders for "next N days" queries. Fix in [`traffic-forecast.repository.ts`](apps/console-api/src/repositories/traffic-forecast.repository.ts): `AND planned_net BETWEEN now() AND now() + make_interval(days => ${horizonDays})`, `ORDER BY planned_net ASC`.
- [x] Bug #6 — `listLaunchManifest` UNION column-count mismatch after ITU ingester (Phase 3f) added 8 `itu*` columns to 3 branches but not the `'db'` branch → every `queryLaunchManifest` call crashed. Padded with `NULL::*` casts.
- [x] Bug #7 — planner emits param names (`window_days`, `size_max`) the helper signature doesn't accept (`horizonDays`, `limit`) → silent drop + default 30d horizon → "next 7 days" query cites J+10 launches. Added `pickNumber()` alias resolver at [`cortex-data-provider.ts`](apps/console-api/src/agent/ssa/cortex-data-provider.ts) normalising `horizonDays | horizon_days | window_days | windowDays | days | horizon`. Default lowered to 14d.

**Cycle ↔ finding M:N (schema + dedup):**

- [x] Bug #8 — `findByCycleId(N)` returned only findings with `research_cycle_id = N`. Dedup hits kept their origin `cycleId`, so re-emissions were invisible to the summariser — cycle 316 had 12 findings produced but only 5 persisted with cycleId=316. Fix: new junction table [`research_cycle_finding`](packages/db-schema/src/schema/research.ts) (migration 0011, composite PK, 2 indexes, ON DELETE CASCADE). [`research-graph.service.storeFinding`](packages/thalamus/src/services/research-graph.service.ts) calls `linkToCycle()` in all 3 branches (semantic-merge, hash-dedup, fresh insert) via `ON CONFLICT DO NOTHING`. Backfilled 639 historical rows from origin column. `research_finding.research_cycle_id` retained as origin marker.
- [x] Bug #9 — semantic dedup (`cosine ≥ 0.92 AND same primary entity`) collapsed per-launch findings onto thematic aggregates because `entityId=0` (unresolved `external:<uuid>` ref) made the entity filter toothless. Two fixes: (a) skip semantic dedup entirely when `entityId=0`, (b) require matching `findingType` (opportunity never merges onto alert). Hash-dedup key for unanchored findings now includes title snippet to prevent bucket collisions across distinct launches.
- [x] Bug #10 — `maxFindings: 5` hardcoded in [`StandardStrategy`](packages/thalamus/src/cortices/strategies/standard-strategy.ts) silently broke "one finding per DATA row" skill contracts. Now `clamp(authoritativeData.length, 5, 30)`.

**Summariser visibility:**

- [x] Bug #11 — [`repl-chat.service.ts`](apps/console-api/src/services/repl-chat.service.ts) sliced cycle findings at 8 by confidence DESC. Strategist self-rated ≥0.78 (sometimes 1.0) trumped `briefing_producer` findings (conf 0.74, the _actual_ per-query answer) — never reached summariser. Bumped to 25.

**Anti-hallucination (domain config + payload structure):**

- [x] Bug #12 — `StandardStrategy` merged SQL + web-search into single `rawData`; LLM cited J+10 web-search launches as fitting "next 7 days". Fix: two-tier payload, `## AUTHORITATIVE DATA` (SQL + structured sources, scoped by query params) + `## WEB CONTEXT` (advisory only), with explicit instruction to ground findings in AUTHORITATIVE and use WEB only for cross-reference.
- [x] Bug #13 — LLM hallucinated mission names and swapped operator/customer (canonical example: DATA row `missionName="Kakushin Rising (JAXA Rideshare)"`, `operatorName="Rocket Lab"`, `operatorCountry="US"`, launch site Mahia NZ → LLM emitted "rideshare Kiwi, opérateur JAXA, pays Japon"). Added `MISSION NAME FIDELITY` + `OPERATOR VS CUSTOMER` clauses to [`SSA_SOURCING_RULES`](apps/console-api/src/agent/ssa/domain-config.ts) with the exact counter-examples.
- [x] Bug #14 — `NUMERIC FIDELITY` rule covered country/regime ratios but not temporal projections. A post-restart cycle still fabricated _"densité ×200 du LEO 590-630 km"_ for Kuiper/Qianfan with no baseline/target pair in DATA (web-verified against eoPortal / Wikipedia / Deloitte TMT 2026 — no such factor exists). Rule extended to any multiplier/ratio/percentage including temporal projections, with qualitative-language fallback.

**End-to-end validation.** Cycle 320 (post all fixes) for _"SpaceX vs non-SpaceX next 7 days"_: 6 per-row findings, all in horizon, all verbatim. Briefing counts: SpaceX 3 / Rocket Lab 2 / Blue Origin 1 — matches DB ground truth.

**Known minor residuals** (non-blocking, skill-prompt level):

- `HASTE | Bubbles` truncated to `Bubbles` (compound-name paraphrase).
- `externalLaunchId` in evidence but not surfaced in summary text.
- `entityRef` (e.g. `"external:<uuid>"`, `"US"` ISO-2) still unresolved to real `entityId` in [`finding-persister.service.ts`](packages/thalamus/src/services/finding-persister.service.ts) — resolver service deferred to next session. Current workaround: dedup simply skips unanchored findings (Bug #9), which keeps the system honest even without resolution.

## Phase 1 — L2 skill rewrites (done)

- [x] [launch-scout.md](apps/console-api/src/agent/ssa/skills/launch-scout.md) — one-per-row pattern, `kind=db` confidence 0.7, `kind=news` 0.4, empty-DATA sentinel 0.7
- [x] [debris-forecaster.md](apps/console-api/src/agent/ssa/skills/debris-forecaster.md) — density rows 0.7, paper/news lower-tier, empty sentinel 0.7
- [x] [apogee-tracker.md](apps/console-api/src/agent/ssa/skills/apogee-tracker.md) — satellite snapshot 0.7, news lower-tier, snapshot apogee/perigee derived from `meanMotion`/`eccentricity`
- [x] Verified end-to-end: cycle 299 produced 15 findings vs 0 in cycle 298; all 3 silent cortices now contributing.

## Phase 2 — L3 ingestion worker harness (done)

Plan reference: `~/.claude/plans/ok-lets-go-planifie-sparkling-knuth.md` (Phase 2).

- [x] Added `ingestionQueue` + `ingestionQueueEvents` to [packages/sweep/src/jobs/queues.ts](packages/sweep/src/jobs/queues.ts)
- [x] [packages/sweep/src/jobs/workers/ingestion.worker.ts](packages/sweep/src/jobs/workers/ingestion.worker.ts) dispatcher created
- [x] [packages/sweep/src/jobs/ingestion-registry.ts](packages/sweep/src/jobs/ingestion-registry.ts) — `IngestionRegistry` class + `createIngestionRegistry()` with baseline `noop` fetcher
- [x] [schedulers.ts](packages/sweep/src/jobs/schedulers.ts) extended with `ingestion-noop` cron (hourly)
- [x] Worker booted from [container.ts](apps/console-api/src/container.ts) via `createIngestionWorker(registry)`; `IngestionService` exposed in `AppServices`
- [x] [routes/ingestion.routes.ts](apps/console-api/src/routes/ingestion.routes.ts) — `POST /api/ingestion/run/:jobName` + `GET /api/ingestion/jobs`
- [x] Verified: `GET /api/ingestion/jobs` → `{"jobs":["noop"]}`; `POST /api/ingestion/run/noop` → enqueues job, worker processes in 2 ms, `bull:ingestion:completed` populated, hourly scheduler registered (`bull:ingestion:repeat:ingestion-noop`).

## Phase 3 — L3 ingesters (todo, one PR per slice)

- [x] **3a** TLE history time-series — [`tle_history`](packages/db-schema/src/schema/tle-history.ts) table (migration 0005), [`tle-history-fetcher.ts`](packages/sweep/src/jobs/ingesters/tle-history-fetcher.ts) hits 40 CelesTrak GP groups every 6 h (`0 */6 * * *`), [`TleHistoryRepository`](apps/console-api/src/repositories/tle-history.repository.ts), `queryApogeeHistory` extended to union `kind="tle_history"` rows from the new table, apogee-tracker.md tightened with slope-based rules (NOMINAL_DRIFT / ORBIT_RAISING / ORBIT_LOWERING / DECAYING / STATION_KEEPING) at confidence 0.85. Verified: 2369 TLEs ingested on first real run, matched 100% to catalog via top-level `satellite.norad_id`.
- [x] **3b** Space weather — multi-source ([NOAA SWPC 🇺🇸](https://services.swpc.noaa.gov/text/27-day-outlook.txt) + [GFZ Potsdam 🇩🇪](https://kp.gfz.de/app/json/) + [SIDC/STCE 🇧🇪](https://www.sidc.be/SILSO/DATA/EISN/EISN_current.csv)) into [`space_weather_forecast`](packages/db-schema/src/schema/space-weather.ts) table (migration 0006), [`space-weather-fetcher.ts`](packages/sweep/src/jobs/ingesters/space-weather-fetcher.ts) daily cron (`30 4 * * *`), [`SpaceWeatherRepository`](apps/console-api/src/repositories/space-weather.repository.ts). Both `queryDebrisForecast` and `queryApogeeHistory` now union a `kind="weather"` branch exposing F10.7 / Ap / Kp / SSN per source. Skills updated: weather rows are context (drag regime / debris scrub), cited in evidence not standalone findings; cross-source divergence flagged. Verified: 59 rows across 3 sources on first fetch (NOAA 27 forecast days + GFZ 15 Kp samples + SIDC 17 sunspot days).
- [x] **3c** Launch manifest enrichment — [`launch`](packages/db-schema/src/schema/launch.ts) table extended with 14 LL2 columns (externalLaunchId, operatorName, operatorCountry, padName, padLocation, plannedNet/Start/End, status, orbitName, missionName, missionDescription, rideshare, fetchedAt) via migration 0007. [`launch-manifest-fetcher.ts`](packages/sweep/src/jobs/ingesters/launch-manifest-fetcher.ts) hits Launch Library 2 (free worldwide aggregator covering US / CN / RU / IN / EU / JP) every 12 h (`0 */12 * * *`), upserts on `externalLaunchId`, marks dropped rows stale. `queryLaunchManifest` surfaces the enriched columns; [launch-scout.md](apps/console-api/src/agent/ssa/skills/launch-scout.md) emits findings tiered by field completeness (0.8 if vehicle+pad+net populated, 0.7 partial, 0.6 minimal, 0.4 news). Verified: 100 upcoming launches from 9 distinct countries on first fetch (Russia / China / US / Japan / India / France / etc.). `launch_payload` join deferred — LL2 detailed payload requires N+1 fetches; next revision.
- [x] **3d** NOTAMs — [`notam`](packages/db-schema/src/schema/notam.ts) table + [notam-fetcher.ts](packages/sweep/src/jobs/ingesters/notam-fetcher.ts) against FAA TFR public JSON (`tfr.faa.gov/tfrapi/exportTfrList`, no auth). Every 6 h (`15 */6 * * *`). Narrative-regex parses `parsed_start_utc/end_utc`; `is_launch_related` flagged from `type='SPACE OPERATIONS'` + keyword fallback. `queryLaunchManifest` surfaces launch-related NOTAMs as `kind="notam"` rows; [launch-scout.md](apps/console-api/src/agent/ssa/skills/launch-scout.md) cross-references NOTAM state + window against LL2 `padLocation` + `plannedWindow` for +0.05 confidence bump (cap 0.9). Verified: 90 TFRs ingested on first run (3 `SPACE OPERATIONS` correctly flagged, parsed windows valid). Geometry bbox omitted — source only narrates "18NM NORTH OF DILLON, MT" without coordinates. FAA SAA KMZ blocked by session-ticket requirement; TFR API is the working path. Non-US NOTAMs (Eurocontrol / NAV CANADA) deferred — require auth.
- [x] **3e** Fragmentation events — [`fragmentation_event`](packages/db-schema/src/schema/fragmentation-event.ts) table (migration 0009) + [fragmentation-events-fetcher.ts](packages/sweep/src/jobs/ingesters/fragmentation-events-fetcher.ts) — curated seeder (20 major events: Fengyun-1C, Cosmos 1408/2251, Iridium 33, NOAA-16, Long March 6A ×2, Briz-M ×2, Pegasus HAPS, DMSP F13, Kosmos 2421/2491, Ariane V16, Atlas V Centaur, Thor-Agena D, RESURS-O1, Cosmos 1375, NOAA-3, and one DMSP F14 non-event as analog contrast). `queryDebrisForecast` now unions `kind="fragmentation"` rows; [debris-forecaster.md](apps/console-api/src/agent/ssa/skills/debris-forecaster.md) cites Kessler analogs when flagging congested shells. No cron — manual re-run on event-list changes. Verified: 20 events across 4 operator countries (CN / RU / US / FR), split as asat_test (3 · 5361 fragments) / breakup (14 · 4932) / collision (2 · 2296) / anomaly (1 · 0). Future: scrape NASA ODPO Quarterly News PDFs for ongoing additions.
- [x] **3f** ITU filings — [`itu_filing`](packages/db-schema/src/schema/itu-filing.ts) table (migration 0010) + [itu-filings-fetcher.ts](packages/sweep/src/jobs/ingesters/itu-filings-fetcher.ts). **Pivot**: ITU's public SNL/SRS endpoints are HTML-only ASP scrape (SRS web service shut down 2021, SNL list1149 is just suspensions). Curated seed of 15 mega-constellations instead: Starlink Gen2, Kuiper, OneWeb Phase 2, IRIS² (EU), Guowang, Qianfan/G60, Honghu (CN x3), Telesat Lightspeed (CA), Sfera (RU), KPS (KR), NavIC (IN), QZSS-2 (JP), AST SpaceMobile, Cinnamon-937 (RW placeholder), Swarm. `queryLaunchManifest` now unions `kind="itu"` rows; [launch-scout.md](apps/console-api/src/agent/ssa/skills/launch-scout.md) emits `"opportunity"` findings per constellation tiered by status (launching 0.75 / approved 0.65 / filed 0.5) and cross-references `operatorName` between `kind="db"` launches and `kind="itu"` filings to annotate which constellation a specific launch is feeding. Verified: 15 filings, 416,150 total planned sats across 10 countries (RW 337k / CN 37k / US 35k / GB 6k / CA 298 / FR 290 / RU 264 / KR, IN, JP ≤ 10). JSONB allow-list updated with `raw` column.

## Extraction (done)

- [x] Init pnpm workspace + 4 packages (`shared`, `db-schema`, `thalamus`, `sweep`)
- [x] Extract `shared` (utils, types, enums, normalizers, observability)
- [x] Extract `db-schema` (Drizzle schema + query helpers)
- [x] Extract `thalamus` (cortices, orchestrator, explorer/nano-swarm, 20 skills)
- [x] Extract `sweep` (nano-sweep, resolution, editorial copilot, admin routes)
- [x] Rewrite import paths to `@interview/*` namespace
- [x] Stub downstream services to isolate sweep from original domain complexity
- [x] Stub Redis, auth, messaging, DI infra layers
- [x] Trim admin routes to sweep-only endpoints
- [x] Trim BullMQ queues and schedulers to sweep-only jobs
- [x] Sanitize client-specific identifiers from code and docs
- [x] README with CortAIx framing + Threat Intelligence transposition mapping

## Spec-first workflow (done)

- [x] LaTeX scaffolding: `docs/specs/preamble.tex`, `template.tex`, `Makefile`, `README.md`
- [x] Custom environments (`invariant`, `scenario`, `ac`, `nongoal`) + Given/When/Then/And macros
- [x] 24 retroactive specs written by 10 parallel opus agents:
  - shared (5): try-async, app-error, completeness-scorer, domain-normalizer, observability
  - db-schema (2): schema-contract, typed-repos
  - thalamus (11): orchestrator, cortex-registry, cortex-pattern, nano-swarm, source-fetchers, curator, guardrails, knowledge-graph-write, skills-as-files, dual-stream-confidence, field-correlation
  - sweep (6): nano-sweep, finding-routing, resolution, feedback-loop, editorial-copilot, chat-rate-limit
- [x] Preamble compilation fixes (`\And` collision, `fancyhdr` in `\makeatletter`, `amsmath`/`amssymb`, `lstlisting` UTF-8 literate)
- [x] All 24 PDFs compile via `make` in `docs/specs/`

### Spec work remaining

- [ ] Move specs from `DRAFT` → `REVIEW` → `APPROVED` status as contracts are validated
- [x] `scripts/spec-check.ts` — spec gate: walks every `.tex`, parses `\specStatus` + `\begin{ac}` + Traceability table, enforces every AC on an APPROVED/IMPLEMENTED spec has an existing test file + test name. Currently no-ops (all 24 specs DRAFT) — activates as specs graduate.
- [ ] Add `spec-build` CI job — run `make all` in `docs/specs/`, publish PDFs as artifacts

## Tests tracing to Acceptance Criteria

Every spec has a Traceability table; tests must land at those paths and the `describe` block must carry the AC id. Below is the consolidated list per package.

### `@interview/shared`

- [ ] `tests/try-async.spec.ts` — SPEC-SH-001 (AC-1..n)
- [ ] `tests/app-error.spec.ts` — SPEC-SH-002
- [ ] `tests/completeness-scorer.spec.ts` — SPEC-SH-003
- [ ] `tests/domain-normalizer.spec.ts` — SPEC-SH-004
- [ ] `tests/logger.spec.ts` + `tests/metrics.spec.ts` — SPEC-SH-005

### `@interview/db-schema`

- [ ] `tests/schema-contract.spec.ts` — SPEC-DB-001
- [ ] `tests/typed-repos.spec.ts` — SPEC-DB-002

### `@interview/thalamus`

- [ ] `tests/orchestrator.spec.ts` — SPEC-TH-001
- [ ] `tests/cortex-registry.spec.ts` — SPEC-TH-002
- [ ] `tests/cortex-pattern.spec.ts` — SPEC-TH-003
- [ ] `tests/nano-swarm.spec.ts` — SPEC-TH-010
- [ ] `tests/source-fetchers.spec.ts` — SPEC-TH-011
- [ ] `tests/curator.spec.ts` — SPEC-TH-012
- [ ] `tests/guardrails.spec.ts` — SPEC-TH-020 (5 invariants × AC)
- [ ] `tests/knowledge-graph-write.spec.ts` — SPEC-TH-030 (sha256 provenance)
- [ ] `tests/skills-as-files.spec.ts` — SPEC-TH-031
- [ ] `tests/dual-stream-confidence.spec.ts` — SPEC-TH-040 (confidence bands, FIELD dominance)
- [ ] `tests/field-correlation.spec.ts` — SPEC-TH-041 (p99 SLO, `LatencyBreach`, no drop)

### `@interview/sweep`

- [ ] `tests/unit/nano-sweep.{batching,parser,callbacks,cost,cap}.spec.ts` + `tests/integration/nano-sweep.readonly.spec.ts` — SPEC-SW-001
- [ ] `tests/finding-routing.spec.ts` — SPEC-SW-002
- [ ] `tests/resolution.spec.ts` — SPEC-SW-003
- [ ] `tests/feedback-loop.spec.ts` — SPEC-SW-010
- [ ] `tests/editorial-copilot.spec.ts` — SPEC-SW-011
- [ ] `tests/chat-rate-limit.spec.ts` — SPEC-SW-012

## Pre-commit + CI (spec-oriented)

- [x] **Native `.githooks/pre-commit`** (no husky dep): blocks `.env*` staged → `pnpm typecheck` → `pnpm spec:check` → `pnpm test`. Installed via `pnpm hooks:install` (sets `core.hooksPath`).
- [ ] CI pipeline: `pnpm -r typecheck` → `pnpm -r lint` → `pnpm -r test --coverage` → `make -C docs/specs all` → `tsx scripts/spec-check.ts`
- [ ] 100% coverage gate on `shared` (pure functions, no excuse); pyramidal target 70% unit / 25% integration / 5% e2e on thalamus + sweep
- [ ] Coverage artifacts published per PR

## Build cleanup (in progress)

- [x] Add `packages/sweep/package.json` and `packages/sweep/tsconfig.json`
- [ ] Remove unused `csv-reader.ts` / `pdf-table-reader.ts` from `shared` (missing `csv-parse` / `pdf-parse` deps, not used by thalamus or sweep)
- [x] `pnpm -r typecheck` passes cleanly across all 7 workspace projects (shared, db-schema, thalamus, sweep, cli, console, console-api)
- [ ] `pnpm -r build` passes (if/when build scripts are added)
- [x] Drizzle `using`/`op` index error resolved via raw SQL migration (`0001_hnsw_index.sql`, `0002_embedding_2048.sql`) — HNSW + halfvec(2048) index applied out-of-band since drizzle-kit 0.21 cannot emit `USING hnsw` natively

## console-api 5-layer refactor — done 2026-04-16

- [x] Decompose `apps/console-api/src/server.ts` from 2001 to 61 lines — layered into `routes/` → `controllers/` → `services/` → `repositories/` → `types/` + `utils/` + `prompts/`.
- [x] Hoist shared DTO helpers to [packages/shared/src/ssa/](packages/shared/src/ssa/) — SatelliteView / FindingView / KgView alongside the existing ConjunctionView. `deriveAction(pc)` added next to `deriveCovarianceQuality(sigmaKm)`.
- [x] Tighten repository id signatures to `bigint` (was `string` + internal `BigInt()` throw); enable PK index via `::bigint[]` cast in edge lookup.
- [x] `StatsService.snapshot` parallelises 3 count queries (was sequential).
- [x] Composition root in [apps/console-api/src/container.ts](apps/console-api/src/container.ts) (134 lines) — wires 9 repos + 13 services + thalamus/sweep containers; exposes `AppServices` to `registerAllRoutes`.
- [x] vitest workspace picks up `packages/*/src/**/*.test.ts` — unmasks 20 co-located shared DTO tests.
- [x] All 4 integration specs (conjunctions / enrichment-findings / knn-propagation / sweep-mission) green throughout. Final: 385 passed / 23 todo.
- [x] Transformers layer — extracted all inline row→DTO mapping functions to `apps/console-api/src/transformers/` (5 modules, 51 new pure-function tests, services shrank −58%, byte-equivalent behaviour).
- [ ] Follow-ups from code review: redact error messages from `asyncHandler` before sending to client in prod, tighten `satellitesController` to validate `regime` via `RegimeSchema.safeParse`, reshape `ConjunctionViewService.list(minPc)` to options-object for symmetry with other services, split `findingDecisionController`'s `"invalid"` sentinel into `"invalid-id"` vs `"invalid-decision"` for field-specific UI errors. `entityRef` duplicated between `kg-view.transformer` and `finding-view.transformer` — de-dup by importing the kg-view one from finding-view (no new file needed).
- [ ] Follow-up from code review: `MissionService` start/stop race preserved from server.ts — add generation counter to prevent concurrent ticks from two rapid start/stop cycles.

### console-api — test surface gaps

Post-refactor audit (2026-04-16). Current: **21 test files, 486 passing**. Foundation solid (transformers 5/5, utils 4/6, 6/14 services, satellite repo integration), but ~60% coverage overall. Top priorities ordered by impact × complexity:

- [ ] **Unit test `ReflexionService`** (`services/reflexion.service.ts`, 299L) — two emit branches (MIL peers vs divergent country), 4 SQL call sites, `HttpError.notFound` / `badRequest` throw paths. Most critical untested service.
- [ ] **Unit test `MissionService`** (`services/mission.service.ts`, 266L) — state machine with setInterval + busy flag + cursor; cover `publicState`, `start/stop` idempotence, `tick` advancement, `runTask` 2-vote consensus, `applyFill` range-guard rejection.
- [ ] **Unit test `KnnPropagationService`** (`services/knn-propagation.service.ts`, 186L) — median-within-10% numeric consensus, mode-≥2/3 text consensus, tooFar / disagree / outOfRange bucket accounting, dryRun short-circuit.
- [ ] **Integration spec repos** against live Postgres: `finding.repository.spec.ts`, `research-edge.repository.spec.ts`, `reflexion.repository.spec.ts`, `stats.repository.spec.ts` — all write paths currently only exercised via e2e through services.
- [ ] Remaining services without unit tests: `KgViewService`, `StatsService`, `EnrichmentFindingService`, `NanoResearchService`, `ReplChatService`, `ReplTurnService`, `SweepSuggestionsService` (already has tests — verify coverage), `AutonomyService` (has tests — verify clamp/NaN branches).
- [ ] e2e gap: 4 endpoints covered / ~20 exist. Add smoke specs for `/api/satellites`, `/api/kg/{nodes,edges}`, `/api/findings` (list + byId + decision), `/api/stats`, `/api/sweep/suggestions` (list + review), `/api/sweep/reflexion-pass`, `/api/autonomy/{start,stop,status}`, `/api/cycles/{run,list}`, `/api/repl/{chat,turn}`.
- [ ] Schema tests — `schemas/*.schema.ts` have no direct tests. Each schema should have a small unit test asserting: strict fields reject invalid inputs (400 expected), clamp fields accept+clamp (no 400), `.finite()` rejects NaN/Infinity/bool. Would catch future drift in the strict/clamp rule.
- [ ] Controller-layer tests — currently 0 direct controller tests (covered indirectly by e2e). Parse→service→response contract would benefit from tight controller-level tests that mock the service and assert status codes (400 / 404 / 500) per route.
- [ ] Add `pnpm test:coverage` script + codecov-style report; target ≥80% on `services/` + `transformers/` + `utils/`, ≥70% overall.

## Domain pivot to SSA (Space Situational Awareness) — done 2026-04-13

The repo was pivoted from its original commercial domain to SSA (collision avoidance, dual-stream OSINT × classified radar, HITL = mission operator). Mapping is schema-level, not cosmetic: `satellite / operator / operator_country / payload / orbit_regime / platform_class / satellite_bus / satellite_payload` are the canonical entities. Cortices are now SSA-native: `catalog / observations / conjunction-analysis / correlation / maneuver-planning` (core 5) plus 13 analysts / auditors.

- [x] Rename schema (`schema/wine.ts` → `schema/satellite.ts`) + entity types
- [x] Rewrite cortex skill prompts (22 files: 5 new core SSA + 12 renames + 5 rewritten in place)
- [x] Rename sql-helpers (6 files) + source fetchers (7 files) to SSA vocabulary
- [x] Orchestrator layer: cortex registry, executor, guardrails (`SSA_KEYWORDS`), `SQL_HELPER_MAP` made dynamic, storage seeds (30 SSA RSS feeds)
- [x] Thalamus services / utils / explorer rewritten (nano-swarm prompts, crawler/curator/scout SSA lenses)
- [x] Sweep package: wine* files → satellite*, editorial-copilot → briefing-copilot, cdc → doctrine
- [x] `shared/schemas/grape-profile.schema.ts` → `payload-profile.schema.ts` (new SSA fields: radiometric, optical, rf, thermal, reliability, spaceWeatherSensitivity)
- [x] Remove all 3 compat shims (db-schema/schema/wine.ts, shared/schemas/grape-profile.schema.ts, thalamus/utils/wine-entity-patterns.ts)
- [x] Zero wine/grape/vintage/appellation/terroir references remain in the repo

## Strategic tests

Targeted coverage, not exhaustive — tests picked to demonstrate design intent to a reviewer.

### shared

- [ ] `tryAsync` tuple semantics (success / caught / rethrow)
- [ ] `AppError` hierarchy + structured-cause serialization
- [ ] Domain normalizers — edge cases that break naive string matching
- [ ] `completeness-scorer` adaptive weight normalization when fields are missing

### db-schema

- [ ] Typed query helpers against a fresh pg instance (smoke)
- [ ] Schema migration round-trip

### thalamus

- [ ] `orchestrator.executor` dispatches to the right cortex by query shape
- [ ] `nano-swarm` parallelism + curator dedup (mock `nano-caller`)
- [ ] `guardrails` enforces depth and cost caps, surfaces partial results on breach
- [ ] One end-to-end cortex path: query → plan → explore → entity write (LLM mocked)

### sweep

- [ ] `nano-sweep.service` emits findings shape expected by `finding-routing`
- [ ] `resolution.service` applies an accepted suggestion in a transaction, writes audit row
- [ ] Feedback loop: reject → next-run prompt includes the rejection signal
- [ ] Rate-limit + dedupe in the chat repository

### e2e

- [ ] Thalamus: one end-to-end query routed through executor, LLM mocked, graph write verified
- [ ] Sweep: trigger → finding → reviewer accept → DB write + audit row (all in-memory/redis-mock)

## Docs

- [x] README.md — system overview + CortAIx framing + Threat Intel transposition table
- [x] TODO.md (this file)
- [x] CHANGELOG.md — extraction history
- [x] `docs/specs/` — 24 LaTeX specs (see "Spec-first workflow" above)
- [ ] `docs/architecture.md` — cortex pattern deep-dive with diagrams
- [ ] `docs/sweep-feedback-loop.md` — how rejection signals feed back into prompts
- [ ] `docs/threat-intel-mapping.md` — detailed walkthrough of the transposition (per cortex, per fetcher, per skill)
- [ ] Per-package `README.md` for thalamus and sweep

## Interview prep — CortAIx / Thales

### Narrative

- [ ] Write first-person pitch (5–7 min): problem → system shape → why cortex pattern → why nano swarm → guardrails → transposition to threat intel → tradeoffs
- [ ] Open with the honest framing: "built on a commercial domain, pattern is domain-agnostic, here's the mapping"
- [ ] Close with "what I'd change to ship this at Thales" (sovereign models on classified cortices, STIX/TAXII source fetchers, CERT-FR/ANSSI feeds)

### Code walkthrough

- [ ] One file per package picked and rehearsed:
  - [ ] `thalamus/src/orchestrators/executor.ts` — orchestration + guardrails
  - [ ] `sweep/src/services/nano-sweep.service.ts` — swarm + finding routing
  - [ ] `db-schema/src/schema/` — typed repo contract
  - [ ] `shared/src/utils/try-async.ts` — error discipline
- [ ] Diagram ready for each (whiteboard-able)

### Anticipated questions — have answers ready

- [ ] **Sovereignty**: how would you deploy this on classified data? (sovereign models per cortex, air-gapped source fetchers, on-prem pgvector)
- [ ] **Cost control**: how do you cap runaway agents? (budget per cortex, depth cap, partial-result surfacing on breach)
- [ ] **Hallucination on IOCs**: hallucinated IOC = security incident. How do you prevent it? (structured-only outputs via Zod, source-reliability scoring, reviewer gate on Sweep before DB write)
- [ ] **Multi-provider**: what if OpenAI is blocked? (model selection is per-step config, nano swarm is the only OpenAI-leaning layer — swap for Mistral/LLaMA)
- [ ] **Human-in-the-loop boundaries**: when does the agent write autonomously? (never into source-of-truth; only into pending Redis buffer until reviewer accepts)
- [ ] **Observability**: prove a cortex was cost-effective last week (Prometheus counters per cortex/source/skill, query → histogram)
- [ ] **Testability**: how do you test an LLM-in-the-loop system? (mock at the `nano-caller` / `SourceFetcher` boundary, unit-test cortices and services, integration-test executor with fakes)
- [ ] **Failure modes**: what breaks at scale? (Redis memory growth on findings, rate-limit contention on nano swarm, audit-row volume — each has an answer)

### Use cases — Factory framing

Primary build pitched as **Space Situational Awareness** (orbital collision avoidance). One-step transposition to **Threat Intelligence**. Three other transpositions kept in reserve.

- [ ] **Space Situational Awareness** (primary): dual-stream OSINT × classified radar, HITL = mission operator, threshold P(collision) ≥ 10⁻⁴, `Maneuver` audit ledger. Every Thales BL operating space assets has a variant — Factory promise pitch in one sentence.
- [ ] **Threat Intelligence** (one-step transposition): schema rename + fetcher swap, nothing else. Show the mapping table live.
- [ ] Plan B transpositions (mention only if asked): **pharmacovigilance**, **IUU fishing / maritime surveillance**, **regulatory & export-control**.

### Opening pitch (30 sec)

> "J'ai bâti un **pattern** d'agent multi-cortex avec swarm parallèle et sweep HITL audité. Le domaine du build initial est commercial — ce qui compte c'est que la même plateforme produit 11 cortices aujourd'hui, et que n'importe quelle BL Thales peut brancher son domaine sans toucher l'orchestrateur, les guardrails, ni le workflow HITL. Je vous montre le pattern sur un cas d'usage critique — **évitement de collision orbitale** — puis je le transpose en une étape au Threat Intelligence. C'est une **Factory d'agents**, pas un agent."

### SSA build — talking points (3 min)

- [ ] Draw the loop: OSINT (TLE publics, observateurs amateurs) → catalog cortex → correlation cortex ← Field (radars classifiés, télémétrie opérateur) → ConjunctionEvent → seuil P ≥ 10⁻⁴ → Sweep finding → operator accept → Maneuver + audit row
- [ ] Show the cortices: `catalog`, `observations`, `conjunction-analysis`, `correlation`, `maneuver-planning`
- [ ] Confidence bands: OSINT edges [0.2–0.5], field-corroborated [0.85–1.0], uncorroborated stays flagged with provenance breakdown
- [ ] Guardrail in code: hypothesis conjunction cannot promote to actionable without field corroboration — enforced by `field-correlation` cortex per SPEC-TH-040
- [ ] Economic framing: false positive = delta-v burned = quantifiable cost; false negative = Kessler-class incident. Confidence metadata is not instrumentation, it drives the go/no-go.

### Transposition to Threat Intel (1 min, live on whiteboard)

- [ ] Replace `catalog` → `vulnerability-catalog`, `observations` → `ioc-normalization`, `correlation` → `dual-stream-correlation`
- [ ] Replace TLE / radar → NVD/STIX/CERT-FR / tactical data-link
- [ ] Replace `ConjunctionEvent` → `ThreatEvent`, `Maneuver` → `Response`
- [ ] **Stay generic — don't name their systems**: "tactical data-link", "sensor-fusion bus", "mission debrief", "C2 feed". Let them recognize their own stack and volunteer the names.
- [ ] Land the punch: "**same code, new domain**. That's the Factory promise — ship the platform once, plug a domain per BL."

### Architecture additions to prototype (post-interview, if they bite)

- [ ] `thalamus/src/cortices/{catalog,observations,conjunction-analysis,correlation,maneuver-planning}/` — SSA cortex stubs with skill `.md` prompts
- [ ] `thalamus/src/cortices/sources/osint/` — `TLEFetcher`, `AmateurObsFetcher`, `SpacePressFetcher`
- [ ] `thalamus/src/cortices/sources/field/` — generic `ClassifiedRadarFetcher`, `OperatorTelemetryFetcher` (stubbed, mockable)
- [ ] `thalamus/src/transports/tactical-bus.ts` — generic Kafka / ZeroMQ / MQTT abstraction (used by field fetchers)
- [ ] `db-schema` — `Satellite`, `Debris`, `Observation`, `ConjunctionEvent`, `Maneuver` entities; every edge table carries `confidence` + `source_class`
- [ ] Sweep rule: `ConjunctionEvent` with P ≥ 10⁻⁴ and no field corroboration > N hours → priority finding
- [ ] One end-to-end demo script: synthetic TLE + synthetic radar track → conjunction detected → operator accept in Playwright → `Maneuver` row + audit

### The 4 interview axes to hit explicitly

- [ ] **Souveraineté** — multi-provider, per-step model selection, nothing tied to a vendor
- [ ] **Contrôle** — bounded agents, guardrails in code not in prompts, cost/depth caps, rogue-agent story as contrast
- [ ] **Human-in-the-loop** — Sweep never writes blind, every mutation audited and reversible
- [ ] **Testabilité** — 5-layer arch, typed repos, vitest workspace with unit/integration/e2e ready to show

### Live-demo readiness

- [ ] `pnpm -r typecheck` green
- [ ] `pnpm test` green
- [ ] Repo browsable with clickable file links in README
- [ ] One cortex skill file opened and explained (`cortices/skills/*.md`)

## Multi-agent simulation swarm (NEW — MiroFish-inspired)

Spec: [docs/specs/sweep/multi-agent-sim.tex](docs/specs/sweep/multi-agent-sim.tex) (SPEC-SW-006)
Plan: [tasks/sweep-sim-plan.md](tasks/sweep-sim-plan.md) — 9 phases, ~6h total

**Core idea:** many cheap small-model "fish" cover the possibility space. A swarm of K fish, each perturbed (god-event, persona, constraints), produces an outcome distribution. Single runs = size-1 swarm. Nano model per fish, ~$0.01/fish.

Use cases:

- **UC1 swarm** — operator behaviour under perturbation; 50 fish, DAG driver, coverage over operator decisions
- **UC3 swarm** — conjunction negotiation; 30 fish, Sequential driver, modal resolution → `sweep_suggestion` with distribution metadata

- [ ] Phase 1 — DB schema (`sim_swarm`, `sim_run`, `sim_agent`, `sim_turn`, `sim_agent_memory` + HNSW)
- [ ] Phase 2 — Types incl. `PerturbationSpec`/`SwarmConfig`, Zod schemas, agent-builder, memory service
- [ ] Phase 3 — Shared `sim_operator_agent` cortex + two drivers (DAG for UC1 parallel, Sequential for UC3 alternation)
- [ ] Phase 4 — Per-fish orchestrator (internal: `scheduleNext`, `pause/resume/inject`)
- [ ] Phase 4.5 — **Swarm service** + perturbation generators + fan-out worker + aggregator (k-means on terminal embeddings) + quorum logic
- [ ] Phase 5 — `sim_reporter` (single fish) + `sim_swarm_reporter` (coverage) cortex skills + promotion to suggestion
- [ ] Phase 6 — Swarm auto-spawn from conjunction findings, `/admin/swarm/*` routes, chat scope (`simRunId`/`swarmId`)
- [ ] Phase 7 — Demos `swarm-uc3.ts` / `swarm-uc1.ts` + Makefile targets + fixture recording
- [ ] Phase 8 — Unit + integration tests (quorum fail-soft, determinism, cross-fish isolation) + final anti-pattern sweep

Exit criteria: `make swarm-uc3` < 180s fixtures-mode (30 fish), `make swarm-uc1` < 300s (50 fish), deterministic aggregator output, one suggestion per swarm max, thalamus→sweep import direction preserved.

## Next up — conversational CLI + fish quick wins

Interactive CLI that captures logs, accepts queries, and delivers briefings
readable by a non-technical reviewer. Each fish quick-win reuses the SPEC-SW-006
sim-swarm infrastructure (already shipped) so impact >> effort.

### Priority 1 — CLI foundation (DONE 2026-04-14)

Shipped as `@interview/cli` via 22-task TDD plan (see
[docs/superpowers/plans/2026-04-14-conversational-cli.md](docs/superpowers/plans/2026-04-14-conversational-cli.md)).
46 specs green.

- [x] `pnpm run ssa` entrypoint — two-lane router (slash grammar +
      `interpreter` cortex emitting Zod `RouterPlan`)
- [x] Commands: `query`, `telemetry`, `logs`, `graph`, `accept`, `explain`
- [x] Source-class color bar + confidence sparkline, cost dial, rolling ETA
- [x] Animated emoji logs (6 fps) + ASCII satellite loader with p50/p95 ETA
- [x] 6 renderers (briefing, telemetry, logTail, graphTree, whyTree, clarify)
- [x] Memory buffer + palace (`sim_agent_memory` HNSW, 200k token threshold)
- [x] `analyst_briefing` + `interpreter` cortex skills
- [x] E2E happy-path test

Deferred (non-blocking for the demo):

- [ ] `buildRealAdapters` in `cli/src/boot.ts` — wire thalamus/telemetry/
      graph/resolution/why to real services (needs shared DB+Redis+LLM
      bootstrap). CLI boots in stub mode; `logs` is real.
- [ ] `analyst_briefing` end-to-end in `runCycle` output (skill exists)
- [ ] Aggregator / swarm-service / promote `stepLog` emission

### Priority 2 — Fish quick-wins (ranked by pitch value)

Each reuses `startInvestigationSwarm(query, targetEntity, K)` — generalised
from `startTelemetrySwarm`.

- [ ] **Conjunction Pc probabilistic estimator (~45 min)** — take a
      `conjunction_event`, K fish estimate Pc with perturbed assumptions
      (hard-body radius 5 / 10 / 20 m, covariance tight / loose). Aggregator
      → median + sigma + dissent clusters. Deterministic Pc baseline already
      shipped (Foster-1992 1D gaussian on regime-conditioned σ — see
      2026-04-16 CHANGELOG entry); this task adds the fish-swarm dissent
      layer on top of it.
- [ ] **Maneuver cost estimator (~60 min)** — K fish propose burns (dV,
      timing, post-maneuver re-screen). Aggregator finds the Pareto front
      over cost x residual-risk. Reviewer accepts the Pareto-efficient pick
      → `sweep_suggestion` with `kind: "maneuver"` payload.
- [ ] **Why? button (~30 min)** — on any finding, traces provenance via
      `research_edge` back to the source_item + skill sha256. ASCII tree
      render in the CLI. Instant explainability for a non-tech reviewer.
- [ ] **Anomaly triage (~60 min)** — suspect low-confidence finding → K fish
      each propose 3-5 explanation hypotheses (pipeline bug / real event /
      sensor error / data gap). Aggregator clusters hypotheses, reviewer
      picks. Demonstrates "system knows when it doesn't know".
- [ ] **Operator posture inference (~45 min)** — K fish impersonate
      doctrines (commercial / institutional / military-like), vote on the
      operator's actual posture based on fleet mass / regime / cadence.
      Fills an `operator.posture` field never publicly disclosed.
- [ ] **"Dig into" follow-up (~30 min)** — in the CLI, follow-up query
      relaunches a micro-swarm scoped to the previous finding's entity +
      accumulated context. Conversational drilldown.
- [ ] **Debris decay forecaster (~75 min)** — requires debris ingestion
      first (see P4). K fish estimate remaining orbital lifetime per
      catalogued debris using live NOAA F10.7 + altitude. Top-20 "likely
      decay next 30d" as findings.
- [ ] **What-if scenario (~90 min)** — "what if operator X launches 100
      sats in SSO next month?" → K fish simulate impact on conjunction
      rate, congestion, operator reactions. Aggregator = distribution of
      plausibility outcomes.

### Priority 3 — Grafana / Prometheus (~1h)

- [ ] HTTP `/metrics` endpoint on port 8080 serving `registry.metrics()`
      (prom-client text format)
- [ ] Instrumentation at 5 points: `thalamus_cycles_total{status}`,
      `thalamus_cortex_duration_seconds{cortex}` (histogram),
      `thalamus_cycle_cost_usd` (counter),
      `sweep_fish_duration_seconds{kind}` (histogram),
      `sweep_suggestions_emitted_total{source_class,severity}` (counter)
- [ ] `docker-compose.yml` — add prometheus (scrape `:8080/metrics`) +
      grafana (port 3000, provision `dashboard.json` at boot)
- [ ] `infra/grafana/dashboards/ssa.json` — 8 panels: cycle rate,
      findings/cycle, cost/cycle, cortex p50/p99, swarm quorum, conjunction
      rate by regime, fish dispersion, source_class distribution

### Priority 4 — Debris ingestion — DONE 2026-04-15

Shipped: 504 payloads → **33,564 objects** (18,560 payloads + 12,544 debris +
2,397 rocket stages + 63 unknown). Voyage embeddings (halfvec 2048) + HNSW
cosine index. KNN-based conjunction candidate cortex end-to-end wired into the
CLI.

- [x] Extended `satellite` table — `object_class` text with CHECK constraint
      (`payload`/`rocket_stage`/`debris`/`unknown`). Migration noted: target
      schema is a dedicated `space_object` table; inline column is interim.
- [x] `seed/populate-space-catalog.ts` — CelesTrak SATCAT ingestion, filter
      `DECAY_DATE=''`, UPSERT by `norad_id`. Apogee/perigee/inclination stored
      in `metadata` JSONB.
- [x] `seed/enrich-gcat.ts` — fixed NORAD-id source (was reading legacy
      `telemetry_summary->>'noradId'`, now reads the dedicated column).
      Enrichment hits the full 33k. Result: 20.5k mass + 20.2k bus backfilled.
- [x] `seed/screen-broadphase.ts` — sweep-line pruner with bounded top-K heap,
      542 M pairs → 145 M candidates in 32s (4× pruning).
- [x] `seed/screen-narrow-phase.ts` — SGP4 narrow phase with TLE fetch + cache,
      Foster-1992 Pc, UPSERT into `conjunction_event`.
- [x] `seed/embed-catalog.ts` + `build-embedding-index.sql` — 33,564 objects
      embedded via Voyage voyage-4-large in 3m39s ($0.08), HNSW cosine index.
- [x] `thalamus/cortices/queries/conjunction-candidates.ts` +
      `skills/conjunction-candidate-knn.md` — pre-narrow-phase candidate cortex
      (KNN + radial overlap + excludeSameFamily). Auto-discovered (28 skills).
- [x] CLI `/candidates <norad> [class=debris] [limit=N]` — parser, schema,
      dispatch, adapter, colour-coded renderer. 55/55 tests green, typecheck
      clean on 7 packages.

### Priority 4b — Debris ingestion follow-ups (open)

- [ ] Promote `object_class` to a dedicated `space_object` table (true schema
      separation for debris/stages vs payloads).
- [ ] `conjunctions-cli.ts` → `conjunctions-knn-cli.ts` — drive narrow-phase
      SGP4 directly off `queryConjunctionCandidatesKnn` survivors (top-N per
      target) instead of the current regime-only sampling.
- [x] KNN anomaly detector — see Priority 5 (orbital reflexion pass).
- [ ] Debris decay forecaster cortex (P2 quick-win) now unblocked by debris
      ingestion — K fish estimate remaining lifetime per debris using live
      NOAA F10.7 + altitude. Top-20 "likely decay next 30d" as findings.

## Priority 6 — OPS globe — orbit trails + conjunction markers (done — 2026-04-16)

Spec: [docs/specs/2026-04-15-orbit-trails-conjunction-markers.md](docs/specs/2026-04-15-orbit-trails-conjunction-markers.md)
Plan: [docs/specs/2026-04-15-orbit-trails-conjunction-markers.plan.md](docs/specs/2026-04-15-orbit-trails-conjunction-markers.plan.md)

### Shared DTO + API

- [x] `packages/shared/src/ssa/conjunction-view.ts` — Zod
      `ConjunctionViewSchema` + `deriveCovarianceQuality` + `deriveAction`.
- [x] `GET /api/conjunctions` joins primary/secondary `satellite` rows,
      derives `regime` (from primary meanMotion), `covarianceQuality`
      (HIGH/MED/LOW from `combined_sigma_km`), `action`
      (maneuver/monitor/no_action from Pc). No mocks — all from live DB.
- [x] `apps/console-api/tests/conjunctions.spec.ts` — integration test
      parses the endpoint against `ConjunctionViewSchema`.

### Frontend rendering

- [x] `apps/console/src/lib/orbit.ts` — `orbitRing(s, n=128)` sampler with
      meanAnomaly-neutralisation for stable geometry. Unit tests cover
      ring closure + period correctness (5/5 green).
- [x] `apps/console/src/modes/ops/OrbitTrails.tsx` — hybrid renderer:
      merged-geometry full rings per regime + 60-sample fading tails.
      Tri-state `off | tails | full` folded into `RegimeFilter`.
- [x] `apps/console/src/modes/ops/ConjunctionMarkers.tsx` — severity
      sprites (green < 1e-6 / yellow < 1e-4 / red ≥ 1e-4) revealed on arc
      hover, with a full-SSA info card portal (10 fields).
- [x] Hover wiring in `ConjunctionArcs.tsx` + panel-click selection
      surface via `OpsMode` local state.

### Housekeeping

- [x] `apps/` unignored — console + console-api are now part of the
      portfolio tree.

## Priority 5 — Enrichment pipeline + KG bridge (done — 2026-04-16)

Closes the loop between catalog enrichment and Thalamus reasoning. Every fill
now emits a `research_finding` with `research_edge`s so cortices can cite,
trace, and reason on factual fills.

### Sweep mission — hardened (done)

- [x] Structured-outputs JSON schema on gpt-5.4-nano `/v1/responses` (strict,
      `source` regex `^https://…`). No prose slot = no hedging possible.
- [x] Hedging-token post-hoc blocklist (typical/approx/around/unknown/…).
- [x] Source validation: returned URL must appear in the builtin
      `web_search` URL list — rejects invented citations.
- [x] Range guards per column (lifetime 0.1-50, launch_year 1957-2035,
      mass_kg 0.1-30k, power 0.1-30k). Values outside → unobtainable.
- [x] Unit mismatch check (lifetime rejects hours/days/months; launch_year
      rejects BC/month/day).
- [x] 2-vote corroboration — two independent nano calls with different
      angles, accept iff values agree within ±10 % (numeric) or exact
      normalised (text). Confidence boosted +0.15 on agreement.
- [x] `object_class='payload'` filter (debris/stages have no meaningful
      `lifetime`/`variant`/`power`).
- [x] Per-satellite granularity — each suggestion (operator × field)
      expands to N per-satellite tasks with `satelliteName` + `noradId` in
      the prompt.

### KNN propagation — zero-LLM enrichment (done)

- [x] `POST /api/sweep/mission/knn-propagate {field, k, minSim, limit,
dryRun}` — for each payload missing a field, finds K nearest embedded
      neighbours with field set, propagates consensus value.
- [x] Consensus rule: numeric = all within ±10 % of median; text = mode
      covers ≥ ⅔ of neighbours. Nearest-neighbour `cos_sim ≥ minSim`.
- [x] Range guards applied to neighbour values (no garbage in → garbage
      out).
- [x] UI: **LAUNCH FISH MISSION** button in SweepSuggestions tab, running
      banner + live counters.

### Enrichment findings — bridge to Thalamus KG (done)

- [x] `emitEnrichmentFinding()` called from both fill paths. Writes a
      `research_finding` (`cortex=data_auditor`, `finding_type=insight`)
      carrying field / value / confidence / source in `evidence` JSONB.
- [x] `research_edge` rows: `about` → target sat, `similar_to` → every
      neighbour (KNN) or source URL (mission). Provenance navigable in KG.
- [x] Feedback loop: each fill pushes an `enrichment` entry to
      `sweep:feedback` so next nano-sweep de-prioritises self-healing
      fields.
- [x] Lazy long-running cycle `trigger_source='catalog-enrichment'`
      persists findings across sessions.
- [x] Every PG param cast explicitly (`::bigint`, `::real`, `::jsonb`,
      `::entity_type`, `::relation`) — `pg@8.x` does not infer these via
      driver. **Lesson: always cast jsonb/bigint/enum bindings.**

### Orbital reflexion pass — factual anomaly detection (done)

- [x] `POST /api/sweep/reflexion-pass {noradId, dIncMax, dRaanMax,
    dMmMax}` runs two orbital cross-tabs (pure SQL, no LLM):
  1. **Strict co-plane companions** — same (inc, raan, meanMotion) within
     tight tolerance + along-track phase lag in minutes.
  2. **Inclination-belt peers** — same inclination regardless of RAAN,
     cross-tabulated by `operator_country × classification_tier ×
object_class`.
- [x] MIL-lineage name-match (`YAOGAN%`, `COSMOS%`, `NROL%`, `LACROSSE%`,
      `TOPAZ%`, `SHIYAN%`, …) surfaces explicit military platforms in belt.
- [x] Emits an `anomaly` finding (`cortex=classification_auditor`,
      `urgency=high` when MIL-peers ≥ 1, else `medium`) with every cited
      peer traced via `similar_to` edges.
- [x] Live verified on FENGYUN 3A (32958) → `urgency=high`, 3 MIL peers
      (YAOGAN-11, SHIYAN-3, SHIYAN-4) + SUOMI NPP strict co-plane at 54 min
      phase lag.

### Autonomy controller — continuous loop (done)

- [x] `POST /api/autonomy/start {intervalSec}` / `stop` / `GET /status`.
      Rotates between Thalamus cycles (6 rotating SSA queries) and Sweep
      nullScan passes. Each tick emits findings live.
- [x] UI: topbar **AUTONOMY** pill (pulse + tick count) + FEED panel with
      3 live counters (findings / suggestions / KG edges) and scrollable
      tick history.
- [x] Briefing mode dropped from rotation (returned 0 operator-countries
      once catalogue fully null-scanned).

### Catalog gap-fill — heuristic (done)

- [x] `seed/fill-catalog-gaps.ts` — deterministic filler for the three
      columns that were 100 % NULL: `g_orbit_regime_description` (from
      orbital elements), `classification_tier` (operator heuristic),
      `is_experimental` (mass + bus/name signals). 500/504 regime, 504/504
      tier, 504/504 experimental.

### REPL chat → real Thalamus dispatch (done)

- [x] `/api/repl/chat` — classifier (gpt-5.4-nano) routes between plain
      chat and `run_cycle`. On cycle intent actually dispatches Thalamus,
      loads findings, summarises with satellite names cited. No fixtures.
- [x] Command palette bare text falls through to REPL chat automatically.

### Tests — 13/13 integration specs green

- [x] `sweep-mission.spec.ts` (6) — queue expansion, Other/Unknown skip,
      non-writable skip, idempotency, cap, double-start-refused.
- [x] `knn-propagation.spec.ts` (5) — field whitelist (400), shape, `k` /
      `minSim` clamping, sampleFills trail, `tooFar` monotonicity.
- [x] `enrichment-findings.spec.ts` (1) — every KNN fill emits a
      `research_finding` with ≥ 1 `about` + ≥ 1 `similar_to` edge.
- [x] `sweep:index:pending` snapshot/restore between tests — isolation
      from 163 live pending suggestions.

### Priority 5 follow-ups (open)

- [ ] Unit tests for `applySatelliteFieldUpdate` + `applyKnnFill` (DB
      UPDATE + audit row write, currently covered only end-to-end).
- [ ] Fixture-mode fabrication-rejection test — prove that `typically…`
      in a recorded nano response gets blocked by the post-hoc blocklist.
- [ ] UI button for `/reflexion-pass <norad>` in the console (currently
      CLI-only via curl).
- [ ] CLI `/reflexion <norad>` verb — same endpoint rendered in the
      terminal, colour-coded by MIL-lineage / co-plane / belt.
- [ ] Reflexion ground-track propagation — use satellite.js SGP4 to
      detect sats that systematically over-fly the same lat/lon within
      X minutes of the target (vs the current RAAN-based co-plane test
      which only catches sats that never drift apart).
- [ ] Operator-country fix: FENGYUN 3A is tagged `Other / Unknown`
      despite being CMA/China. The nullScan surfaces this gap; add a
      ChatGPT-based operator-resolver cortex (low priority).

### Bottom line — interview pitch combo (~2h15)

CLI + interpreter cortex (P1) + **Pc estimator + maneuver Pareto + Why button**
(first three P2) = decision-support under uncertainty with auditable
provenance, live. Matches the README pitch. Everything else is polish.

---

## Priority 6 — Thalamus content quality (post-SSE)

Discovered while smoke-testing the SSE stream (cycle 264, 160s, 4 iterations,
59 findings, $0.108). The SSE plumbing works — the content Thalamus surfaces
doesn't. Three root causes, ranked by ROI:

### Root causes (cycle 264 diagnostic)

- **Dedup tax — ~40% of findings collide with prior cycles.** Cycle 264
  emitted 13 `Semantic dedup: merging into existing finding` lines
  (existingId 226, 184, 154, 417, 402, 468, 172, 351, 710, 711, 382, 237)
  across 59 candidates. `data_auditor` + `classification_auditor` keep
  re-discovering the same P0/P1 catalogue gaps (33 202 sans PlatformClass,
  33 060 sans opérateur, 12 495 sans masse) because nothing upstream
  enriches those fields.
- **Web-search fallback without payoff.** `debris_forecaster` ran with
  `webSearch: true`, fetched 10 015 chars in 15 s, emitted `findings: 0`.
  The fallback pulls generic debris doc, but the cortex prompt can't map
  it onto _our_ catalogue state, so nothing lands.
- **Budget exhausted mid-cycle.** `Stopping: cost budget exhausted
totalCost: 0.107778 maxCost: 0.1 iteration: 4`. The cycle aborts before
  the next planner pass could consume the fresh strategist output, which
  is exactly where the named-satellite findings live (AQUA 5 090 kg, etc.).
  The summariser then falls back to listing finding IDs.

### Fix backlog

- [ ] **(a)** Pimp summariser prompt — `apps/console-api/src/prompts/repl-chat.prompt.ts`
      `summariserPrompt()` to privilege `findingType=strategy` +
      `urgency=high` + cite satellite names instead of flat ID lists.
      ~30 min, single file. Biggest visible win in the REPL.
- [ ] **(c)** Bump `maxCost` for user-triggered cycles to $0.25
      (vs $0.10 daemon default). Config in
      `packages/thalamus/src/cortices/config.ts` → `THALAMUS_CONFIG` /
      `ITERATION_BUDGETS`. ~2 min. Lets the cycle actually converge.
- [ ] **(b)** Planner cortex filter by intent — strip
      `data_auditor` / `classification_auditor` from the cortex pool
      when the user query is not an audit request. Today the planner
      picks them because the catalogue is so thin they're the only
      cortices with guaranteed findings. Touches
      `packages/thalamus/src/services/thalamus-planner.service.ts`.
      ~1 h. Second-order effect: less dedup tax.

### Underlying (Priority 7, future)

- Enrich the seed so `data_auditor` stops dominating. Join more
  Celestrak SATCAT fields (`operator`, `mass`, `country`,
  `platform_class`) into `seed/populate-space-catalog.ts`. Until the DB
  has meat on the bones, Thalamus will keep reporting the same holes.
