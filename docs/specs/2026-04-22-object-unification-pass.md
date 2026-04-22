# Object Unification Pass — high-ROI dedup without breaking agnosticity

**Date:** 2026-04-22
**Status:** proposal (future feature branch — starts after the current test-focused branch merges)
**Spec ID:** SPEC-ARCH-029

## Summary

This branch does **not** aim for zero textual duplication and does **not** enforce artificial DRY.
It targets **similar or near-similar objects** that can be unified into a single reusable logic with a **real maintenance payoff**, while preserving:

- kernel agnosticity in `packages/*`
- existing package/app boundaries
- console-api layering rules enforced by `.dependency-cruiser.js`

The branch should remove the highest-value repetition in orchestration flows, repeated controller patterns, route registrars, repository SQL fragments, source fetcher envelopes, pure parsing/stat helpers, DTO shapes, and selected declarative registries.

### Expected payoff

Grounded estimate:

- **~1100 to 1500 LOC** of similar logic touched or normalized
- **~400 to 650 net LOC removed**
- possible stretch target: **~650 to 800 net LOC** if additional safe controller/DTO unifications are folded in during execution

## Intent

Unify similar objects only when all of the following are true:

1. There is a shared underlying mechanism, not just a similar shape.
2. The unified form is simpler to maintain than the duplicated forms.
3. The unification can be done without violating package agnosticity or layer boundaries.
4. The result remains readable to a feature engineer working locally in that area.

## Non-goals

- No "zero clone" objective.
- No repo-wide elimination of all duplicate function names.
- No new generic framework for controllers, services, providers, or runners.
- No package-to-app import shortcuts.
- No SSA vocabulary leakage into `packages/thalamus/` or kernel-generic areas of `packages/sweep/`.
- No forced unification of provider implementations whose variance is inherently transport/provider-specific.

## Decision rule

Every detected family of similar objects must be classified into exactly one of these buckets:

- `unify-local`
  - extract a private helper, local factory, or feature-local module
- `unify-boundary-safe`
  - extract a shared source of truth in an allowed location such as `@interview/shared`
- `normalize-shape`
  - keep separate implementations, but unify the DTO/type/spec/builder they rely on
- `keep-separate`
  - document why the similarity is superficial or architecture-constrained

Only the first three buckets are in scope for code changes.

## Scope

Included:

- `apps/**`
- `packages/**`
- `scripts/**`

Excluded:

- `**/*.test.*`
- `**/*.spec.*`
- `**/tests/**`
- `**/__tests__/**`
- `**/fixtures/**`
- `**/migrations/**`
- `docs/**`
- generated/report/build artifacts

## Architectural constraints

### Package agnosticity

- `packages/thalamus/**` stays domain-agnostic.
- kernel-generic parts of `packages/sweep/**` stay domain-agnostic.
- no SSA nouns or SSA-only helpers may move into kernel packages.

### Boundary policy

When two similar objects live across an architecture boundary, prefer a **boundary-safe common source**:

- shared helper for pure logic
- shared DTO/type/spec for transport shape
- shared builder/mapper input contract

Do **not** unify by coupling layers directly.

### Shared package rule

Only move logic into `@interview/shared` if it is:

- pure
- domain-agnostic
- already used by more than one package or clearly justified as cross-package infrastructure

## Branch output

This branch should produce:

1. A repo-visible inventory of similar objects with explicit decisions.
2. A policy/check script to prevent regressions.
3. A focused set of unifications with measurable LOC reduction.
4. No architecture regressions.

## Important additions to APIs / interfaces / types

The branch should introduce the following internal interfaces/surfaces.

### Tooling

- `scripts/object-similarity-report.ts`
- `scripts/object-similarity-policy.json`

Add npm scripts:

- `obj:report`
- `obj:check`

### Shared pure helpers

- `packages/shared/src/utils/markup.ts`
- `packages/shared/src/dto/sim-http.dto.ts`

Ensure they are exported through existing subpath conventions in `packages/shared/package.json`.

### Feature-local shared modules

- `apps/console-api/src/utils/request-schema.ts`
- `apps/console-api/src/agent/ssa/sources/source-result.builder.ts`
- `packages/sweep/src/sim/utils/stats.ts`
- `apps/console-api/src/utils/serialize.ts`
- `apps/console-api/src/repositories/queries/source-item-base.ts`
- `apps/console-api/src/repositories/queries/satellite-dimensions.ts`
- `apps/console-api/src/repositories/queries/sim-terminal-latest.ts`
- `apps/console-api/src/repositories/queries/research-edge-label.ts`
- `apps/console-api/src/repositories/queries/space-weather-latest.ts`
- `apps/console-api/src/routes/sim-runs.routes.ts`
- `apps/console-api/src/routes/sim-swarms.routes.ts`
- `apps/console-api/src/routes/sim-orchestrator.routes.ts`
- `apps/console-api/src/routes/sim-subjects.routes.ts`
- `apps/console-api/src/routes/sim-kernel.routes.ts`
- `packages/sweep/src/sim/runner-shared.ts`
- `apps/console/src/features/ops/regime-model.ts`

## Inventory of high-ROI candidate families

## 1. Pure parsing / text extraction helpers

### Candidates

- `decodeEntities`
  - `apps/console-api/src/agent/ssa/sources/fetcher-rss.ts`
  - `packages/db-schema/src/seed/sources.ts`
- `pickAll`
  - `apps/console-api/src/agent/ssa/sources/fetcher-arxiv.ts`
  - `packages/db-schema/src/seed/sources.ts`
- `parseDate`
  - `apps/console-api/src/agent/ssa/sources/fetcher-rss.ts`
  - `packages/db-schema/src/seed/sources.ts`
- nearby related helpers:
  - `stripTags`
  - `pickFirst`
  - `pickAttr`

### Decision

`unify-boundary-safe`

### Action

Create `packages/shared/src/utils/markup.ts` with:

- `decodeHtmlEntities`
- `stripMarkupToText`
- `pickFirstTagText`
- `pickAllTagText`
- `pickTagAttr`

Use this only for pure markup parsing. Do not move fetcher-specific domain logic.

## 2. Seed-script algorithm helpers

### Candidates

- `classifyRegime`
  - `packages/db-schema/src/seed/embed-catalog.ts`
  - `packages/db-schema/src/seed/screen-broadphase.ts`
  - `packages/db-schema/src/seed/screen-narrow-phase.ts`
- heap / offer helpers between:
  - `packages/db-schema/src/seed/screen-broadphase.ts`
  - `packages/db-schema/src/seed/screen-narrow-phase.ts`

### Decision

`unify-local`

### Action

Create one seed-local helper module under `packages/db-schema/src/seed/` for:

- regime classification reused by multiple screen/embed scripts
- shared heap operations if both screen passes are intentionally using the same priority behavior

Keep this module local to the seed toolchain. Do not promote it into `@interview/shared`.

## 3. Pure stat helpers in sim aggregators

### Candidates

- `percentile`
  - `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts`
  - `apps/console-api/src/agent/ssa/sim/aggregators/telemetry.ts`

### Decision

`unify-local`

### Action

Create `packages/sweep/src/sim/utils/stats.ts` and move all shared numeric/stat helpers there.

Scope:
- keep pure numeric/stat helpers in kernel utils
- keep SSA-specific aggregator services and suggestion shaping in `apps/console-api`

## 4. Repeated transformer helpers

### Candidates

- `toIso`
  - `apps/console-api/src/transformers/satellite-enrichment.transformer.ts`
  - `apps/console-api/src/transformers/source-data.transformer.ts`
  - `apps/console-api/src/transformers/traffic-forecast.transformer.ts`

### Decision

`unify-local`

### Action

Create `apps/console-api/src/utils/serialize.ts` and move shared projection helpers there.

## 5. Source fetcher result envelopes

### Observed repetition

Multiple SSA source fetchers repeat the same `SourceResult` envelope pattern:

- `fetchedAt: new Date().toISOString()`
- `latencyMs: Date.now() - start`
- `type/source/url/data`
- `try/catch -> []`

Seen in:

- `fetcher-celestrak.ts`
- `fetcher-regulation.ts`
- `fetcher-space-weather.ts`
- `fetcher-spectra.ts`
- `fetcher-launch-market.ts`
- `fetcher-bus-archetype.ts`
- `fetcher-knowledge-graph.ts`
- `fetcher-orbit-regime.ts`

### Decision

`unify-local`

### Action

Create `apps/console-api/src/agent/ssa/sources/source-result.builder.ts` with:

- `buildSourceResult(...)`
- `withSourceTiming(start, payload)`
- optional `safeFetchToResults(...)` only if it stays generic and readable

The builder may unify the envelope only. Endpoint-specific transforms stay local.

## 6. Repeated controller patterns in console-api

### High-ROI groups

Strong repeated request-handling patterns exist in:

- `apps/console-api/src/controllers/sources.controller.ts`
- `apps/console-api/src/controllers/findings.controller.ts`
- `apps/console-api/src/controllers/orbital.controller.ts`
- `apps/console-api/src/controllers/conjunctions.controller.ts`
- `apps/console-api/src/controllers/opacity.controller.ts`
- `apps/console-api/src/controllers/payloads.controller.ts`
- `apps/console-api/src/controllers/satellite-audit.controller.ts`
- `apps/console-api/src/controllers/satellite-enrichment.controller.ts`
- `apps/console-api/src/controllers/satellites.controller.ts`
- `apps/console-api/src/controllers/sim-run.controller.ts`
- `apps/console-api/src/controllers/sim-swarm.controller.ts`
- `apps/console-api/src/controllers/sim-turn.controller.ts`
- `apps/console-api/src/controllers/sim-agent.controller.ts`
- `apps/console-api/src/controllers/sim-terminal.controller.ts`
- `apps/console-api/src/controllers/sim-orchestrator.controller.ts`

Patterns include:

- parse query -> delegate
- parse params -> lookup by id -> notFound -> map dto
- parse params -> lookup by id -> count -> dto
- parse params/body -> lookup -> transition guard -> mutate

### Decision

`keep-separate`

### Action

Keep controllers explicit.

Allowed cleanup only:

- continue using `asyncHandler`
- continue using `parseOrReply`
- extend `sim-controller.utils.ts` only for truly sim-local helpers such as shared id parsing or not-found construction
- remove duplication by moving real work into services or repositories, not by introducing a controller factory layer

Not allowed:

- `controller-factories.ts`
- generic controller builders
- hiding route-specific request/response flow behind a mini framework

## 7. Similar follow-up execution flows

### Candidates

Inside `apps/console-api/src/agent/ssa/followup/repl-followup-executor.ssa.ts`:

- `executePcVerification`
- `executeTelemetryVerification`

### Decision

`unify-local`

### Action

Extract one shared flow:

- `executeSwarmVerification(item, input, spec)`

Where `spec` holds only:
- target id extraction
- launcher call
- optional labels if needed

The common flow keeps:
- dependency guards
- `fishCount` derivation
- pump loop
- step streaming
- completion/failure handling
- `awaitSwarmTerminal(...)`

## 8. Similar sim runner internals

### Candidates

Across:
- `packages/sweep/src/sim/turn-runner-dag.ts`
- `packages/sweep/src/sim/turn-runner-sequential.ts`

Shared logic already observed:
- `callAgent`
- `buildContext`
- `loadGodEvents`

### Decision

`unify-local`

### Action

Create `packages/sweep/src/sim/runner-shared.ts` containing:

- `callAgentTurn(...)`
- `buildAgentContext(...)`
- `loadGodEvents(...)`

Allowed parameterization:
- memory query string
- any narrow runner-specific variation already present

Not allowed:
- new kernel ports
- inheritance hierarchy
- pushing this into the container layer

## 9. Transport DTO symmetry between console-api and sweep HTTP adapters

### Observed symmetry

The following areas mirror the same transport concepts:

- `packages/sweep/src/sim/http/runtime-store.adapter.ts`
- `packages/sweep/src/sim/http/swarm-store.adapter.ts`
- `packages/sweep/src/sim/http/fleet.adapter.ts`
- `apps/console-api/src/transformers/sim-http.transformer.ts`
- `apps/console-api/src/services/sim-runtime-store.service.ts`
- `apps/console-api/src/agent/ssa/sim/fleet-provider.ts`

### Decision

`normalize-shape`

### Action

Create `packages/shared/src/dto/sim-http.dto.ts` with shared DTO definitions for transport shapes only.

Expected contents include:
- create response DTOs
- count DTOs
- run/swarm/agent transport DTOs
- observable turn DTOs
- memory row DTOs
- god event DTOs
- timestamp/count wrappers

Important rule:
- types move to shared
- mappers stay in their own layers
- services and adapters stay separate

## 10. Frontend constants and registries as source-of-truth candidates

### Observed similarity

The same regime set and related mappings appear in:

- `apps/console/src/features/ops/opsFilterStore.ts`
- `apps/console/src/hooks/useRegimeFilter.ts`
- `apps/console/src/adapters/renderer/palette.ts`
- likely `apps/console/src/features/ops/RegimeFilter.tsx`

Additional frontend registries also show repeated key sets and should be reviewed as source-of-truth candidates:

- source-class colors / labels across:
  - `apps/console/src/shared/types/graph-colors.ts`
  - `apps/console/src/features/repl/renderers/WhyTreeRender.tsx`
  - `apps/console/src/features/thalamus/ThalamusDrawer.tsx`
- autonomy action label/color maps in:
  - `apps/console/src/features/autonomy/Control.tsx`
- conjunction action label/color maps in:
  - `apps/console/src/shared/types/conjunction.ts`

### Decision

`normalize-shape`

### Action

Create `apps/console/src/features/ops/regime-model.ts` with:

- `REGIME_KEYS`
- `DEFAULT_REGIME_VISIBILITY`
- regime palette constants
- ring palette constants
- lightweight helpers for regime counts/order if needed

Create additional shared frontend registries only when there are at least two real consumers of the same key-space:

- `source-class-model.ts` for source class color/label/count semantics
- `action-display-model.ts` only if autonomy or conjunction action maps are reused outside their current module

Do not centralize one-off presets or purely local presentation choices.

## 11. Repository SQL fragment canonization and query hot paths

### Observed similarity

Several console-api repositories repeat the same SQL query fragments or lookup fragments:

- `source_item` + `source` base projection in:
  - `apps/console-api/src/repositories/source.repository.ts`
- satellite dimension joins in:
  - `apps/console-api/src/repositories/satellite.repository.ts`
  - `apps/console-api/src/repositories/satellite-enrichment.repository.ts`
  - `apps/console-api/src/repositories/reflexion.repository.ts`
  - `apps/console-api/src/repositories/user-fleet.repository.ts`
- research edge label resolution in:
  - `apps/console-api/src/repositories/kg.repository.ts`
  - `apps/console-api/src/repositories/research-edge.repository.ts`
- latest space-weather forecast selection in:
  - `apps/console-api/src/repositories/space-weather.repository.ts`
  - `apps/console-api/src/repositories/satellite-audit.repository.ts`
- latest terminal-turn CTE in:
  - `apps/console-api/src/repositories/sim-terminal.repository.ts`

The audit also found a few concrete SQL hot spots:

- `apps/console-api/src/repositories/sim-terminal.repository.ts`
  - repeated `WITH latest AS (...)` plus a correlated `turns_played` subquery
- `apps/console-api/src/repositories/satellite.repository.ts`
  - repeated satellite dimension joins
  - `getOperatorCountrySweepStats()` performs per-row follow-up queries for `topPayloads` and `sampleSatellites`
- `apps/console-api/src/repositories/user-fleet.repository.ts`
  - repeats the same user-satellite base join across fleet and watchlist branches
- `apps/console-api/src/repositories/source.repository.ts`
  - repeats the same source-item/source projection and sorting rules across six methods

### Decision

`unify-local`

### Action

Create repository-local shared SQL modules:

- `apps/console-api/src/repositories/queries/source-item-base.ts`
  - canonical `source_item` + `source` select / join / ordering fragments
- `apps/console-api/src/repositories/queries/satellite-dimensions.ts`
  - canonical satellite dimension select and join fragments
- `apps/console-api/src/repositories/queries/sim-terminal-latest.ts`
  - canonical latest-agent-turn-per-run CTE plus optional pre-aggregated turn counts
- `apps/console-api/src/repositories/queries/research-edge-label.ts`
  - canonical CASE + join logic for resolving labeled operator/regime edges
- `apps/console-api/src/repositories/queries/space-weather-latest.ts`
  - canonical `DISTINCT ON (source, epoch)` forecast selection

Refactor with these rules:

- `SourceRepository` keeps separate public methods, but all methods share the same base fragments.
- `SatelliteRepository`, `SatelliteEnrichmentRepository`, `ReflexionRepository`, and `UserFleetRepository` reuse the same satellite-dimension fragments where the projected shape is materially the same.
- `SimTerminalRepository` must be rewritten to:
  - share the same latest-turn CTE between both methods
  - replace the correlated `turns_played` count with a pre-aggregated CTE or joined subquery
- `SatelliteRepository.getOperatorCountrySweepStats()` must be rewritten to eliminate per-row follow-up queries and return `topPayloads` / `sampleSatellites` from one SQL round-trip using ranked CTEs or JSON aggregates.
- `SpaceWeatherRepository.listLatestForecast()` and `SatelliteAuditRepository.listApogeeHistory()` must share the same latest-forecast SQL fragment so forecast de-dup and horizon semantics do not drift.
- `UserFleetRepository` may keep separate public methods, but the fleet/watchlist base satellite shape must become a single shared fragment.

Do not introduce a generic ORM DSL. Keep the shared pieces as SQL fragments local to `apps/console-api/src/repositories/queries/`.

## 12. Route composition cleanup in console-api

### Observed similarity

`apps/console-api/src/routes/sim.routes.ts` currently mixes:

- authenticated public sim routes
- internal kernel-secret routes
- run, swarm, orchestrator, subject, queue, and promotion registration

The file is not duplicated textually, but it concentrates too many similar route-registration objects in one place and hides the same feature boundaries already present in controllers and services.

### Decision

`unify-local`

### Action

Keep `apps/console-api/src/routes/sim.routes.ts` as a top-level composer only, and split registrations into:

- `apps/console-api/src/routes/sim-runs.routes.ts`
- `apps/console-api/src/routes/sim-swarms.routes.ts`
- `apps/console-api/src/routes/sim-orchestrator.routes.ts`
- `apps/console-api/src/routes/sim-subjects.routes.ts`
- `apps/console-api/src/routes/sim-kernel.routes.ts`

Rules:

- `sim.routes.ts` owns only hook setup and composition order.
- feature route modules own only path registration.
- controller wiring stays unchanged.
- HTTP paths, auth hooks, and kernel-secret behavior must not change.

This split is primarily for readability and maintenance, but it also makes route families align with the controller and service unification work above.

## 13. Schema primitives and transformer helper normalization

### Observed similarity

The audit found a small but real layer of repeated low-level helpers in `console-api`:

- repeated numeric-id and query parsing primitives across:
  - `apps/console-api/src/schemas/sim.schema.ts`
  - `apps/console-api/src/schemas/orbital.schema.ts`
  - `apps/console-api/src/schemas/sources.schema.ts`
  - `apps/console-api/src/schemas/satellite-audit.schema.ts`
  - `apps/console-api/src/schemas/conjunctions.schema.ts`
- repeated date/id normalization helpers across:
  - `apps/console-api/src/transformers/source-data.transformer.ts`
  - `apps/console-api/src/transformers/traffic-forecast.transformer.ts`
  - `apps/console-api/src/transformers/satellite-enrichment.transformer.ts`
  - `apps/console-api/src/transformers/satellite-audit.transformer.ts`
  - `apps/console-api/src/transformers/conjunction-view.transformer.ts`

### Decision

`unify-local`

### Action

Add `apps/console-api/src/utils/request-schema.ts` with only the reusable request-schema helpers that already have multiple real consumers:

- `numericIdString(...)`
- `optionalNonEmptyString(...)`
- `optionalFiniteNumber(...)`
- `optionalStringNumber(...)` only if both existing consumers can use the same semantics

Rules:

- keep `clamp.ts` as the dedicated numeric tuning helper module
- do not build a generic schema DSL
- keep full endpoint schemas feature-local
- only extract primitives when the validation semantics are already identical

Expand `apps/console-api/src/utils/serialize.ts` to contain:

- `toIsoOrNull(...)`
- `toIsoStrict(...)`
- `idOrNull(...)`

Refactor the transformer files above to consume those helpers, while keeping feature-specific DTO fragments local:

- `sourceHeader(...)` stays in `source-data.transformer.ts`
- `toOperatorHeader(...)` stays in `satellite-enrichment.transformer.ts`
- no generic `toListResult(...)` service abstraction is introduced

## Families explicitly kept separate

These must be recorded in `scripts/object-similarity-policy.json` as `keep-separate`.

### 1. LLM providers

- `packages/thalamus/src/transports/providers/openai.provider.ts`
- `packages/thalamus/src/transports/providers/minimax.provider.ts`
- `packages/thalamus/src/transports/providers/kimi.provider.ts`
- `packages/thalamus/src/transports/providers/local.provider.ts`

Reason:
- same interface, but materially different auth, endpoints, limits, payloads, parsing, and logging concerns

### 2. Service pass-throughs that exist to preserve layering

- `apps/console-api/src/services/sim-memory.service.ts`
- `apps/console-api/src/services/sim-terminal.service.ts`
- service/repository or service/http-adapter mirror pairs such as:
  - `apps/console-api/src/services/sim-runtime-store.service.ts`
  - `packages/sweep/src/sim/http/runtime-store.adapter.ts`
  - `apps/console-api/src/services/sim-swarm-store.service.ts`
  - `packages/sweep/src/sim/http/swarm-store.adapter.ts`

Reason:
- they are thin, but they express the service layer boundary
- replacing them with generic delegation would lower clarity for little gain
- only their shared DTOs, builders, and pure mapping logic should be normalized

### 3. SSA daemon DAG declarations

- `apps/console-api/src/agent/ssa/daemon-dags.ts`

Reason:
- repeated node object shapes are declarative data
- keep as-is unless a second module consumes the same DAG grammar and needs a builder/registry abstraction

### 4. Read-only view services that are already thin and explicit

- `apps/console-api/src/services/source-data.service.ts`
- `apps/console-api/src/services/orbital-analysis.service.ts`
- `apps/console-api/src/services/satellite-view.service.ts`
- `apps/console-api/src/services/payload-view.service.ts`
- `apps/console-api/src/services/conjunction-view.service.ts`
- `apps/console-api/src/services/kg-view.service.ts`
- `apps/console-api/src/services/opacity.service.ts`

Reason:
- these services are visibly thin, but their current shape is still readable and feature-local
- forcing a generic `list->transform->{items,count}` abstraction would save little and would hide feature vocabulary
- the real gains in these flows are upstream in controller factories and repository SQL fragments
- the real gains in these flows are upstream in repository SQL fragments, helper extraction, and route composition cleanup

### 5. Already-good local query-builder patterns

- `apps/console-api/src/repositories/queries/operator-fleet-rollup.ts`
- `apps/console-api/src/repositories/fleet-analysis.repository.ts`
- `apps/console-api/src/repositories/satellite-fleet.repository.ts`
- `apps/console-api/src/repositories/payload.repository.ts`

Reason:
- these modules already express a good balance of local reuse, explicit SQL, and bounded responsibility
- they should be used as style references for the new repository query fragments
- they are not primary cleanup targets unless a new audit finds a concrete bug or regression risk

### 6. Feature-local service `rows -> items -> count` methods

- `apps/console-api/src/services/source-data.service.ts`
- `apps/console-api/src/services/orbital-analysis.service.ts`
- `apps/console-api/src/services/satellite-audit.service.ts`
- `apps/console-api/src/services/satellite-enrichment.service.ts`
- `apps/console-api/src/services/conjunction-view.service.ts`
- `apps/console-api/src/services/payload-view.service.ts`
- `apps/console-api/src/services/satellite-view.service.ts`
- `apps/console-api/src/services/opacity.service.ts`

Reason:
- they are visibly repetitive, but the remaining duplication is shallow and feature-revealing
- replacing them with a generic `listResult(repoCall, mapper)` helper would save little and reduce readability
- the meaningful cleanup for these flows is already captured in schema/controller/transformer/repository work

### 7. Explicit controllers with shallow parse/delegate flow

- `apps/console-api/src/controllers/sources.controller.ts`
- `apps/console-api/src/controllers/orbital.controller.ts`
- `apps/console-api/src/controllers/satellite-audit.controller.ts`
- `apps/console-api/src/controllers/conjunctions.controller.ts`
- `apps/console-api/src/controllers/satellite-enrichment.controller.ts`
- `apps/console-api/src/controllers/sim-*.controller.ts`

Reason:
- the duplication is visible, but mostly shallow and readable
- introducing a shared controller factory makes the code less beautiful and less direct
- only sim-local utility extraction remains allowed, not cross-controller genericization

## Implementation plan

## Phase 1 — Build the inventory and policy guard

1. Implement `scripts/object-similarity-report.ts`.
2. Group similar objects into families.
3. Produce machine-readable output.
4. Create `scripts/object-similarity-policy.json`.
5. Classify each family into:
   - `unify-local`
   - `unify-boundary-safe`
   - `normalize-shape`
   - `keep-separate`
6. Add:
   - `obj:report`
   - `obj:check`

### Acceptance

- the repo has a stable inventory
- all currently known candidate families are classified
- `obj:check` fails when a new unclassified family appears

## Phase 2 — Unify pure helpers

1. Add `packages/shared/src/utils/markup.ts`
2. Add `packages/sweep/src/sim/utils/stats.ts`
3. Add `apps/console-api/src/utils/serialize.ts`
4. Replace duplicated helpers with imports
5. Add any seed-local shared helpers under `packages/db-schema/src/seed/`

### Acceptance

- no remaining duplicate pure helper implementations in the targeted files
- typecheck and affected unit tests pass

## Phase 3 — Unify source fetcher envelopes

1. Add `source-result.builder.ts`
2. Migrate fetchers one by one
3. Preserve existing `SourceResult` semantics exactly

### Acceptance

- no behavior change in fetcher outputs
- repeated `fetchedAt/latencyMs/result wrapper` scaffolding is eliminated from targeted fetchers

## Phase 4 — Split sim route composition and normalize repository SQL fragments

1. Split `apps/console-api/src/routes/sim.routes.ts` into feature route modules while preserving hooks and paths
2. Add `source-item-base.ts` and migrate `SourceRepository`
3. Add `satellite-dimensions.ts` and migrate `SatelliteRepository`, `SatelliteEnrichmentRepository`, `ReflexionRepository`, and `UserFleetRepository`
4. Add `sim-terminal-latest.ts` and migrate both `SimTerminalRepository` queries
5. Add `research-edge-label.ts` and migrate `KgRepository` plus `ResearchEdgeRepository`
6. Add `space-weather-latest.ts` and migrate `SpaceWeatherRepository` plus the weather branch in `SatelliteAuditRepository`
7. Add `utils/request-schema.ts` and migrate only truly shared request-schema helpers
8. Expand `utils/serialize.ts` and migrate shared date/id helpers
9. Rewrite `SatelliteRepository.getOperatorCountrySweepStats()` to remove the current N+1 query pattern

### Acceptance

- `sim.routes.ts` becomes a pure composition file
- repository SQL duplication drops materially without introducing a generic query framework
- `SimTerminalRepository` still returns identical shapes with fewer repeated SQL blocks
- `SpaceWeatherRepository` and the weather branch of `SatelliteAuditRepository` resolve latest forecast rows through one canonical fragment
- duplicated schema primitives and transformer date/id helpers are consolidated without creating a framework
- `getOperatorCountrySweepStats()` completes in one logical round-trip and keeps the same output shape

## Phase 5 — Unify orchestration flows

1. Refactor `repl-followup-executor.ssa.ts`
2. Add `packages/sweep/src/sim/runner-shared.ts`
3. Refactor both turn runners to consume the shared logic
4. Fold `loadGodEvents` into the same shared runner module
5. Keep runner-specific orchestration local

### Acceptance

- both runner files shrink materially
- behavior remains unchanged under existing tests
- no new ports or DI complexity are introduced

## Phase 6 — Normalize DTO shapes and registries

1. Add `packages/shared/src/dto/sim-http.dto.ts`
2. Update console-api and sweep HTTP sides to consume shared DTO types
3. Add `apps/console/src/features/ops/regime-model.ts`
4. Add additional frontend registries only when audit confirms at least two real consumers
5. Update consumers to use the shared source of truth

### Acceptance

- transport shape duplication is reduced without coupling layers
- frontend regime constants have one clear source of truth

## Test cases and validation

Run after each phase:

- `pnpm run obj:report`
- `pnpm run obj:check`
- `pnpm run dup:check`
- `pnpm run arch:check:repo`
- `pnpm run typecheck`

Targeted tests to add:

- object similarity script:
  - detects similar functions
  - detects similar controller patterns
  - ignores tests/docs/migrations/fixtures
  - respects `keep-separate` policy
- markup helper tests:
  - entity decode
  - tag strip
  - XML tag extraction
- stats helper tests:
  - percentile edge cases
- route composition tests:
  - `sim.routes.ts` preserves all existing public and kernel paths after the split
- follow-up executor tests:
  - telemetry and pc follow the same shared flow
- sim runner tests:
  - shared `callAgent`, `buildContext`, and `loadGodEvents` preserve output
- repository SQL helper tests:
  - source-item base fragments preserve ordering and filters
  - satellite dimension fragments preserve nullability and aliases
  - `SimTerminalRepository` latest-turn and `turnsPlayed` outputs stay identical
  - research-edge label resolution stays identical in `kg` and `research-edge`
  - latest space-weather selection stays identical in `space-weather` and `satellite-audit`
  - `getOperatorCountrySweepStats()` preserves payload/sample output while removing the looped queries
- schema primitive tests:
  - numeric id validation remains strict across all migrated schemas
  - optional query string/number semantics stay identical for blank and invalid inputs
- transformer helper tests:
  - `toIsoOrNull`, `toIsoStrict`, and `idOrNull` preserve current null and invalid-date behavior
- frontend regime model tests:
  - visibility defaults
  - palette lookups
  - count logic if extracted
- seed helper tests:
  - `classifyRegime` stays consistent across all seed consumers
  - heap/offer helpers preserve ordering semantics if centralized

## Acceptance criteria

The branch is complete when:

- every family marked `unify-local`, `unify-boundary-safe`, or `normalize-shape` is implemented
- every remaining family is explicitly classified `keep-separate`
- `obj:check` passes
- `dup:check` does not regress
- `arch:check:repo` passes
- package agnosticity remains intact
- behavior is unchanged across existing tests relevant to touched areas

## Risks and mitigations

- **Risk:** shared helpers leak SSA concepts into generic packages
  **Mitigation:** only move pure, domain-agnostic logic to `@interview/shared`

- **Risk:** runner unification increases DI complexity
  **Mitigation:** use a small local shared module with explicit parameterization only

- **Risk:** DTO normalization accidentally couples transport and domain models
  **Mitigation:** share transport types only; keep mappers local

- **Risk:** frontend registry cleanup centralizes presentation constants that are not actually shared
  **Mitigation:** require at least two real consumers before extracting a registry

- **Risk:** seed-script helper extraction changes algorithmic behavior in one pass but not the others
  **Mitigation:** add seed-local regression tests before centralizing the helper

## Assumptions and defaults

- current test-focused branch merges before this branch starts
- this branch is allowed to touch `apps/`, `packages/`, and `scripts/`
- no schema/database migration is part of this work
- no HTTP contract should change unless a shared DTO already reflects the existing contract exactly
- no family should be unified if the resulting abstraction is harder to understand than the original duplication
