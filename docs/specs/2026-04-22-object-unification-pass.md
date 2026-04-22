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

The branch should remove the highest-value repetition in orchestration flows, controller shells, source fetcher envelopes, pure parsing/stat helpers, DTO shapes, and selected declarative registries.

### Expected payoff

Grounded estimate:

- **~900 to 1300 LOC** of similar logic touched or normalized
- **~350 to 550 net LOC removed**
- possible stretch target: **~500 to 700 net LOC** if additional safe controller/DTO unifications are folded in during execution

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
- `packages/shared/src/types/sim-http.ts`

Ensure they are exported through existing subpath conventions in `packages/shared/package.json`.

### Feature-local shared modules

- `apps/console-api/src/controllers/controller-factories.ts`
- `apps/console-api/src/agent/ssa/sources/source-result.builder.ts`
- `apps/console-api/src/agent/ssa/sim/aggregators/stats.ts`
- `apps/console-api/src/transformers/helpers.ts`
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

## 2. Pure stat helpers in sim aggregators

### Candidates

- `percentile`
  - `apps/console-api/src/agent/ssa/sim/aggregators/pc.ts`
  - `apps/console-api/src/agent/ssa/sim/aggregators/telemetry.ts`

### Decision

`unify-local`

### Action

Create `apps/console-api/src/agent/ssa/sim/aggregators/stats.ts` and move all shared numeric/stat helpers there.

## 3. Repeated transformer helpers

### Candidates

- `toIso`
  - `apps/console-api/src/transformers/satellite-enrichment.transformer.ts`
  - `apps/console-api/src/transformers/source-data.transformer.ts`
  - `apps/console-api/src/transformers/traffic-forecast.transformer.ts`

### Decision

`unify-local`

### Action

Create `apps/console-api/src/transformers/helpers.ts` and move shared projection helpers there.

## 4. Source fetcher result envelopes

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

## 5. Controller shells in console-api

### High-ROI groups

Strong repeated skeletons exist in:

- `apps/console-api/src/controllers/sources.controller.ts`
- `apps/console-api/src/controllers/findings.controller.ts`
- `apps/console-api/src/controllers/orbital.controller.ts`
- `apps/console-api/src/controllers/sim-run.controller.ts`
- `apps/console-api/src/controllers/sim-swarm.controller.ts`
- `apps/console-api/src/controllers/sim-terminal.controller.ts`
- `apps/console-api/src/controllers/sim-orchestrator.controller.ts`

Patterns include:

- parse query -> delegate
- parse params -> lookup by id -> notFound -> map dto
- parse params -> lookup by id -> count -> dto
- parse params/body -> lookup -> transition guard -> mutate

### Decision

`unify-local`

### Action

Create `apps/console-api/src/controllers/controller-factories.ts` with exactly these utilities:

- `makeQueryController`
- `makeParamsController`
- `makeParamsQueryController`
- `makeBodyController`
- `makeParamsBodyController`
- `makeLookupController`
- `makeCountController`
- `makeMutationController`

These must remain thin wrappers around:
- `asyncHandler`
- `parseOrReply`
- local id parsing / not-found helpers

They must not become a controller framework.

## 6. Similar follow-up execution flows

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

## 7. Similar sim runner internals

### Candidates

Across:
- `packages/sweep/src/sim/turn-runner-dag.ts`
- `packages/sweep/src/sim/turn-runner-sequential.ts`

Shared logic already observed:
- `callAgent`
- `buildContext`

### Decision

`unify-local`

### Action

Create `packages/sweep/src/sim/runner-shared.ts` containing:

- `callAgentTurn(...)`
- `buildAgentContext(...)`

Allowed parameterization:
- memory query string
- any narrow runner-specific variation already present

Not allowed:
- new kernel ports
- inheritance hierarchy
- pushing this into the container layer

## 8. Transport DTO symmetry between console-api and sweep HTTP adapters

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

Create `packages/shared/src/types/sim-http.ts` with shared DTO/type definitions for transport shapes only.

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

## 9. Frontend regime constants as source-of-truth candidates

### Observed similarity

The same regime set and related mappings appear in:

- `apps/console/src/features/ops/opsFilterStore.ts`
- `apps/console/src/hooks/useRegimeFilter.ts`
- `apps/console/src/adapters/renderer/palette.ts`
- likely `apps/console/src/features/ops/RegimeFilter.tsx`

### Decision

`normalize-shape`

### Action

Create `apps/console/src/features/ops/regime-model.ts` with:

- `REGIME_KEYS`
- `DEFAULT_REGIME_VISIBILITY`
- regime palette constants
- ring palette constants
- lightweight helpers for regime counts/order if needed

Do not move unrelated feature presets there.

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

Reason:
- they are thin, but they express the service layer boundary
- replacing them with generic delegation would lower clarity for little gain

### 3. SSA daemon DAG declarations

- `apps/console-api/src/agent/ssa/daemon-dags.ts`

Reason:
- repeated node object shapes are declarative data
- keep as-is unless a second module consumes the same DAG grammar and needs a builder/registry abstraction

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
2. Add `apps/console-api/src/agent/ssa/sim/aggregators/stats.ts`
3. Add `apps/console-api/src/transformers/helpers.ts`
4. Replace duplicated helpers with imports

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

## Phase 4 — Introduce controller factories

1. Add `controller-factories.ts`
2. Migrate `sources.controller.ts`
3. Migrate `findings.controller.ts`
4. Migrate `orbital.controller.ts`
5. Migrate `sim-*` controller groups in descending ROI order

### Acceptance

- controller files get smaller without hiding business-specific logic
- no controller->repository violations are introduced
- request parsing and HTTP behavior remain identical

## Phase 5 — Unify orchestration flows

1. Refactor `repl-followup-executor.ssa.ts`
2. Add `packages/sweep/src/sim/runner-shared.ts`
3. Refactor both turn runners to consume the shared logic
4. Keep runner-specific orchestration local

### Acceptance

- both runner files shrink materially
- behavior remains unchanged under existing tests
- no new ports or DI complexity are introduced

## Phase 6 — Normalize DTO shapes and registries

1. Add `packages/shared/src/types/sim-http.ts`
2. Update console-api and sweep HTTP sides to consume shared DTO types
3. Add `apps/console/src/features/ops/regime-model.ts`
4. Update consumers to use the shared regime source of truth

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
  - detects similar controller shells
  - ignores tests/docs/migrations/fixtures
  - respects `keep-separate` policy
- markup helper tests:
  - entity decode
  - tag strip
  - XML tag extraction
- stats helper tests:
  - percentile edge cases
- controller factory tests:
  - query parse
  - params parse
  - params/body parse
  - notFound and count wrappers
- follow-up executor tests:
  - telemetry and pc follow the same shared flow
- sim runner tests:
  - shared `callAgent` and `buildContext` preserve output
- frontend regime model tests:
  - visibility defaults
  - palette lookups
  - count logic if extracted

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

- **Risk:** controller factories become over-generic
  **Mitigation:** cap factories at parse/delegate/count/mutation scaffolds only

- **Risk:** shared helpers leak SSA concepts into generic packages
  **Mitigation:** only move pure, domain-agnostic logic to `@interview/shared`

- **Risk:** runner unification increases DI complexity
  **Mitigation:** use a small local shared module with explicit parameterization only

- **Risk:** DTO normalization accidentally couples transport and domain models
  **Mitigation:** share transport types only; keep mappers local

## Assumptions and defaults

- current test-focused branch merges before this branch starts
- this branch is allowed to touch `apps/`, `packages/`, and `scripts/`
- no schema/database migration is part of this work
- no HTTP contract should change unless a shared DTO already reflects the existing contract exactly
- no family should be unified if the resulting abstraction is harder to understand than the original duplication
