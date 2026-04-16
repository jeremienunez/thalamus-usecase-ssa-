# Arch audit — packages/sweep/

**Scope**: `packages/sweep/src/`
**Lens**: kernel-agnostic (reusable HITL-audit pattern) vs SSA-domain (satellite / conjunction / telemetry metier)
**Date**: 2026-04-16
**Status**: Diagnostic. No code modified.

## Summary

`packages/sweep/` bundles a genuinely reusable HITL-audit kernel (Redis-backed suggestion/review loop, pluggable resolution dispatcher with ambiguity selectors, durable audit trail, sweep reviewer feedback loop, BullMQ worker skeleton, nano-swarm sim engine with fish/aggregate fan-out) together with a thick SSA payload (satellite/operator-country/payload/orbit-regime vocabulary hardcoded into DTOs, prompts, resolution handlers, null-scan citations, and every sim service). The kernel shape is already visible and extractable — the bulk of the package (`services/nano-sweep.service.ts`, `services/sweep-resolution.service.ts`, `repositories/sweep.repository.ts`, `jobs/workers/sweep.worker.ts`, most of `sim/`) would survive a rename to pharmacovigilance or threat intel, BUT every single file currently imports SSA nouns (`satellite`, `operatorCountry`, `payload`, `conjunctionId`, `hardBodyRadiusMeters`, `deltaVmps`, `TELEMETRY_SCALAR_KEYS`, NORAD, etc.) directly. There is zero generic seam: no `EntityRepository<T>` interface, no `DomainVocabulary` injection, no "fetcher bundle" abstraction. The briefing copilot, satellite-sweep-chat stack, and cortex skill names (`sim_operator_agent`, `telemetry_inference_agent`, `pc_estimator_agent`) are fully SSA. **Refactor is feasible** because the layering is clean (routes → controllers → services → repositories; resolution handlers already dispatched off a Zod discriminated union) — the SSA leak is _lexical_, not _structural_.

The biggest architectural smell is that `sim/` (a full multi-agent simulation engine with 3 use-cases UC1/UC3/UC_TELEMETRY/UC_PC) lives inside `sweep/`. It's roughly 50% of the LOC and it emits `sweep_suggestion`s as its output contract, but conceptually it's a separate product: **sim** would be its own generic swarm-sampling kernel + SSA operator-agent domain pack.

---

## Kernel-pure (reste dans `@interview/sweep` générique après rename)

- `packages/sweep/src/jobs/workers/helpers.ts` — generic BullMQ `createWorker` factory. Zero domain.
- `packages/sweep/src/jobs/queues.ts` — queue definitions; domain-neutral except for queue _names_ (`"sweep"`, `"satellite"`, `"sim-turn"`, `"swarm-fish"`, `"swarm-aggregate"`) — rename-trivial.
- `packages/sweep/src/jobs/schedulers.ts` — generic cron helper + one weekly-sweep cron. Pure.
- `packages/sweep/src/config/redis.ts` — generic Redis singleton.
- `packages/sweep/src/middleware/auth.middleware.ts` — stubbed generic auth. Pure.
- `packages/sweep/src/utils/controller-error-handler.ts` — generic Fastify error adapter. Pure.
- `packages/sweep/src/utils/llm-json-parser.ts` — 8-strategy JSON extraction from LLM output. Pure.
- `packages/sweep/src/utils/sql-helpers.ts` — `escapeIlike`. Pure.
- `packages/sweep/src/transformers/shared.dto.ts` — pagination schema. Pure.
- `packages/sweep/src/repositories/sweep.repository.ts` — **core kernel**: Redis-backed suggestion store, `insertMany` / `insertOne` / `list` / `review` / `getById` / `updateResolution` / `getStats` / `loadPastFeedback`. Schema is domain-neutral except for the hardcoded field `operatorCountryId`/`operatorCountryName` (should be `entityScopeId` / `entityScopeName`) and `affectedSatellites` (should be `affectedEntities`). 90% kernel, 10% leak.
- `packages/sweep/src/services/messaging.service.ts` — stubbed generic messaging port. Pure.
- `packages/sweep/src/sim/perturbation.ts` — seeded Mulberry32 RNG + pure `applyPerturbation`. Generic except the `SimKind` union and a couple of SSA-flavoured default specs (`delta_v_budget`, `pc_assumptions`); the RNG + discriminated dispatch are textbook kernel.
- `packages/sweep/src/sim/memory.service.ts` — pgvector-backed per-agent memory (`simAgentMemory`). Schema-coupled but conceptually domain-free (topK, recentObservable, write). Pure vector-memory primitive.
- `packages/sweep/src/sim/aggregator.service.ts` — cosine k-means++ over fish terminal embeddings → cluster fractions + modal + divergence. Pure algorithm, works on any `TurnAction`-shaped union.
- `packages/sweep/src/sim/turn-runner-dag.ts` — parallel per-turn DAG driver. Generic except it hardcodes cortex names (`sim_operator_agent`, `telemetry_inference_agent`, `pc_estimator_agent`) and the `AgentContext` carries SSA-specific `telemetryTarget` / `pcEstimatorTarget` slots. Structurally kernel.
- `packages/sweep/src/sim/turn-runner-sequential.ts` — same as DAG but alternating. Structurally kernel.
- `packages/sweep/src/sim/swarm.service.ts` — generic K-fish fan-out, quorum tracking, aggregator trigger. Pure orchestration primitive.
- `packages/sweep/src/sim/sim-orchestrator.service.ts` — standalone + swarm-fish sim_run factory, pause/resume/inject, scheduleNext. Kernel orchestrator; the only SSA leak is the use of `buildOperatorAgent` for agent construction (easy to inject).
- `packages/sweep/src/sim/god-channel.service.ts` — admin-facing injection wrapper. Templates (`asat_sample`, `debris_cascade_sample`, `launch_surge_sample`) are SSA-themed copy but the service itself is domain-free.
- `packages/sweep/src/sim/prompt.ts` — turn prompt renderer. Kernel scaffolding (persona / goals / constraints / memory / observable / god-events) with SSA-specific `renderTelemetryTarget` + `renderPcEstimatorTarget` injected via optional ctx fields.
- `packages/sweep/src/jobs/workers/sweep.worker.ts` — generic sweep-job runner. Pure.
- `packages/sweep/src/jobs/workers/sim-turn.worker.ts` — generic sim-turn dispatcher; routes on `sim_run.kind`. Kernel except the kind literals (`uc3_conjunction`, `uc1_operator_behavior`) are SSA vocab.
- `packages/sweep/src/jobs/workers/swarm-fish.worker.ts` — generic per-fish drainer. Pure.
- `packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts` — generic aggregate trigger + optional modal→suggestion emission. Pure.
- `packages/sweep/src/controllers/admin-sweep.controller.ts` — generic `list` / `stats` / `review` / `resolve` / `trigger` endpoints. The controller body is domain-free; only the DTO types it imports carry SSA vocab.
- `packages/sweep/src/routes/admin.routes.ts` — generic route registration. Pure.

## Domain-leaked (sort dans un domain pack `@interview/ssa-sweep` ou `packages/sweep-ssa/`)

- `packages/sweep/src/repositories/satellite.repository.ts` — pure SSA. `satellite`, `operatorCountry`, `payload`, `satelliteBus`, `orbitRegime`, `platformClass`, `TELEMETRY_14D_KEYS`, `nullScanByColumn` sourced from information_schema. Entirely domain.
- `packages/sweep/src/types/satellite.types.ts` — SSA types (RawSatelliteInput, EnrichmentOutput, TelemetryScalars). Pure domain.
- `packages/sweep/src/utils/doctrine-parser.ts` — parses operator-country licence/sharing doctrine JSONB. Pure SSA (operator-country doctrine is space-regulatory vocab).
- `packages/sweep/src/services/nano-sweep.service.ts` — **heavy leak**. The 3 modes (`dataQuality`, `nullScan`, `briefing`) are generic in spirit but the implementation hardcodes: operator-country batching, SSA column names in `backfillCitationFor` (mass_kg, launch_year, payload, operator_country_id, platform_class_id, orbit_regime_id, 14D telemetry scalars with GCAT/CelesTrak citations), and the entire prompt text ("satellite data quality auditor for an SSA (Space Situational Awareness) catalog"). A kernel version would inject: `batchGatherer`, `citationProvider`, `promptTemplate`, `domainVocabulary`.
- `packages/sweep/src/services/sweep-resolution.service.ts` — **heavy leak**. Dispatcher shape is kernel (action discriminated union → handler), but the 5 handlers (`update_field` on satellite scalars, `link_payload` / `unlink_payload` on satellite_payload, `reassign_operator_country` on satellite.operator_country_id, `enrich` → satelliteQueue) are pure SSA. Telemetry camelCase fieldMap (powerDraw, thermalMargin, payloadDuty, …) is SSA. The `onSimUpdateAccepted` hook fires for `sim_swarm_telemetry` provenance — SSA-specific. `resolveSatelliteIds`, `findPayloadsByName`, `findOperatorCountriesByName`, `updateSatellitesScalar`, `updateSatellitesFk` all SQL against `satellite` / `payload` / `operator_country` / `orbit_regime` / `platform_class`. Kernel would be a `ResolutionHandlerRegistry` with domain packs registering their `ActionKind → Handler` entries.
- `packages/sweep/src/transformers/sweep.dto.ts` — leak in 2 places: (a) `sweepCategoryEnum` values (`mass_anomaly`, `doctrine_mismatch`, `briefing_angle`) are SSA vocab; (b) the 5 action schemas (`update_field`/`link_payload`/`unlink_payload`/`reassign_operator_country`/`enrich`) are SSA-named, though the _shape_ is generic.
- `packages/sweep/src/services/finding-routing.ts` — the cortex-to-tier map is pure SSA vocabulary (`strategist`, `fleet_analyst`, `launch_scout`, `debris_forecaster`, `apogee_tracker`, `payload_profiler`, `regime_profiler`, `briefing_producer`, `data_auditor`). Routing machinery is generic but data is domain.
- `packages/sweep/src/services/satellite-sweep-chat.service.ts` — fully SSA: briefing copilot on satellite data, loads ephemeris history + lifetime curve + satellite-bus + doctrine + payloads, prompt is "space situational awareness analyst". Pure domain feature.
- `packages/sweep/src/services/satellite.service.ts` — SSA stub (`getEphemerisHistory`).
- `packages/sweep/src/services/viz.service.ts` — SSA stub (`getLifetimeCurve`).
- `packages/sweep/src/repositories/satellite-sweep-chat.repository.ts` — Redis keys scoped by `satelliteId`. Chat primitive is generic but the namespace is SSA.
- `packages/sweep/src/transformers/satellite-sweep-chat.dto.ts` — `sweepFindingCategorySchema` = `orbit | advisory | mission | regime | maneuver | conjunction | lifetime | general`. Pure SSA.
- `packages/sweep/src/controllers/satellite-sweep-chat.controller.ts` — SSA-specific controller (user × satelliteId × SSE stream).
- `packages/sweep/src/routes/satellite-sweep-chat.routes.ts` — SSA routes (`/:id/sweep-chat`).
- `packages/sweep/src/sim/agent-builder.ts` — pure SSA: persona is "SSA operations lead for {operator}", goals mention delta-v spend / regime slot share / regulatory doctrine, constraints include `maxDeltaVMpsPerSat`. The `loadFleetSnapshot` SQL hits `satellite`/`operator_country`/`orbit_regime`/`platform_class`.
- `packages/sweep/src/sim/schema.ts` — `turnActionSchema` is a discriminated union of 10 SSA actions (`maneuver` with deltaVmps, `propose_split`, `launch` with regimeId, `retire`, `lobby` on policy, `infer_telemetry` with 14D scalars, `estimate_pc` with hardBodyRadiusMeters / covarianceScale / TCA geometry). Every action kind is SSA. Perturbation schema carries `delta_v_budget` and `pc_assumptions`. `launchSwarmSchema.kind` is `uc1_operator_behavior | uc3_conjunction | uc_telemetry_inference | uc_pc_estimator` — all SSA use-cases.
- `packages/sweep/src/sim/types.ts` — `FleetSnapshot`, `TelemetryTarget` (bus archetype + datasheet prior + NORAD id), `PcEstimatorTarget` (conjunction geometry, hard-body radius, TCA). Fully SSA.
- `packages/sweep/src/sim/bus-datasheets.ts` + `bus-datasheets.json` — pure satellite-bus archetype datasheets (published/inferred priors for 14D telemetry scalars). Pure domain pack asset.
- `packages/sweep/src/sim/load-telemetry-target.ts` — loads satellite + flattens bus datasheet prior. Pure SSA.
- `packages/sweep/src/sim/load-pc-target.ts` — loads conjunction_event + both satellites + covariance. Pure SSA.
- `packages/sweep/src/sim/telemetry-swarm.service.ts` — SSA entry point (satellite id → K-fish telemetry inference).
- `packages/sweep/src/sim/pc-swarm.service.ts` — SSA entry point (conjunction id → K-fish Pc estimator).
- `packages/sweep/src/sim/aggregator-telemetry.ts` — reduces K `infer_telemetry` actions into 14 scalar distributions. SSA vocab (but the _stats_ code is generic).
- `packages/sweep/src/sim/aggregator-pc.ts` — reduces K `estimate_pc` actions into a Pc distribution with mode/flags clusters. Pure SSA.
- `packages/sweep/src/sim/promote.ts` — promotion logic: `isKgPromotable(action) = maneuver | launch | retire`; the UC3 modal → `research_finding` + `research_edge` path uses SSA vocab throughout. Writes `sim_swarm.outcome_report_finding_id`, emits sweep_suggestions tagged with satellite/operator context. SSA.
- `packages/sweep/src/demo/run.ts` + `demo/telemetry-swarm.ts` — SSA demos.

## Ambiguous (à trancher explicitement)

- `packages/sweep/src/repositories/sweep.repository.ts` — **Redis schema is 90% generic** but hardcodes `operatorCountryId` / `operatorCountryName` / `affectedSatellites` fields in the hash payload. Two options: (a) leave SSA field names, accept a thin SSA-flavoured Redis kernel (pragmatic); (b) rename to `entityScopeId` / `entityScopeName` / `affectedEntityCount` and map in the SSA adapter. **Recommendation**: (b) — the rename is mechanical and the payoff (pharmacovigilance suggestion store for free) is real.
- `packages/sweep/src/controllers/admin-sweep.controller.ts` + `routes/admin.routes.ts` — the controller code is fully generic, but the DTOs it parses carry SSA vocab (`mass_anomaly`, `doctrine_mismatch`, etc.). The controller itself is kernel _once the DTOs are generic_. Classification depends on whether DTOs get split.
- `packages/sweep/src/config/container.ts` — `buildSweepContainer` is the wiring hub. Currently imports `SatelliteRepository` + `NanoSweepService` + sim services all together. Kernel-pure if you split into `buildSweepKernelContainer(opts)` + `buildSsaSweepContainer(kernel, ssaDeps)`. Today it's domain-coupled.
- `packages/sweep/src/sim/prompt.ts` — persona/goals/constraints/memory/observable scaffolding is kernel; `renderTelemetryTarget` + `renderPcEstimatorTarget` are SSA blocks injected via optional ctx fields. **Today** the optional fields sit on `AgentContext` (generic-looking) but the renderers are SSA-specific. Clean split: kernel renderer calls `ctx.domainBlocks: DomainBlockRenderer[]` which each domain pack fills.
- `packages/sweep/src/sim/turn-runner-*.ts` — the `pickCortexName` helper hardcodes 3 cortex names. Kernel if the name picker is injected (`selectCortexForContext(ctx): string`), SSA as-written.
- `packages/sweep/src/sim/god-channel.service.ts` — `GOD_EVENT_TEMPLATES` hardcodes 4 SSA templates (ASAT, regulation, launch surge, debris cascade). Mechanism is kernel; data is SSA — trivial domain pack registration.
- `packages/sweep/src/sim/perturbation.ts` — `applyPerturbation` switches over `spec.kind`. `launch_surge` / `delta_v_budget` / `pc_assumptions` are SSA; `noop` / `god_event` / `constraint_override` / `persona_tweak` are kernel. Needs a plugin extension point.
- `packages/sweep/src/jobs/workers/sim-turn.worker.ts` — routes on `sim_run.kind === "uc3_conjunction"` vs `"uc1_operator_behavior"`. Should be `runnerRegistry.pick(run.kind).runTurn(...)` — kernel with registry.

---

## Cross-cutting observations

- **All 49 files** in `packages/sweep/src/` match at least one of `satellite|conjunction|payload|orbit|SSA|NORAD|telemetry|spacecraft` (case-insensitive grep). Bar a few utilities (helpers, sql-helpers, llm-json-parser, controller-error-handler, shared.dto, auth middleware, redis config) which are in kernel territory, **every non-trivial file is lexically SSA-coupled**.
- **`@interview/db-schema` imports in sweep**: 29 files. Sweep directly imports domain tables (`satellite`, `operator_country`, `payload`, `satellite_payload`, `orbit_regime`, `platform_class`, `conjunction_event`, `sim_*`, `sweep_audit`, `research_*`). There is no intermediate `EntityRepository` abstraction — services talk raw Drizzle/SQL to SSA tables. A generic kernel would need a `KnowledgeGraphRepository<Entity, Edge>` port with the SSA pack implementing the concrete mapping. Today, coupling is direct.
- **Sim engine vs sweep kernel boundary is the single biggest axis** the current module structure hides: `sim/` is 22 files (~50% of LOC) and is conceptually "multi-agent swarm sampler that writes into sweep's suggestion store". It is a separate domain concern (simulation / decision modeling) stacked on top of the sweep kernel. Keeping it physically inside `packages/sweep/` is convenient but masks the architectural layering.
- **Layering leaks (routes → controllers → services → repositories)**:
  - Controllers (`admin-sweep.controller.ts`, `satellite-sweep-chat.controller.ts`) are thin and correct — parse DTO, call service, reply. No leaks.
  - Services occasionally bypass repos and speak raw SQL directly (`sweep-resolution.service.ts` runs `INSERT INTO satellite_payload`, `DELETE FROM satellite_payload`, `UPDATE satellite SET operator_country_id = …`, bespoke `SELECT … FROM operator_country` / `FROM payload`). This is a real layering leak: those SQL statements belong in `SatelliteRepository` (or a new `SatellitePayloadRepository` + `OperatorCountryRepository`). Current shape means adding a second domain requires duplicating raw SQL inline in the resolution service.
  - `sim/agent-builder.ts`, `sim/load-telemetry-target.ts`, `sim/load-pc-target.ts`, `sim/promote.ts`, `sim/sim-orchestrator.service.ts` all run raw `db.execute(sql\`…\`)` calls against SSA tables with no repo layer. Same leak, wider surface.
  - **Finding**: the repository layer is thin where it exists (`satellite.repository.ts`, `sweep.repository.ts`, `satellite-sweep-chat.repository.ts`) but services and sim code routinely bypass it. A kernel extraction must first push all raw SQL into repos, then split repos into kernel-port (interface) + SSA-adapter (implementation).

---

## Top 3 leaks (biggest kernel-extraction blockers)

1. **`sweep-resolution.service.ts` action handlers are SSA-hardcoded.** 5 handlers (`update_field`/`link_payload`/`unlink_payload`/`reassign_operator_country`/`enrich`) all run SSA-specific SQL inline, plus the camelCase fieldMap hardcodes the 8 telemetry scalars. Kernel requires a `ResolutionHandlerRegistry` with domain packs contributing handlers per action kind. Today no such seam exists — the service _is_ the kernel + the SSA pack glued together. This is the single biggest extraction blocker.
2. **`sim/schema.ts::turnActionSchema` is a monolithic SSA discriminated union of 10 actions** (maneuver/launch/retire/propose_split/accept/reject/lobby/hold/infer_telemetry/estimate_pc). The turn runners, aggregator, promote.ts, and BullMQ workers all switch on these `kind` values. Kernel needs `TurnAction` to be an open union extended by domain packs (e.g. `z.discriminatedUnion("kind", [...kernelActions, ...domainActions])`) with a registry-driven aggregator. Today, replacing SSA with pharmacovigilance means rewriting `turnActionSchema`, every turn runner's action handling, every aggregator (narrative + telemetry + Pc), and `isKgPromotable` / `isTerminal`.
3. **`nano-sweep.service.ts` prompts, citations, and batching are literal SSA prose.** `backfillCitationFor` hardcodes 6 SSA column names + 8 telemetry scalars with GCAT/CelesTrak/sim-fish citations. The `buildNanoRequest` and `buildBriefingRequest` instructions say "satellite data quality auditor for an SSA (Space Situational Awareness) catalog" verbatim. The whole "operator-country batch" gatherer is SSA-shape. Kernel needs injected `BatchGatherer`, `CitationProvider`, `PromptTemplateSet`, `DomainVocabulary` — today these are methods on the class with SSA baked in.

---

## Target architecture proposal

```
packages/
├── sweep-kernel/                          # generic HITL-audit + nano-swarm runtime
│   ├── src/
│   │   ├── suggestions/
│   │   │   ├── suggestion.repository.ts   # Redis store, entity-agnostic
│   │   │   ├── suggestion.types.ts        # Suggestion<T>, Resolution<T>
│   │   │   └── feedback.loop.ts           # past-feedback accumulator
│   │   ├── resolution/
│   │   │   ├── resolution.service.ts      # dispatcher + audit write
│   │   │   ├── handler.registry.ts        # DomainPack registers handlers per kind
│   │   │   └── types.ts                   # ResolutionAction<T>, PendingSelection
│   │   ├── audit/
│   │   │   ├── audit.repository.ts        # sweep_audit writer (kernel-owned table)
│   │   │   └── kg-hook.port.ts            # interface; impl lives in domain pack
│   │   ├── nano-swarm/                    # was sweep/src/sim/ (generic half)
│   │   │   ├── orchestrator.service.ts
│   │   │   ├── swarm.service.ts           # K-fish fan-out
│   │   │   ├── aggregator.service.ts      # cosine k-means clustering
│   │   │   ├── memory.service.ts          # pgvector memory
│   │   │   ├── turn-runner-dag.ts
│   │   │   ├── turn-runner-sequential.ts
│   │   │   ├── prompt.renderer.ts         # generic scaffolding + domain block slots
│   │   │   ├── perturbation.ts            # RNG + kernel perturbation kinds
│   │   │   └── god-channel.service.ts     # templates injected via domain pack
│   │   ├── hitl/
│   │   │   ├── admin.controller.ts        # generic list/review/resolve/trigger
│   │   │   └── admin.routes.ts
│   │   ├── jobs/
│   │   │   ├── queues.ts
│   │   │   ├── schedulers.ts
│   │   │   └── workers/                   # sweep/sim-turn/swarm-fish/swarm-aggregate
│   │   ├── ports/
│   │   │   ├── domain-vocabulary.port.ts  # { suggestionCategories, severities, entityName }
│   │   │   ├── batch-gatherer.port.ts
│   │   │   ├── citation-provider.port.ts
│   │   │   ├── prompt-template-set.port.ts
│   │   │   ├── entity-repository.port.ts
│   │   │   ├── turn-action.port.ts        # base action kinds + extension hook
│   │   │   └── cortex-selector.port.ts
│   │   ├── utils/                         # llm-json-parser, sql-helpers, errors
│   │   └── config/                        # redis, DI builder (kernel-only)
│   └── package.json  -> @interview/sweep-kernel
│
├── sweep-ssa/                              # SSA domain pack for sweep-kernel
│   ├── src/
│   │   ├── repositories/
│   │   │   ├── satellite.repository.ts
│   │   │   ├── satellite-payload.repository.ts     # extracted from resolution svc
│   │   │   ├── operator-country.repository.ts      # extracted from resolution svc
│   │   │   └── orbit-regime.repository.ts
│   │   ├── resolution/
│   │   │   ├── update-field.handler.ts
│   │   │   ├── link-payload.handler.ts
│   │   │   ├── unlink-payload.handler.ts
│   │   │   ├── reassign-operator-country.handler.ts
│   │   │   └── enrich.handler.ts
│   │   ├── nano-sweep/
│   │   │   ├── data-quality.prompt.ts
│   │   │   ├── briefing.prompt.ts
│   │   │   ├── null-scan.service.ts        # SSA-citation-aware
│   │   │   └── citations.ts                # backfillCitationFor (GCAT/CelesTrak/sim-fish)
│   │   ├── sim/
│   │   │   ├── actions.schema.ts           # maneuver/launch/retire/propose_split/...
│   │   │   ├── telemetry-swarm.service.ts
│   │   │   ├── pc-swarm.service.ts
│   │   │   ├── aggregator-telemetry.ts
│   │   │   ├── aggregator-pc.ts
│   │   │   ├── load-telemetry-target.ts
│   │   │   ├── load-pc-target.ts
│   │   │   ├── agent-builder.ts            # SSA operator persona
│   │   │   ├── bus-datasheets.ts + .json
│   │   │   ├── god-events.ts               # ASAT/regulation/launch-surge/debris-cascade
│   │   │   └── promote.ts                  # KG promotion rules (SSA-specific)
│   │   ├── vocabulary.ts                   # DomainVocabulary impl for SSA
│   │   ├── briefing-copilot/               # ex satellite-sweep-chat/*
│   │   │   ├── chat.service.ts
│   │   │   ├── chat.repository.ts
│   │   │   ├── chat.controller.ts
│   │   │   ├── chat.routes.ts
│   │   │   └── chat.dto.ts
│   │   ├── finding-routing.ts              # SSA cortex→tier map
│   │   ├── doctrine-parser.ts
│   │   └── container.ts                    # buildSsaSweepContainer(kernelContainer)
│   └── package.json  -> @interview/sweep-ssa
│
├── sweep-pharmacovigilance/                # future — symmetry proof
│   └── src/{repositories,resolution,vocabulary.ts,...}
│
└── sweep-threat-intel/                     # future — symmetry proof
    └── src/{...}
```

**Key seams introduced**

- `DomainVocabulary` port: `{ suggestionCategories, severities, entityName, entityPluralName, entityScopeName, batchGroupName }` — drives prompt text + DTO enums.
- `EntityRepository<TEntity, TEdge>` port: CRUD + null-scan + FK lookups + name search. SSA impl hits `satellite`/`payload`/`operator_country` tables; pharmacovigilance impl hits `drug`/`reaction`/`patient_cohort`.
- `ResolutionHandlerRegistry`: domain packs register `{ kind, schema, handler }` tuples; the kernel dispatcher resolves at runtime.
- `TurnActionExtension`: kernel exposes `extendTurnAction(domainActions)` so SSA can declare `maneuver|launch|infer_telemetry|estimate_pc|...` without forking kernel code.
- `FetcherBundle`: per-domain bundle of `{ batchGatherer, citationProvider, promptTemplates, godEventTemplates, busDatasheets? }` — the "rename + fetcher swap to repurpose" knob the pitch promises.
- `CortexSelector` port: decides which cortex skill to invoke per turn based on context (replaces hardcoded `pickCortexName` in the two runners).

---

## Estimated refactor scope

Rough effort, assuming TDD + the structural clean-up is done incrementally from leaves to roots:

**Phase 1 — Flatten the service → SQL leaks (prerequisite, no packaging change yet)** — _~3 days_

- Extract inline SQL in `sweep-resolution.service.ts` into `SatellitePayloadRepository`, `OperatorCountryRepository`, `OrbitRegimeRepository`.
- Push raw SQL from `sim/agent-builder.ts`, `sim/load-telemetry-target.ts`, `sim/load-pc-target.ts`, `sim/promote.ts`, `sim/sim-orchestrator.service.ts` into dedicated sim-repos (or extend `SatelliteRepository`).
- Establish: **services speak to repos only**. Tests stay green.

**Phase 2 — Introduce ports + move DTOs behind vocabulary** — _~3 days_

- Define `DomainVocabulary`, `EntityRepository`, `BatchGatherer`, `CitationProvider`, `PromptTemplateSet` ports.
- Rename `SweepRepository` hash fields `operatorCountry*` → `entityScope*` and `affectedSatellites` → `affectedEntityCount` (with Redis migration / dual-read).
- Parameterise `sweepCategoryEnum` via domain pack (kernel exposes only `info|warning|critical` severities; categories come from vocab).
- Turn `backfillCitationFor` into `CitationProvider.citeFor(columnKey)`.

**Phase 3 — Extract `ResolutionHandlerRegistry`** — _~2 days_

- Action schemas split: kernel owns `resolutionPayloadSchema.discriminatedUnion("kind", [...])` as an extensible union; SSA pack registers its 5 handlers + their Zod schemas.
- Dispatcher becomes `registry.resolve(action, ctx)`.

**Phase 4 — Extract `TurnActionExtension` + cortex registry from sim** — _~3 days_

- `turnActionSchema` becomes `buildTurnActionSchema(kernelActions, domainActions)`.
- `pickCortexName` → `CortexSelector` port; SSA pack registers `{ telemetryTarget: "telemetry_inference_agent", pcEstimatorTarget: "pc_estimator_agent", default: "sim_operator_agent" }`.
- Aggregators split: kernel owns narrative k-means; domain packs own `aggregator-telemetry` / `aggregator-pc` via a `DomainAggregatorRegistry` keyed on swarm kind.

**Phase 5 — Package split** — _~2 days_

- Move kernel files to `packages/sweep-kernel/`, SSA files to `packages/sweep-ssa/`.
- Rework `buildSweepContainer` → `buildSweepKernelContainer` (kernel) + `buildSsaSweepContainer(kernel, ssaDeps)` (composition root).
- Update `packages/thalamus/` + `packages/cli/` + `apps/*` imports.
- `@interview/db-schema` stays shared but SSA tables only consumed by SSA pack; kernel tables (`sweep_audit`, `sim_*`, `research_*`) stay kernel-accessible.

**Phase 6 — Symmetry proof** — _~3 days_

- Implement `packages/sweep-pharmacovigilance/` with `drug`/`reaction`/`adverse_event_report` entities, stub handlers, fake vocabulary.
- Wire an e2e null-scan pass through the same kernel. If it runs end-to-end with only SSA removed, the extraction is validated.

**Phase 7 — Briefing copilot move + cleanup** — _~2 days_

- Move `satellite-sweep-chat.*` + `viz.service` + `satellite.service` + `doctrine-parser.ts` to SSA pack (unchanged functionality, different address).
- Final sweep: search for residual `satellite` / `conjunction` / `TLE` / `NORAD` in `sweep-kernel/` — should be zero.

**Total**: ~18 days of focused work, assuming one engineer, existing test coverage survives, and DB migrations are additive.

**De-risking**:

- Phase 1 is the safest win and unlocks everything else. Ship it regardless of whether the full extraction lands.
- Phase 6 (pharmacovigilance stub) is the cheapest way to prove the kernel actually generalises. If it doesn't run without SSA touches, the extraction isn't done.
- The sim engine (`sim/` → kernel `nano-swarm/` + SSA `sim/`) is the hardest split and can be deferred to a v2 if the sweep-only kernel is the immediate goal.
