# Arch audit — apps/

Date: 2026-04-16
Scope: `/home/jerem/interview-thalamus-sweep/apps/console-api/src/` and `/home/jerem/interview-thalamus-sweep/apps/console/src/`
Lens: apps are the right home for SSA business/product code; packages should contain reusable kernel or explicitly injected domain packs, not hidden SSA business.

## Summary

Verdict: **apps are the right place for the SSA console business layer, but some reusable runtime mechanics are trapped inside apps and should move up into kernel packages.** The feature surface of both apps is SSA end-to-end: satellites, conjunctions, orbital views, Sweep suggestions, Thalamus cycles, mission enrichment, KNN propagation, reflexion, and REPL chat. The `grep -rn "SSA\|satellite\|conjunction\|orbital" apps/` pass did confirm SSA saturation, but it also hit `node_modules` and `tsconfig.tsbuildinfo`; the scoped pass over `apps/*/src` had no surprise non-SSA product domain.

The main upward leaks are not SSA métier. They are reusable app-runtime patterns: Fastify boot/logging/lifecycle, DB+Redis resource lifecycle, Fastify/Zod controller helpers, SSE write/read plumbing, and two ad hoc single-flight autonomous loops (`AutonomyService` and `MissionService`). Those belong in a package such as `packages/api-runtime/` or `packages/shared/src/http|runtime|net/`, with console-specific wiring staying in `apps/console-api/`.

The inverse finding is important: **SSA prompts currently in `packages/thalamus` and `packages/sweep` are business/domain assets, not kernel.** Under the stated hypothesis they should move down into an app-owned SSA prompt/domain pack and be injected into Thalamus/Sweep kernels.

## Kernel-leaked-UP (du code dans apps/ qui devrait remonter packages/)

| File | Reason | Where |
| --- | --- | --- |
| `apps/console-api/src/server.ts` | Generic Fastify app factory: `createApp`, `startServer`, CORS registration, pino-pretty config, request logging hook, lifecycle close contract. App-specific bits are the satellite logo/banner and route registration. | Move generic factory to `packages/api-runtime/src/fastify-app.ts`; inject routes, CORS opts, logger opts, banner printer, poll-route suppression. Keep logo/hints in `apps/console-api`. |
| `apps/console-api/src/container.ts` | Generic resource lifecycle: read env, open `pg.Pool`, wrap Drizzle, open Redis, expose masked info and `close()`. The concrete service graph is app code; resource scope is reusable. | Move `createPostgresDb`, `createRedisClient`, `ResourceScope.closeAll`, URL masking to `packages/api-runtime/src/resources/`. Keep `buildThalamusContainer`, `buildSweepContainer`, repositories, and services in app composition. |
| `apps/console-api/src/utils/async-handler.ts`, `parse-request.ts`, `http-error.ts`, `schemas/clamp.ts` | Generic Fastify/Zod boundary toolkit. Duplicates existing package concepts: `packages/shared/src/utils/error.ts` has `AppError`; `packages/sweep/src/utils/controller-error-handler.ts` has another Fastify error adapter. | Consolidate into `packages/api-runtime/src/http/` or `packages/shared/src/http/`: `asyncHandler`, `parseOrReply`, `HttpError/AppError` bridge, clamped zod numeric helpers. |
| `apps/console-api/src/controllers/repl.controller.ts` + `apps/console/src/lib/repl-stream.ts` | SSE mechanics are generic: server writes `event:` / `data:` frames from an async generator; client parses an SSE stream and calls a handler. The event type already lives in `@interview/shared`. | Move to `packages/shared/src/net/sse.ts` or `packages/api-runtime/src/sse/`: `writeSseStream(reply, events)` and browser `postSseJson<TEvent>()`. Keep REPL route, prompts, and `ReplStreamEvent` domain contract where owned. |
| `apps/console-api/src/services/autonomy.service.ts` | Reusable single-flight interval loop: start/stop, clamp interval, `busy` guard, tick history, public state, immediate first tick. SSA is only the action provider (`thalamus`, `sweep-nullscan`, query rotation). | Extract `AutonomousLoop<TAction, TTick>` to `packages/shared/src/runtime/` or a future `packages/scheduler-kernel/`. App injects rotation and handler. |
| `apps/console-api/src/services/mission.service.ts` | Same loop pattern as autonomy plus cursor-based task queue: pending tasks, current task, completion counters, `setInterval`, `busy`, stop at exhaustion. The task content is SSA; the runner is generic. | Extract `TaskLoop<TTask, TResultCounters>` to `packages/shared/src/runtime/loop.ts` or `packages/sweep-kernel/mission-loop.ts`. Keep satellite field fill/voting/audit in app. |
| `apps/console/src/lib/api.ts` | Generic `getJson` and mutation wrappers are local; the file also duplicates API DTO types already partly present in `@interview/shared/src/ssa`. | Move only `getJson` / JSON fetch helpers to `packages/shared/src/net/http-json.ts`. Do not move SSA DTOs into kernel; see duplication note below. |

Near-miss / do not move as kernel: `apps/console/src/lib/orbit.ts` contains reusable orbital math, but it is not reusable **outside SSA**. It may belong in an app-owned SSA domain module if shared between console views, not in a kernel package.

## Domain-correctly-placed

- `apps/console-api/src/controllers/*`, `routes/*`, `repositories/*`, `services/*` for satellites, conjunctions, findings, KG, stats, KNN propagation, reflexion, Sweep suggestions, mission enrichment: correct in app. They are API/product orchestration over SSA tables and package services.
- `apps/console-api/src/prompts/*`: correct in app. REPL chat, mission research, and autonomy queries are console/operator prompts.
- `apps/console-api/src/transformers/*`: mostly correct in app because they project DB/package rows into console views. They already consume `@interview/shared` for existing SSA helpers (`deriveAction`, `deriveCovarianceQuality`, `regimeFromMeanMotion`, `smaFromMeanMotion`, `classificationTier`).
- `apps/console-api/src/fixtures.ts` and `apps/console-api/src/repl.ts`: app/demo SSA simulation surface. Keep out of packages.
- `apps/console/src/modes/ops/*`, `modes/sweep/*`, `modes/thalamus/*`, drawers, panels, search, telemetry strip: correct in app. This is presentation and interaction for the SSA console.
- `apps/console/src/lib/orbit.ts`: SSA visualization/domain utility. Correctly not kernel; could be moved only to an app-owned `domain/ssa/orbit.ts` for clearer ownership.
- `apps/console/src/lib/conjunction.ts`: SSA UI derivations and colors. The visual mapping is app code; the threshold derivations duplicate shared SSA logic and should be normalized locally or through a generated/domain contract, not promoted to kernel.

## Apps consuming packages / duplication

What is good:

- `apps/console-api/package.json` depends on `@interview/db-schema`, `@interview/shared`, `@interview/thalamus`, and `@interview/sweep`.
- `apps/console-api/src/container.ts` composes `buildThalamusContainer({ db })` and `buildSweepContainer({ db, redis })` rather than duplicating their internals.
- `apps/console-api/src/transformers/satellite-view.transformer.ts` consumes `normaliseRegime`, `regimeFromMeanMotion`, `smaFromMeanMotion`, and `classificationTier` from `@interview/shared`.
- `apps/console-api/src/transformers/conjunction-view.transformer.ts` consumes `deriveAction`, `deriveCovarianceQuality`, and `regimeFromMeanMotion` from `@interview/shared`.
- `apps/console/src/lib/repl-stream.ts` and `apps/console-api/src/services/repl-chat.service.ts` share `ReplStreamEvent` through `@interview/shared`.

Duplication / drift risks:

- `apps/console/src/lib/api.ts` redefines `Regime`, `SatelliteDTO`, `ConjunctionDTO`, `KgNodeDTO`, `KgEdgeDTO`, `FindingDTO`, and status/action unions while `packages/shared/src/ssa/*` already defines much of the same SSA contract. Under the "apps own SSA" hypothesis, move the contract down to an app-owned console contract, not up to kernel.
- `apps/console/src/lib/conjunction.ts` duplicates thresholds from `packages/shared/src/ssa/conjunction-view.ts`: Pc `1e-4` -> maneuver/red, Pc `1e-6` -> monitor/yellow, sigma `<0.1/<1` -> HIGH/MED/LOW. Today UI labels are uppercase while server values are snake_case; this should be a single app/domain mapping.
- `apps/console-api/src/fixtures.ts` defines DTOs parallel to `apps/console/src/lib/api.ts` and shared schemas. It is demo-only, but the comment "Mirrors apps/console-api/src/fixtures.ts DTOs. Keep in sync." in the console API client is a drift smell.
- `apps/console-api/src/utils/http-error.ts` duplicates the role of `packages/shared/src/utils/error.ts` and `packages/sweep/src/utils/controller-error-handler.ts`; consolidate kernel HTTP errors once.

## Prompts inventory

App prompts, correctly placed:

- `apps/console-api/src/prompts/repl-chat.prompt.ts` — SSA mission-operator assistant, SSA intent router, SSA briefing writer. Correctly app/business.
- `apps/console-api/src/prompts/mission-research.prompt.ts` — SSA catalog fact extractor for one satellite + one field. Correctly app/business.
- `apps/console-api/src/prompts/autonomy-queries.prompt.ts` — console autonomy queries for orbital state, close-approach pressure, catalog consistency, low-visibility objects, sim-fish vs Thalamus reconciliation. Correctly app/business.
- `apps/console-api/src/prompts/index.ts` — app prompt barrel.

Package prompts that are domain/business under this hypothesis and should move down:

- `packages/thalamus/src/prompts/planner.prompt.ts` — starts "You are Thalamus, an SSA (Space Situational Awareness) research planner"; includes satellite/regime/conjunction examples. Should move to app-owned SSA Thalamus prompt pack, or become a generic planner prompt parameterized by injected domain label/examples.
- `packages/thalamus/src/prompts/opacity-scout.prompt.ts` — OpacityScout satellite catalog information-deficit prompt. Pure SSA cortex prompt. Should move to app-owned SSA prompt pack.
- `packages/thalamus/src/cortices/skills/*.md` — 29 SSA cortex skill prompts (catalog, conjunction-analysis, maneuver-planning, payload-profiler, traffic-spotter, etc.). These are business prompts and should not live in a kernel Thalamus package.
- `packages/sweep/src/sim/prompt.ts` — mixed. Persona/goals/constraints/memory/observable scaffold is generic; `renderTelemetryTarget`, `renderPcEstimatorTarget`, fleet snapshot fields, satellite IDs, NORAD IDs, conjunction geometry are SSA. Split into kernel renderer + app/domain `DomainBlockRenderer`s.
- `packages/sweep/src/services/nano-sweep.service.ts` inline prompts — "satellite data quality auditor for an SSA catalog" and "mission-operator briefing editor for an SSA catalog". Move to app/domain prompt pack or inject via `PromptTemplateSet`.
- `packages/sweep/src/sim/agent-builder.ts` inline persona — "SSA operations lead", fleet availability, delta-v spend, orbital regime slot share, conjunction negotiation. Domain/business, should move down or be injected.
- `packages/sweep/src/services/satellite-sweep-chat.service.ts` inline prompts — space situational awareness analyst / satellite SSA analysis extraction. Domain/business.

Conclusion: **`packages/thalamus/prompts` and `packages/sweep` prompt strings are not kernel.** Under this architecture they should live in `apps/console-api/src/domain/ssa/prompts/` or an app-owned SSA domain bundle wired into the kernel packages at boot.

## Target

Recommended target tree:

```text
packages/
  shared/
    src/
      utils/                 # generic only: json/string/collection/tryAsync/retry/etc.
      net/
        http-json.ts         # generic fetch JSON helper
        sse.ts               # generic SSE parser/writer contracts
      runtime/
        autonomous-loop.ts   # generic single-flight interval loop
        task-loop.ts         # generic cursor/task runner
      observability/         # logger/metrics/step context; no SSA registry data

  api-runtime/               # optional if Fastify helpers should not pollute shared
    src/
      fastify-app.ts         # createFastifyApp/startServer lifecycle
      resources/
        postgres.ts          # Pool + Drizzle helper
        redis.ts             # Redis client helper
        scope.ts             # closeAll/resource masking
      http/
        async-handler.ts
        parse-or-reply.ts
        errors.ts
        zod-clamp.ts

  thalamus/                  # kernel only after later refactor
    src/
      planner/               # prompt injected
      executor/              # query helpers injected
      registry/              # skill loader, no SSA skill files
      transports/

  sweep/                     # kernel only after later refactor
    src/
      suggestions/
      resolution/
      sim/
        prompt-renderer.ts   # generic block slots, no satellite/conjunction text

apps/
  console-api/
    src/
      domain/
        ssa/
          prompts/
            repl-chat.prompt.ts
            mission-research.prompt.ts
            autonomy-queries.prompt.ts
            thalamus-planner.prompt.ts
            opacity-scout.prompt.ts
            sweep-nano.prompt.ts
            sim-agent.prompt.ts
          skills/            # former thalamus cortex skill .md files if app owns SSA
          queries/           # former SSA cortex query helpers if kernel split happens
          contracts/         # console API DTOs/schemas, app-owned SSA
          orbit/             # app-owned orbital math if shared across console surfaces
      container.ts           # concrete app composition only
      server.ts              # app-specific banner/routes only

  console/
    src/
      domain/
        ssa/
          api-contract.ts    # generated/imported app contract, not hand-duplicated
          conjunction-ui.ts  # visual labels/colors around app-domain thresholds
          orbit.ts
      lib/
        api.ts               # thin client over contract + shared http-json
        repl-stream.ts       # thin wrapper over shared SSE helper
```

If frontend/backend compile-time sharing needs a workspace boundary, prefer an app/domain workspace such as `apps/console-contracts` or `packages/ssa-console-contracts`. Do not call it `shared` or `kernel`; it is SSA domain contract.

## Estimated refactor

1. **Extract HTTP/runtime kernel helpers** (~0.5-1 day)
   - Move `async-handler`, `parse-request`, `http-error`, `clamp`, JSON fetch, and SSE parser/writer into `packages/api-runtime` or `packages/shared`.
   - Update console-api controllers and console REPL stream to import them.
   - Consolidate with `packages/shared/src/utils/error.ts` and `packages/sweep/src/utils/controller-error-handler.ts` so there is one HTTP error vocabulary.

2. **Extract resource lifecycle** (~0.5 day)
   - Add `createPostgresDb`, `createRedisClient`, `maskConnectionUrl`, and `ResourceScope`.
   - Keep `apps/console-api/src/container.ts` as concrete composition only.

3. **Extract autonomous/task loop primitives** (~1 day)
   - Pull `setInterval` + `busy` + history + stop/exhaustion mechanics out of `AutonomyService` and `MissionService`.
   - Rebuild both app services around injected action/task handlers.
   - Tests: autonomy start/stop/status, mission start/stop/exhaustion, no concurrent ticks.

4. **Normalize console API contracts** (~1 day)
   - Stop hand-copying `SatelliteDTO`, `ConjunctionDTO`, `FindingDTO`, etc. in `apps/console/src/lib/api.ts`.
   - Choose app-owned contract source (server Zod export, generated client, or `apps/console-contracts`).
   - Fold duplicated conjunction thresholds into one app-domain mapping.

5. **Move package prompts down / inject prompt packs** (~2-4 days, depending on how much Thalamus/Sweep splitting is done now)
   - Move `packages/thalamus/src/prompts/*` and SSA skill markdowns into `apps/console-api/src/domain/ssa/prompts|skills`.
   - Move inline Sweep prompt strings into files under the same domain pack.
   - Change Thalamus/Sweep package constructors to accept prompt/skill/domain-block providers.
   - Re-record fixtures if prompt hashes are used by transport caches.

6. **Post-move verification**
   - `rg -n "SSA|satellite|conjunction|orbital|NORAD|TLE" packages/shared packages/api-runtime` should be zero, except test names/comments deliberately covering fixtures.
   - `rg -n "SSA|satellite|conjunction|orbital" apps/console-api/src apps/console/src` should stay high and expected.
   - `pnpm --filter @interview/console-api typecheck`
   - `pnpm --filter @interview/console typecheck`
   - Focused tests for controller helpers, SSE, loop extraction, and console DTO contract.

Top 3 upward leaks:

1. `apps/console-api/src/server.ts` + `apps/console-api/src/container.ts` — Fastify/resource lifecycle kernel mixed with app composition.
2. `apps/console-api/src/services/autonomy.service.ts` + `apps/console-api/src/services/mission.service.ts` — duplicated autonomous single-flight loop/task scheduler mechanics.
3. `apps/console-api/src/controllers/repl.controller.ts` + `apps/console/src/lib/repl-stream.ts` — generic SSE writer/parser split across app backend/frontend.
