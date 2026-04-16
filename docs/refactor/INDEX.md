# Refactor prep — index

Generated 2026-04-14. Rule: **l'abstraction s'arrête toujours au métier.**

## 🚨 CRITICAL findings (Codex xhigh audits)

Surface these FIRST in the interview — they are production blockers, not nice-to-haves.

1. **Admin auth is fake** — [sweep/middleware/auth.middleware.ts](../../packages/sweep/src/middleware/auth.middleware.ts#L1) + [routes/admin.routes.ts](../../packages/sweep/src/routes/admin.routes.ts#L18). `authenticate` hardcodes an admin user; `requireRoles` / `requireTier` are no-ops. `/admin/sweep/*` is effectively public. Source: [codex-security.md](./codex-security.md).
2. **Drizzle migration is broken / drifted** — [migrations/0000_flawless_dorian_gray.sql#L1](../../packages/db-schema/migrations/0000_flawless_dorian_gray.sql) only creates a partial `research_cycle` (just `photo_url`) vs the rich schema at [schema/research.ts](../../packages/db-schema/src/schema/research.ts); migration adds FKs to `orbit_regime`, `operator_country`, `payload`, `operator` tables that are **never created** by SQL migrations. Fresh `drizzle migrate` will fail. Source: [codex-dx-correctness.md](./codex-dx-correctness.md).
3. **Swarm aggregate can be silently dropped** — [swarm-fish.worker.ts#L122-126](../../packages/sweep/src/jobs/workers/swarm-fish.worker.ts#L122-L126) enqueues `swarmAggregateQueue.add()` in `finally` with `attempts: 1` + no error recovery. One transient Redis blip → aggregate never runs → suggestions never promote. Source: [codex-type-safety.md](./codex-type-safety.md).

## 🔴 HIGH severity (non-exhaustive — see layer docs for full list)

- **SSRF on crawler** — [crawler.ts#L191](../../packages/thalamus/src/explorer/crawler.ts#L191) fetches URLs extracted from LLM output with no validation. Poisoned URLs propagate through promotion. Also [fetcher-rss.ts#L67](../../packages/thalamus/src/cortices/sources/fetcher-rss.ts#L67) — DB URL fetched without allowlist.
- **No timeouts** on Kimi/OpenAI [llm-chat.ts#L141-154](../../packages/thalamus/src/transports/llm-chat.ts#L141-L154) or Voyage embed [voyage-embedder.ts#L45-58](../../packages/thalamus/src/utils/voyage-embedder.ts#L45-L58). Network stalls hang indefinitely.
- **Fire-and-forget `sweep()`** — [admin-sweep.controller.ts#L65-71](../../packages/sweep/src/controllers/admin-sweep.controller.ts#L65-L71) — `.catch(() => {})` swallows failures silently.
- **JSON.parse unguarded** on Redis payloads — [satellite-sweep-chat.repository.ts#L55-58](../../packages/sweep/src/repositories/satellite-sweep-chat.repository.ts#L55-L58). One corrupted entry takes down history/findings retrieval.
- **Non-exhaustive switches** in [confidence.ts#L203-310](../../packages/thalamus/src/cortices/confidence.ts#L203-L310) `promote`/`demote` — no `never` guard, new evidence kind = runtime undefined.
- **Env vars without validation** — [enrichment.ts#L12-25](../../packages/thalamus/src/config/enrichment.ts#L12-L25) — `Number(process.env.X)` accepts `NaN`, empty keys silently accepted.
- **N+1 SQL writes** in sweep resolution; missing hot-path indexes on satellite; unbounded caches in source registry + ConfidenceService; embedding regeneration of identical text. Source: [codex-perf.md](./codex-perf.md).
- **Quorum default mismatch** — `0.6` in [telemetry-swarm.service.ts#L121](../../packages/sweep/src/sim/telemetry-swarm.service.ts#L121) vs `0.8` in schema + aggregator. Acceptance behavior differs by code path. Source: [codex-dx-correctness.md](./codex-dx-correctness.md).
- **Public API porous** — `@interview/*/*` path aliases in [tsconfig.base.json#L22](../../tsconfig.base.json#L22) let consumers reach inside any package, bypassing `src/index.ts` contracts.
- **`@interview/cli` package.main is side-effectful bin** — importing the package executes the process. [packages/cli/package.json#L5](../../packages/cli/package.json#L5).

## Docs

| Doc                                                          | Scope                                                     | Key findings                                                                                                                                                                    |
| ------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [duplication.md](./duplication.md)                           | Cross-package duplication (5 basenames + hidden patterns) | 1 MERGE (`llm-json-parser` → `shared/llm`, byte-identical 154L), 2 DELETE-ORPHAN, 2 KEEP-SEPARATE + rename, hidden: `sim_swarm:{id}` template                                   |
| [god-files.md](./god-files.md)                               | 6 largest files split by domain concept                   | SPLIT: satellite.repo (7-way), sim/promote (2-way), nano-sweep.service (2-way). KEEP: sweep-resolution, nano-swarm. EXTRACT-TAIL: executor                                      |
| [graph-health.md](./graph-health.md)                         | Cycles, orphans, hubs, layering                           | 1 cycle (llm-chat ⇄ fixture-transport), 2 real orphans (8 false positives from `@/` alias), `sweep/index.ts` fan-out 56 (junk drawer), unused `@interview/db-schema` in console |
| [thalamus-organization.md](./thalamus-organization.md)       | Intra-file mixed responsibilities                         | 13 offenders, 8 prompts to hoist → `prompts/`, 4 type extractions, 7 N≥2 patterns. Top ROI: `callStructuredLlm` (5 sites, 15-30 LOC each)                                       |
| [sweep-organization.md](./sweep-organization.md)             | Intra-file mixed responsibilities                         | 5 offenders, 6 prompts to hoist, 6 hidden domain primitives misfiled, 4 patterns worth extracting now                                                                           |
| [apps-shared-organization.md](./apps-shared-organization.md) | Console + console-api + shared                            | OpsMode/ThalamusMode need hook+Hud+Drawer split, ~60% of `shared/` has 0 consumers, DTO held by comment-coupling                                                                |
| [\_depcruise-summary.md](./_depcruise-summary.md)            | Raw dep-cruiser metrics                                   | 247 modules, 10 orphans, 1 cycle, top hubs                                                                                                                                      |
| [\_depcruise.json](./_depcruise.json)                        | Full dependency graph                                     | source of truth                                                                                                                                                                 |

## Codex audits

### Verification passes (audit Claude docs against code)

- [codex-audit-duplication.md](./codex-audit-duplication.md) — CONFIRM with off-by-one line counts
- [codex-audit-god-files.md](./codex-audit-god-files.md)
- [codex-audit-graph-health.md](./codex-audit-graph-health.md)

### Layer audits (Codex xhigh, fresh eyes — finds what Claude missed)

- [codex-db-schema.md](./codex-db-schema.md) — schema organization, enum hygiene, seed files, relations
- [codex-jobs-workers.md](./codex-jobs-workers.md) — BullMQ worker hygiene, cross-worker duplication
- [codex-tests.md](./codex-tests.md) — fixture reuse, setup/teardown duplication, test-file outliers
- [codex-perf.md](./codex-perf.md) — N+1 queries, re-renders, unbounded caches, embedding waste
- [codex-security.md](./codex-security.md) — auth gaps (CRIT), SSRF (HIGH), input validation
- [codex-type-safety.md](./codex-type-safety.md) — `as unknown as` casts, missing timeouts, non-exhaustive switches
- [codex-observability.md](./codex-observability.md) — log consistency, trace correlation, metrics gaps
- [codex-dx-correctness.md](./codex-dx-correctness.md) — migration drift (CRIT), magic numbers, dead code

## Top-priority actions (ROI-ordered, cross-doc)

### Quick wins (minutes, zero risk)

1. **Fix dep-cruiser config** — resolve `@/` alias, `doNotFollow` configs + `.d.ts`. Clears 6/10 false-positive orphans.
2. **Delete 2 real orphans**: [sweep/utils/satellite-entity-patterns.ts](../../packages/sweep/src/utils/satellite-entity-patterns.ts), [thalamus/utils/sql-helpers.ts](../../packages/thalamus/src/utils/sql-helpers.ts).
3. **Remove unused `@interview/db-schema`** from [apps/console/package.json](../../apps/console/package.json).
4. **Collapse duplicate `useUtcClock`** in [OpsMode.tsx L30-37](../../apps/console/src/modes/ops/OpsMode.tsx#L30-L37) → import from [lib/useUtcClock.ts](../../apps/console/src/lib/useUtcClock.ts).
5. **Shared cleanup** — delete 0-consumer modules: `metrics.ts`, `auth.enum.ts`, `utils/json.ts`, inline helpers in `utils/index.ts`. Demote `messaging.enum`, `payload-profile.schema`.

### High-impact refactors (hours)

6. **Break cycle** llm-chat ⇄ fixture-transport — extract `transports/types.ts` + `factory.ts`, drop `require()`.
7. **Create `packages/thalamus/src/prompts/`** — hoist 8 inline prompts (planner, reflexion, scout, curator, cortex-analysis, cortex-web-search-fallback, nano-researcher, crawler-web-search).
8. **Create `packages/sweep/src/prompts/`** — hoist 6 inline prompts (data-quality-audit, operator-country-briefing, satellite-chat-system, satellite-chat-extract, operator-agent-persona, rename sim/prompt.ts).
9. **Extract `callStructuredLlm`** (thalamus) — 5 sites, 15-30 LOC each, highest single-refactor ROI.
10. **Extract `sim/turn-agent-call.ts` + `sim/turn-context.ts`** — kills ~250 LOC of line-identical duplication between seq/DAG turn-runners.
11. **Rename `thalamus/cortices/sql-helpers.*` → `cortices/queries/*`** — name matches intent, fan-out 24 → proper label.

### Major splits (days)

12. **Split [satellite.repository.ts](../../packages/sweep/src/repositories/satellite.repository.ts) (1319L)** → 4 files in order: `satellite-bus-telemetry.repository.ts` → `data-quality-audit.repository.ts` → `operator-country.repository.ts` → `satellite-catalog.repository.ts`.
13. **Split [sim/promote.ts](../../packages/sweep/src/sim/promote.ts)** → `kg-promotion.ts` (UC3) + `telemetry-inference-emission.ts` (SPEC-TH-040).
14. **Split [nano-sweep.service.ts](../../packages/sweep/src/services/nano-sweep.service.ts)** → residual (LLM audit + briefing) + `null-scan-sweep.service.ts` (deterministic, schema-introspection).
15. **Split [sweep/src/index.ts](../../packages/sweep/src/index.ts)** barrel (fan-out 56) → `@interview/sweep` root (~12) + `/sim` + `/jobs` + `/dto`.
16. **Split `observability/index.ts` barrel** → `@interview/shared/logger` + `/metrics` + `/steps`.

### Interview-defensible organization

17. **Thalamus**: `services/thalamus-{planner,executor,reflexion}.service.ts` + `thalamus.service.ts` → **`pipeline/`** directory (documents the data flow).
18. **Thalamus**: `transports/` + `cortices/cortex-llm.ts` + new `prompts/` + new transports → **`llm/`** sub-package.
19. **Console**: complete per-mode folder convention — `modes/thalamus/` split into Mode/Hud/Drawer/Filters/layout mirroring `modes/ops/` and `modes/sweep/`.
20. **Console↔API**: extract `packages/console-contracts` (or shared sub-path) for DTO types held by `// keep in sync` comment.

## Rules enforced in cruiser (prevent regression)

- `no-circular` — prevents future cycles
- `no-orphans` — with exceptions for `.d.ts` + `*.config.*`
- `no-deep-imports-across-packages` — forces package-root or named sub-barrel imports
- `shared-cannot-import-db-schema-or-apps` — protects layering

## What the rule rejected (noted, not acted on)

- `escapeIlike` shared util — 3-line regex helper, only 1 real consumer
- Generic `mean()` / `AbortSignal.timeout` wrappers — technical primitives, not domain
- Preemptive `features/uc3-conjunction/` reorganization in sweep — diff cost > clarity gain at current scale
- Splitting `nano-swarm.ts` into decomposer/caller/merger — single cohesive domain (60% is data)
- Splitting `sweep-resolution.service.ts` handlers — all variants of one reviewer-accept lifecycle
