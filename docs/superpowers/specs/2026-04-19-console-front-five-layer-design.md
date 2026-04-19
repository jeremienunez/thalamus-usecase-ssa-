# Console Front — Five-Layer Architecture

> Spec — 2026-04-19. Applies to `apps/console/src/**`.
> Sibling of Plan 5 (sim kernel HTTP boundary) + Plan 6 (sweep 5-layer).
> Mirrors their vocabulary where the React idiom allows.

---

## 1. Goals

Ordered by priority (from the brainstorming dialogue):

1. **Dégraissage des god-components.** Break `ThalamusMode` (763 LOC),
   `OpsMode` (462 LOC), `SatelliteField` (583 LOC) into focused units. Each
   unit has one reason to change.
2. **Kernel/app vocabulary parallelism.** A console contributor should be
   able to read `apps/console-api/` and `apps/console/` with the same mental
   map of "who calls whom".
3. **DIP by construction.** No component imports `fetch`, `Three.js`, or
   `sgp4` directly. Every external I/O goes through an adapter consumed via
   React Context. Tests swap fakes without module mocking.

Non-goals:

- Rewrite to Next.js / RSC / SSR.
- Replace TanStack Query / Zustand / Sigma / Three.js.
- Move to a monorepo package `@interview/console-core`. Stays inside
  `apps/console/src/**`.
- Test coverage push. Structure first; tests are an enabler, not the target.

---

## 2. The five layers

```
apps/console/src/
├── pages/              # L1 — entry, routing, top-level composition
├── features/           # L2 — one folder per business surface
├── hooks/              # L3 — view-models (UI state + local orchestration)
├── usecases/           # L4 — domain intents front (TanStack queryFn)
├── adapters/           # L5 — external I/O, zero UI
├── shared/
│   ├── ui/             # UI-kit primitives (Drawer, Skeleton, KV, Measure)
│   └── types/          # DTOs + enums mirroring backend (@interview/shared)
└── providers/          # Context wiring at bootstrap
```

### L1 — pages/

- `App.tsx`, `main.tsx`, any top-level layout chrome.
- Wires `providers/*` into a single cascade around `<RouterOutlet />`.
- No business logic. No data fetching. No state beyond routing.

### L2 — features/

- One folder per business surface: `thalamus/`, `ops/`, `sweep/`, `repl/`,
  `findings/`, `autonomy/`, `decisions/`.
- Each feature folder is **self-contained**: its components, its scoped
  store (if any), its local types, its internal sub-components.
- **Features never import other features.** If two features need the same
  thing, it moves to `shared/ui`, `hooks/`, or `usecases/`.
- A feature component composes; it does not orchestrate. Orchestration
  (data, state) comes from `hooks/` and `usecases/`.

### L3 — hooks/

- View-model hooks: "what does this component need to render, as a function
  of URL + global state + usecases?"
- Examples: `useOpsTime()`, `useOpsSelection()`, `useThalamusGraph()`.
- A hook may consume multiple usecases + multiple contexts; it never
  performs I/O itself.
- Scoped Zustand stores live here (`hooks/stores/ops.store.ts` etc.) when a
  feature needs cross-component local state.
- No React component in this folder.

### L4 — usecases/

- Domain intents front-side: "get the fleet snapshot", "subscribe to findings
  stream", "start a sweep turn". Each file = one intent.
- Implemented as **TanStack hooks** (`useXQuery`, `useXMutation`,
  `useXSubscription`) that compose adapters retrieved from Context.
- Usecases own: query keys, cache policy, retry, transformations from wire
  DTO → view-shape.
- Never import `fetch` or other raw I/O. Only adapters via `useApiClient()`
  / `useSseClient()` / etc.
- The L4 ↔ backend-services mapping is explicit: "`usecases/useFleetQuery`
  is the front-side of `apps/console-api/src/services/fleet.service.ts`".

### L5 — adapters/

- External I/O, zero UI, zero React (except Context glue at the boundary).
- Substructure:

  ```
  adapters/
  ├── api/                # HTTP, one file per domain
  │   ├── satellites.ts   # SatelliteApiPort interface + fetch impl
  │   ├── conjunctions.ts
  │   ├── kg.ts
  │   ├── findings.ts
  │   ├── cycles.ts
  │   ├── sweep.ts
  │   ├── mission.ts
  │   ├── autonomy.ts
  │   ├── decisions.ts
  │   ├── review.ts
  │   └── client.ts       # shared fetch wrapper: baseURL, headers, error envelope
  ├── sse/
  │   ├── repl.ts         # REPL SSE parser (was lib/repl-stream.ts)
  │   └── findings.ts     # findings subscription
  ├── renderer/           # Three.js — kept out of React
  │   ├── scene.ts
  │   ├── textures.ts     # makeGoldBumpTexture, makeSolarPanelTexture, ...
  │   └── instanced-sats.ts
  └── propagator/
      └── sgp4.ts         # propagateSgp4 wrapper (was direct import)
  ```

- Each adapter exports (1) a TS interface (the port), (2) a concrete
  implementation, (3) a React Context + `useX()` hook.

### shared/

- `shared/ui/` — UI-kit primitives that carry no business knowledge:
  `Drawer`, `DrawerSection`, `KV`, `Skeleton`, `Measure`, `Toast`, button
  variants.
- `shared/types/` — DTOs + domain enums. **Must re-export from
  `@interview/shared` when the concept exists server-side.**
  - `entity-kind.ts` — one `entityKind(id): "sat" | "op" | "finding" | …`
    function replacing the duplicated switches in `ThalamusMode`,
    `FindingReadout`, etc.
  - `satellite-classification.ts` — replaces `getModelType`'s 40
    `startsWith` hardcodes.
  - `severity.ts`, `action-kind.ts`, `regime.ts`, `cortex-name.ts`,
    `sweep-category.ts`, `confidence-band.ts` — frontmatter of the domain
    vocabulary, aligned 1:1 with backend enums.

### providers/

- One provider per adapter port: `ApiClientProvider`, `SseClientProvider`,
  `RendererProvider`, `PropagatorProvider`, `QueryClientProvider`.
- `AppProviders.tsx` composes them in one cascade consumed by `pages/App.tsx`.
- Bootstrap (`main.tsx`) constructs concrete adapters and passes them as
  `value` to providers. Tests construct fakes and do the same.

---

## 3. Dependency direction (enforced)

```
pages   → features → hooks → usecases → adapters
                                      ↘ shared/types
shared/ui is importable from any layer (pure presentation)
providers/ wires adapters into Contexts at bootstrap
```

Forbidden (arch-guard will assert):

- `features/* → features/*` (no cross-feature import)
- `hooks/* | usecases/* → fetch|EventSource|Three|sgp4` (must go through adapter)
- `adapters/* → react` (except the Context glue file at each adapter boundary)
- `components/*` / `modes/*` / `lib/*` — these folders are **deleted**; the
  arch-guard forbids them from reappearing.

---

## 4. DIP mechanism

**Context-per-port + TanStack Query** (chosen; alternatives rejected):

- Each adapter has its own Context + hook.
- Tests wrap in `<ApiClientProvider value={fake}><QueryClientProvider
client={testClient}>`. Zero module mocking.
- Swapping real ↔ fake ↔ fixture-mode = swapping the Context value. The
  consumer code is identical.

Why not single `AdaptersContext`: forces all consumers to know every
adapter shape → couples the TypeScript graph tighter than needed.

Why not module-level setter (like `buildSweepContainer`): defeats React
re-render on swap and doesn't fit hot-reload during dev.

---

## 5. File-by-file migration map

| Source (LOC)                                           | Destination                                                                                                                                                                          |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `modes/thalamus/ThalamusMode.tsx` (763)                | `features/thalamus/{Canvas,Hud,Drawer,Ascii,SubDrawer}.tsx` + `hooks/useThalamusGraph.ts` + `hooks/useThalamusLayout.ts` + `adapters/renderer/sigma.ts`                              |
| `modes/ops/OpsMode.tsx` (462)                          | `features/ops/{Scene,Filters,ThreatBoard,Clock,Search}.tsx` + `hooks/useOpsTime.ts` + `hooks/useOpsSelection.ts`                                                                     |
| `modes/ops/SatelliteField.tsx` (583)                   | `features/ops/SatelliteField.tsx` (≤150 LOC) + `adapters/renderer/{textures,instanced-sats,palette}.ts` + `adapters/propagator/sgp4.ts` + `shared/types/satellite-classification.ts` |
| `modes/sweep/SweepSuggestions.tsx` (240)               | `features/sweep/Suggestions.tsx` + `usecases/useSweepSuggestions.ts` + `usecases/useMissionMutation.ts`                                                                              |
| `lib/api.ts` (mega-client, 192 LOC)                    | `adapters/api/{satellites,conjunctions,kg,findings,cycles,sweep,mission,autonomy,decisions,review}.ts` + `adapters/api/client.ts`                                                    |
| `lib/queries.ts`                                       | dissolved into `usecases/*.ts` (one file per intent, not per endpoint)                                                                                                               |
| `lib/repl.ts`, `lib/repl-stream.ts`                    | `adapters/sse/repl.ts` + `usecases/useReplStream.ts` + `features/repl/ReplContext.tsx` stays but slimmed to feature-scope state only                                                 |
| `lib/replReducer.ts`                                   | stays, moves to `features/repl/reducer.ts` (pure fn, no I/O)                                                                                                                         |
| `lib/uiStore.ts` (zustand, global)                     | split into `features/thalamus/state.ts` + `features/ops/state.ts` + `features/repl/state.ts` (scoped)                                                                                |
| `components/Drawer.tsx`, `Skeleton.tsx`, `Measure.tsx` | `shared/ui/`                                                                                                                                                                         |
| `components/FindingsPanel.tsx`, `FindingReadout.tsx`   | `features/findings/`                                                                                                                                                                 |
| `components/LeftRail.tsx`                              | `pages/LeftRail.tsx` (it routes between features)                                                                                                                                    |
| `components/AutonomyControl.tsx`                       | `features/autonomy/Control.tsx` + `usecases/useAutonomyQuery.ts`                                                                                                                     |

---

## 6. Enum alignment (L2 goal → concrete fix)

Today, five kinds of duplicated `switch` exist in the UI:

1. `ghostClassFor` + `synthLabel` in `ThalamusMode.tsx:114-161` — switch on
   ID prefix.
2. `entityKind` in `FindingReadout.tsx:385-401` — same switch, different
   grammar.
3. `getModelType` in `SatelliteField.tsx:149-231` — 40 `startsWith` on bus
   names.
4. `SEVERITY_COLOR` / `ACTION_COLOR` records — fine (records are OCP-safe)
   but could be re-exported from `@interview/shared` instead of re-declared.
5. Mode routing in `LeftRail.tsx:42-47` — non-extensible `if`.

After refactor:

- One `entityKind(id)` in `shared/types/entity-id.ts`, backed by a typed
  enum re-exported from `@interview/shared`.
- One `classifySatellite({busName, operator, purpose})` in
  `shared/types/satellite-classification.ts`, sourced from a JSON table
  (loaded at build time) so adding a bus family means editing data, not
  code.
- Mode routing becomes a `features[mode].Entry` lookup.

---

## 7. Testing posture

- **Components** (features) — render with fake adapter Contexts; assert on
  DOM. No network.
- **Hooks** — `renderHook` from `@testing-library/react` with provider
  wrapper.
- **Usecases** — renderHook with a fake `ApiClientContext` + real
  `QueryClientProvider` (test client). Assert on query state transitions.
- **Adapters** — unit tests against `fetch` mocked at the `client.ts`
  level. Each adapter tested once.
- **Arch-guard** — one spec file walks `apps/console/src/**` and asserts
  the forbidden-edges list in §3.

Coverage push is **not a goal** of this refactor. The architecture merely
removes the current barriers (module singletons, god-components) that
make testing prohibitively expensive.

---

## 8. Migration — big bang, atomic commits

The user chose "big bang" (option A) in the brainstorming. Executed as one
feature branch, merged as a single PR, composed of atomic commits per
layer/move so `git bisect` stays useful.

**Commit plan:**

1. `scaffold(front-5l): create adapters/ usecases/ shared/ providers/ layout`
2. `refactor(front-5l): extract adapters/api/* from lib/api.ts`
3. `refactor(front-5l): add ApiClientProvider + client.ts fetch wrapper`
4. `refactor(front-5l): dissolve lib/queries.ts into usecases/*`
5. `refactor(front-5l): extract adapters/sse/{repl,findings} + useReplStream usecase`
6. `refactor(front-5l): extract adapters/renderer/* from SatelliteField`
7. `refactor(front-5l): extract adapters/propagator/sgp4`
8. `refactor(front-5l): split SatelliteField → features/ops/*`
9. `refactor(front-5l): split ThalamusMode → features/thalamus/*`
10. `refactor(front-5l): split OpsMode → features/ops/{Scene,Filters,...}`
11. `refactor(front-5l): move ui primitives → shared/ui/`
12. `refactor(front-5l): scope zustand stores per feature`
13. `refactor(front-5l): wire AppProviders in pages/App.tsx`
14. `chore(front-5l): delete lib/ + modes/ + old components/ shells`
15. `test(front-5l): arch-guard spec enforcing layer rules`
16. `docs(front-5l): update apps/console/README with layer map`

**Risk gate per commit:** `pnpm -C apps/console typecheck` clean + `pnpm
-C apps/console dev` boots + a visual smoke (each mode still renders) before
moving to the next commit.

---

## 9. Open questions (to resolve during writing-plans)

1. **Scoped zustand vs React useReducer**: for features with modest state
   (findings, decisions), `useReducer` may be enough — avoid spinning a
   zustand store per feature by default.
2. **`shared/types/` vs `@interview/shared`**: some DTOs already exist in
   `@interview/shared` (or should). Plan must enumerate which types move
   upstream vs stay local.
3. **Renderer adapter granularity**: one `RendererAdapter` per feature
   (Sigma for thalamus, Three for ops) or one unified interface? Ops and
   Thalamus don't share a rendering surface — likely two ports, not one.
4. **SSE reconnection policy**: currently in `lib/repl-stream.ts`; moves to
   `adapters/sse/client.ts` shared across SSE adapters.

---

## 10. Acceptance criteria

The refactor is done when:

- `apps/console/src/lib/` does not exist.
- `apps/console/src/modes/` does not exist.
- `apps/console/src/components/` does not exist (old shells deleted; only
  `shared/ui/` holds primitives).
- No file under `features/` or `hooks/` or `usecases/` contains `fetch(`,
  `new EventSource(`, `new THREE.` (except via adapter call).
- No file under `adapters/` imports from `react` (except the Context glue
  file — one per adapter).
- No file under `features/<A>/` imports from `features/<B>/`.
- Arch-guard test (§7) is green.
- `ThalamusMode`, `OpsMode`, `SatelliteField` are gone or reduced to ≤150
  LOC shells that compose sub-components.
- The golden-path smoke (open console → browse Ops → open a satellite
  drawer → switch to Thalamus → run a REPL turn → see a sweep suggestion)
  works identically to `main`.
