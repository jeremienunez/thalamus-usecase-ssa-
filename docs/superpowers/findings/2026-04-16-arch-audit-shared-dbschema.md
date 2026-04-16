# Arch audit — packages/shared + packages/db-schema

Date: 2026-04-16
Scope: `/home/jerem/interview-thalamus-sweep/packages/shared/` and `/home/jerem/interview-thalamus-sweep/packages/db-schema/`

## H1 — `shared/` is 100% kernel-agnostic: INFIRMED

Verdict: **REJECTED.** `shared/` carries a load-bearing SSA domain layer. Business vocabulary (satellite, conjunction, payload, orbit regime, cortex) is baked into multiple files and re-exported from the root barrel. This is not a leak on the margin — it is a second layer living inside the "kernel" package.

Evidence (from `/home/jerem/interview-thalamus-sweep/packages/shared/src/index.ts`):

```ts
export * from "./schemas/payload-profile.schema"; // SSA: spacecraft payload datasheet
export * from "./ssa"; // SSA: entire folder
```

Files that are SSA-domain, not kernel:

- `packages/shared/src/ssa/conjunction-view.ts` — `RegimeSchema` (LEO/MEO/GEO/HEO), `ConjunctionViewSchema`, `CovarianceQuality`, `ConjunctionAction`, `deriveAction`, `deriveCovarianceQuality`.
- `packages/shared/src/ssa/satellite-view.ts` — `SatelliteViewSchema` with NORAD id, inclination, RAAN, mean motion, Kepler solver `smaFromMeanMotion`, classification tiers.
- `packages/shared/src/ssa/finding-view.ts` — `FindingViewSchema` typed for cortex-level findings (string cortex field, OSINT/field/derived evidence).
- `packages/shared/src/ssa/kg-view.ts` — KG node class enum fixed to `Satellite | Operator | OrbitRegime | Payload`.
- `packages/shared/src/schemas/payload-profile.schema.ts` — explicit in file header: "Everything above that line (radiometric, optical, rf, thermal, reliability, spaceWeatherSensitivity) is pure SSA domain." 242 lines of SSA instrument physics.
- `packages/shared/src/enum/research.enum.ts` — `ResearchCortex` enum frozen to SSA cortices (ConjunctionAnalysis, ManeuverPlanning, PayloadProfiler, DebrisForecaster, OrbitSlotOptimizer, …). `ResearchEntityType` enum frozen to SSA entities (Satellite, Launch, OrbitRegime, ConjunctionEvent, Maneuver). The file header even admits the split: "What IS domain-specific is the content those findings point at: cortices, entities, relations".
- `packages/shared/src/enum/sweep.enum.ts` — SSA review-loop vocabulary (`BriefingAngle`, `DoctrineMismatch`, `MassAnomaly`) — marginally generic, but tuned to operator/catalog audits.
- `packages/shared/src/enum/source.enum.ts` — `SourceKind` values `osint | field | radar | press` map to SSA ingestion lanes (arXiv/NTRS are science feeds, field/radar are SSA-specific).
- `packages/shared/src/types/orchestration.types.ts` — `CardCategory = "satellite" | "data" | "map" | "web" | "process"` and `AgentRole = "researcher" | "profiler" | "cartographer" | "analyst"` are product-shaped, not infra.
- `packages/shared/src/observability/steps.ts` — `STEP_REGISTRY` enumerates domain steps (`fetch.osint`, `curator.dedup`, `kg.write`, `swarm`, `fish.spawn`, etc.). Kernel would expose a generic `stepLog(name, phase)` and let the app register names.

What IS genuinely kernel:

- `packages/shared/src/utils/async-handler.ts` — `tryAsync`, `withTimeout`, `retry`, `allSettled`, `Result<T,E>`.
- `packages/shared/src/utils/error.ts` — `AppError`, `ValidationError`, `NotFoundError`, `UnauthorizedError`, `SystemError`, `isAppError`.
- `packages/shared/src/utils/json.ts` — `safeJsonParse`, `tryParseJson`.
- `packages/shared/src/utils/string.ts` — `truncate`, `removeDiacritics`, `toSlug`.
- `packages/shared/src/utils/collection.ts` — `keepLastN`, `deduplicateBy`, normalize/includes helpers.
- `packages/shared/src/utils/domain-normalizer.ts` — pure canonical-form derivation.
- `packages/shared/src/utils/completeness-scorer.ts` — adaptive weighted-sum scorer, zero domain knowledge.
- `packages/shared/src/net/safe-fetch.ts` — SSRF guard + DNS rebinding protection, URL validation, redirect walking.
- `packages/shared/src/observability/logger.ts` — pino factory + loki/pretty transports.
- `packages/shared/src/observability/metrics.ts` — prom-client wrapper.
- `packages/shared/src/observability/step-context.ts` + `step-logger.ts` (mechanism, not the registry).
- Generic auth/messaging enums: `packages/shared/src/enum/auth.enum.ts` (`UserRole`, `SubscriptionTier`, `VerificationCodeType`), `packages/shared/src/enum/messaging.enum.ts` (`SenderType`, `Channel`, `ConversationType`).

## H2 — `db-schema/` is 100% domain SSA: MOSTLY VALIDATED (with a generic sublayer)

Verdict: **CONFIRMED with nuance.** 11 schema files; 9 are SSA-specific, 2 are plausibly generic (`user`, `article`). The package's identity, FKs, and type exports are dominated by SSA entities — it cannot live in a "kernel" slot. The `research_*` tables (cycle, finding, edge) are structurally generic but wired to SSA via the `cortexEnum` / `entityTypeEnum` / `relationEnum` pgEnums, whose tuples are `Object.values(ResearchCortex)` etc. — and those TS enums are SSA-frozen in shared.

Evidence from `/home/jerem/interview-thalamus-sweep/packages/db-schema/src/index.ts`:

> "@interview/db-schema — single source of truth for entity shapes, enums, and Drizzle tables consumed by @interview/thalamus and @interview/sweep."

And from `satellite.ts` header:

> "This file is the first place where the generic machinery meets the domain. Table and column names reflect the objects we are actually reasoning about: satellites, payloads, operators, launches, orbital regimes."

## Leaks in `shared/`

| File                                                    | Why it's a leak                                                                                                                  |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `packages/shared/src/ssa/conjunction-view.ts`           | SSA conjunction DTO: `probabilityOfCollision`, `hardBodyRadiusM`, `combinedSigmaKm`, `RegimeSchema = ["LEO","MEO","GEO","HEO"]`. |
| `packages/shared/src/ssa/satellite-view.ts`             | NORAD id, inclinationDeg, RAAN, mean motion, Kepler propagator, classification tier.                                             |
| `packages/shared/src/ssa/finding-view.ts`               | Finding view schema keyed to `cortex: string` + OSINT/field evidence kinds.                                                      |
| `packages/shared/src/ssa/kg-view.ts`                    | `KgEntityClassSchema = ["Satellite","Operator","OrbitRegime","Payload"]`.                                                        |
| `packages/shared/src/schemas/payload-profile.schema.ts` | Spacecraft payload datasheet (radiometric EIRP, optical GSD, RF bands, radiation tolerance).                                     |
| `packages/shared/src/enum/research.enum.ts`             | `ResearchCortex`, `ResearchEntityType` frozen to SSA values.                                                                     |
| `packages/shared/src/enum/sweep.enum.ts`                | SSA review vocabulary (`MassAnomaly`, `DoctrineMismatch`, `BriefingAngle`).                                                      |
| `packages/shared/src/enum/source.enum.ts`               | Ingestion lanes tuned to SSA (`osint`, `field`, `radar`).                                                                        |
| `packages/shared/src/observability/steps.ts`            | `STEP_REGISTRY` hard-codes SSA steps (`fetch.osint`, `kg.write`, `fish.spawn`, `swarm`).                                         |
| `packages/shared/src/types/orchestration.types.ts`      | `AgentRole`/`CardCategory` product-shaped.                                                                                       |
| `packages/shared/src/index.ts` (barrel)                 | Re-exports `./ssa`, `./schemas/payload-profile.schema`. Anything depending on `@interview/shared` transitively pulls the domain. |

Note: `packages/shared/src/utils/collection.ts` doc example mentions `deduplicateBy(satellites, …)` but the code is generic — cosmetic only.

## Demographics — `db-schema/`

Fully generic (no SSA coupling):

- `user` (email, name, role, tier, metadata) — `packages/db-schema/src/schema/user.ts`.
- `article` (slug, title, status, content, authorId) — `packages/db-schema/src/schema/article.ts`. Not referenced by any SSA table; currently unused by cortices.

Structurally generic, semantically SSA via enums:

- `research_cycle`, `research_finding`, `research_edge` — `packages/db-schema/src/schema/research.ts`. Tables themselves describe a generic finding/edge machine, but typed to `cortexEnum`, `findingTypeEnum`, `entityTypeEnum`, `relationEnum`, which resolve to SSA tuples.
- `exploration_log` — `packages/db-schema/src/schema/exploration.ts`. Curiosity-loop trace; generic in shape.
- `source`, `source_item` — `packages/db-schema/src/schema/source.ts`. Generic polymorphic ingestion catalog, though `sourceKindEnum` carries SSA lanes.
- `sweep_audit` — `packages/db-schema/src/schema/sweep.ts`. FK to `operator_country` (SSA) and typed to SSA sweep enums.

SSA-specific:

- `satellite`, `orbit_regime`, `platform_class`, `operator_country`, `payload`, `operator`, `satellite_payload`, `satellite_bus` — all in `packages/db-schema/src/schema/satellite.ts`.
- `launch` — `packages/db-schema/src/schema/launch.ts`.
- `conjunction_event` — `packages/db-schema/src/schema/conjunction.ts`.
- `amateur_track` — `packages/db-schema/src/schema/amateur-track.ts` (SeeSat-L, SatTrackCam observations).
- `sim_swarm`, `sim_run`, `sim_agent`, `sim_turn`, `sim_agent_memory` — `packages/db-schema/src/schema/sim.ts`. Shape is generic multi-agent sim but `SimKind` union + `TurnAction` carry maneuver/launch/estimate_pc/infer_telemetry (SSA).

Enums (pgEnum tuples, live in `packages/db-schema/src/enums/`):

- `cortexEnum` — frozen to SSA cortices via `Object.values(ResearchCortex)`.
- `entityTypeEnum` — frozen to SSA entities (Satellite, OperatorCountry, Operator, Launch, SatelliteBus, Payload, OrbitRegime, ConjunctionEvent, Maneuver, Finding).
- `findingTypeEnum`, `findingStatusEnum`, `urgencyEnum`, `relationEnum`, `cycleTriggerEnum`, `cycleStatusEnum` — structurally generic, reusable across domains.
- `sweepCategoryEnum`, `sweepSeverityEnum`, `sweepResolutionStatusEnum` — review vocabulary; SSA-tuned categories, generic severity/status.
- `sourceKindEnum` — SSA-tuned (osint/field/radar/press).

## Target architecture

### `packages/shared/` — keep only the kernel

Keep:

- `src/utils/` (async-handler, error, json, string, collection, domain-normalizer, completeness-scorer) — all generic.
- `src/net/safe-fetch.ts` — pure SSRF guard.
- `src/observability/logger.ts`, `metrics.ts`, `step-context.ts`, `step-logger.ts` — mechanism only.
- `src/enum/auth.enum.ts`, `src/enum/messaging.enum.ts` — generic cross-cutting.

Move out:

- `src/ssa/*` → `packages/domain-ssa/src/views/` (or `apps/console-api/src/shared/`).
- `src/schemas/payload-profile.schema.ts` → `packages/domain-ssa/src/schemas/`.
- `src/enum/research.enum.ts` → split. Keep `ResearchStatus`, `ResearchFindingType`, `ResearchRelation`, `ResearchUrgency`, `ResearchCycleTrigger`, `ResearchCycleStatus` in shared (generic research-machine primitives). Move `ResearchCortex` and `ResearchEntityType` to `packages/domain-ssa/src/enum/`.
- `src/enum/sweep.enum.ts` → split. Keep `SweepSeverity`, `SweepResolutionStatus` in shared. Move `SweepCategory` to `packages/domain-ssa/`.
- `src/enum/source.enum.ts` → move to `packages/domain-ssa/` (lanes are SSA-shaped); or generalise to `{ feed, catalog, manual, telemetry, press }` in shared and keep domain-specific labels in the SSA package.
- `src/observability/steps.ts` → move `STEP_REGISTRY` to an app/package (thalamus or a new domain package), keep only the `StepName` type param pattern in shared so `stepLog` stays generic.
- `src/types/orchestration.types.ts` → move to `apps/console-api/` or `packages/thalamus/` — these are product/SSE shapes.
- `src/types/repl-stream.ts` → already closer to CLI; move to `packages/cli/` or `apps/console-api/`.

### `packages/db-schema/` — rename and relocate

This package cannot stay in a "kernel" slot. Options:

1. **Rename to `@interview/ssa-schema`** and keep at `packages/ssa-schema/`. Lowest-friction: pure rename + import rewrite.
2. **Move to `apps/console-api/src/db/`** (co-locate with repositories). Heavier — thalamus and sweep would need a thin `@interview/domain-ssa` shim re-exporting the Drizzle tables.
3. **Split**: `packages/db-core/` keeps `research_*`, `source*`, `exploration_log`, `user`, `article`, `sim_*` (generic halves) plus the `vector` customType; `packages/ssa-schema/` keeps `satellite*`, `orbit_regime`, `conjunction_event`, `amateur_track`, `launch`, `payload`, `operator*`, SSA enums. `sweep_audit` goes with SSA because of the `operator_country` FK.

Recommended path: option 1 now, option 3 after the domain stabilises. Option 2 over-couples.

### `ResearchCortex` extensibility

The enum is currently a TS enum frozen at compile time → flows into a `pgEnum` tuple → pinned by migrations. To make it domain-extensible:

- Replace the compile-time TS enum with a **registry pattern** in `packages/shared/src/research/cortex-registry.ts` that exposes `registerCortex(name, metadata)` and returns a widened `string` type.
- Move the DB column from `cortexEnum` (pg enum) to a `text` column with a CHECK constraint generated from the registry union OR drop the check entirely and rely on the registry at write-time.
- Each domain package (`domain-ssa`, future `domain-finance`, etc.) imports the registry and calls `registerCortex("conjunction_analysis", { … })` at module load.
- Same treatment for `ResearchEntityType` — polymorphic edges already store `entityType` as a string at runtime, so narrowing via pgEnum is purely defensive. Swap for a runtime validator keyed off the registry.

Alternate: keep the pgEnum but generate the tuple from a composed list `[...genericTypes, ...domainTypes]`. Still requires a migration per new domain entity — acceptable for low-churn.

## Cross-dependency impact

Call sites:

- `@interview/db-schema` is imported by 129 files across `apps/console-api`, `packages/thalamus`, `packages/sweep`, `packages/cli`, plus the package's own seed scripts and docs (grep showed 267 occurrences in 129 files).
- `@interview/shared` is imported by 138 files across the same consumers plus `apps/console`.
- `db-schema`'s own `package.json` declares `"@interview/shared": "workspace:*"` and its `research.enum.ts` / `sweep.enum.ts` / `source.enum.ts` pgEnums import the TS enums from shared. So the chain is `db-schema → shared → (SSA enums)`.

Breakage when relocating:

- Renaming `@interview/db-schema` → `@interview/ssa-schema` is a one-shot `pnpm -r` grep-replace across 129 files + `pnpm-lock.yaml` regen. TSC catches any miss.
- Moving the SSA leak out of `shared` (`./ssa`, `./schemas/payload-profile.schema`, `ResearchCortex`, `ResearchEntityType`) touches the 138 shared consumers, but most imports use the barrel (`import { … } from "@interview/shared"`). A codemod rewriting `@interview/shared` → `@interview/domain-ssa` for the SSA symbols is tractable.
- `db-schema/src/enums/research.enum.ts` imports 8 enums from `@interview/shared`; this line has to flip to `@interview/domain-ssa` after the split. If we keep all enums in shared for now (deferred split), db-schema is unaffected by step 1.

Ordering (safe): (1) rename db-schema; (2) extract `packages/domain-ssa/` and migrate `shared/src/ssa/*` + payload-profile; (3) split the enums; (4) turn `ResearchCortex` into a registry.

## Refactor scope estimate

| Step                                                                                                                                                                                                | Files touched | Risk                                     | Effort    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------- | --------- |
| 1. Rename `@interview/db-schema` → `@interview/ssa-schema` (package + 129 imports + lock regen)                                                                                                     | ~130          | Low (mechanical)                         | ~0.5 day  |
| 2. Extract `packages/domain-ssa/`: move `shared/src/ssa/*`, `shared/src/schemas/payload-profile.schema.ts`, update shared `index.ts`, rewrite ~50 consumer imports                                  | ~55           | Low–Med (tests cover `ssa/*`)            | ~1 day    |
| 3. Split enums: move `ResearchCortex`, `ResearchEntityType`, `SweepCategory`, `SourceKind` to `domain-ssa`; update `db-schema/enums/*.enum.ts` imports; regen pgEnum tuple is a no-op (same values) | ~20           | Low                                      | ~0.5 day  |
| 4. Move `STEP_REGISTRY` out of shared into thalamus; keep mechanism generic                                                                                                                         | ~10           | Low                                      | 0.25 day  |
| 5. Move `orchestration.types.ts`, `repl-stream.ts` to their real owners                                                                                                                             | ~15           | Low                                      | 0.25 day  |
| 6. `ResearchCortex` → registry pattern (optional, defer until 2nd domain arrives)                                                                                                                   | ~30           | Medium (pgEnum → text + CHECK migration) | ~1.5 days |

Total (steps 1–5): ~2.5 days of mechanical work + typecheck + vitest pass. Step 6 is a design-level shift; hold until the second domain lands.

## Top decisions for the user

1. **Rename `@interview/db-schema` → `@interview/ssa-schema` first.** Lowest risk, highest signal: the name matches the contents, and every downstream import becomes self-documenting. Do this before touching shared.
2. **Extract `packages/domain-ssa/` and move `shared/src/ssa/*` + `payload-profile.schema.ts` + SSA-frozen enums (`ResearchCortex`, `ResearchEntityType`, `SweepCategory`, `SourceKind`) into it.** Keep `tryAsync`, `AppError`, `safeFetch`, logger, metrics, completeness-scorer, domain-normalizer, collection/string/json/async utils in `shared`. This is the move that makes H1 true.
3. **Defer the `ResearchCortex` registry refactor** until a second domain exists. Current TS-enum-to-pgEnum pipeline is fine for a single-domain codebase; the registry pattern only pays back once `domain-finance` or similar starts registering its own cortices. Do not pre-build it.
