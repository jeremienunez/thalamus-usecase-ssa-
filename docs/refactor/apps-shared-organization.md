# apps/console + apps/console-api + packages/shared — intra-file organization audit

Complements [duplication.md](./duplication.md), [god-files.md](./god-files.md), [graph-health.md](./graph-health.md), [thalamus-organization.md](./thalamus-organization.md).

---

## 1. Mixed-responsibility offenders

### 1a. apps/console

| File                                                                       | L   | Mixed concerns                                                                                                                                                                                                                                                                                                                                 | Proposed split                                                                                                                                                      |
| -------------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [OpsMode.tsx](../../apps/console/src/modes/ops/OpsMode.tsx)                | 352 | (a) formatters `fmtPc`, `severityOf` L17-28; (b) duplicated `useUtcClock` L30-37 (shadows [lib/useUtcClock.ts](../../apps/console/src/lib/useUtcClock.ts)); (c) atoms `MetricTile` L39-62, `CornerBracket` L64-73; (d) time-controller state L76-132; (e) threat-board derivation L97-111; (f) R3F scene L139-167; (g) 4 HUD overlays L182-342 | `lib/pc.ts` (3 consumers); delete local `useUtcClock`; `modes/ops/hud/atoms.tsx`; `useTimeController()`; `useThreatBoard()`; `OpsHud.tsx`. Residual shrinks to ~80L |
| [ThalamusMode.tsx](../../apps/console/src/modes/thalamus/ThalamusMode.tsx) | 345 | (a) `layoutByClass` L23-48; (b) graphology builder L72-100; (c) Sigma lifecycle L102-133; (d) stats L57-70; (e) incident edges L135-149; (f) camera focus L151-169; (g) HUD overlays L183-280; (h) `ClassLegend` + `ThalamusDrawer` colocated                                                                                                  | `modes/thalamus/layout.ts`; `useSigma({graph, onClick})`; `useKgGraph(data)`; `useKgStats(data)`; `ThalamusHud.tsx`; `ThalamusDrawer.tsx` (convention match)        |
| [Globe.tsx](../../apps/console/src/modes/ops/Globe.tsx)                    | 261 | (a) GLSL shaders L6-102 inline; (b) R3F component L104-203; (c) geometry builders L205-261; (d) second inline shader pair L184-198                                                                                                                                                                                                             | `modes/ops/globe-shaders.ts` + `modes/ops/globe-geometry.ts`. Component → ~80L                                                                                      |
| [SatelliteField.tsx](../../apps/console/src/modes/ops/SatelliteField.tsx)  | 184 | `makeHaloTexture` L19-35; instanced setup; Kepler updater; HTML labels                                                                                                                                                                                                                                                                         | Borderline. Extract `lib/halo-texture.ts` (reusable); otherwise leave (single concept)                                                                              |
| [TelemetryStrip.tsx](../../apps/console/src/components/TelemetryStrip.tsx) | 87  | Third copy of `nowUtc` L8-10                                                                                                                                                                                                                                                                                                                   | Replace with `useUtcClock`                                                                                                                                          |
| [LeftRail.tsx](../../apps/console/src/components/LeftRail.tsx)             | 168 | Rail shell + mode dispatcher + **3 mode-specific filter panels** `OpsFilters`/`ThalamusFilters`/`SweepFilters` L70-168 in shared components/                                                                                                                                                                                                   | Move each filter to `modes/<mode>/<Mode>Filters.tsx`; rail keeps shell + slot                                                                                       |

### 1b. apps/console-api

| File                                                  | L   | Mixed concerns                                                                                                                                                                    | Proposed                                                                                                                                                                                                                |
| ----------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [server.ts](../../apps/console-api/src/server.ts)     | 80  | Bootstrap + CORS + 8 handlers + inline querystring parsing + stats reducer L58-76. No validation, no DTO mapper                                                                   | Fine for the demo. Story: extract `services/stats.service.ts` (genuine business logic) now; propose `features/<entity>/{routes,schema,controller}` when validation/auth/DB lands                                        |
| [fixtures.ts](../../apps/console-api/src/fixtures.ts) | 350 | PRNG L7-16 + DTO types L18-97 (mirrored in [console/lib/api.ts](../../apps/console/src/lib/api.ts)) + reference constants + 5 generators (satellites, conjunctions, KG, findings) | Split `fixtures/{prng,types,satellites,conjunctions,kg,findings,index}.ts`. **Critical:** extract DTO types to a shared contract consumed by both server + console (today held together by a `// keep in sync` comment) |

### 1c. packages/shared

| File                                                                                             | L   | Issue                                                                                                               | Action                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | --- | ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| [observability/index.ts](../../packages/shared/src/observability/index.ts)                       | 5   | Junk-drawer barrel (fan-in 58); re-exports 3 unrelated concepts (pino logger / prometheus metrics / step-lifecycle) | **SPLIT barrel** → `@interview/shared/logger` + `/metrics` + `/steps`                                                                        |
| [utils/index.ts](../../packages/shared/src/utils/index.ts)                                       | 31  | Re-exports 7 files + inlines 4 ad-hoc helpers (`formatDate`, `sleep`, `randomId`, env flags) with 0 callers         | Move helpers to `utils/env.ts`; delete `formatDate`                                                                                          |
| [utils/collection.ts](../../packages/shared/src/utils/collection.ts)                             | 166 | Three mixed concerns: normalization L24-36, sliding-window L49-70, case-insensitive ops L81-166                     | Split or delete (0 production consumers — see §4)                                                                                            |
| [schemas/payload-profile.schema.ts](../../packages/shared/src/schemas/payload-profile.schema.ts) | 241 | Schema + defaults + ensureXxx mutators + `computeProfileConfidence` + `FIELD_WEIGHTS`                               | Borderline. If split: `payload-profile.confidence.ts` (weights + scorer is distinct decision). But 0 non-shared consumers currently — see §4 |

---

## 2. Component hygiene

Hooks + Hud/Drawer extractions for files >200L **or** ≥3 concerns:

- **OpsMode.tsx** — `useTimeController()` → `{speedIdx, paused, effectiveSpeed, togglePause, selectSpeed, label}` (L76-132); `useThreatBoard(conjunctions)` → `{threats, highCount, peakPc, labelIds}` (L97-111). Then `OpsHud.tsx` + `hud/MetricTile.tsx` + `hud/CornerBracket.tsx`.
- **ThalamusMode.tsx** — `useSigma({graph, onClick})`, `useKgGraph(data)`, `useKgStats(data)`. Split `ThalamusHud.tsx` + `ThalamusDrawer.tsx`.
- **Globe.tsx** — `globe-shaders.ts` + `globe-geometry.ts` (component drops to ~80L).

Under threshold (leave): SatelliteField 184L (1 concept), SweepDrawer 136L, FindingsGraph 116L, SweepMode 72L, Drawer 68L, TopBar 62L.

---

## 3. Route/controller hygiene

Today: 80 lines total. **Feature folder is premature at this scale.**

**Immediate wins:**

- Extract `services/stats.service.ts` (L58-76 reducer is real business logic)
- Fix inline `Number(req.query.minPc ?? 0)` → zod validation
- Decision POST L47-56 mutates `f.status` directly on fixture object (controller leaks into store)
- DTO duplication: console ↔ console-api held by comment — see §5

**Growth path** (the moment validation/auth/DB lands):

```
apps/console-api/src/
  features/
    satellites/{routes.ts, schema.ts}
    conjunctions/{routes.ts, schema.ts}
    kg/{routes.ts}
    findings/{routes.ts, controller.ts, schema.ts}    # mutation + DTO mapping
    stats/{routes.ts, service.ts}
  fixtures/{prng, satellites, conjunctions, kg, findings, index}.ts
  server.ts   # registers feature plugins
```

---

## 4. Shared-package discipline — consumer-count audit

| Module                                       | Consumers                                                     | Verdict                                                  |
| -------------------------------------------- | ------------------------------------------------------------- | -------------------------------------------------------- |
| `observability/logger.ts` (`createLogger`)   | ~50 in sweep + thalamus. Console apps: 0                      | KEEP                                                     |
| `observability/metrics.ts`                   | **0**                                                         | **DELETE**                                               |
| `observability/step-logger.ts` + `steps.ts`  | 7+ in sweep/sim + thalamus/services                           | KEEP                                                     |
| `observability/index.ts` (barrel, fan-in 58) | Each importer wants exactly ONE of logger/stepLog, never both | **SPLIT into 3 entrypoints**                             |
| `enum/research.enum.ts`                      | sweep + thalamus + db-schema                                  | KEEP                                                     |
| `enum/messaging.enum.ts`                     | only sweep                                                    | **DEMOTE → packages/sweep**                              |
| `enum/auth.enum.ts`                          | **0**                                                         | **DELETE**                                               |
| `schemas/payload-profile.schema.ts`          | 0 non-shared                                                  | **DEMOTE → packages/thalamus** (payload-profiler cortex) |
| `types/orchestration.types.ts`               | 0 non-shared                                                  | DELETE or demote                                         |
| `utils/async-handler.ts`                     | `retry` × 1 (llm-chat.ts); rest: 0                            | Trim or inline                                           |
| `utils/error.ts`                             | `isAppError` × 1 (sweep/controller-error-handler); rest: 0    | Trim                                                     |
| `utils/collection.ts`                        | **0 production consumers** for all 8 exports                  | **DEMOTE/DELETE**                                        |
| `utils/string.ts`                            | `toSlug` × 1 (satellite.repository); rest: 0                  | Keep `toSlug`, trim rest                                 |
| `utils/json.ts`                              | 0                                                             | DELETE                                                   |
| `utils/completeness-scorer.ts`               | 0 non-shared, non-test                                        | DEMOTE                                                   |
| `utils/domain-normalizer.ts`                 | 0 non-shared                                                  | DEMOTE                                                   |
| `utils/index.ts` inlines                     | 0                                                             | DELETE                                                   |

**Headline:** `apps/console` and `apps/console-api` declare `@interview/shared` in package.json but **never import from it**. Shared only serves sweep + thalamus + db-schema. **~60% of shared/ has 0 consumers** and should be demoted/deleted before interview.

---

## 5. Extractable patterns (N≥2)

| Pattern                                                                                     | Sites                                                                                                                                                                                                                                                                                                                                           | Home                                                                                                                                                          |
| ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **UTC clock / formatter**                                                                   | [lib/useUtcClock.ts](../../apps/console/src/lib/useUtcClock.ts) (canonical) + [OpsMode.tsx L30-37](../../apps/console/src/modes/ops/OpsMode.tsx#L30-L37) + [TelemetryStrip.tsx L8-10](../../apps/console/src/components/TelemetryStrip.tsx#L8-L10)                                                                                              | Expose `useUtcClock(): string`, `useUtcClockDate(): Date`, `formatUtcTime(date)` in `lib/useUtcClock.ts`. Delete duplicates                                   |
| **PC severity / color / format**                                                            | [OpsMode.tsx L17-28](../../apps/console/src/modes/ops/OpsMode.tsx#L17-L28), [OpsDrawer.tsx L66-73](../../apps/console/src/modes/ops/OpsDrawer.tsx#L66-L73) (re-implements ladder inline), [lib/orbits.ts L66-70](../../apps/console/src/lib/orbits.ts#L66-L70) (`pcColor`), [SweepStats.tsx](../../apps/console/src/modes/sweep/SweepStats.tsx) | `lib/pc.ts` — `severityOf`, `formatPc`, `pcSeverityClass`, `pcSeverityHex`. **Single source for threshold ladder**                                            |
| **Drawer empty-state**                                                                      | OpsDrawer L14-16, SweepDrawer L15, ThalamusMode L306                                                                                                                                                                                                                                                                                            | Add `<Drawer.Empty title="…" />` to [components/Drawer.tsx](../../apps/console/src/components/Drawer.tsx)                                                     |
| **HUD panel chrome** (`border border-hairline bg-panel/90 backdrop-blur-sm` + label header) | 6+ sites across OpsMode + ThalamusMode                                                                                                                                                                                                                                                                                                          | `components/HudPanel.tsx` — `{title, accent, children, meta}`                                                                                                 |
| **Metric tile** (label + mono value, tone-colored)                                          | `MetricTile` in OpsMode L39-62, inline copies in ThalamusMode L189-210, `Card` in SweepStats L73-81                                                                                                                                                                                                                                             | `components/MetricTile.tsx` with `tone="primary"\|"hot"\|"amber"\|"cyan"\|"cold"`                                                                             |
| **Mode → command/nav mapping**                                                              | [TopBar.tsx L6-10](../../apps/console/src/components/TopBar.tsx#L6-L10) + [CommandPalette.tsx L19-26](../../apps/console/src/components/CommandPalette.tsx#L19-L26) + LeftRail dispatcher                                                                                                                                                       | `lib/modes.ts` — `MODES = [{id, to, label, icon, hint, cmdK}]`. Kills magic strings `"ops"\|"thalamus"\|"sweep"` scattered across 4+ files. **Strongest win** |
| **Status color ladder**                                                                     | [graphColors.ts L29](../../apps/console/src/lib/graphColors.ts#L29) (`STATUS_COLOR`) + re-impl in LeftRail L150-153 + SweepMode L46-55                                                                                                                                                                                                          | Add `STATUS_TW_CLASS: Record<FindingStatus, string>` next to `STATUS_COLOR`                                                                                   |
| **DTO duplication console ↔ api**                                                           | [console/lib/api.ts L1-82](../../apps/console/src/lib/api.ts#L1-L82) vs [console-api/fixtures.ts L18-97](../../apps/console-api/src/fixtures.ts#L18-L97); held by `// keep in sync` comment                                                                                                                                                     | Extract `packages/console-contracts` (or `shared/types/console.ts`). **First-priority** — only legitimate shared dep between the two apps                     |

---

## 6. Proposed feature layout

### apps/console — per-mode folder completion

Gaps vs convention (`modes/ops/` 5 files, `modes/sweep/` 5 files, `modes/thalamus/` 1 file):

- **thalamus**: everything is in one 345-line file. Mirror ops/sweep: `ThalamusMode.tsx` + `ThalamusDrawer.tsx` + `ThalamusHud.tsx` + `layout.ts` + sigma hook.
- **ops**: `OpsHud.tsx` not yet extracted.
- **LeftRail**: per-mode filter panels belong in their mode folder.

End-state per mode:

```
modes/<mode>/
  <Mode>Mode.tsx        # data fetch + scene + Hud + Drawer composition (<120L)
  <Mode>Hud.tsx         # absolute-positioned overlays
  <Mode>Drawer.tsx      # selection inspector
  <Mode>Filters.tsx     # left-rail content
  hooks.ts              # use<Mode><Concern>
  layout.ts / scene.ts  # geometry / layout helpers
```

### apps/console-api

Feature folders are premature at 80L. Interview-defensible answer: "80 lines; the real surface is the 350L fixtures shim until Postgres. Extract `stats.service` + DTO contract now; on Postgres, carve `features/<name>/{routes,schema,controller}`."

---

## TL;DR

- **Console**: `OpsMode.tsx` (352L/7 concerns) + `ThalamusMode.tsx` (345L/8 concerns) need hook + Hud + Drawer extraction. `Globe.tsx` shaders+geometry split is clean win. `LeftRail` filter panels belong in mode folders.
- **Console-api**: 80L server fine; extract stats service + DTO contract first.
- **Shared**: ~60% has 0 consumers. Delete `metrics.ts`, `auth.enum.ts`, most of `collection.ts`/`json.ts`/`async-handler.ts`. Demote `messaging.enum`, `payload-profile.schema`. Split `observability` barrel into 3 entrypoints.
- **Top cross-cutting extractables**: `MODES` registry (kills magic strings 4+ files), `HudPanel`, `MetricTile`, `lib/pc.ts`, `console-contracts` package for DTO dedup.
