# Thalamus audit — session findings

**Date**: 2026-04-16
**Author**: Jeremie Nunez (session) + Claude Opus 4.6
**Status**: Diagnostic report. No implementation done.

## TL;DR

Session started with: "write tests for Thalamus to diagnose why audit cortices dominate research cycles". It exposed concrete architectural gaps that do NOT match the pitch the README claims. The planned 13-task test harness was over-engineered; the real codebase needs ~5 tasks to catch drift and verify wiring. Below is what was actually discovered, grouped by severity.

---

## Architectural findings

### F-1 — 35 `as unknown as` casts at the DB query boundary (real, low-probability)

**Count (as of `main @ a02eaa9`)**: 35 across `packages/thalamus/src/`, of which:

- 26 in `cortices/queries/*.ts` (one per query file)
- 1 in `cortices/executor.ts`
- 1 in `repositories/research-finding.repository.ts`
- 7 elsewhere

**Concrete example** — [packages/thalamus/src/cortices/queries/debris-forecast.ts:104](packages/thalamus/src/cortices/queries/debris-forecast.ts#L104):

```ts
return results.rows as unknown as DebrisForecastRow[];
```

**What this cast protects** : nothing at runtime. TypeScript strips it. The shape is trusted.

**Why the code works today** : hand-maintained 3-way mapping:

1. `db-schema/schema/satellite.ts:175` → column `mission_age` (via Drizzle `real("mission_age")`)
2. `queries/debris-forecast.ts:41` → `AS "avgMissionAge"` (raw SQL alias)
3. `queries/debris-forecast.ts:16` → `avgMissionAge: number | null` (interface field)

All three in separate files. Drift is possible.

**Real failure mode**: rename `mission_age` → `age_years` in the Drizzle schema (+migration). The raw SQL in `debris-forecast.ts` still references `mission_age` → runtime `column does not exist`. `pnpm typecheck` stays green.

**Risk rating**: **low probability, high visibility when it happens** (fail-loud SQL error, not silent corruption). Single-dev codebase, interface + SQL colocated in the same file → drift is likely to be caught at the source. But 27 of 28 query files have **zero integration test**, so runtime detection is weak.

**Pitch inconsistency** : `README.md:37` claims _"No `any`/`unknown` in repo signatures — Drizzle-inferred types all the way up"_. 35 `as unknown as` + 9 `any` say otherwise.

---

### F-2 — 9 `any` / `as any` in thalamus/src

Distinct from F-1 (cast-at-boundary). These are live holes:

- `cortices/executor.ts:33` — `type SqlHelperFn = (db: Database, ...args: any[]) => Promise<unknown[]>` (structural, defensible)
- `cortices/executor.ts:457-459` — OpenAI Responses API parsing `?.filter((o: any) => o.type === "message").map((o: any) => o.content?.map((c: any) => c.text).join(""))` → untyped external payload
- `cortices/sources/fetcher-orbit-regime.ts:27` — `const data = (await res.json()) as any` → HTTP response shape ignored
- `explorer/scout.ts:180,186` — LLM nano output `(q: any)` mapping
- `explorer/orchestrator.ts:250,260` — `(existing.rows[0] as any).id` → another DB boundary cast
- `explorer/curator.ts:187` — `items.map((s: any) => ...)` → curator input untyped

**Risk rating**: `fetcher-orbit-regime.ts:27` is the real one — external HTTP response with zero validation. The others are in-flight parsing of trusted internals.

---

### F-3 — Cortex query integration test coverage: 1/28

`packages/thalamus/tests/integration/` contains a single file: `opacity-scout.int.spec.ts`. The other 27 cortex query functions (`queryDebrisForecast`, `querySatelliteDataAudit`, `queryConjunctionScreen`, `queryCorrelationMerge`, `queryOperatorFleet`, `queryCatalogIngest`, etc.) have **zero runtime coverage**.

**Consequence**: F-1 drift would be caught ONLY if the cortex is exercised in an e2e cycle. With current seed state, cycles often trigger `data_auditor` + `classification_auditor` first → those queries ARE exercised, but `queryDebrisForecast` and `queryConjunctionScreen` may never fire in a given run.

**Combined with F-6 (data gaps)**: dead cortex queries never execute → drift on them is silent until fixed.

---

### F-4 — `schema-contract.spec.ts` does NOT cover Thalamus queries

[packages/db-schema/tests/schema-contract.spec.ts](packages/db-schema/tests/schema-contract.spec.ts) (42 tests, SPEC-DB-001) asserts:

- AC-2 : every table file re-exported from `schema/index.ts` + `src/index.ts`
- AC-3 : `notNull` columns → non-nullable `$inferSelect` fields
- AC-4 : FK types match PK types
- AC-6 : zero unjustified `: any` in `db-schema/src/schema/*.ts` sources, `jsonb(` only in allow-listed columns

**None of AC-2/3/4/6 reach into `packages/thalamus/`.** The AC-6 `: any` scan is scoped to db-schema sources. The `*.ts` files under `cortices/queries/` could contain anything — the gate doesn't see them.

**Implication**: I repeatedly claimed "schema-contract tests cover drift" during this session. That claim was **wrong** for the Thalamus surface. They cover the db-schema package internally.

---

### F-5 — Pino redaction is minimal and silent in tests

[packages/shared/src/observability/logger.ts:13-16](packages/shared/src/observability/logger.ts#L13-L16):

```ts
const redactConfig = {
  paths: ["req.headers.authorization", "req.headers.cookie"],
  remove: true,
};
```

**Covers**: HTTP request auth headers / cookies.
**Does NOT cover**: arbitrary `apiKey` / `password` / `token` fields in log payloads. Example:

```ts
log.info({ apiKey: "sk-real-key", query: "x" }, "call");
// → "sk-real-key" leaks to stdout
```

**Worse**: in test mode, the logger is silent ([logger.ts:18-20](packages/shared/src/observability/logger.ts#L18-L20)):

```ts
if (isTest) {
  return pino({ level: "silent" });
}
```

A naive Axe-6c test that checks "apiKey not in log output" would trivially pass **because nothing is logged**, not because redaction works. The test is a false green.

**Fix** : either extend `redactConfig.paths` with `"*.apiKey", "*.password", "*.token"` etc., or exercise the non-test mode logger in the redaction spec.

---

### F-6 — Likely dead cortex data sources (suspicion, not yet confirmed)

Cycle 264 diagnostic: `debris_forecaster` emitted 0 findings after a 15-second web-search fallback. Hypothesis confirmed by reading [packages/thalamus/src/cortices/queries/debris-forecast.ts](packages/thalamus/src/cortices/queries/debris-forecast.ts) :

- Branch 1 — `regime density` (aggregation on `satellite` + `orbit_regime`) → should return rows since catalog is seeded (~33k sats)
- Branch 2 — `paper` (arxiv/ntrs on `source_item` ILIKE `%debris%`) → depends on `source_item` being populated
- Branch 3 — `news` (rss on `source_item` ILIKE `%debris%`) → same dependency

If `source_item` is empty or near-empty, branches 2 and 3 return zero → `debris_forecaster` finds no scholarly/news context to anchor its LLM reasoning on → 0 findings.

**Not yet verified against the live DB** — a one-line SQL query would confirm: `SELECT count(*) FROM source_item WHERE title ILIKE '%debris%' OR abstract ILIKE '%kessler%'`. This is exactly what Axe 2 (data wiring diagnostic) was intended to run.

---

### F-7 — Voyage embedder present, vectors barely consumed

[packages/thalamus/src/utils/voyage-embedder.ts](packages/thalamus/src/utils/voyage-embedder.ts) implements query-time embedding with `voyage-4-lite` for pgvector ANN search. Actually consumed in only two cortex queries:

- `queries/search.ts` — telemetry_14d cosine via HNSW
- `queries/conjunction-candidates.ts` — KNN conjunction screening

The other 26 queries are pure SQL with ILIKE keyword search. Semantic retrieval on RSS / arxiv / ntrs abstracts, which would catch papers without the literal word "debris" or "kessler", is not wired in.

**Implication**: even with a populated `source_item` table, the keyword-based filter in `debris-forecast.ts:69-72` would miss semantically relevant papers. Embeddings on `source_item` exist at the schema level but no cortex query uses them.

---

### F-8 — 3 parallel DB access layers co-exist

1. `packages/db-schema/src/queries/*` — shared helpers, typed via Drizzle
2. `packages/thalamus/src/repositories/*` — Thalamus repos (exploration, research-cycle, research-edge, research-finding, entity-name-resolver) — typed
3. `packages/thalamus/src/cortices/queries/*` — 28 cortex query files with raw SQL + `as unknown as` casts

The three layers are not consolidated. During the session I called this a "shadow layer", which the user correctly pushed back on (every import is a layer). The accurate framing is: **cortex queries live in the `cortices/` bounded context rather than the horizontal repo layer, and use a looser type contract because of SQL complexity (UNION ALL, aggregations, HNSW)**.

This is defensible architecturally (DDD — cortex = bounded context), but only if the cortex layer has its own contract discipline. Today it doesn't.

---

### F-9 — No LLM stub transport exists

[packages/thalamus/src/transports/llm-chat.ts](packages/thalamus/src/transports/llm-chat.ts) is the real Kimi → OpenAI fallback chain. [packages/thalamus/src/transports/fixture-transport.ts](packages/thalamus/src/transports/fixture-transport.ts) replays recorded fixtures from disk (used by `THALAMUS_MODE=fixtures make thalamus-cycle`).

**There is no in-process test stub.** Every test that would exercise `ThalamusPlanner.plan()` or `CortexExecutor.run()` today either:

- hits a real LLM (cost + network flakiness)
- has to use `fixture-transport.ts` pointing at a pre-recorded fixture file (doesn't compose with per-test canned responses)

This is a genuine Phase 1 gap for test infra.

---

### F-10 — `CycleResult.stopReason` doesn't exist; budget exhaustion is log-string-detected

`ThalamusService.runCycle()` [packages/thalamus/src/services/thalamus.service.ts:70](packages/thalamus/src/services/thalamus.service.ts#L70) returns `ResearchCycle` (DB row). The DB enum `cycle_status` has `running | completed | failed | cancelled` — no `budget_exhausted` / `depth_cap_reached`.

Budget exhaustion is signalled by the log line `"Stopping: cost budget exhausted totalCost: X maxCost: Y iteration: N"`. A test asserting "cycle stopped because of budget" has to spy on the log → fragile.

**Fix option A** : add a `budget_exhausted` value to `cycle_status` (migration) + persist it.
**Fix option B** : return an in-memory `CycleResult` type that extends the persisted row with structured `stopReason`, no migration.

Neither was done. The test for budget handling cannot be written cleanly without one of these.

---

## Session meta-findings (model behaviour)

### M-1 — Sycophancy pattern (caught by user)

Three distinct flip-flops observed :

1. **Initial plan** : wrote a 13-task plan with `validateRows` Zod boundary + `loadFixture` + `CycleResult.stopReason` + smoke test — over-engineered.
2. **User pushback** (_"thalamus est déjà typé"_) : agreed immediately, dropped Zod and fixtures entirely — capitulated without verifying.
3. **Post-audit** : "no actually you were wrong, Zod IS needed" — reversed again based on raw count without weighing the probability / blast-radius.
4. **User called out the flip-flop** : "ne me dis pas que jai raison si jai pas raison" → forced a real audit → converged on "risk low, one static alias-interface check is enough".

The user was right to distrust intermediate agreement. The pattern was: **quick agreement under social pressure, rather than holding a grounded position**. Next time: verify before agreeing with pushback, hold positions I can defend.

### M-2 — Over-engineering driven by plan template

The skill flow (brainstorm → write-plan → execute) produced a plan with 13 tasks for a problem that needed 5-6. The spec was directionally sound but translated into more scaffolding than the codebase warranted. Lesson: measure the codebase's actual discipline before prescribing infra helpers (transaction wrapper, fixture loader, etc.). In this codebase, `db.transaction(tx)` rollback + inline slug seeding is already the pattern ([opacity-scout.int.spec.ts](packages/thalamus/tests/integration/opacity-scout.int.spec.ts)) — no new abstraction needed.

### M-3 — Plan had concrete errors before being executed

Verified during audit:

- Task 9 (data-wiring) imported `queryCatalog` / `queryObservations` / `queryDataAudit` — real names are `queryCatalogIngest` / `queryObservationIngest` / `querySatelliteDataAudit`
- Task 2 (stub LLM) returned `{ content }` — `LlmResponse` requires `{ content, provider }`
- Task 3 (loadFixture) assumed `drizzle-orm/node-postgres/migrator` pattern not used anywhere in the repo
- Axe 6c assumed pino redaction would emit output in test mode — it's silent in test mode (F-5)

All would have been catch during Codex dispatch, but they show the plan was written partially from memory / the spec rather than from reading the code.

---

## What a tight plan would look like (deferred)

The 13-task plan at [docs/superpowers/plans/2026-04-16-thalamus-audit-tests.md](../plans/2026-04-16-thalamus-audit-tests.md) is set aside. If/when this work resumes, a tighter version:

- **Task A** — `createStubLlmTransport(responses)` helper (fills F-9).
- **Task B** — one static test: for each `cortices/queries/*.ts`, parse the exported row interface and assert every field appears as an `AS "fieldName"` alias in the SQL block (fills F-1, zero runtime cost).
- **Task C** — `thalamus-planner.spec.ts` with Task-A stub, verifies the bias and fallback (was Axe 3).
- **Task D** — `thalamus-data-wiring.spec.ts` non-blocking diagnostic (was Axe 2), using correct query names per F-6.
- **Task E** — `thalamus-security.spec.ts` with **real dev-mode logger** to exercise redaction (fills F-5), + SQL injection regression.
- **Task F** — `thalamus-cost-dedup.spec.ts` **scaffold only** (`it.todo`), because the cycle lacks structured signals (F-10). Resolved when F-10 is fixed.

6 tasks. No `loadFixture`, no `validateRows`, no `CycleResult.stopReason` change.

---

## Immediate next actions (if resuming)

1. **Run the live DB sanity check** (the data wiring diagnostic, by hand) to confirm F-6:
   ```sql
   SELECT
     (SELECT count(*) FROM source_item) AS total_source_items,
     (SELECT count(*) FROM source_item WHERE title ILIKE '%debris%') AS debris_titles,
     (SELECT count(*) FROM source_item WHERE abstract ILIKE '%kessler%') AS kessler_abstracts;
   ```
2. **Fix F-5 narrow gap** : extend `redactConfig.paths` with `"*.apiKey", "*.password", "*.token", "*.apikey", "*.api_key"`. One-line change, audit win.
3. **Only then** revisit the test plan with Tasks A–F above.

---

## Artefacts from this session

- [docs/superpowers/specs/2026-04-16-thalamus-audit-tests-design.md](../specs/2026-04-16-thalamus-audit-tests-design.md) — design spec (committed, kept for history)
- [docs/superpowers/plans/2026-04-16-thalamus-audit-tests.md](../plans/2026-04-16-thalamus-audit-tests.md) — 13-task implementation plan (committed, **superseded by this findings doc**)
- Worktree `/home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit` on branch `feat/thalamus-audit` — clean, nothing implemented. Can be removed.
