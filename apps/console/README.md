# @interview/console

Five-layer frontend for the thalamus / sweep / ops surface.

## Layers

```
src/
├── routes/              L1 — TanStack Router entries (conventional folder)
├── features/            L2 — business surfaces (one folder per feature)
│   ├── ops/
│   ├── thalamus/
│   ├── sweep/
│   ├── repl/
│   ├── autonomy/
│   └── config/
├── hooks/               L3 — view-model hooks (UI state + local orchestration)
├── usecases/            L4 — domain intents (TanStack hooks via adapters)
├── adapters/            L5 — external I/O, zero UI
│   ├── api/             HTTP: one port per domain + shared fetch client
│   ├── sse/             SSE: REPL stream + generic EventSource wrapper
│   ├── renderer/        Three.js: textures, palette (+Sigma/graphology via deps)
│   └── propagator/      SGP4 / Kepler orbital propagation
├── shared/
│   ├── ui/              UI-kit primitives (Drawer, Skeleton, TopBar, AppShell…)
│   └── types/           DTOs + enums mirroring backend (entity-id, classify…)
└── providers/           AppProviders composer (Context-per-adapter + QueryClient)
```

## Dependency direction (enforced)

```
routes → features → hooks → usecases → adapters
                                      ↘ shared/types
shared/ui ← any layer (presentation-only)
providers/ wires adapters into Contexts at bootstrap
```

Enforced by `.dependency-cruiser.js` rules `console-front-*`:

- `console-front-no-cross-feature` — features must not import each other.
- `console-front-adapters-no-react` — adapters may not import React (except `*Context.tsx` glue files).
- `console-front-hooks-no-raw-io` — `hooks/` and `usecases/` may not import `three`, `sigma`, `satellite.js`, `graphology`.
- `console-front-features-no-raw-propagation` — features may not import `satellite.js` directly.
- `console-front-no-legacy-{lib,modes,components}` — the pre-refactor folders are deleted; any re-introduction fails CI.

## DIP mechanism

Context-per-adapter + TanStack Query. Each adapter category has its own React Context:

- `ApiClientContext` → 9 domain ports (satellites, conjunctions, kg, findings, stats, cycles, sweep, mission, autonomy)
- `SseClientContext` → EventSource wrapper + REPL parser
- `RendererContext` → Three.js textures + palette helpers
- `PropagatorContext` → SGP4 / Kepler orbital math

`providers/AppProviders.tsx` composes them once at bootstrap via `buildDefaultAdapters()`. Tests swap real adapters for fakes via `tests/wrap.tsx` — zero module mocking.

## Adding a new API endpoint

1. Add method to the relevant port in `adapters/api/<domain>.ts` + `.test.ts`.
2. If it's a new domain, expose a new port in `adapters/api/index.ts::ApiClient`.
3. Write a usecase: `usecases/useXxxQuery.ts` (or `Mutation`), consuming `useApiClient()`.
4. Export from `usecases/index.ts` (with a legacy-name alias during migration windows).
5. Consume from features.

## Adding a new feature

1. Create `features/<name>/` with `Entry.tsx` + any sub-components.
2. State: scoped `useReducer` or shared `useUiStore` (drawer/rail); never extend `useUiStore` for feature-local state.
3. Add route in `routes/<name>.tsx` importing the barrel (`@/features/<name>`).
4. Write RTL smoke test using `tests/wrap.tsx::WrapProviders` with stubbed adapters.

## Skill

Feature work in this app should invoke the skill
[`coding-feature-vertical-slice`](../../.claude/skills/coding-feature-vertical-slice/SKILL.md)
(13-step vertical slice mirroring the backend route skill).
