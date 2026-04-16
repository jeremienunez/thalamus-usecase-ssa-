# Architecture synthesis — kernel vs domain split

**Date**: 2026-04-16
**Scope**: unifies 5 per-layer audits committed earlier the same day.
**Source audits**:

- [arch-audit-shared-dbschema.md](./2026-04-16-arch-audit-shared-dbschema.md)
- [arch-audit-thalamus.md](./2026-04-16-arch-audit-thalamus.md)
- [arch-audit-sweep.md](./2026-04-16-arch-audit-sweep.md)
- [arch-audit-cli.md](./2026-04-16-arch-audit-cli.md)
- [arch-audit-apps.md](./2026-04-16-arch-audit-apps.md)

## Verdict in one sentence

**The platform pitch — "agnostic kernel + domain pack per use case" — is not currently honoured. SSA has leaked into every kernel package (78% of `packages/thalamus`, 100% of `packages/sweep`, 9/11 tables in `packages/db-schema`, and multiple files in `packages/shared/src/ssa/`). The apps, paradoxically, contain genuine kernel candidates (Fastify runtime, autonomy loop, SSE plumbing) that belong up one level.**

## Numeric picture

| Layer                   | Total files/tables | Kernel-pure                                               | Domain-leaked                                                                                                                                               | Ambiguous | Imports `@interview/db-schema` |
| ----------------------- | ------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------ |
| `shared/src/`           | ~60 (folders)      | utils, net, observability (partial), auth/messaging enums | `src/ssa/`, `payload-profile.schema`, ResearchCortex/SourceKind/SweepCategory enums, `observability/steps.ts` STEP_REGISTRY, `types/orchestration.types.ts` | —         | —                              |
| `db-schema/src/schema/` | 11 tables          | `user`, `article`                                         | 9 tables (satellite, orbit*regime, …) + all `research*_`/`source\__` via SSA-frozen pgEnums                                                                 | —         | self                           |
| `thalamus/src/`         | 98 ts files        | 21                                                        | 73                                                                                                                                                          | 4         | 47                             |
| `sweep/src/`            | 49 ts files        | 0                                                         | 49                                                                                                                                                          | —         | 29                             |
| `cli/src/`              | ~40 ts/tsx files   | 13 primitives (Prompt, ScrollView, CostMeter, …)          | 27 (router, adapters, renderers, boot)                                                                                                                      | —         | direct                         |
| `apps/console-api/src/` | —                  | has kernel leaks **upward** (see F-apps)                  | correctly SSA                                                                                                                                               | —         | direct                         |
| `apps/console/src/`     | —                  | has kernel leaks **upward** (SSE parser)                  | correctly SSA                                                                                                                                               | —         | —                              |

**Cross-dependency scale**: `@interview/db-schema` is imported in 129 files (267 occurrences). `@interview/shared` in 138 files. The move is mechanical but large.

## Top 10 most damaging leaks (ranked)

1. **`packages/thalamus/src/cortices/executor.ts`** — SSA `ResearchCortex.*` enum values hardcoded in `USER_SCOPED_CORTICES` / `WEB_ENRICHED_CORTICES` / strategist meta-cortex branch + `KNOWN_ORBIT_REGIMES` (LEO/MEO/GEO) + web-search prompt "CelesTrak / Space-Track / ESA / NASA CNEOS". The orchestration engine is the worst offender.
2. **`packages/thalamus/src/services/thalamus-planner.service.ts`** + **`packages/thalamus/src/prompts/planner.prompt.ts`** — `DAEMON_DAGS` hardcodes 8 SSA jobs (fleet*analyst, conjunction_analysis, regime_profiler, debris_forecaster, …). Prompt opens with *"You are Thalamus, an SSA research planner"\_. A new domain cannot produce a plan without editing kernel code.
3. **`packages/thalamus/src/cortices/guardrails.ts`** — `SSA_KEYWORDS` (70+ tokens: satellite, orbit, LEO, TLE, NORAD, celestrak, …) drives `domainRelevance()`. Any non-SSA domain would see 100% of its content filtered.
4. **`packages/sweep/src/services/sweep-resolution.service.ts`** — 5 action handlers (`update_field`/`link_payload`/`unlink_payload`/`reassign_operator_country`/`enrich`) run inline SQL against `satellite`/`payload`/`operator_country` with a camelCase fieldMap for 8 telemetry scalars. No registry seam.
5. **`packages/sweep/src/sim/schema.ts::turnActionSchema`** — 10-variant SSA discriminated union (maneuver/launch/retire/propose_split/accept/reject/lobby/hold/infer_telemetry/estimate_pc). Turn runners, aggregators, `promote.ts`, workers all switch on these kinds. Swap domain = rewrite the sim stack.
6. **`packages/sweep/src/services/nano-sweep.service.ts`** — prompt text is literal SSA ("satellite data quality auditor for an SSA catalog"), `backfillCitationFor` hardcodes GCAT/CelesTrak citations for 6 columns + 8 telemetry scalars.
7. **`packages/shared/src/ssa/`** (folder) — `satellite-view.ts`, `conjunction-view.ts`, `finding-view.ts`, `kg-view.ts` with NORAD id, Kepler solver, regime enum, Pc/covariance derivations. Entire folder re-exported from the root `shared` barrel.
8. **`packages/shared/src/enum/research.enum.ts`** — `ResearchCortex` + `ResearchEntityType` + `SweepCategory` + `SourceKind` TS enums frozen to SSA values, consumed by pgEnums and kernel code alike.
9. **`packages/thalamus/src/repositories/entity-name-resolver.ts`** + **`packages/thalamus/src/utils/satellite-entity-patterns.ts`** — hardcoded SSA entity table map and NORAD/COSPAR/Starlink/Sentinel/GPS regex bank.
10. **`packages/shared/src/observability/steps.ts`** — `STEP_REGISTRY` hardcodes SSA step names (`fetch.osint`, `kg.write`, `fish.spawn`, `swarm`). A non-SSA cortex can't emit semantically-clean steps without patching shared.

## Inverse finding: kernel leaks UP from apps

Three reusable runtime primitives are currently trapped in `apps/console-api/`:

| From                                                                                          | What                                                            | Should go to                                                      |
| --------------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| `apps/console-api/src/server.ts` + `container.ts`                                             | Fastify app factory, resource lifecycle, pool/redis/URL masking | `packages/api-runtime/` (new)                                     |
| `apps/console-api/src/services/autonomy.service.ts` + `mission.service.ts`                    | single-flight interval loop, cursor/task queue runner           | `packages/shared/src/runtime/autonomous-loop.ts` + `task-loop.ts` |
| `apps/console-api/src/controllers/repl.controller.ts` + `apps/console/src/lib/repl-stream.ts` | SSE frame writer + browser parser                               | `packages/shared/src/net/sse.ts`                                  |
| `apps/console-api/src/utils/{async-handler,parse-request,http-error}.ts` + `schemas/clamp.ts` | Fastify/Zod controller boundary toolkit                         | `packages/shared/src/http/` or `packages/api-runtime/src/http/`   |

These are moves that pay for themselves immediately: they **duplicate** with `packages/shared/src/utils/error.ts` and `packages/sweep/src/utils/controller-error-handler.ts`. Consolidating today removes a drift smell.

## Target architecture

The shape the pitch demands:

```text
packages/
  shared/                          # kernel, strictly agnostic
    src/
      utils/                       # tryAsync, AppError (consolidated), retry, …
      net/
        http-json.ts
        safe-fetch.ts
        sse.ts                     # moved up from apps/
      runtime/
        autonomous-loop.ts         # moved up from apps/
        task-loop.ts               # moved up from apps/
      observability/               # logger, metrics, step-context
                                   # (STEP_REGISTRY moves to domain)
      http/                        # async-handler, parse-or-reply, zod-clamp
      enum/                        # auth, messaging (generic only)

  api-runtime/                     # NEW — optional carve-out if HTTP stack
    src/                           # pollution of shared is unwelcome
      fastify-app.ts
      resources/postgres.ts
      resources/redis.ts
      resources/scope.ts

  agent-core/                      # ex-thalamus, kernel only
    src/
      orchestrator/                # executor with injected vocab
      planner/                     # prompt template + DAG registry injected
      registry/                    # skill/cortex loader, no SSA data
      guardrails/                  # keyword gate accepts injected allowlist
      transports/                  # llm-chat, fixture, stub
      explorer/                    # swarm + curator, vocab injected
      research-graph/              # KG write-path, schema injected
      skills/                      # SKILL LOADER contract (ports)
      # NO prompts/, NO skill .md, NO queries/, NO sources/

  hitl-kernel/                     # ex-sweep, kernel only
    src/
      runner/                      # nano-sweep runner, prompt templates injected
      resolution/                  # handler registry, SSA handlers removed
      feedback/                    # prompt tuning from accept/reject
      sim/                         # generic sim orchestrator
        prompt-renderer.ts         # generic slots, no SSA text
      # NO SSA action schemas, NO GCAT citations, NO SSA prose

  repl-kernel/                     # OPTIONAL, only if a 2nd CLI appears
    src/                           # Prompt, ScrollView, ConversationBuffer,
                                   # CostMeter, EtaStore, PinoRingBuffer,
                                   # ClarifyRenderer

apps/
  console-api/
    src/
      domain/ssa/                  # THE domain pack
        schema/                    # ex-packages/db-schema tables + enums
        prompts/                   # planner, opacity-scout, nano-sweep,
                                   # sim-agent, repl-chat, mission-research,
                                   # autonomy-queries
        skills/                    # 29 cortex skill .md files
        queries/                   # 28 cortex SQL helpers
        sources/                   # celestrak, seesat, spacetrack fetchers
        resolution-handlers/       # 5 SSA handlers
        turn-actions/              # 10 SSA sim variants
        vocabulary/                # SSA_KEYWORDS, orbit regimes, entity patterns
        enums/                     # ResearchCortex, SourceKind, SweepCategory
        contracts/                 # console DTOs (unifies apps/console/lib/api.ts drift)
        orbit/                    # app-owned orbital math
      server.ts                    # app banner + route registration
      container.ts                 # concrete composition only
      controllers/
      services/
      transformers/
  console/                         # React SSA UI
  ssa-cli/                         # ex-packages/cli, renamed + moved

  # Proof-by-symmetry (future, not in this plan):
  pharmacovigilance-api/
    src/
      domain/pv/
        schema/                    # drug, adverse_event, …
        prompts/                   # PV-specific
        skills/
        vocabulary/
```

## Phased refactor plan (scope-first)

Each phase delivers standalone value. No phase requires a full rewrite to ship.

**Phase 1 — Upward extraction from apps/** _(1-2 days)_

- Create `packages/api-runtime/` (or `packages/shared/src/{http,net,runtime}/`, pick one — decision below).
- Move `async-handler`, `parse-request`, `http-error`, `clamp`, JSON fetch, SSE writer/parser, Fastify factory, resource scope.
- Extract `AutonomousLoop<TAction>` and `TaskLoop<TTask>` from `AutonomyService` + `MissionService`.
- Consolidate with `shared/utils/error.ts` and `sweep/utils/controller-error-handler.ts` (one HTTP error vocabulary).
- Update `apps/console-api` to consume the new imports.
- Tests pass.

**Phase 2 — shared/ cleanup** _(1 day)_

- Move `packages/shared/src/ssa/*` → `apps/console-api/src/domain/ssa/contracts/` (or similar).
- Move `packages/shared/src/schemas/payload-profile.schema.ts` → `apps/console-api/src/domain/ssa/schema/`.
- Move `ResearchCortex`, `ResearchEntityType`, `SweepCategory`, `SourceKind` enums to the domain pack. Leave a kernel port in shared (string type or `CortexId` opaque) + let domain register values.
- Move `observability/steps.ts` `STEP_REGISTRY` to domain. Kernel keeps `StepName` as `string`.
- Re-point every consumer.

**Phase 3 — db-schema rename + layout** _(1-2 days)_

- Mechanical rename `@interview/db-schema` → `@interview/ssa-schema`. ~130 files, find-replace + re-export.
- Move the package under `apps/console-api/src/domain/ssa/schema/` or keep as `packages/ssa-schema/` if multiple apps share it. Decision deferred to when a 2nd SSA app exists.
- Optional: extract `user` + `article` into `packages/kg-schema/` if they are reused; otherwise keep them in the domain pack too.

**Phase 4 — Sweep layering fix** _(2-3 days, standalone value)_

- Push all `db.execute(sql\`...\`)` calls in sweep services into the repo layer. No kernel/domain decision yet; just restore the 5-layer invariant the README claims.
- Tests: integration specs per repo surface.
- This is Phase 1 of the sweep audit's 7-phase plan — ships value even without kernel split.

**Phase 5 — Thalamus kernel purification** _(3-5 days)_

- `cortices/skills/*.md` → `apps/.../domain/ssa/skills/`.
- `cortices/queries/*.ts` → `apps/.../domain/ssa/queries/`.
- `cortices/sources/fetcher-{celestrak,seesat,spacetrack,…}.ts` → `apps/.../domain/ssa/sources/`.
- Keep generic fetchers (`rss`, `arxiv`, `ntrs`) in `agent-core/src/sources/`.
- Refactor `executor.ts`: inject `CortexVocabulary`, `OrbitRegimeRegistry`, web-search prompt template.
- Refactor `planner.service`: accept `DaemonDAGRegistry` + `PlannerPromptTemplate` (text with `{domain}`, `{examples}` slots).
- Refactor `guardrails`: accept `DomainVocabulary` port (keyword allowlist) for `domainRelevance()`.
- Refactor `entity-name-resolver`: accept `EntityTableMap` at construction.
- Rename package `@interview/thalamus` → `@interview/agent-core` (last; mechanical after refactor).

**Phase 6 — Sweep kernel purification** _(3-5 days)_

- Move sweep prompts (`nano-sweep` inline, `sim/agent-builder` inline, `sim/prompt.ts` SSA bits) to `apps/.../domain/ssa/prompts/sweep/`.
- Refactor `sweep-resolution.service`: accept `ActionHandlerRegistry`. Move 5 SSA handlers to domain.
- Refactor `sim/schema.ts::turnActionSchema`: accept domain-provided extension schema. Move 10 SSA variants to domain.
- Rename `@interview/sweep` → `@interview/hitl-kernel`.

**Phase 7 — CLI move** _(0.5 day)_

- `packages/cli` → `apps/ssa-cli`. Single-consumer binary moves with its routes/adapters/renderers.
- Do **not** extract `packages/repl-kernel` yet. The 13 generic primitives stay co-located until a 2nd CLI exists (YAGNI, confirmed by the cli audit).

**Phase 8 — Symmetry proof** _(1-2 days)_

- Build a minimal `apps/pharmacovigilance-api/src/domain/pv/` stub with its own schema + prompts + 1 cortex + 1 resolution handler.
- Wire it into the SAME `agent-core` + `hitl-kernel`. If this boots and runs a fake cycle end-to-end, the pitch is honest.
- This is the interview-pitch payload. Without this, the refactor is theory.

**Total: 11-19 days** depending on how aggressive the sim stack refactor is. Phases 1-4 ship standalone value (~5-8 days); the kernel split (5-7) is 7-10 days; symmetry proof (8) is where the pitch becomes defensible.

## Open architectural decisions (ask the user)

1. **Package boundary for HTTP/runtime helpers** — `packages/shared/src/{http,runtime,net}/` OR separate `packages/api-runtime/`?
   - Pro shared: one less package to publish, smaller cross-dep graph.
   - Pro api-runtime: `shared` stays strictly non-Fastify, cleaner SRP.
   - Reco: **fold into `shared`** unless shared gains non-Fastify HTTP consumers; premature package split otherwise.

2. **Where does `ssa-schema` live?**
   - `apps/console-api/src/domain/ssa/schema/` if only console-api consumes it.
   - `packages/ssa-schema/` if console-api + ssa-cli + pharmacovigilance-api each have their own schemas.
   - Reco: **keep as package (`packages/ssa-schema/`) after rename**, because `apps/ssa-cli` + `apps/console-api` both consume it. Symmetric with future `packages/pv-schema/`.

3. **Cortex registry: static TS enum vs runtime registry?**
   - Today `ResearchCortex` is a TS enum frozen to SSA values, also consumed as `pgEnum` in the DB. A runtime registry means the pgEnum must accept dynamic values (array in migration) or drop to `text`.
   - Reco: **defer** — keep the current pattern, accept that cortex values are app-compile-time constants. Move to runtime registry only when a 2nd domain is actually added (Phase 8).

4. **Thalamus + sweep rename — do it during refactor, or at the end?**
   - Renaming at the end means all imports change twice (once per refactor phase).
   - Renaming at the start means the new name is aspirational (still full of SSA).
   - Reco: **at the end of each kernel purification phase (5, 6)**. Imports change once, name matches content.

5. **Cortex skills as files vs as string exports?**
   - Today they are `.md` files loaded by the registry. Moving them to `apps/.../domain/ssa/skills/` keeps the pattern but requires path resolution from the kernel.
   - Alternative: compile skills to `.ts` string exports, injected at boot. Loses diffability for non-engineers.
   - Reco: **keep as `.md` files in the domain pack**, kernel accepts a `skillDir: string` or `skillLoader: SkillLoader` port.

## Risks

| Risk                                                                                                                      | Mitigation                                                                               |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| 129-file find-replace for db-schema rename                                                                                | codemod with `pnpm changeset`-style script; dry-run first                                |
| Tests break during cross-package moves                                                                                    | move-then-re-green loop per phase; do not batch phases                                   |
| pgEnum migration if ResearchCortex leaves shared                                                                          | defer (decision 3)                                                                       |
| Prompt hash changes invalidate fixture-transport recordings                                                               | re-record `THALAMUS_MODE=record` after each prompt move                                  |
| Circular dep when `apps/console-api/domain/ssa` imports from kernel packages that now depend on injected domain providers | only if we also try to import domain _from_ kernel tests; keep integration tests in apps |
| Interview-pitch urgency vs refactor scope                                                                                 | Phase 8 alone proves the pitch; if time-boxed, ship Phases 1-3 + a thin Phase 8 stub     |

## Where this document leaves things

- All 5 layer audits committed.
- This synthesis committed.
- No code has been moved. Implementation is scoped but **not started**.
- The next call to action is **for the human**: pick a phase to start (Phase 1 or 4 are standalone; Phase 8 is the pitch payload), or explicitly park the refactor.
