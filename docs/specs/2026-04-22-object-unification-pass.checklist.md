# Object Unification Pass — execution checklist

Companion doc for `docs/specs/2026-04-22-object-unification-pass.md`.

Purpose:
- turn the spec into a branch-ready implementation sequence
- keep scope tight around high-ROI unifications
- preserve agnosticity and package boundaries at every step

Branch precondition:
- start only after the current test-focused branch is merged

Recommended branch name:
- `feat/object-unification-pass`

## Working rules

- Do not change HTTP contracts.
- Do not introduce `packages -> apps` imports.
- Do not move SSA-specific logic into kernel-generic packages.
- Do not introduce a generic framework for controllers, services, or repositories.
- Prefer feature-local helpers first.
- After each phase, run:
  - `pnpm run typecheck`
  - `pnpm run arch:check:repo`
  - `pnpm run dup:check`
- After phases that add the similarity tooling, also run:
  - `pnpm run obj:report`
  - `pnpm run obj:check`

## Phase 0 — Baseline and guardrails

Goal:
- establish the inventory and keep the branch from regressing while refactors are in flight

Files to add:
- `scripts/object-similarity-report.ts`
- `scripts/object-similarity-policy.json`

Files to edit:
- root `package.json` or workspace script entrypoints that own `obj:report` and `obj:check`

Tasks:
- implement AST-based family grouping
- encode known families from the spec into the policy file
- fail `obj:check` on new unclassified high-similarity families

Acceptance:
- the tool reports all currently known families
- the policy classifies each family into `unify-local`, `unify-boundary-safe`, `normalize-shape`, or `keep-separate`

## Phase 1 — Low-risk pure helpers

Goal:
- remove the easiest repeated pure logic first

### 1A. Markup/text helpers

Files to add:
- `packages/shared/src/utils/markup.ts`

Files to edit:
- `packages/shared/package.json`
- `apps/console-api/src/agent/ssa/sources/fetcher-rss.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-arxiv.ts`
- `packages/db-schema/src/seed/sources.ts`

Tasks:
- move `decodeEntities`
- move `stripTags`
- move `pickFirstTagText` / `pickAllTagText` style helpers
- move `parseDate` only if the current semantics are identical in both consumers

Acceptance:
- no local markup parser copies remain in the targeted files

### 1B. Seed-local helpers

Files to add:
- `packages/db-schema/src/seed/helpers.ts`

Files to edit:
- `packages/db-schema/src/seed/embed-catalog.ts`
- `packages/db-schema/src/seed/screen-broadphase.ts`
- `packages/db-schema/src/seed/screen-narrow-phase.ts`

Tasks:
- centralize `classifyRegime`
- centralize heap / `offer` helpers only if ordering semantics are identical

Acceptance:
- all seed consumers use the same regime classification helper

### 1C. Stats and transformer helpers

Files to add:
- `packages/sweep/src/sim/utils/stats.ts`
- `apps/console-api/src/utils/serialize.ts`

Files to edit:
- `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts`
- `apps/console-api/src/agent/ssa/sim/aggregators/telemetry.ts`
- `apps/console-api/src/transformers/source-data.transformer.ts`
- `apps/console-api/src/transformers/traffic-forecast.transformer.ts`
- `apps/console-api/src/transformers/satellite-enrichment.transformer.ts`
- `apps/console-api/src/transformers/satellite-audit.transformer.ts`
- `apps/console-api/src/transformers/conjunction-view.transformer.ts`

Tasks:
- move `average`, `percentile`, `sampleStddev`, and other pure stat helpers into `packages/sweep/src/sim/utils/stats.ts`
- move `toIsoOrNull`, `toIsoStrict`, `idOrNull` into `utils/serialize.ts`
- leave feature-specific DTO composition helpers in place

Acceptance:
- only one shared date/id helper implementation remains in `console-api`

## Phase 2 — Source fetcher envelopes

Goal:
- normalize repeated SSA fetcher result wrapping without touching domain-specific parsing

Files to add:
- `apps/console-api/src/agent/ssa/sources/source-result.builder.ts`

Files to edit:
- `apps/console-api/src/agent/ssa/sources/fetcher-celestrak.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-regulation.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-space-weather.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-spectra.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-launch-market.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-bus-archetype.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-knowledge-graph.ts`
- `apps/console-api/src/agent/ssa/sources/fetcher-orbit-regime.ts`

Tasks:
- centralize `fetchedAt`
- centralize `latencyMs`
- centralize empty-result and wrapped-result scaffolding

Acceptance:
- all targeted fetchers share the same envelope builder

## Phase 3 — Route composition split

Goal:
- align route registration with feature boundaries already present in controllers and services

Files to add:
- `apps/console-api/src/routes/sim-runs.routes.ts`
- `apps/console-api/src/routes/sim-swarms.routes.ts`
- `apps/console-api/src/routes/sim-orchestrator.routes.ts`
- `apps/console-api/src/routes/sim-subjects.routes.ts`
- `apps/console-api/src/routes/sim-kernel.routes.ts`

Files to edit:
- `apps/console-api/src/routes/sim.routes.ts`

Tasks:
- keep `sim.routes.ts` as the composition root
- keep public auth hooks in the public branch
- keep kernel-secret hooks in the kernel branch
- preserve all existing paths verbatim

Acceptance:
- `sim.routes.ts` becomes a thin composer
- all existing routes remain registered

## Phase 4 — Repository SQL canonization

Goal:
- centralize repeated SQL fragments and remove the clearest query inefficiencies

Files to add:
- `apps/console-api/src/repositories/queries/source-item-base.ts`
- `apps/console-api/src/repositories/queries/satellite-dimensions.ts`
- `apps/console-api/src/repositories/queries/sim-terminal-latest.ts`
- `apps/console-api/src/repositories/queries/research-edge-label.ts`
- `apps/console-api/src/repositories/queries/space-weather-latest.ts`

### 5A. Source repository

Files to edit:
- `apps/console-api/src/repositories/source.repository.ts`

Tasks:
- factor common `source_item + source` select/join/order fragments
- leave each public method separate

### 5B. Satellite dimension joins

Files to edit:
- `apps/console-api/src/repositories/satellite.repository.ts`
- `apps/console-api/src/repositories/satellite-enrichment.repository.ts`
- `apps/console-api/src/repositories/reflexion.repository.ts`
- `apps/console-api/src/repositories/user-fleet.repository.ts`

Tasks:
- factor shared select/join fragments for operator/country/platform/regime/bus
- reuse only where aliases and nullability semantics actually match

### 5C. Sim terminal latest-turn queries

Files to edit:
- `apps/console-api/src/repositories/sim-terminal.repository.ts`

Tasks:
- extract the shared latest-turn CTE
- replace the correlated `turns_played` subquery with pre-aggregated counts

### 5D. Research edge label resolution

Files to edit:
- `apps/console-api/src/repositories/kg.repository.ts`
- `apps/console-api/src/repositories/research-edge.repository.ts`

Tasks:
- centralize the `entity_type -> label` CASE/join logic

### 5E. Space weather latest forecast

Files to edit:
- `apps/console-api/src/repositories/space-weather.repository.ts`
- `apps/console-api/src/repositories/satellite-audit.repository.ts`

Tasks:
- centralize `DISTINCT ON (source, epoch)` latest forecast selection
- keep horizon semantics explicit at the call site if needed

### 5F. N+1 removal in operator-country sweep stats

Files to edit:
- `apps/console-api/src/repositories/satellite.repository.ts`

Tasks:
- rewrite `getOperatorCountrySweepStats()`
- replace the current looped follow-up queries for `topPayloads` and `sampleSatellites`
- use ranked CTEs or JSON aggregates in a single SQL execution

Acceptance:
- repeated SQL blocks shrink materially
- `getOperatorCountrySweepStats()` no longer performs per-row round-trips

## Phase 5 — Schema primitives pass

Goal:
- normalize only the schema primitives that already have identical semantics in multiple consumers

Files to add:
- `apps/console-api/src/utils/request-schema.ts`

Files to edit:
- `apps/console-api/src/schemas/sources.schema.ts`
- `apps/console-api/src/schemas/orbital.schema.ts`
- `apps/console-api/src/schemas/satellite-audit.schema.ts`
- `apps/console-api/src/schemas/conjunctions.schema.ts`
- `apps/console-api/src/schemas/sim.schema.ts`

Tasks:
- extract `numericIdString(...)`
- extract `optionalNonEmptyString(...)`
- extract `optionalFiniteNumber(...)` only where blank/invalid semantics are identical
- keep `clamp.ts` unchanged as the numeric range helper module

Do not:
- create a schema meta-framework
- force all schemas through one builder API

Acceptance:
- repeated low-level parsing helpers disappear
- endpoint schema readability stays the same or better

## Phase 6 — Follow-up and runner flow unification

Goal:
- unify the repeated orchestration mechanics in the two highest-value flow clusters

### 7A. Follow-up verification

Files to edit:
- `apps/console-api/src/agent/ssa/followup/repl-followup-executor.ssa.ts`

Tasks:
- replace `executePcVerification`
- replace `executeTelemetryVerification`
- introduce `executeSwarmVerification(item, input, spec)`

### 7B. Sweep runner shared logic

Files to add:
- `packages/sweep/src/sim/runner-shared.ts`

Files to edit:
- `packages/sweep/src/sim/turn-runner-dag.ts`
- `packages/sweep/src/sim/turn-runner-sequential.ts`

Tasks:
- centralize `callAgent`
- centralize `buildContext`
- centralize `loadGodEvents`
- keep scheduling and orchestration feature-specific

Acceptance:
- the runner files are materially smaller
- no new DI/container complexity is introduced

## Phase 7 — DTO and registry normalization

Goal:
- unify shared transport shapes and the few declarative registries that really have multiple consumers

Files to add:
- `packages/shared/src/dto/sim-http.dto.ts`
- `apps/console/src/features/ops/regime-model.ts`

Files to edit:
- `packages/shared/package.json`
- `apps/console-api/src/transformers/sim-http.transformer.ts`
- `packages/sweep/src/sim/http/runtime-store.adapter.ts`
- `packages/sweep/src/sim/http/swarm-store.adapter.ts`
- `packages/sweep/src/sim/http/fleet.adapter.ts`
- `apps/console-api/src/services/sim-runtime-store.service.ts`
- `apps/console-api/src/agent/ssa/sim/fleet-provider.ts`
- `apps/console/src/features/ops/opsFilterStore.ts`
- `apps/console/src/hooks/useRegimeFilter.ts`
- `apps/console/src/adapters/renderer/palette.ts`

Conditional follow-ups only if the second real consumer is confirmed:
- `apps/console/src/features/*/source-class-model.ts`
- `apps/console/src/features/*/action-display-model.ts`

Acceptance:
- transport types are shared, but mappers remain local
- regime constants have one clear source of truth

## Phase 8 — Final sweep and policy lock

Goal:
- finish the branch with only justified `keep-separate` families remaining

Tasks:
- run `obj:report`
- classify any new family emitted during the refactor
- remove any accidental drift introduced by the branch
- update the policy file so only approved `keep-separate` families remain

Final acceptance:
- `pnpm run obj:check`
- `pnpm run dup:check`
- `pnpm run arch:check:repo`
- `pnpm run typecheck`

## Explicit non-targets for this branch

- `packages/thalamus/src/transports/providers/*`
- `apps/console-api/src/controllers/controller-factories.ts`
- generic service abstractions for thin read-only services
- generic controller abstractions for shallow parse/delegate flows
- `apps/console-api/src/repositories/payload.repository.ts`
- `apps/console-api/src/repositories/queries/operator-fleet-rollup.ts`
- `apps/console-api/src/repositories/fleet-analysis.repository.ts`
- `apps/console-api/src/repositories/satellite-fleet.repository.ts`

These stay out unless a concrete bug is found.
