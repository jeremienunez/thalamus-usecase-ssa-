# Cortex Data Provider — HTTP migration

**Date:** 2026-04-18
**Status:** proposal (future feature branch — not in scope of current agnosticity refactor)
**Spec ID:** SPEC-SSA-028

## Intent

Eliminate the second-contract violation between the thalamus `CortexDataProvider`
port and console-api services. Today the provider is an adapter that imports
services directly (`satelliteEnrichment.replacementCost(p as any)`), bypassing
the HTTP layer that already exists for every one of its 20 query methods.

Per `CLAUDE.md` §3.2 — "If both HTTP and direct in-process consumption exist
for the same boundary, the refactor is not finished."

## Motivation — grounded in observed failure

Cycle 405 (query _"Starlink v2 mini rideshare auction pricing vs dedicated
Falcon 9 LEO insertion 2025 — space weather impact on reentry cadence"_):

- **`replacement_cost_analyst`** emitted `{bus: "Starlink-v2-mini", " rideshare_flag": true}` to `queryReplacementCost`. Helper declares `satelliteId: number` — it got none. Service received `satelliteId: undefined` and silently returned 0 rows. Fell through to web fallback, skill contract refused to emit, meta-finding surfaced.
- **`apogee_tracker`** emitted `{fleet: "Starlink", shell: "560"}`. `noradId` undefined → the satellite branch was skipped entirely, only news rows returned, skill couldn't match its `kind` routing, emitted nothing.
- **`debris_forecaster`** emitted `{regime: "LEO-560", cycle: 25}`. Helper ignored every param, returned the same generic arXiv/news mix it always returns, skill dutifully emitted 4 findings on lunar supernova debris and plasma solitons — **irrelevant to the query**. Worse than silent-zero: false positive.
- **`launch_scout`** was the only cortex that emitted relevant findings — because `queryLaunchManifest` is the **only** helper with defensive param normalization (see `cortex-data-provider.ts:86-112`).

All four helpers received malformed params. Three silently tolerated
(producing either zero or irrelevant output). Only one had a defense built in,
and that defense is duplicated nowhere.

HTTP routes with Zod validation exist for all 20 query methods. If the
`CortexDataProvider` consumed them, the malformed `replacement_cost_analyst`
call would have returned a 400 Bad Request visible to the planner reflexion,
instead of a silent schema-mismatch meta-finding.

## Scope

- Replace `buildCortexDataProvider(deps)` (direct service import) with
  `buildCortexDataProvider({ baseUrl, token })` (HTTP client).
- Each of the 20 query methods becomes a typed `fetch()` against the existing
  route, with the route's Zod schema as the serde contract.
- Skill `params:` frontmatter aligned 1:1 with route Zod query schemas —
  single source of truth.
- `.strict()` added to every Zod query schema so extras raise 400 instead of
  being silently stripped.

## Non-goals

- Does **not** fix the static helper bug in `TrafficForecastRepository.forecastDebris` (SQL ignores `regimeId` / `horizonYears`). That is an orthogonal data-access defect tracked separately.
- Does **not** add entity resolution ("Starlink v2 mini" → satellite id) on the planner side. That is a planner-level responsibility.

## BDD scenarios (validation matrix)

### AC-1 — strict param validation surfaces at the boundary

> **Given** the planner emits `{bus: "Starlink-v2-mini", " rideshare_flag": true}`
> **When** the cortex invokes `queryReplacementCost` through the HTTP provider
> **Then** the route responds `400 Bad Request` with Zod issue `"satelliteId: Required"`
> **And** the cycle loop logs the validation failure at WARN
> **And** no silent-zero meta-finding is emitted for this cortex

### AC-2 — planner drift absorbed when route schema has defaults

> **Given** the planner emits `{fleet: "Starlink", shell: "560"}` to `queryApogeeHistory`
> **When** the route's `ApogeeHistoryQuerySchema` is `.strict()`
> **Then** the route responds `400 Bad Request` with Zod issue `"Unrecognized keys: fleet, shell"`
> **And** the helper is never called with unusable params

### AC-3 — skill frontmatter matches route schema

> **Given** every cortex skill declares a `params:` block
> **When** a developer changes `ReplacementCostQuerySchema` to require `horizonYears`
> **Then** the skill file's `params:` frontmatter no longer matches the route
> **And** a `tsc`-level or lint-level diff test fails on CI

### AC-4 — internal HTTP auth does not leak token to kernel

> **Given** the provider is wired with a kernel-scoped token
> **When** the cortex calls any provider method
> **Then** the `Authorization` header is set by the provider adapter
> **And** the token is not reachable from `packages/thalamus/` code

### AC-5 — provider surface equivalence (regression guard)

> **Given** the old (direct) and new (HTTP) providers
> **When** a cortex calls any of the 20 methods with valid params
> **Then** both return structurally identical `items[]`
> **And** latency overhead is bounded (< 50ms median for localhost loopback)

### AC-6 — debris_forecaster false-positive surfaced

> **Given** the planner emits garbage params to `queryDebrisForecast`
> **When** the new route-based provider receives `{regime: "LEO-560", cycle: 25}`
> **Then** `.strict()` rejects `regime` + `cycle` as unrecognized
> **And** the cortex returns empty data-gap rather than 4 off-topic papers
> _(This AC validates that the HTTP migration stops the silent false-positive
> path even without fixing the static SQL helper.)_

### AC-7 — reflexion reacts to route validation failures

> **Given** a cortex received a 400 during a research cycle
> **When** reflexion evaluates the iteration
> **Then** `gaps[]` contains an entry naming the cortex + validation error
> **And** `replan=true` if remaining budget allows

## Implementation outline (for the future branch)

1. Inventory: for each of the 20 methods, record route path, Zod schema, skill frontmatter. Flag drift.
2. Replace `CortexDataProviderDeps` with `{ baseUrl, fetch, token }`.
3. Generate one typed client per route using the existing Zod schemas.
4. Add `.strict()` to all 20 query schemas.
5. Align skill `params:` with the Zod schema names — cascade-update cortex skill files.
6. Wire the 400/422 path into `reflexion` so planner validation errors become gaps.
7. Delete direct service imports from `agent/ssa/cortex-data-provider.ts`.
8. Remove `pickNumber` drift absorption — `.strict()` makes it counterproductive.

## References

- `apps/console-api/src/agent/ssa/cortex-data-provider.ts:1-121` — current bypass adapter
- `apps/console-api/src/controllers/{orbital,satellite-audit,satellite-enrichment,opacity,conjunctions,sources}.controller.ts` — existing HTTP surface
- `apps/console-api/src/schemas/{orbital,satellite-audit}.schema.ts` — existing Zod schemas
- `apps/console-api/src/agent/ssa/skills/*.md` — skill frontmatter to align
- `CLAUDE.md` §3.2 — "No second contract" rule
- Cycle 405 log excerpt — motivating failure case (conversation on 2026-04-18)
