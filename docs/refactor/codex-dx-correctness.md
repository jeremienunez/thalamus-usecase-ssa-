1. [0000_flawless_dorian_gray.sql#L1](/home/jerem/interview-thalamus-sweep/packages/db-schema/migrations/0000_flawless_dorian_gray.sql#L1) — **Critical** — Drizzle migration is structurally broken/drifted (e.g. `research_cycle` has only `photo_url`, while schema defines many columns), and it adds FKs to tables never created in migrations ([same file#L158](/home/jerem/interview-thalamus-sweep/packages/db-schema/migrations/0000_flawless_dorian_gray.sql#L158)).  
Fix: regenerate a clean baseline migration from current schema and add CI check that applies migrations on an empty DB.

2. [satellite.ts#L52](/home/jerem/interview-thalamus-sweep/packages/db-schema/src/schema/satellite.ts#L52) — **Critical** — Schema declares tables (`orbit_regime`, `operator_country`, `payload`, `operator`) that are referenced in migration FKs but not created by SQL migrations.  
Fix: add missing `CREATE TABLE` statements via generated migration and run schema-vs-migrations diff in CI.

3. [tsconfig.base.json#L22](/home/jerem/interview-thalamus-sweep/tsconfig.base.json#L22) — **High** — Public API boundary is porous: `@interview/*/*` aliases expose internals of every package, bypassing `src/index.ts` contracts.  
Fix: remove wildcard cross-package aliases and enforce package `exports` maps.

4. [package.json#L5](/home/jerem/interview-thalamus-sweep/packages/cli/package.json#L5) + [index.ts#L1](/home/jerem/interview-thalamus-sweep/packages/cli/src/index.ts#L1) — **High** — `@interview/cli` sets `main` to a side-effectful bin file; importing the package executes the process entrypoint.  
Fix: split bin entry (`bin`) from library entry (`main`/`exports`) with a non-executing module.

5. [boot.ts#L66](/home/jerem/interview-thalamus-sweep/packages/cli/src/boot.ts#L66) — **High** — Only source `TODO/FIXME/HACK/XXX` in runtime code is a real blocker: core adapters intentionally throw ([boot.ts#L79](/home/jerem/interview-thalamus-sweep/packages/cli/src/boot.ts#L79)).  
Fix: wire real adapters or hard-disable non-wired commands in CLI UX.

6. [utils/index.ts#L13](/home/jerem/interview-thalamus-sweep/packages/shared/src/utils/index.ts#L13) — **Medium** — Dead exports: `formatDate`, `randomId`, `isProduction`, `isDevelopment` have no importers outside their defining file.  
Fix: drop from public barrel (or remove) and run unused-export check in CI.

7. [thalamus/index.ts#L15](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/index.ts#L15) + [confidence.ts#L87](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/confidence.ts#L87) — **Medium** — `InvalidPromotion` is publicly exported but unused (dead API surface).  
Fix: stop exporting it (or actually throw/use it in confidence transitions).

8. [thalamus/index.ts#L24](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/index.ts#L24) + [field-correlation.ts#L33](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/field-correlation.ts#L33) — **Low** — `LATENCY_BUDGET_MS` is exported as public API but appears internal-only.  
Fix: keep constant internal unless there is a documented external consumer.

9. [router/schema.ts#L5](/home/jerem/interview-thalamus-sweep/packages/cli/src/router/schema.ts#L5) + [satellite-sweep-chat.service.ts#L38](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/satellite-sweep-chat.service.ts#L38) + [sql-helpers.operator-fleet.ts#L41](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/sql-helpers.operator-fleet.ts#L41) — **Medium** — Same concept appears as `satId` / `satelliteId` / `sat_id`.  
Fix: standardize external DTOs to `satelliteId`, restrict `sat_id` to SQL aliases, map immediately at query boundary.

10. [telemetry-swarm.service.ts#L121](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/telemetry-swarm.service.ts#L121) + [schema.ts#L120](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/schema.ts#L120) + [aggregator-telemetry.ts#L60](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/aggregator-telemetry.ts#L60) — **High** — Quorum default mismatch (`0.6` launcher vs `0.8` schema/aggregator) can change acceptance behavior by code path.  
Fix: centralize one `DEFAULT_QUORUM_PCT` constant and consume everywhere.

11. [thalamus.service.ts#L449](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/services/thalamus.service.ts#L449) — **Low** — Confidence→TTL bands (`0.5/0.7/0.85`, `14/30/60/90`) are hardcoded magic numbers.  
Fix: move bands to named constants (or config) and test against spec thresholds.

12. [redis.ts#L11](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/redis.ts#L11) + [vite.config.ts#L17](/home/jerem/interview-thalamus-sweep/apps/console/vite.config.ts#L17) + [nano-caller.ts#L67](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-caller.ts#L67) + [llm-chat.ts#L201](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/transports/llm-chat.ts#L201) — **Medium** — Environment coupling via hardcoded localhost/ports/base URLs.  
Fix: route all endpoints through config/env (`*_BASE_URL`, `REDIS_URL`, API proxy target), with explicit non-dev validation.

13. [README.md#L41](/home/jerem/interview-thalamus-sweep/README.md#L41) + [README.md#L242](/home/jerem/interview-thalamus-sweep/README.md#L242) + [CHANGELOG.md#L235](/home/jerem/interview-thalamus-sweep/CHANGELOG.md#L235) + [TODO.md#L87](/home/jerem/interview-thalamus-sweep/TODO.md#L87) — **Medium** — Docs drift: broken entrypoint link, duplicated README body, and stale “missing sweep package.json/tsconfig” claims.  
Fix: prune duplicated README section and run a docs freshness pass tied to CI (link check + stale checklist items).

14. [cli/package.json#L14](/home/jerem/interview-thalamus-sweep/packages/cli/package.json#L14) + [thalamus/package.json#L15](/home/jerem/interview-thalamus-sweep/packages/thalamus/package.json#L15) + [console-api/package.json#L13](/home/jerem/interview-thalamus-sweep/apps/console-api/package.json#L13) — **Medium** — Unused deps: `@interview/db-schema/@interview/thalamus/@interview/sweep` in CLI, `ioredis/@langchain/core` in thalamus, `@interview/db-schema/@interview/shared` in console-api.  
Fix: remove unused deps and add depcheck-like validation in CI.

15. [tsconfig.base.json#L7](/home/jerem/interview-thalamus-sweep/tsconfig.base.json#L7) vs [console-api/tsconfig.json#L7](/home/jerem/interview-thalamus-sweep/apps/console-api/tsconfig.json#L7) — **Medium** — Type-safety policy is inconsistent: backend packages inherit non-strict base (`strict=false`, `strictNullChecks=false`, `noUncheckedIndexedAccess=false`), while apps are strict; `exactOptionalPropertyTypes` is nowhere enabled.  
Fix: define a strict backend base config and migrate package-by-package with `exactOptionalPropertyTypes` opt-in.

No meaningful commented-out code blocks found in `packages/*/src` and `apps/*/src`.
