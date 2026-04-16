# Cross-package duplication — refactor prep

Scope: pnpm monorepo (`shared`, `db-schema`, `sweep`, `thalamus`, `apps/console`, `apps/console-api`).
Guiding rule: **l'abstraction s'arrête toujours au métier.** Consolidate only when the concept is the _same business primitive_. When names collide but meanings differ, separate and rename.

Source signals: [\_depcruise.json](./_depcruise.json), [\_depcruise-summary.md](./_depcruise-summary.md).

---

## 1. `research.enum.ts` — shared TS enums vs. Drizzle pgEnums

- [packages/shared/src/enum/research.enum.ts](../../packages/shared/src/enum/research.enum.ts) — 99 lines, 8 plain TS `enum`s (`ResearchCortex`, `ResearchFindingType`, `ResearchEntityType`, `ResearchRelation`, `ResearchStatus`, `ResearchUrgency`, `ResearchCycleTrigger`, `ResearchCycleStatus`) carrying SSA vocabulary.
- [packages/db-schema/src/enums/research.enum.ts](../../packages/db-schema/src/enums/research.enum.ts) — 66 lines, imports those same TS enums from `@interview/shared` and projects each one into a Drizzle `pgEnum`. The doc block is explicit: "Single source of values: shared TS enum → `Object.values()` → pgEnum tuple → `CREATE TYPE` SQL."

**Verdict: KEEP-SEPARATE (rename).** These are not duplicates — two _projections_ of the same vocabulary for different runtimes (TS type system vs. Postgres catalog). Abstraction correctly stops at the business enum (`shared`); `db-schema` only adapts to Drizzle.

**Migration:** rename db-schema copy → `research.pg-enum.ts` (or `research.drizzle.ts`), update barrel.

---

## 2. `container.ts` — two different DI composition roots

- [packages/sweep/src/config/container.ts](../../packages/sweep/src/config/container.ts) — 198 lines. Wires `SatelliteRepository`, `SweepRepository`, sim engine (`MemoryService`, sequential/DAG turn runners, `SimOrchestrator`, `GodChannelService`, `AggregatorService`, `SwarmService`, `ConfidenceService`), reviewer-accept → confidence-promote hook. Fan-out 19.
- [packages/thalamus/src/config/container.ts](../../packages/thalamus/src/config/container.ts) — 79 lines. Wires `CortexRegistry`, `CortexExecutor`, `ResearchGraphService`, `ThalamusService`, research repos, `EntityNameResolver`, `VoyageEmbedder`. Fan-out 10.

**Verdict: KEEP-SEPARATE.** Each container _is_ the composition root of its bounded context. No shared wiring. Optional rename to `sweep.container.ts` / `thalamus.container.ts` to silence the dependency-cruiser duplicate-basename hit.

---

## 3. `sql-helpers.ts` — three files, two meanings

- [packages/sweep/src/utils/sql-helpers.ts](../../packages/sweep/src/utils/sql-helpers.ts) — **12 lines**, single export `escapeIlike`.
- [packages/thalamus/src/utils/sql-helpers.ts](../../packages/thalamus/src/utils/sql-helpers.ts) — **12 lines, byte-identical**. ORPHAN per depcruise.
- [packages/thalamus/src/cortices/sql-helpers.ts](../../packages/thalamus/src/cortices/sql-helpers.ts) — **40-line barrel** re-exporting ~20 cortex-specific query families (`satellite`, `search`, `orbit-regime`, `rss`, `catalog`…). Fan-out 24 — the largest non-barrel in the repo. **This is a business-domain file.**

**Verdict:**

- `thalamus/src/utils/sql-helpers.ts` → **DELETE-ORPHAN.**
- cortices barrel ↔ sweep `escapeIlike` → **KEEP-SEPARATE, rename cortices barrel** to e.g. `cortex-queries.ts`. Different business concepts sharing a basename.

`escapeIlike` is 3 regex lines; promoting to `shared` would create a generic utility layer for its own sake.

---

## 4. `llm-json-parser.ts` — byte-identical cross-package copy

- [packages/sweep/src/utils/llm-json-parser.ts](../../packages/sweep/src/utils/llm-json-parser.ts) — 155 lines.
- [packages/thalamus/src/utils/llm-json-parser.ts](../../packages/thalamus/src/utils/llm-json-parser.ts) — **155 lines, byte-identical**. Same `cleanLlmOutput`, `repairTruncated`, `extractJson` (8 strategies), `extractJsonObject`, `extractJsonArray`.

Thalamus callers: [cortex-llm.ts](../../packages/thalamus/src/cortices/cortex-llm.ts), [thalamus-planner.service.ts](../../packages/thalamus/src/services/thalamus-planner.service.ts), [curator.ts](../../packages/thalamus/src/explorer/curator.ts), [scout.ts](../../packages/thalamus/src/explorer/scout.ts).

**Verdict: MERGE.** Stable business primitive: "parse whatever the LLM threw at us." Same concept in both packages.

**Target:** `packages/shared/src/llm/llm-json-parser.ts` (new `llm/` subtree, analogous to existing `observability/`). Do NOT create a generic `utils/`.

**Migration:**

1. Move to `packages/shared/src/llm/llm-json-parser.ts`.
2. Rewrite 4 thalamus imports (+ any sweep adoption).
3. Delete both package-local copies.

---

## 5. `satellite-entity-patterns.ts` — same concept, divergent regex catalogs

- [packages/sweep/src/utils/satellite-entity-patterns.ts](../../packages/sweep/src/utils/satellite-entity-patterns.ts) — 61 lines. ORPHAN per depcruise (zero sweep importers).
- [packages/thalamus/src/utils/satellite-entity-patterns.ts](../../packages/thalamus/src/utils/satellite-entity-patterns.ts) — 91 lines. Live — imported by [crawler.ts](../../packages/thalamus/src/explorer/crawler.ts) and [nano-swarm.ts](../../packages/thalamus/src/explorer/nano-swarm.ts). **Superset** catalog: adds Galileo, BeiDou, NOAA, Landsat, Planet, SkySat, BlackSky, ICEYE, Capella, Molniya, Tundra, Yaogan, Gaofen, Shijian, Kosmos variants; adds `LAUNCH_VEHICLE_PATTERNS`; expanded orbit-regime (Molniya, Tundra, Lagrange, cislunar) and operators (DLR, ASI, UKSA, Rocket Lab, Viasat, Telesat, USSF, NRO, NOAA).

**Note:** depcruise flags the **sweep** copy as orphan, not thalamus (original prompt had it backwards — verified).

**Verdict: DELETE-ORPHAN (sweep copy).** Keep thalamus copy as canonical SSA vocabulary inside thalamus bounded context. Do NOT lift to `shared` preemptively.

---

## Hidden duplication candidates

Conservative — only leads with direct code evidence.

### H1. Redis key conventions — no action

Sweep owns `sweep:*` and `satellite-sweep:*` namespaces. Thalamus does not use Redis directly. A shared key-builder would be pure generic utility — **do not extract.**

### H2. `sim_swarm:{swarmId}` citation/trigger template — ACT

Literal repeated in:

- [packages/sweep/src/config/container.ts](../../packages/sweep/src/config/container.ts) (`citation: \`sim_swarm:${swarmId}...\``)
- [packages/sweep/src/sim/promote.ts](../../packages/sweep/src/sim/promote.ts) (`triggerSource: \`sim_swarm:${swarmId}\``)
- [packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts](../../packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts) (×2)

One business concept ("sim-swarm trigger-source id"). Extract `simSwarmTriggerSource(swarmId)` colocated in `packages/sweep/src/sim/` (NOT shared).

### H3. `finding:{id}` node-id template — no action

Only thalamus, 2 call sites in same file. Inline is fine at N=2.

### H4. `telemetryEdgeId` FNV-1a fingerprint — watch

Currently buried in sweep/container.ts. If a second consumer appears (reviewer UI, replay tool), lift to `packages/thalamus/src/services/confidence-edge-id.ts` as named business primitive.

### H5. `createLogger` usage — false positive

65 call sites, but it's shared primitive working as intended.

### H6. Zod schemas — no cross-package duplication detected

Concentrated in sweep (`sim/schema.ts`, `transformers/*.dto.ts`). Thalamus barely uses Zod. [payload-profile.schema.ts](../../packages/shared/src/schemas/payload-profile.schema.ts) already correctly placed.

### H7. pgvector / embeddings — working as intended

Single definition in [\_vector.ts](../../packages/db-schema/src/schema/_vector.ts). No duplication.

---

## TL;DR

| Group                                        | Verdict                                              | Cost                   |
| -------------------------------------------- | ---------------------------------------------------- | ---------------------- |
| `research.enum.ts`                           | KEEP-SEPARATE, rename db-schema copy                 | trivial                |
| `container.ts`                               | KEEP-SEPARATE, optional rename                       | trivial                |
| `sql-helpers.ts` (thalamus/utils orphan)     | DELETE-ORPHAN                                        | trivial                |
| `sql-helpers.ts` (sweep vs. cortices barrel) | KEEP-SEPARATE, rename cortices → `cortex-queries.ts` | 1 rename + import fix  |
| `llm-json-parser.ts`                         | MERGE → `@interview/shared/llm`                      | 4 rewrites + 2 deletes |
| `satellite-entity-patterns.ts` (sweep copy)  | DELETE-ORPHAN                                        | trivial                |
| H2 `sim_swarm:{id}` template                 | Extract helper in `sweep/sim/`                       | 4 sites                |

Everything else: observe, do not preemptively abstract.
