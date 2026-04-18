# Thalamus cortex config — runtime-tunable

**Date:** 2026-04-18
**Status:** proposal (future feature branch — out of scope of current agnosticity refactor)
**Spec ID:** SPEC-TH-025

## Intent

Migrate `packages/thalamus/src/cortices/config.ts` from a frozen `as const`
module-level export to a runtime-tunable `ConfigProvider<T>` surface. Reuse the
existing `RuntimeConfigService` + `PATCH /api/config/runtime/:domain`
infrastructure — no new route is needed.

Budget tweaks (max iterations per complexity, cost caps, confidence targets,
TTLs, correlation thresholds, RSS cadence, explorer caps) must become
operator-controlled without a redeploy.

## Motivation

Current `THALAMUS_CONFIG` and `ITERATION_BUDGETS` are frozen at build time.
When cycle 405 exhausted its $0.10 `deep` budget after 2 iterations and the
operator wanted to extend it to $0.25 for a deeper sweep, the only options
were:

- restart the process with a hardcoded new constant, or
- accept the early `cost-exhausted` stop.

`thalamus.nano` and `thalamus.nanoSwarm` already solved this pattern:
`RuntimeConfigService.provider("thalamus.nano")` returns a
`ConfigProvider<NanoConfig>` backed by Redis, and the
`PATCH /api/config/runtime/thalamus.nano` route lets ops tune
`concurrency`, `timeoutMs`, `retries` etc. live. This spec extends the same
pattern to cortex-loop budgets, guardrails, correlation, RSS, and explorer.

## Scope

Split `THALAMUS_CONFIG` into independently-tunable sub-domains, each registered
with `RuntimeConfigRepository` under its own Redis key + Zod schema:

| Domain key             | Current constant(s)           | Consumer                                  |
| ---------------------- | ----------------------------- | ----------------------------------------- |
| `thalamus.loop`        | `THALAMUS_CONFIG.loop`        | `CycleLoopService`, `StopCriteriaService` |
| `thalamus.budgets`     | `ITERATION_BUDGETS`           | planner complexity dispatch               |
| `thalamus.cortex`      | `THALAMUS_CONFIG.cortex`      | `StandardStrategy` timeout + payload caps |
| `thalamus.graph`       | `THALAMUS_CONFIG.graph`       | finding-persister TTL                     |
| `thalamus.guardrails`  | `THALAMUS_CONFIG.guardrails`  | `sanitizeDataPayload`                     |
| `thalamus.correlation` | `THALAMUS_CONFIG.correlation` | field-correlation cortex                  |
| `thalamus.rss`         | `THALAMUS_CONFIG.rss`         | RSS pipeline schedulers                   |
| `thalamus.explorer`    | `THALAMUS_CONFIG.explorer`    | `ExplorerOrchestrator`                    |

Each consumer switches from direct import `THALAMUS_CONFIG.loop.maxIterationsPerChain`
to `await this.loopConfig.get().then(c => c.maxIterationsPerChain)`.

`noveltyThreshold(iteration)` stays a pure function — no config state.

`THALAMUS_CONFIG.data` (satellite counts, cortex counts) is **telemetry**, not
config — remains frozen. Covered by `/api/stats` separately.

## Non-goals

- Does **not** introduce a new HTTP route. `PATCH /api/config/runtime/:domain`
  is already the contract.
- Does **not** change the shape of any config field. Migration is pass-through:
  today's constants become tomorrow's defaults.
- Does **not** touch `packages/thalamus/src/prompts/nano-swarm.prompt.ts`
  profile — that is domain injection, not runtime tuning.

## BDD scenarios

### AC-1 — default parity (no regression)

> **Given** no operator override has been applied
> **When** a cortex reads its config via the provider
> **Then** every field equals the `THALAMUS_CONFIG` / `ITERATION_BUDGETS` constant it replaces

### AC-2 — patch without redeploy

> **Given** the server is running with defaults
> **When** `PATCH /api/config/runtime/thalamus.budgets` sets `deep.maxCost` to `0.25`
> **Then** the next research cycle with `complexity=deep` accepts costs up to $0.25
> **And** no process restart is required

### AC-3 — schema-validated patches

> **Given** an operator emits `PATCH /api/config/runtime/thalamus.loop` with `maxCostPerDay: "cheap"`
> **When** the route validates against the registered Zod schema
> **Then** the response is `400 Bad Request` with the Zod issue list
> **And** the Redis value is unchanged

### AC-4 — per-domain reset

> **Given** `thalamus.cortex.timeoutMs` was patched to `180000`
> **When** `DELETE /api/config/runtime/thalamus.cortex` is invoked
> **Then** the next read returns the default `90000`
> **And** other domains (`thalamus.loop`, `thalamus.budgets`, etc.) are unaffected

### AC-5 — provider caching avoids hot-loop Redis storms

> **Given** a cortex that calls `config.get()` inside a per-row loop
> **When** the loop runs 500 rows
> **Then** Redis is read at most once per TTL window (implementation detail, e.g. 5s)
> **And** the provider honours patches within one TTL window

### AC-6 — observability of in-effect config

> **Given** runtime overrides exist on multiple domains
> **When** the operator calls `GET /api/config/runtime`
> **Then** the response lists every domain + default values + any active override
> **And** each field is annotated with its consumer (cortex, service, route)

### AC-7 — migration is opt-in per consumer

> **Given** the refactor is landed domain by domain
> **When** `thalamus.loop` is migrated but `thalamus.rss` is not
> **Then** both consumers still work
> **And** un-migrated consumers import the frozen constant unchanged

## Implementation outline (future branch)

1. Define Zod schema for each domain in `packages/shared/src/config/thalamus.ts`.
2. Extend `RuntimeConfigRepository`'s known-domain registry with the 8 new keys.
3. Export `setLoopConfigProvider`, `setBudgetsConfigProvider`, etc. in
   thalamus package (one per domain), matching the `setNanoSwarmConfigProvider`
   shape.
4. Each consumer declares its provider as a required ctor arg (DI).
5. Container wiring in `apps/console-api/src/container.ts`:
   ```ts
   setLoopConfigProvider(runtimeConfigService.provider("thalamus.loop"));
   setBudgetsConfigProvider(runtimeConfigService.provider("thalamus.budgets"));
   // ... one per domain
   ```
6. Delete `as const` from `cortices/config.ts`; keep the constants as the
   `DEFAULT_*` objects the providers start with.
7. Add contract test per domain: default → patch → read → matches.

## References

- `packages/thalamus/src/cortices/config.ts` — current frozen constants
- `apps/console-api/src/routes/runtime-config.routes.ts` — existing route
- `apps/console-api/src/services/runtime-config.service.ts` — provider factory
- `packages/thalamus/src/explorer/nano-swarm.ts:38-45` — precedent pattern
- `apps/console-api/src/container.ts:208-211` — precedent wiring
