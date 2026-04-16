# Graph health — refactor prep

Scope: pnpm monorepo (`shared`, `db-schema`, `sweep`, `thalamus`, `apps/console`, `apps/console-api`).
Source: [\_depcruise.json](./_depcruise.json) · [\_depcruise-summary.md](./_depcruise-summary.md).
Rule: _l'abstraction s'arrête toujours au métier_ — a hub must expose a **business** surface, not a **technical** convenience.

---

## 1. Cycles

### 1.1 `llm-chat.ts` ⇄ `fixture-transport.ts`

- [llm-chat.ts](../../packages/thalamus/src/transports/llm-chat.ts)
- [fixture-transport.ts](../../packages/thalamus/src/transports/fixture-transport.ts)

**Nature.** `llm-chat.ts` defines `LlmChatTransport`, `LlmResponse`, `LlmTransport`, and the mode-aware factory `createLlmTransportWithMode`. To support `THALAMUS_MODE=fixtures|record`, the factory does a runtime `require("./fixture-transport")` (L283). `fixture-transport.ts` does a static `import { LlmChatTransport, type LlmResponse } from "./llm-chat"` (L17). Cruiser sees both edges.

**Smell.** Factory (composition root) knows about a specific alternate. Alternate depends on the concrete class it substitutes. Business concept blurred: _"LLM transport"_ vs _"Kimi/OpenAI HTTP client"_.

**Break (invert on an interface).**

1. Extract `transports/types.ts` exporting `LlmTransport`, `LlmResponse`, `LlmChatConfig` — the domain contract.
2. `llm-chat.ts` imports types from `./types`, exports only `LlmChatTransport` + `createLlmTransport`.
3. `fixture-transport.ts` imports `LlmResponse` from `./types`; types `realTransport?: LlmTransport`. Drops structural class import.
4. Move `createLlmTransportWithMode` to `transports/factory.ts` — imports both concrete transports statically. No more `require()`.

Shape: `types.ts ← {llm-chat, fixture-transport} ← factory.ts`. Pure DAG.

---

## 2. Orphans — verdicts

**Context:** most orphans are false positives from the `@/` Vite alias not being resolved by cruiser. Fix cruiser config first.

| File                                                                                                    | Verdict                    | Evidence                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [postcss.config.js](../../apps/console/postcss.config.js)                                               | **KEEP**                   | PostCSS entrypoint. Add to cruiser `doNotFollow`.                                                                                                                                                    |
| [tailwind.config.ts](../../apps/console/tailwind.config.ts)                                             | **KEEP**                   | Tailwind entrypoint.                                                                                                                                                                                 |
| [routes/index.tsx](../../apps/console/src/routes/index.tsx)                                             | **KEEP**                   | TanStack Router file-based route.                                                                                                                                                                    |
| [CommandPalette.tsx](../../apps/console/src/components/CommandPalette.tsx)                              | **WIRED** (false positive) | Imported by [AppShell.tsx](../../apps/console/src/components/AppShell.tsx) L5.                                                                                                                       |
| [uiStore.ts](../../apps/console/src/lib/uiStore.ts)                                                     | **WIRED** (false positive) | 8 importers via `@/lib/uiStore`.                                                                                                                                                                     |
| [useUtcClock.ts](../../apps/console/src/lib/useUtcClock.ts)                                             | **WIRE-UP-MISSING**        | Imported by `TopBar.tsx` via `@/lib/useUtcClock`. **But** [OpsMode.tsx](../../apps/console/src/modes/ops/OpsMode.tsx) L30 defines a **duplicate local** `useUtcClock` — collapse to the shared hook. |
| [drizzle.config.ts](../../packages/db-schema/drizzle.config.ts)                                         | **KEEP**                   | Drizzle CLI. Add to `doNotFollow`.                                                                                                                                                                   |
| [geojson.d.ts](../../packages/sweep/src/types/geojson.d.ts)                                             | **KEEP**                   | Ambient `.d.ts` shim. Flag as type-shim.                                                                                                                                                             |
| [sweep/utils/satellite-entity-patterns.ts](../../packages/sweep/src/utils/satellite-entity-patterns.ts) | **DELETE**                 | Zero importers; live twin in thalamus.                                                                                                                                                               |
| [thalamus/utils/sql-helpers.ts](../../packages/thalamus/src/utils/sql-helpers.ts)                       | **DELETE**                 | 10-line `escapeIlike`; not imported.                                                                                                                                                                 |

---

## 3. Mega-hubs (fan-in)

### 3.1 [db-schema/src/index.ts](../../packages/db-schema/src/index.ts) — fan-in **75** — **KEEP**

18-line barrel: `export * from "./schema"; export * from "./enums"`. Sub-barrel groups 10 domain files. This is a **business surface** — persistence shape of the product. High fan-in is healthy.

_Optional polish:_ sub-barrels like `@interview/db-schema/satellite` to reduce typecheck blast-radius.

### 3.2 [shared/observability/index.ts](../../packages/shared/src/observability/index.ts) — fan-in **58** — **KEEP**

Re-exports `logger`, `metrics`, `steps`, `step-logger`. One concept. 58 call-sites are almost all `createLogger(...)`. Cross-cutting utility working as intended.

_Audit:_ verify `metrics` and `steps` don't pull heavy deps into UI bundles.

### 3.3 [shared/enum/index.ts](../../packages/shared/src/enum/index.ts) — fan-in **13** — **KEEP, dedupe**

Re-exports `research.enum`, `auth.enum`, `messaging.enum`. **Red flag:** duplicate basename `research.enum.ts` exists in both `shared` and `db-schema`. Fan-in itself is fine; the duplication is the problem. See [duplication.md §1](./duplication.md#1-researchenumts).

---

## 4. Fan-out god files

### 4.1 [sweep/src/index.ts](../../packages/sweep/src/index.ts) — fan-out **56** — **SPLIT**

Re-exports **everything**: services, repos, controllers, routes, jobs, DTOs, config, middleware, `sim/*` subsystem, 3 workers, 6 queues. **Junk drawer disguised as a package surface.**

Business concept of Sweep = _ops-review of research findings_, not _every internal sim primitive_.

**Split into sub-barrels:**

- `@interview/sweep` (root) → `buildSweepContainer`, `registerAdminSweepRoutes`, `MessagingService`, controllers, `SweepRepository`. Drops to ~12.
- `@interview/sweep/sim` → full sim subsystem.
- `@interview/sweep/jobs` → queues + workers.
- `@interview/sweep/dto` → transformers.

### 4.2 [cortices/sql-helpers.ts](../../packages/thalamus/src/cortices/sql-helpers.ts) — fan-out **24** — **RENAME**

Barrel re-exports **22 domain query files** (satellite, search, orbit-regime, rss, launch-cost-context, data-audit, classification-audit, user-mission-portfolio, user-fleet, payload-profiler, catalog, operator-fleet, orbit-slot, replacement-cost, launch-manifest, orbital-traffic, debris-forecast, advisory-feed, orbital-primer, conjunction, correlation, maneuver, observations, apogee). Only consumer: [executor.ts](../../packages/thalamus/src/cortices/executor.ts) L18.

**Not a helper — the cortex query catalog.** Name lies.

**Rename:** `cortices/sql-helpers.*.ts` → `cortices/queries/{satellite,search,...}.ts`. Barrel → `cortices/queries/index.ts`. Executor: `import * as queries`.

### 4.3 [sweep/config/container.ts](../../packages/sweep/src/config/container.ts) — fan-out **19** — **ACCEPT**

Composition root. Fan-out is intrinsic. _Minor:_ inconsistent cross-package deep import `@interview/thalamus/services/research-graph.service` — see §5.3.

### 4.4 [thalamus/config/container.ts](../../packages/thalamus/src/config/container.ts) — fan-out **10** — **ACCEPT**

Clean composition root.

---

## 5. Layering audit

### 5.1 `db-schema` → UI layer

**Clean in source, dirty in manifest.** [apps/console/package.json](../../apps/console/package.json) L15 declares `@interview/db-schema: workspace:*`. `grep apps/console/src` → **zero** matches.

**Verdict:** unused workspace dependency. Remove — console talks to `console-api` over HTTP. [apps/console-api/package.json](../../apps/console-api/package.json) L13 declares the same dep and uses it correctly.

### 5.2 `shared` → `db-schema`

`grep '@interview/(db-schema|sweep|thalamus)' packages/shared` → no matches. `shared` is correctly at the bottom. Good.

### 5.3 Cross-package deep imports

[sweep/config/container.ts](../../packages/sweep/src/config/container.ts) L15 uses `import type { ResearchGraphService } from "@interview/thalamus/services/research-graph.service";` — reaches inside another package's src. Other sweep imports use the package root.

**Fix:** either export `ResearchGraphService` from `thalamus/src/index.ts`, or add `@interview/thalamus/graph` sub-barrel.

### 5.4 Duplicate basenames

See [duplication.md](./duplication.md) for full treatment. Summary: `research.enum.ts` rename, `container.ts` both legitimate, `sql-helpers.ts` × 3 → rename cortices barrel + delete orphan, `llm-json-parser.ts` merge to shared, `satellite-entity-patterns.ts` delete sweep copy.

---

## 6. Actionable next steps — ROI-ordered

| #   | Action                                                                                                                                                                                                                                                                | Effort | Payoff                                                          |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | --------------------------------------------------------------- |
| 1   | **Fix cruiser config**: resolve `@/` alias, `doNotFollow` for configs + `.d.ts`                                                                                                                                                                                       | 15 min | Clears 6/10 false-positive orphans. Trustworthy runs.           |
| 2   | **Break `llm-chat` ⇄ `fixture-transport` cycle**: extract `types.ts` + `factory.ts`                                                                                                                                                                                   | 30 min | Zero cycles. Enables strict `no-cycles` rule.                   |
| 3   | **Delete real orphans**: [sweep/utils/satellite-entity-patterns.ts](../../packages/sweep/src/utils/satellite-entity-patterns.ts), [thalamus/utils/sql-helpers.ts](../../packages/thalamus/src/utils/sql-helpers.ts). Collapse duplicate `useUtcClock` in OpsMode.tsx. | 10 min | Removes dead code + duplicate-basename noise.                   |
| 4   | **Remove unused `@interview/db-schema` from console/package.json**                                                                                                                                                                                                    | 2 min  | Eliminates phantom layering violation.                          |
| 5   | **Rename `cortices/sql-helpers*` → `cortices/queries/*`**                                                                                                                                                                                                             | 45 min | Names match intent. Kills biggest non-composition-root fan-out. |
| 6   | **Split `sweep/src/index.ts`** into root + `/sim` + `/jobs` + `/dto`                                                                                                                                                                                                  | 2-3h   | Root barrel 56 → ~12. Each sub-barrel = coherent domain API.    |
| 7   | **Dedupe `research.enum.ts`** (shared re-exports from db-schema)                                                                                                                                                                                                      | 30 min | Kills semantic divergence bomb.                                 |
| 8   | **Unify cross-package imports**: no deep imports, enforce via cruiser rule                                                                                                                                                                                            | 20 min | Uniform boundary policy.                                        |
| 9   | **Promote `escapeIlike`** or keep colocated; delete duplicate                                                                                                                                                                                                         | 10 min | Removes last `sql-helpers.ts` duplicate.                        |
| 10  | **Cruiser guard rules**: `no-circular`, `no-orphans`, `no-deep-imports-across-packages`, `shared-cannot-import-db-schema`                                                                                                                                             | 20 min | Prevents regression. Enforceable in CI.                         |
