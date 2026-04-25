# Changelog

All notable changes to the interview extraction of Thalamus + Sweep.

## [Unreleased]

### Real eval protocol + orchestration hardening — 2026-04-25

`4738dbe` adds the production-grade eval corpus/protocol. `9211e0d` hardens
the remaining orchestration contracts. The current follow-up makes web-search
fallback explicit when OpenAI rate-limits.

**Real evaluation protocol**

- Added `docs/evals/real-eval-manifest.json` and
  `scripts/acquire-real-evals.ts` for real SSA/HRM eval acquisition instead of
  mock fixtures.
- Documented the canonical eval protocol in
  `docs/evals/evaluation-protocol.md`, covering paired agentic-vs-baseline
  runs, nondeterministic seeds, SSA/HRM metrics, cost telemetry, budget tiers,
  and multimodal status.
- Added `evals:list`, `evals:fetch:smoke`, and `evals:fetch:full` npm scripts,
  with downloaded assets kept under ignored `data/evals/`.

**Runtime contracts**

- `ThalamusPlanner.finalizePlan()` now applies the same runtime/user filters
  to caller-supplied, daemon, manual, LLM, and fallback DAGs, then rejects
  unknown cortex names with `DagValidationError("unknown_cortex")`.
- Sweep resolution now treats `success` and `partial` as terminal, allows
  failed rows to retry, and uses a Redis resolution lock so concurrent
  resolution attempts do not double-dispatch actions.
- Research graph write paths now count findings only when the
  `research_cycle_finding` junction insert actually succeeds, keeping cycle
  counters aligned with idempotent links.

**Web-search fallback**

- OpenAI web search remains the primary path, but `429`, `5xx`, transport
  errors, and empty OpenAI responses now fall back to a Kimi-only transport
  with Kimi builtin `$web_search` enabled.
- Web fallback output is tagged with the provider/reason and the cortex payload
  now records the provider-neutral source `web_search` instead of hardcoding
  `openai`.
- Abort signals still propagate through both OpenAI and fallback paths, so
  cancellation does not become a silent empty result.

**Verification**

- `pnpm vitest run packages/thalamus/tests/thalamus-planner.spec.ts packages/sweep/tests/unit/sweep-resolution.service.spec.ts`
- `pnpm vitest run packages/thalamus/tests/openai-web-search.adapter.spec.ts`
- `pnpm run typecheck`
- `git diff --check`

### Console API repository DIP hardening — 2026-04-24

This branch closes the repository-coupling regression found during console API
hardening and adds a guardrail so unit tests cannot hide the same violation.

**Satellite repository split**

- Removed the monolithic `SatelliteRepository` surface and split satellite
  persistence into focused repositories for orbital views, null-audit scans,
  field enrichment writes / KNN helpers, and sweep stats.
- Rewired `container.ts` so SSA audit, mission fill, KNN propagation,
  simulation promotion, telemetry swarms, and satellite view services receive
  only the focused repository they need.
- Replaced the old satellite repository integration spec with
  `satellite-split.repository.spec.ts` covering the new repository slices.

**DIP and test guardrails**

- Removed concrete repository imports from console API services and SSA agent
  adapters; services now type against local ports plus shared DTO/type modules.
- Removed the remaining production `packages/sweep` service dependency on
  `SweepRepository` by introducing narrow suggestion writer / resolution store
  ports.
- Updated unit tests to import service ports or shared row types instead of
  concrete repository classes.
- Added `scripts/check-repository-import-leaks.sh` and wired it into
  `pnpm run arch:check` so service files and non-repository tests fail fast if
  they import repositories again.

**Verification**

- `pnpm --filter @interview/sweep typecheck`
- `pnpm --filter @interview/console-api typecheck`
- `pnpm run typecheck`
- `pnpm test`
- `pnpm run arch:check`
- `pnpm exec vitest run --project integration apps/console-api/tests/integration/repositories/satellite-split.repository.spec.ts`

### Console shell + 3D KG + CI hardening — 2026-04-24

`75456e2`, `2ad5f7a`, `c2ec7d1`, `2aec73e`, and `49fd509`
land the front hardening / Thalamus KG iteration and close the follow-up
CI and dependency issues found after pushing to `main`.

**Console shell hardening**

- Route-level front shell fallbacks now keep `ops`, `thalamus`, `sweep`,
  and `config` screens from taking down the whole console when a panel
  throws.
- Shared chrome primitives (`AppShell`, `Drawer`, `TopBar`, `LeftRail`,
  `HudPanel`, `MetricTile`, `CommandPalette`) gained tighter defensive
  rendering and regression coverage for thrown child components.
- Ops / Sweep / Thalamus drawers now handle missing or partial data more
  consistently instead of leaking brittle UI assumptions into feature code.

**Thalamus 3D KG view**

- The Thalamus knowledge graph view moved from the previous flat graph
  direction to a 3D, operator-console style scene with node geometry,
  edge rendering, camera focus, and ambient swarm detail.
- `Entry.tsx` was trimmed back by moving graph scene construction into
  `kg-scene.ts` and rendering into `kg-scene-3d/*` components.
- KG scene tests now cover graph layout / projection helpers so visual
  iteration does not have to live inside the main feature component.

**LLM / cortex guardrails**

- Cortex LLM parsing now rejects degenerate repeated-token responses
  before they can be interpreted as valid findings.
- Standard cortex strategy code was split into explicit `meta-findings`,
  `standard-inputs`, `standard-payload`, and `standard-strategy` modules
  to reduce the monolithic strategy surface.
- Pattern and JSON parser tests cover the new guardrail behaviour,
  including non-JSON polluted responses.

**Dependency and CI fixes**

- Dependabot alert `GHSA-w5hq-g745-h8pq` was fixed by forcing transitive
  `uuid` resolution to `14.0.0` through `pnpm.overrides`; `pnpm audit`
  now reports no known vulnerabilities.
- The repo-wide arch guard test now has an explicit timeout because it
  shells out to `dependency-cruiser` and was timing out under the GitHub
  unit runner's default 5s limit.
- k6 smoke results are no longer tracked in git; `infra/k6/results/` is
  ignored so the CI container can create fresh writable JSON output.

**Verification**

- local gates green across the landing commits: `arch:check`,
  `typecheck`, `test:policy`, `spec:check`, and `test`
- focused CI fix checks: `pnpm test:unit` (`196` files, `1224` tests)
- GitHub Actions on `49fd509`: `Repo Contracts`, `Tests`, and
  `Build & Push` all green

### Runtime contracts + graph recovery hardening — 2026-04-22

`2cf9dc9` lands the object-unification pass that was worth keeping:
shared transport DTOs, boundary cleanup around `sim-*`, route / SQL
dedup where the abstraction stays honest, and a hardening fix for the
e2e graph pipeline after tests were found to be touching real
`research_*` rows.

**Shared DTO contracts**

- `packages/shared/src/dto/*` is now the canonical home for cross-package
  transport shapes used by `console-api`, `@interview/sweep`, and the CLI.
- `sim-http`, `sim-subject`, `sim-target`, `sim-promotion`,
  `sim-orchestrator`, `sim-god-channel`, and `cycle-run` contracts were
  moved out of local app/package declarations into shared DTO modules.
- `apps/console-api/src/transformers/*` now stays focused on `toXxx(...)`
  mappers, while small agnostic request / serialization helpers live in
  `apps/console-api/src/utils/*`.

**Runtime / sim cleanup**

- pure sim math/stat helpers now live in
  `packages/sweep/src/sim/utils/stats.ts`, while SSA-specific aggregators
  stay in `apps/console-api/src/agent/ssa/**`;
- common turn-runner mechanics moved into
  `packages/sweep/src/sim/turn-runner.utils.ts`, while `turn-runner-dag`
  and `turn-runner-sequential` keep their own orchestration role;
- `repl-followup-executor.ssa.ts` now shares one local
  `executeSwarmVerification(...)` flow for telemetry / PC verification
  without introducing a controller-style skeleton.

**Routes / repositories / parsing**

- `sim.routes.ts` is now a mount point only; route wiring is split into
  explicit `sim-run`, `sim-swarm`, `sim-launcher`, `sim-control`, and
  `sim-kernel` modules.
- repeated SQL was reduced with honest shared modules instead of fake
  repositories: `source-item-base.ts`, `satellite-dimension.sql.ts`, and
  `research-edge-label.sql.ts`.
- a real `satellite-dimension.repository.ts` now owns canonical satellite
  dimension reads instead of letting fragments drift across repositories.
- RSS / Atom markup parsing was centralized in
  `packages/shared/src/utils/markup.ts` and reused by `console-api` source
  fetchers and `db-schema` seed code.
- `sim-terminal.repository.ts` dropped duplicated `WITH latest` scaffolding
  and correlated counts; `satellite.repository.ts` removed the
  `getOperatorCountrySweepStats()` `N+1`.

**Graph / RAG test hardening**

- e2e runs now use an isolated migrated Postgres database instead of
  mutating the real dev DB.
- fixture cleanup for KNN / conjunction / swarm e2e coverage is now scoped
  to each test seed instead of broad `sim_swarm:%` deletion.
- the `swarm-uc3` cleanup bug that could wipe real `research_cycle`,
  `research_finding`, and `research_edge` rows was fixed.
- local recovery was verified by restoring catalog embeddings and rerunning
  live Thalamus / fish cycles against dev: the graph repopulates, embeddings
  are present again, and sweep suggestions are re-emitted from Redis.

**Dedup outcome**

- jscpd clone density dropped from `1.39%` (`62` clones / `1026` duplicated
  lines) to `0.95%` (`48` clones / `702` duplicated lines) without forcing
  abstractions past the business boundary.

**Verification**

- pre-merge gate green: `arch:check`, `typecheck`, `test:policy`,
  `spec:check`, `test`
- final landing run: `207 passed | 2 skipped` files,
  `1024 passed | 9 skipped` tests

### CI bedrock + real-contract test hardening — 2026-04-21

`15356bb` lands SP-0 test execution in CI and a broad cleanup of
false-green tests in `apps/console-api`. The goal of the pass was not
to make tests pass at any cost, but to make a green suite mean
"behaviour still matches the real contract".

**CI / workspace split**

- `vitest.workspace.ts` now defines explicit `unit`, `integration`,
  and `e2e` projects across `packages/*` and `apps/console-api/**`.
- `apps/console-api/vitest.config.ts` was removed; Fastify
  `globalSetup` now runs only for e2e instead of every `console-api`
  test.
- Root scripts `test:unit`, `test:integration`, and `test:e2e` now
  fail loudly on zero matches.
- `.github/workflows/test.yml` now runs unit, integration
  (Postgres + migrations), and e2e (Postgres + Redis) on PRs and
  pushes.
- `scripts/test-db-migrate.ts` boots a real migrated test database for
  CI and local runs.
- `docs/testing/README.md` and `apps/console-api/tests/README.md`
  now document the layered test commands and local setup.

**False-green removal**

- Controller tests now exercise the real public `/api/...` routes via
  `register*Routes`, and assert `404` on the fake local paths that
  older tests used to hit.
- REPL and follow-up tests now execute the actual SSE flow, follow-up
  policy/execution path, and `runCycle(...)` wiring instead of only
  checking forwarding to mocks.
- Source fetcher, KG, mission, reflexion, KNN, conjunction,
  enrichment, autonomy, satellite, and transformer/view tests were
  reworked to use valid schemas, real ports, and full runtime shapes
  instead of `as never`, `as unknown as`, or partial duck-typed mocks.
- New repository integration specs now prove KG edge resolution,
  research-edge output, conjunction screening, and related DB lookups
  against Postgres rather than temp-only local fakes.

**Bugs exposed and fixed**

- blank numeric query params in `clamp.ts` no longer coerce to `0`
  before clamping;
- mission tasks no longer report `filled` without a persisted write,
  and a mission stops immediately after its last task instead of one
  empty tick later;
- finding nodes in KG are no longer mislabeled as `Payload`, and KG
  edges now resolve operator/orbit-regime names consistently with the
  node ids used by the graph and finding views;
- KNN evidence now distinguishes requested `k` from actually used
  neighbours;
- REPL turns now default to real fixtures, and the server banner
  advertises the correct `/api/repl/turn` payload shape;
- enrichment now rejects invalid satellite / neighbour ids before any
  partial writes;
- conjunction screening now uses `norad_id` SQL columns instead of
  JSON-only lookups;
- BullMQ / Redis teardown now closes cleanly, removing the recurring
  `close timed out after 10000ms` test harness warning.

**Verification**

- local gate green: `arch:check`, `typecheck`, `test:policy`,
  `spec:check`, `test`
- final landing run: `172 passed | 2 skipped` files,
  `908 passed | 5 skipped` tests

### Console front — SOLID compression + DRY pass + jscpd — 2026-04-19 (session 4)

Two follow-up commits on `feature/console-front-5l` after the initial
5-layer landing. Closes every "god-component internals" item from the
earlier TODO and lands a clone-detector to keep DRY pressure ongoing.

**SOLID compression** (`282c044`) — 6 monoliths shrunk by **38%**
(3164 → 1955 LOC) without losing behaviour, by introducing 14 focused
abstractions instead of mechanical splits:

| File                               | Before | After |    Δ |
| ---------------------------------- | -----: | ----: | ---: |
| `features/thalamus/Entry.tsx`      |    762 |   367 | -52% |
| `features/ops/SatelliteField.tsx`  |    583 |   378 | -35% |
| `features/config/Entry.tsx`        |    568 |   208 | -63% |
| `features/ops/Entry.tsx`           |    463 |   377 | -19% |
| `features/thalamus/FindingReadout` |    428 |   367 | -14% |
| `features/ops/OrbitTrails.tsx`     |    360 |   258 | -28% |

DIP wins:

- New `adapters/graph/` port (graphology + sigma + ForceAtlas2) —
  `graph-builder.ts` + `sigma-renderer.ts` + `GraphContext.tsx`
  exposed via `AppProviders`. Thalamus no longer imports sigma /
  graphology directly.
- `adapters/renderer/orbit-geometry.ts` — `buildFullRingsGeometry`,
  `buildTailsGeometry`, `clearRingCache` extracted from
  `SatelliteField`. THREE BufferGeometry assembly is an adapter
  concern now, not a feature concern. 141 LOC of dedup.

SRP primitives + view-model hooks:

- `shared/ui/HudPanel.tsx` — 12 ad-hoc panel-chrome instances merged.
- `shared/ui/MetricTile.tsx` — promoted from `ops/Entry`, reused by
  thalamus.
- `shared/util/aggregate.ts` — `countBy` / `topN` / `maxCount`
  replaces 4 duplicated inline blocks.
- `hooks/useDrawerA11y` — esc-to-close + focus-trap mutualised between
  `Drawer` and `FindingReadout`.
- `hooks/useDraft<T>` — generic form draft / dirty / errors / diff,
  consumed by `config/Entry`.
- `hooks/useTimeControl`, `useRegimeFilter`, `useThreatBoard` — three
  view-model hooks lifted from `ops/Entry`.

OCP widening (extending existing surfaces, not new ones):

- `KV` gains optional `color` prop (kills `FindingReadout::DataRow` dup).
- `sparkline.ts` gains `blockBar` (binary histogram next to confidence
  sparkline).
- `palette.ts` gains `ringColor` (trail palette distinct from regime
  dots).
- `STATUS_COLOR` — `FindingReadout` now consumes the canonical
  `graph-colors` rather than re-declaring.

**DRY pass** (`82f0fce`) — two near-duplicates surfaced by jscpd:

- `thalamus/Entry`: finding-vs-entity drawer routing was written twice
  (`onNodeClick` lambda + `handleFocus`). Extracted `selectKgNode(id, attrs)`;
  `handleFocus` now composes `focusNode + selectKgNode`.
- `shared/types/units`: `fmtPc` and `fmtPcCompact` shared the same
  null/0/log10 parse. Extracted private `parsePc()` returning
  `{m, e} | "zero" | "bad"`. Clone density 0.31 % → 0.11 %.

**Tooling** — `jscpd` added as a devDep with three npm scripts:

- `pnpm dup:report` — full report (console + json + html under
  `.reports/jscpd/`).
- `pnpm dup:check` — strict CI gate (threshold 3 % clone density).
- `pnpm dup:report:full` — looser min-lines/min-tokens for exploratory
  passes.

Config in `.jscpd.json`: 10 LOC / 80 tokens minimum, strict mode,
ignores tests, fixtures, migrations, docs. `.reports/` ignored by git.

**Test infra DRY** — `apps/console/tests/setup.ts` now ships global
`vi.mock("sigma")` + `vi.mock("graphology-layout-forceatlas2")` so
any test that transitively pulls in the graph adapter mounts cleanly
in jsdom. Per-file mocks removed from `thalamus/Entry.test.tsx`.

**Verification**: 48/48 tests pass · 0 dep-cruiser violations · jscpd
clone density 0.11 % (down from 0.31 %).

### Console front 5-layer architecture — 2026-04-19

`apps/console/src/**` refactored into a five-layer structure mirroring the
backend layering vocabulary, with strict DIP via React-Context-per-adapter
and TanStack Query. Delivered on `feature/console-front-5l` in 15 atomic
commits; every commit passes pre-commit (arch-check + typecheck + spec-check

- tests) and leaves the app buildable.

**Target layout** (`apps/console/src/`):

```
routes/ → features/ → hooks/ → usecases/ → adapters/
                                         ↘ shared/types
shared/ui ← any layer
providers/ wires adapters into Contexts at bootstrap
```

**Adapters (L5, `adapters/*`)** — zero UI, zero React except `*Context.tsx`
glue. Four categories, all DIP-injectable:

- `adapters/api/` — 9 typed ports (satellites, conjunctions, kg, findings,
  stats, cycles, sweep, mission, autonomy) on top of `ApiFetcher` port +
  fetch impl. `createApiClient()` aggregate factory.
- `adapters/sse/` — `SseClient` wrapper over `EventSource` + the REPL stream
  parser (moved from `lib/repl-stream.ts`).
- `adapters/renderer/` — Three.js textures (`makeGoldBumpTexture`,
  `makeSolarPanelTexture`, `makeHaloTexture`) + palette (`getCompanyColor`,
  `regimeColor`, `pcColor`) + Sigma mount helper.
- `adapters/propagator/` — SGP4 + Kepler orbital propagation (moved from
  `lib/orbit.ts`) with `satellite.js` as the sole transport dependency.

Each adapter ships a typed interface, a concrete impl, and a React Context

- `useXxxClient()` hook consumed via `providers/AppProviders.tsx` cascade.

**Usecases (L4, `usecases/*`)** — 16 TanStack hooks, each reading
`useApiClient()` from Context instead of a singleton import. Legacy
`lib/queries.ts` dissolved into one file per intent
(`useSatellitesQuery`, `useDecisionMutation`, …) + shared `keys.ts` query-key
factory. `usecases/index.ts` barrel exposes both canonical names and legacy
aliases (`useSatellites` → `useSatellitesQuery`).

**Shared types (`shared/types/*`)** — DTOs centralised (was inlined in
`lib/api.ts`); added `entityKind()` single-source-of-truth replacing
duplicated ID-prefix switches; `classifySatellite()` table-driven, replaces
the 40-entry `startsWith` chain in `SatelliteField`.

**Features (L2, `features/*`)** — six business surfaces relocated from
`modes/`:

- `features/ops/` — 13 files (Scene, Canvas, SatelliteField, Globe,
  CameraFocus, OrbitTrails, ConjunctionArcs/Markers, Filters, Search,
  Clock, TelemetryStrip, FindingsPanel, CycleLaunchPanel).
- `features/thalamus/` — Entry + FindingReadout (sole cross-feature
  import collapsed here).
- `features/sweep/` — Entry, Suggestions, Overview, Stats, Drawer,
  FindingsGraph.
- `features/repl/` — Panel, Provider, Context, TurnView, ResultView,
  reducer + 9 renderers.
- `features/autonomy/Control.tsx`, `features/config/Entry.tsx`.

Each feature owns a barrel (`index.ts`) exporting an `XxxEntry` component
consumed by the matching route file. Cross-feature imports forbidden by
dep-cruiser rule `console-front-no-cross-feature`.

**Shared UI (`shared/ui/*`)** — 10 UI-kit primitives (Drawer, Skeleton,
Measure, ErrorBoundary, AppShell, TopBar, LeftRail, CommandPalette,
CycleLoader, AnimatedStepBadge) + scoped `uiStore` (rail + drawer) +
`sparkline`. No business logic, consumable from any layer.

**Bootstrap wiring (`main.tsx`)** — `AppProviders` cascade
(`QueryClient > ApiClient > SseClient > Renderer > Propagator`) wraps the
router; `buildDefaultAdapters()` constructs concrete impls once.

**Legacy deletion** — `lib/`, `modes/`, `components/` folders removed.
Every consumer migrated to the new paths; dep-cruiser rules
`console-front-no-legacy-{lib,modes,components}` flipped from `info` to
`error` so reappearance fails CI.

**Testing** — `@testing-library/react` + `jsdom` + `@testing-library/jest-dom`
added; `apps/console/vitest.config.ts` registered in the root workspace.
48 tests across 17 files (API adapters, SSE client, client fetcher,
ApiClientContext, satellite-classification, entity-id, SGP4 propagator,
sweep entry RTL, thalamus entry smoke). `tests/wrap.tsx` provides a
`WrapProviders` + `makeStubApi` test utility — zero module mocking, every
dependency swappable via Context.

**Architectural enforcement** — six dep-cruiser rules added:

- `console-front-no-cross-feature` — features are islands; shared concerns go to `shared/ui`, `hooks/`, or `usecases/`.
- `console-front-adapters-no-react` — adapters are I/O only.
- `console-front-hooks-no-raw-io` — no `three`/`sigma`/`satellite.js`/`graphology` in hooks or usecases.
- `console-front-features-no-raw-propagation` — features never import `satellite.js` directly.
- `console-front-no-legacy-{lib,modes,components}` — legacy folders can never come back.

Zero dependency violations (666 modules, 2094 edges cruised).

**Skill** — user-global skill `coding-feature-vertical-slice`
(`~/.claude/skills/coding-feature-vertical-slice/SKILL.md`) written as the
frontend sibling of `coding-route-vertical-slice`: 13-step vertical slice
(discovery → adapter port + test → usecase → view-model → feature → entry
→ route) that LLM agents working in this codebase must invoke before any
feature work.

**Verification**:

- `pnpm arch:check:repo` — 0 violations.
- `pnpm -C apps/console typecheck` — clean.
- `pnpm -C apps/console exec vitest run` — 48/48 pass.
- `pnpm -C apps/console build` — 1.6MB bundle (chunk-size warning noted in
  TO-REVIEW; not blocking).

### Generic verification contract + SSA-owned REPL follow-ups — 2026-04-19

The REPL follow-up slice was re-cut so package code stays object-pure
and all SSA semantics remain app-owned.

**Packages are generic again**

- `packages/thalamus/src/types/research.types.ts`
  - removed `ResearchVerificationKind`
  - `ResearchVerificationTargetHint` now carries only generic entity
    hints: `entityType`, `entityId`, `sourceCortex`, `sourceTitle`,
    `confidence`
- `packages/thalamus/src/services/cycle-loop.service.ts`
  - `buildCycleVerification()` no longer emits business follow-up kinds
  - it emits only `reasonCodes` plus generic entity hints inferred from
    findings and edges
- `packages/shared/src/types/repl-stream.ts`
  - follow-up stream events keep a generic `kind: string`
  - `ReplFollowUpTarget` no longer exposes `conjunctionId` /
    `satelliteId`; app-specific refs travel in an opaque `refs` bag

**SSA policy/execution is app-owned**

- `apps/console-api/src/agent/ssa/followup/repl-followup.types.ssa.ts`
  now defines the local SSA follow-up union:
  - `deep_research_30d`
  - `sim_pc_verification`
  - `sim_telemetry_verification`
  - `sweep_targeted_audit`
- `apps/console-api/src/agent/ssa/followup/repl-followup-policy.ssa.ts`
  maps generic verification signals to SSA follow-ups
- `apps/console-api/src/agent/ssa/followup/repl-followup-executor.ssa.ts`
  is the only layer that knows how to interpret sim/sweep refs

**Effect**

- no follow-up business taxonomy leaks from `packages/thalamus`
- no SSA target fields leak from `packages/shared`
- `apps/console-api` owns all follow-up semantics, budgeting, and execution

**Verification**

- `pnpm -r typecheck`
- `pnpm arch:check`
- `pnpm vitest run packages/thalamus/tests/cycle-verification.spec.ts apps/console-api/tests/unit/services/repl-followup.service.test.ts apps/console-api/tests/unit/services/repl-chat.service.test.ts`

### Adaptive cortex timeout + cycle budget override + reasoning-token auto-provision — 2026-04-19

Follow-up after observing 3 cortex timeouts on a `gpt-5.4-nano` +
`reasoningEffort: "high"` run (calls took 125–186s; executor gave up
at 90s) and a cycle clamped to $0.10 even though the operator set
`maxCostUsd: 1`.

**Adaptive per-cortex timeout** (`thalamus-executor.service.ts`)

- New base knob `thalamus.planner.cortexTimeoutMs` (default 90 000)
- Auto-scaled at call time by model context:
  - `reasoningEffort = xhigh` → ×6 (~9 min on default base)
  - `reasoningEffort = high` → ×3 (~4.5 min)
  - `reasoningEffort = medium` → ×1.5
  - `provider = minimax` → at least ×3
  - `thinking = true` → at least ×3
  - `model` starts with `local/` → at least ×2
- Per-cortex override (`thalamus.cortex.overrides[x].callTimeoutMs`)
  still wins over both the base and the adaptive scale.
- Static overrides preserved (`payload_profiler: 180s`).

**Budget override** (`thalamus.service.ts`)

- When `plannerCfg.maxCostUsd > 0`, it becomes the authoritative cycle
  cost cap — wins over both the complexity-indexed
  `ITERATION_BUDGETS[c].maxCost` and the hardcoded
  `THALAMUS_CONFIG.loop.maxCostPerChain = $0.10`.
- Default stays $0.10 safety throttle; opt-in via config only.

**Reasoning-token auto-provision** (`openai.provider.ts`, `nano-caller.ts`)

- GPT-5.4 reasoning tokens count against `max_output_tokens`. With
  `effort=xhigh` reasoning alone burns 10–20k tokens, truncating the
  completion if `max_output_tokens` is unset. Now auto-provisions
  based on effort when the caller didn't cap:
  - xhigh → 32 000
  - high → 16 000
  - medium → 8 000
- Explicit `opts.maxOutputTokens > 0` always wins over the auto-provision.

**Findings cap per cortex** (`cortex-llm.ts`)

- New knob `thalamus.planner.maxFindingsPerCortex` (default 3).
- Caller-supplied `input.maxFindings` (standard-strategy's data-driven
  `clamp(5, authoritativeData.length, 30)`) still wins.

### Runtime config registry + 4 LLM providers + /config admin UI — 2026-04-19

Large session: kernel knobs (planner, cortex, reflexion, sim fish,
sim swarm, sim embedding) are now runtime-tunable via a single
polymorphic HTTP endpoint and an admin-facing frontend. LLM transport
rewired to honour per-call overrides (model, reasoning effort, thinking,
verbosity, max tokens, temperature) across every provider. MiniMax
added to the chain. `<think>` leaks closed across all providers.

**Architectural shift — registry pattern (OCP)**

- `RuntimeConfigService` no longer hardcodes a `SCHEMAS` table. Added
  `registerDomain<D>(spec)` — each package ships its own registrar and
  wires at boot. Console-api never touches its service when a new
  domain arrives. `RuntimeConfigRegistrar` port lives in
  `packages/shared/src/config/types.ts`.
- Packages (`@interview/thalamus`, `@interview/sweep`) expose
  `registerThalamusConfigDomains` / `registerSweepConfigDomains` at
  `packages/*/src/config/register-runtime-config.ts`.
- Container wires the registrars + per-consumer `ConfigProvider<T>`
  setters (nano, nanoSwarm, planner, cortex, reflexion, sim fish).
- `FieldKind` extended to `string | number | boolean | string[] | json`.
  `FieldSpec` supports `{kind, choices}` for enum fields (UI dropdown).

**6 new config domains (9 total)**

| Domain               | Knobs                                                                                                                                                                                                            | Backed by                                                                                                 |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `thalamus.planner`   | 15 fields — cortex caps, mandatory strategist, provider, model, reasoning effort, max output tokens, temperature, verbosity, thinking, reasoning format, reasoning split, max cost USD, forced/disabled cortices | `thalamus-planner.service.ts::applyRuntimeFilters` + `createLlmTransport({preferredProvider, overrides})` |
| `thalamus.cortex`    | `overrides: Record<cortex, CortexOverride>` with 12 LLM knobs per cortex + `enabled` kill switch                                                                                                                 | `cortex-llm.ts::analyzeCortexData` reads per-cortex override with planner fallback                        |
| `thalamus.reflexion` | `maxIterations`, `minConfidenceToStop`, `stopOnNoNewFindings`                                                                                                                                                    | `thalamus.service.ts:114` clamps cycle loop                                                               |
| `sim.swarm`          | `defaultFishConcurrency`, `defaultQuorumPct`                                                                                                                                                                     | declared; not yet consumed by swarm-service — follow-up                                                   |
| `sim.fish`           | `model`, `reasoningEffort`, `maxOutputTokens`, `temperature`, `thinking`                                                                                                                                         | `turn-runner-{sequential,dag}.ts` thread into `NanoRequest.overrides`                                     |
| `sim.embedding`      | `embedConcurrency`                                                                                                                                                                                               | declared; not yet consumed by memory/aggregator — follow-up                                               |

**LLM provider layer rewired**

Every provider reads `LlmProviderCallOpts` (extended with `model`,
`maxOutputTokens`, `temperature`, `reasoningEffort`, `verbosity`,
`thinking`, `reasoningFormat`, `reasoningSplit`) and maps to its
native API. Field mappings confirmed via Codex web-search pass.

| Provider                    | Reasoning                   | Max tokens                                              | Thinking                               | Other             |
| --------------------------- | --------------------------- | ------------------------------------------------------- | -------------------------------------- | ----------------- |
| `OpenAIProvider`            | `reasoning.effort` (nested) | `max_output_tokens`                                     | —                                      | `text.verbosity`  |
| `KimiProvider`              | —                           | `max_completion_tokens` (was `max_tokens` — deprecated) | `thinking: {type: enabled\|disabled}`  | —                 |
| `LocalProvider` (llama.cpp) | `reasoning_format`          | `max_tokens`                                            | `chat_template_kwargs.enable_thinking` | —                 |
| `MiniMaxProvider` **NEW**   | —                           | `max_completion_tokens`                                 | —                                      | `reasoning_split` |

`REASONING_EFFORT_CHOICES = ["none","low","medium","high","xhigh"]`
(GPT-5.4 enum; `minimal` is gpt-5-only).
`REASONING_FORMAT_CHOICES = ["none","deepseek","deepseek-legacy"]`.

`createLlmTransport` accepts `{preferredProvider, overrides}`; the
orchestrator reorders the chain so the preferred provider runs first
(fallback preserved). Chain order:
`[Local, Kimi, MiniMax, OpenAI]`.

**Call-site wiring**

- `ThalamusPlanner.plan` — reads `thalamus.planner` + `thalamus.cortex`,
  passes overrides, applies `applyRuntimeFilters` (disabled first,
  forced injection, maxCortices clamp with strategist-last, mandatory
  strategist guarantee).
- `analyzeCortexData` — per-cortex override merge over planner defaults,
  honours `enabled:false` as kill switch.
- Sim turn runners — read `sim.fish` via `getSimFishConfig()`, pass as
  `NanoRequest.overrides`.
- `callNano` — `reasoning.effort` no longer hardcoded to `"low"`; reads
  `req.overrides`.

**`<think>` leakage closed everywhere**

`stripThinkingChannels` extended to catch `<think>…</think>` (DeepSeek
/ Kimi K2.5 / MiniMax inline), `<thinking>…</thinking>`, and
`<|channel>…<channel|>` (Gemma 4 GGUF). Applied in all 4 providers and
`callNano`. Previously only `LocalProvider` stripped.

**Planner bias fix — 5 cortex descriptions rewritten (Tier 1)**

Pre-session planner systematically skipped `conjunction_candidate_knn`,
`debris_forecaster`, `orbit_slot_optimizer`, `launch_scout`,
`traffic_spotter`. Root cause: frontmatter led with implementation-
emitter language (`"Emit one grounded X finding per Y row"`). Rewrote
to analyst-intent voice (`"Forecast…"`, `"Scout…"`, `"Spot…"`,
`"Plan…"`, `"Propose new…"`). Kimi planner now has a chance to pick
them when user intent matches.

**Admin config UI (`/config`)**

- Route: `apps/console/src/routes/config.tsx`
- Page: `apps/console/src/modes/config/ConfigMode.tsx`
- Lib: `apps/console/src/lib/runtime-config.ts` (react-query hooks)
- Top-bar tab: CONFIG (SlidersHorizontal icon)
- Left rail: DOMAINS · CONFIG — jump-links grouped by namespace
  (THALAMUS / SIM / SWEEP), field counts, amber indicator on active
  overrides
- Scrollable main pane (was overflow-hidden, caused ~50% of fields
  invisible on first ship)
- Fields render typed: `number` → number input, `boolean` → checkbox,
  `string[]` → chip input, `json` → textarea, `{kind,choices}` →
  `<select>` dropdown
- **Model dropdown**: `<optgroup>` by provider, custom-id fallback,
  **auto-syncs the `provider` field** when selecting a preset
  (prevents the `MiniMax-M2.7 sent to Kimi` footgun)
- **Per-model support matrix**: `MODEL_PRESETS[i].supports` drives UI
  greying — selecting Kimi K2 greys `reasoningEffort`/`verbosity` with
  tooltip "Ignored by Kimi · K2 (non-thinking)"
- Save/Reset buttons, dirty-state per domain card

**Breaking changes**

- Kimi body now sends `max_completion_tokens` instead of `max_tokens`.
  Moonshot accepts both but `max_tokens` is deprecated per their docs.
- OpenAIProvider `reasoning.effort` default remains `"minimal"` when
  no override supplied (back-compat); new planner config default is
  `"medium"`.

**Verification**

- `pnpm -r typecheck` clean on all 7 packages
- `pnpm test` — **674/674 pass**, 42 todo, 3 skipped (baseline preserved)
- Live `PATCH /api/config/runtime/:domain` round-trip verified on all
  new domains + new field kinds (boolean, string[], json)

**Known remaining debt** (tracked in TODO):

1. `sim.swarm` + `sim.embedding` declared but not yet consumed by their
   target services.
2. Per-query cortex filter UI (REPL-level checkboxes) — backend extends
   nothing yet.
3. MiniMax + local providers need env keys (`MINIMAX_API_KEY`,
   `LOCAL_LLM_URL`); `isEnabled()` falls through to fallback if missing.

### PG functions: 4 param-drop bugs fixed + conjunction KNN + fleet rollup dedup — 2026-04-19

Pushes compute closer to the data and makes four previously-silent HTTP
params first-class. Two new migrations, eight TS files touched, 674/674
tests pass.

**New migrations** (applied manually against live PG via
`psql "$DATABASE_URL" -f ...`; drizzle-kit push does not pick up
functions):

- `packages/db-schema/migrations/0012_orbital_analytics_fns.sql` — 4
  SQL functions, `LANGUAGE sql STABLE`:
  - `fn_plan_orbit_slots(p_operator_id, p_limit)` — dropped the
    `horizonYears` param (no SQL meaning without a
    `safe_mission_window` UDF, which doesn't exist yet; tracked
    separately).
  - `fn_analyze_orbital_traffic(p_window_days, p_regime_id, p_limit)`
    — density branch honors `regimeId`; news branch cannot
    (free-text). Each row now carries `branch_filter_applied boolean`
    so callers see which rows the regime filter actually touched.
  - `fn_forecast_debris(p_regime_id, p_limit)` — density +
    fragmentation branches filter; paper/news/weather don't. Dropped
    `horizonYears` (same reason as slots). Includes a `LEO ↔ Low
Earth Orbit` LATERAL mapping so `fragmentation_event.regime_name`
    (short codes) actually matches `orbit_regime.name` (long form);
    previously the fragmentation filter returned 0 rows even when
    applied.
  - `fn_list_launch_manifest(p_horizon_days, p_limit)` — dropped
    `regimeId` (no branch has structured regime linkage;
    `launch.orbit_name`, `itu_filing.orbit_class` are free text).
    `horizonDays` already worked and is preserved.
- `packages/db-schema/migrations/0013_conjunction_knn_fn.sql` —
  `fn_conjunction_candidates_knn(...)` in `LANGUAGE plpgsql` so
  `set_config('hnsw.ef_search', ..., true)` can run inside the body.
  Transaction-local scope: the recall knob can no longer leak onto
  the pooled connection. Verified: `current_setting('hnsw.ef_search')`
  reverts to pgvector's default (40) on commit. Old TS pattern
  (`SET hnsw.ef_search = N` without `LOCAL`) was sticky per
  connection — fixed.

**HTTP contract changes (breaking)**:

- `GET /api/orbital/slots` — `horizonYears` removed from
  `SlotsQuerySchema`. Zod `.strip()` default swallows it silently
  for legacy clients; no 400.
- `GET /api/orbital/debris` — `horizonYears` removed from
  `DebrisForecastQuerySchema`. Response rows gain
  `branchFilterApplied: boolean | null`.
- `GET /api/orbital/traffic` — response rows gain
  `branchFilterApplied`.
- `GET /api/orbital/launch-manifest` — `regimeId` removed from
  `LaunchManifestQuerySchema`.
- `GET /api/orbital/fleet` — `regimeMix` / `platformMix` / `busMix`
  shape flipped from `Record<string, number>` to
  `Array<{key, count}>` sorted desc, top-5. Array preserves
  ordering; old object shape lost it.

**Fleet rollup dedup**:

- `apps/console-api/src/repositories/queries/operator-fleet-rollup.ts`
  — single drizzle `sql` builder now backs both
  `FleetAnalysisRepository.analyzeOperatorFleet` (HTTP, N rows) and
  `SatelliteFleetRepository.getOperatorFleetSnapshot` (sim, 1 row).
  Neither repo depends on the other; they share the template via
  pure import. Removed ~142 LOC of duplicated SQL, consolidated into
  ~80 LOC in one place. `userId` param dropped (was on the port but
  had no consumers; target table doesn't exist in the schema).

**KNN ef_search parity fix**:

- `apps/console-api/src/repositories/satellite.repository.ts` —
  `knnNeighboursForField` now issues
  `SET hnsw.ef_search = <ef>` before the cosine query, matching the
  pattern `findKnnCandidates` had (and now does via the fn). `ef`
  added as an optional param with a default of `100`, clamped
  `[10, 1000]`.

**Skill prompt doc updates**:

- `apps/console-api/src/agent/ssa/skills/fleet-analyst.md` — updated
  the DATA-shape section to describe `*Mix` as arrays of
  `{key, count}` sorted by count desc.

**Param-propagation proof** (live DB, `fn_forecast_debris`):

| branch        | no filter | regimeId=1 (LEO) | regimeId=3 (GEO) |
| ------------- | --------- | ---------------- | ---------------- |
| density       | 6         | 1                | 1                |
| fragmentation | 3         | 8                | 1                |
| paper         | 10        | 10               | 10               |
| news          | 1         | 1                | 1                |
| weather       | 10        | 10               | 10               |

Structured branches now honor the filter; free-text/global branches
pass through unfiltered with `branch_filter_applied = false` so the
contract is honest.

**Still open** (from the ordered plan):

- Step 5 — view extraction for `satellite-audit` /
  `classification-flags` (pure views, low risk).
- Step 6 — `user-fleet.repository.ts` → `jsonb`-returning SQL
  functions.
- HNSW index on `satellite_enrichment.telemetry_14d` — skipped:
  column doesn't exist (seed-data / schema gap, separate concern).
- Skill prompts (`debris-forecaster.md`, `orbit-slot-optimizer.md`,
  `fleet-analyst.md` still mention `horizonYears` in some examples)
  — left untouched; Zod strips unknowns so no crash, cortex-provider
  normalisation absorbs drift.

### Architecture audit 2026-04-19 + 9 fixes landed — 2026-04-19

Deep audit (Claude code-reviewer subagent + manual passes) of the codebase
against `CLAUDE.md` invariants (single-contract, no private bypass, kernel
agnosticity, SOLID). Full report with file:line refs in
`docs/refactor/architecture-audit-2026-04-19.md` (indexed in
`docs/refactor/INDEX.md` entry #0 + new "Architecture audit" section).

**Audit outcome:** 7 Critical + 12 Important + 10 Minor findings. 4 Critical
and 5 Important closed this session; 3 Critical + 7 Important remain open
(tracked in `TODO.md` with file:line fixes). All fixes non-destructive.

**C3 — dead thalamus HTTP surface deleted.**

- Removed `packages/thalamus/src/controllers/thalamus.controller.ts` (188 L)
  and `packages/thalamus/src/routes/thalamus.routes.ts` (81 L); removed
  `ThalamusController` + `thalamusRoutes` exports from the package barrel.
  Those symbols duplicated the app-owned HTTP surface (CLAUDE.md §1-2) and
  were never mounted. Zero consumers, zero behaviour change.

**C5 — `satellite-sweep-chat` stack (639 LOC) remounted.**

- 7-file stack had been moved from `packages/sweep/` to `apps/console-api/`
  in commit `1ccc31b` but never wired: `routes/satellite-sweep-chat.routes.ts`,
  `controllers/`, `services/`, `repositories/`, `transformers/`, `types/`,
  `prompts/`. Feature had been silently disabled since the move.
- `apps/console-api/src/container.ts`: constructs
  `SatelliteSweepChatRepository` (redis) → `SatelliteSweepChatService`
  (depends on `SatelliteRepository` + stubbed `VizService` +
  `SatelliteService`) → `SatelliteSweepChatController`.
- `apps/console-api/src/routes/index.ts`: mounts via `app.register(async
scope => satelliteSweepChatRoutes(scope, s.satelliteSweepChat), {prefix:
"/api/satellites"})` — auth (`authenticate` + `requireTier`) scoped to the
  sub-plugin, no leakage onto sibling routes.
- Routes now live: `POST /api/satellites/:id/sweep-chat` (SSE stream) +
  `GET /api/satellites/:id/sweep-chat/state`. Front-end UI still TODO.

**C6 — SSE controllers don't leak tokens on client disconnect.**

- `apps/console-api/src/controllers/repl.controller.ts` and
  `.../satellite-sweep-chat.controller.ts`: both create an `AbortController`
  subscribed to `reply.raw.on("close")` so a browser navigation aborts the
  service stream.
- `ReplChatService.handleStream()` and `SatelliteSweepChatService.chat()`
  accept `signal?: AbortSignal` and check `aborted()` before every new LLM
  call (intent classify, chat reply, nano stream, findings extract) and at
  every yield boundary. Result: a disconnect stops new token spend within
  one generator step (in-flight calls still finish; the next one doesn't
  start).
- Updated `tests/unit/controllers/repl.controller.test.ts` to assert the
  3rd `AbortSignal` argument.

**C7 — interval timers cleaned on Fastify shutdown.**

- `apps/console-api/src/server.ts`: new `app.addHook("onClose", async () =>
{ container.services.mission.stop(); container.services.autonomy.stop(); })`
  after `registerAllRoutes`. Stops the Vitest "hanging-process" warnings
  and hot-reload timer leaks that fired `tick()` against torn-down infra.

**I3 — no more post-build type cast in the composition root.**

- `apps/console-api/src/container.ts`: replaced the
  `(ssaAuditProvider as unknown as {...}).deps.sweepRepo.loadPastFeedback
= ...` patch with a typed shared `sweepRepoHolder: { loadPastFeedback:
() => Promise<SuggestionFeedbackRow[]> }`. Same object reference is
  passed into `SsaAuditProvider` and rebound once `buildSweepContainer`
  resolves. No private-field reach, no `as unknown as` casts. Pre-wire
  calls throw a clear error so future wiring mistakes are loud in dev.

**I4 — thalamus barrel promotion; deep-path imports deleted.**

- `packages/thalamus/src/index.ts`: added `setNanoConfigProvider`,
  `setNanoSwarmConfigProvider`, `setNanoSwarmProfile`, `setCuratorPrompt`,
  `DEFAULT_NANO_SWARM_PROFILE`, `Lens`, `NanoSwarmProfile`,
  `ExplorationQuery`, `NanoRequest`, `NanoResponse`.
- `apps/console-api/src/container.ts`, `services/satellite-sweep-chat.service.ts`,
  `prompts/nano-swarm-ssa.prompt.ts`, `agent/ssa/sweep/audit-provider.ssa.ts`:
  all migrated from `@interview/thalamus/explorer/{nano-caller,nano-swarm,curator}`
  - `@interview/thalamus/prompts/nano-swarm.prompt` + `.../explorer/scout`
    deep-paths to the public barrel. Zero `@interview/thalamus/...` deep-path
    imports remaining in `**/src/**`.

**I7 — `MissionService.tick()` no longer throws unhandled rejections.**

- `apps/console-api/src/services/mission.service.ts`: added a `catch (err)`
  block around `runTask` that increments `errorCount` and logs
  `{err, suggestionId, satelliteId}` via the injected Fastify logger.
  Mirrors the `autonomy.service.ts` pattern. Prevents Node ≥ 15 from
  crashing the process on per-task failures.

**I10 — embed fan-out bounded with `mapWithConcurrency`.**

- New generic helper at `packages/shared/src/utils/concurrency.ts`:
  `mapWithConcurrency<T,R>(items, limit, fn)` preserves input order, caps
  workers at `min(limit, items.length)`, propagates the first rejection.
  6 unit tests at `packages/shared/tests/concurrency.spec.ts` cover empty
  input, order preservation, concurrency cap, overflow cap, rejection
  propagation, and invalid limits.
- `packages/sweep/src/sim/memory.service.ts:writeMany` and
  `packages/sweep/src/sim/aggregator.service.ts` batch-embed path now
  route through `mapWithConcurrency(..., 8, ...)`. A 50-row turn batch no
  longer bursts 50 concurrent Voyage/OpenAI embed calls. No new npm dep.

**I12 — frontend polls only when the job is running.**

- `apps/console/src/lib/queries.ts`: `useMissionStatus` and
  `useAutonomyStatus` now use `refetchInterval: (q) =>
q.state.data?.running ? <ms> : false`. Idle dashboards poll zero times
  per minute (was 24 + 20).

**Verification.** `pnpm -r typecheck` green across all 7 packages after
every step. Unit tests: 338 in workspace packages (+6 new concurrency
specs, was 332) + 314 in console-api = **652 unit tests passing**. Two
repl controller assertions were updated to accept the new `AbortSignal`
argument; no other test changes.

**Still open (tracked in `TODO.md`):** Critical C1 (triple-write path on
thalamus tables), C2 (`sim-promotion.service.ts` god-service with raw DB
handle), C4 (thalamus kernel still hard-codes SSA via
`utils/satellite-entity-patterns.ts` + 13 `cortices/sources/fetcher-*.ts`

- `prompts/opacity-scout.prompt.ts`). Important I1, I2, I5, I6, I8, I9,
  I11 + 10 Minor items.

### Sim 5-layer + HTTP boundary + Thalamus domain-agnostic — 2026-04-18 (evening)

Branch `refactor/sim-agnostic`, on top of Plan 1 (sweep-agnostic) and Plan 2
B.1–B.11. Closes the CLAUDE.md §1 invariant for the sim subsystem: kernel no
longer reaches app internals — it consumes `console-api` over HTTP; thalamus
no longer encodes SSA vocabulary — the profile is injected at container
build time.

**Sim boundary — HTTP, not in-process.**

- New `packages/sweep/src/sim/http/` — typed `SimHttpClient` + 6 adapters
  (`fleet`, `promotion`, `queue`, `runtime-store`, `swarm-store`, `target`).
  Three new kernel ports (`runtime-store`, `swarm-store`, `queue`) flank the
  8 existing ones; the kernel now talks to the app over a single contract
  (`POST /api/sim/**` routes).
- Sim 5-layer landed in `apps/console-api/src/`: 7 new repositories
  (`satellite-fleet`, `sim-run`, `sim-turn`, `sim-agent`, `sim-swarm`,
  `sim-memory`, `sim-terminal`) + 11 new services (`SimAgent`,
  `SimGodChannel`, `SimTarget`, `SimFleet`, `SimSwarmStore`, `SimRun`,
  `SimSwarm`, `SimTurn`, `SimMemory`, `SimTerminal`, `SimPromotion`) +
  `RuntimeConfigRepository` / `RuntimeConfigService`. SSA sim pack
  (`apps/console-api/src/agent/ssa/sim/`) wires 10 port implementations:
  `action-schema`, `aggregation-strategy`, `cortex-selector`,
  `fleet-provider`, `kind-guard`, `persona-composer`, `perturbation-pack`,
  `promotion`, `prompt-renderer`, `targets` + `aggregators/pc` +
  `bus-datasheets` + `swarms/{telemetry,pc}`.
- Legacy sweep-side sim adapters deleted: `legacy-ssa-promotion.ts` (132 L),
  `legacy-ssa-resolution.ts` (634 L), sweep-owned `satellite.repository.ts`
  (1326 L). `BuildSweepOpts.ports` made required; CLI + UC3 E2E inject
  disabled stubs so no fallback path survives. Sweep arch-guard still
  accepts the remaining Plan 6 allowlist (promote.ts + 2 legacy-ssa-\*).

**Thalamus domain-agnostic — profile injection at container build.**

- `packages/thalamus/src/prompts/` now exports `DEFAULT_NANO_SWARM_PROFILE`
  (4 generic lenses: news / trend / data / market) + `DEFAULT_CURATOR_PROMPT`
  - setters `setNanoSwarmProfile()` / `setCuratorPrompt()`. Thalamus ships
    standalone-testable with zero SSA knowledge.
- SSA-specific profile (50 specialized lenses, keyword → operator/regime
  map, SSA rubrics) and SSA curator prompt moved to
  `apps/console-api/src/prompts/nano-swarm-ssa.prompt.ts` +
  `curator-ssa.prompt.ts`. `container.ts` injects both via the setters
  next to the existing `setNanoConfigProvider` / `setNanoSwarmConfigProvider`
  runtime-tunable wiring.
- `nano-swarm.ts` slimmed from 607 to ~90 lines: the wave executor now
  delegates to `callNano(mode)` in `explorer/nano-caller.ts`; all the
  domain-specific orchestration lives in the injected profile. Dedup logic
  preserved.

**SSA audit prompts extracted.**

- `apps/console-api/src/agent/ssa/sweep/audit-provider.ssa.ts` no longer
  inlines the nano-sweep prompt template. Moved to
  `apps/console-api/src/prompts/ssa-audit.prompt.ts` (existing prompts/
  convention, per `feedback_prompt_placement` — non-cortex prompts live in
  `<pkg>/src/prompts/`).

**Smaller targeted SOLID cleanups.**

- `packages/sweep/src/repositories/sweep.repository.ts` — extracted a single
  `toRow(hash)` helper; deleted the 24-field hash-to-row construction
  duplicated between `insertMany` and `insertOne`; `list()` simplified on
  the same helper. Net −43 lines, behaviour preserved (unit specs green).
- `apps/console-api/src/agent/ssa/sweep/resolution-handlers.ssa.ts` —
  extracted `resolveOrPrompt()` consolidating the 0 / 1 / N-match
  disambiguation flow used by `resolveAndUpdate`,
  `createLinkPayloadHandler`, and `createReassignOperatorCountryHandler`.
  Net −28 lines, typecheck clean.
- `doctrine-parser.ssa.ts` and `transformers/sweep-audit.transformer.ts`
  deleted (no remaining consumers after Plan 1 + Plan 2).

**Runtime-tunable configuration.**

- `RuntimeConfigRepository` persists per-domain config (`nano`, `nano-swarm`,
  per-mode overrides); `RuntimeConfigService` exposes get/set with schema
  validation; `setNanoConfigProvider` / `setNanoSwarmConfigProvider` in
  thalamus pull current config at call-time so operator changes take effect
  without a redeploy.

**Documentation.**

- `README.md` trimmed from 741 → 129 lines — narrative moved to 13 LaTeX
  specs under `docs/specs/architecture/` (ontology, design stance, layout,
  thalamus, sweep, SSA primary build, transpositions, three swarms, shared
  foundation, design choices, running locally, consoles, references). Each
  spec compiles to a standalone PDF via `make -C docs/specs all`.

### Thalamus reliability sweep #2 — 2026-04-17 (afternoon)

Follow-up to the morning deep-audit. Adversarial queries on `launch_scout`
(`"7 prochains jours SpaceX vs non-SpaceX"`, `"rideshare ≤100 kg"`, `"China vs
USA posture this week"`) surfaced 8 structural bugs compounding into the same
failure mode: the system had correct data in DB, emitted correct findings,
but the summariser received a partial view and Kimi composed plausible-looking
paraphrases instead of ground-truth answers.

**Pipeline fixes (SQL → cortex → summariser):**

- **`listLaunchManifest` horizon never applied.** [`traffic-forecast.repository.ts`](apps/console-api/src/repositories/traffic-forecast.repository.ts) declared `horizonDays` as a param but the `db`-branch WHERE clause had no temporal filter, and rows were ordered `planned_net DESC NULLS LAST`. A "next 14 days" query returned the 15 _furthest_ launches (all year-end TBD placeholders). Fixed: `AND planned_net BETWEEN now() AND now() + make_interval(days => ${horizonDays})`, ORDER ASC. Simulation post-fix: `Electron | Kakushin Rising (JAXA Rideshare)` (2026-04-23, rideshare=true) now surfaces at row 6 of the 14-day window.

- **Same `listLaunchManifest` UNION column-count mismatch.** The `'db'` branch missed the 8 `itu*` columns added when the ITU ingester (Phase 3f) shipped — `queryLaunchManifest` crashed with `"each UNION query must have the same number of columns"` on every cycle. Padded the branch with `NULL::*` casts matching the ITU branch.

- **Planner emits param names the helper doesn't recognise.** The LLM planner routinely sent `{window_days: 7, size_max: 100}` where the helper expected `{horizonDays, limit}` — params silently dropped, helper defaulted to 30 days. Added `pickNumber()` alias resolver at [`cortex-data-provider.ts`](apps/console-api/src/agent/ssa/cortex-data-provider.ts) accepting `horizonDays | horizon_days | window_days | windowDays | days | horizon`, plus `limit | size_max | sizeMax | max`. Default lowered to 14d as safety net.

- **Summariser received only top-8 by confidence DESC.** [`repl-chat.service.ts`](apps/console-api/src/services/repl-chat.service.ts) sliced cycle findings at 8. With strategist findings self-rated ≥0.78 and sometimes 1.0, `briefing_producer` findings (conf 0.74, the _actual_ per-query answer) never reached the summariser. Bumped to 25 — sufficient for typical cycle output, summariser LLM handles relevance.

**Schema + dedup fixes (cycle ↔ finding):**

- **`research_cycle_finding` junction table** (migration 0011). Previously `findByCycleId(N)` returned only findings whose `research_cycle_id` origin matched N — a semantic or hash dedup hit kept the older origin cycleId, so re-emissions were invisible to the summariser. New M:N table is the source of truth for "what cycle N actually surfaced"; `research_finding.research_cycle_id` remains as origin marker. [`storeFinding`](packages/thalamus/src/services/research-graph.service.ts) calls `linkToCycle()` in all three branches (semantic merge, hash dedup hit, fresh insert) via `ON CONFLICT DO NOTHING`. Backfilled 639 historical finding rows from the origin column so past cycles still resolve correctly.

- **Semantic dedup tightened.** Old rule (`cosine ≥ 0.92 AND same primary entity`) collapsed specific per-launch findings onto thematic aggregates: a finding about "Starlink 17-22 at SLC-4E 18/04 14:00" merged into a pre-existing "SpaceX multi-grappin LEO: 75 satellites Starlink" because embeddings cluster by operator/constellation and `entityId=0` (unresolved `external:<uuid>` ref) made the entity filter toothless. New rules: (1) skip semantic dedup entirely when `entityId=0` (unanchored), (2) require matching `findingType` — an `"opportunity"` rideshare never merges onto an `"alert"`. Hash-dedup key for unanchored findings now includes a title snippet to prevent same-bucket collisions across distinct launches.

- **`maxFindings` dynamic cap.** Was hardcoded at 5 in [`StandardStrategy`](packages/thalamus/src/cortices/strategies/standard-strategy.ts), silently breaking skills whose contract is "one finding per DATA row" (launch_scout, debris_forecaster). Now `clamp(authoritativeData.length, 5, 30)` — a 6-launch manifest produces up to 6 findings, capped at 30 for cost safety.

**Anti-hallucination fixes (skill + domain config):**

- **`AUTHORITATIVE DATA` vs `WEB CONTEXT` tiered payload.** [`StandardStrategy`](packages/thalamus/src/cortices/strategies/standard-strategy.ts) now hands the LLM two distinct sections: (1) SQL + structured-source rows scoped by query params, (2) web-search snippets as advisory context only, with an explicit instruction: _"Ground every finding in AUTHORITATIVE DATA. Use WEB CONTEXT only to cross-reference — never cite a specific launch/event/number that appears ONLY in WEB CONTEXT as if it were in scope."_ Previously everything was merged into `rawData` and the LLM happily cited J+10 web-search launches as fitting a "next 7 days" window.

- **`MISSION NAME FIDELITY` + `OPERATOR VS CUSTOMER` rules** in [`SSA_SOURCING_RULES`](apps/console-api/src/agent/ssa/domain-config.ts). The audit surfaced a canonical hallucination: DATA row `missionName='Kakushin Rising (JAXA Rideshare)'`, `operatorName='Rocket Lab'`, `operatorCountry='US'`, launch site Mahia NZ → LLM emitted _"rideshare Kiwi, opérateur JAXA, pays Japon"_. "Kiwi" was composed from the launch-site country nickname; JAXA (the rideshare customer) was swapped for the operator. New rules mandate verbatim mission/operator names with the exact counter-example, and explicitly separate OPERATOR (`operatorName`) from CUSTOMER (found in `missionName`/`missionDescription`).

- **`NUMERIC FIDELITY` rule extended to temporal projections.** Original rule covered country/regime ratios (e.g. _"China vs USA debris ×2.3"_) but a post-restart cycle still fabricated _"densité ×200 du LEO 590-630 km"_ for the Kuiper/Qianfan convergence with no baseline/target pair in DATA. Web-verified against eoPortal, Wikipedia, Deloitte TMT 2026: no published source expresses that shell's density growth as a `×200` factor. Rule now covers any multiplier/ratio/percentage including temporal projections, with qualitative-language fallback when numerator+denominator aren't both in DATA.

**Validation.** Cycle 320 (post all fixes) for query _"SpaceX vs non-SpaceX next 7 days, vehicle/NET/mission/operator/country, counts by operator"_: 6 per-row findings, all in horizon, all verbatim:

| #   | Finding                                                                       |
| --- | ----------------------------------------------------------------------------- |
| 981 | Falcon 9 · Starlink Group 17-22 · SpaceX — 2026-04-18                         |
| 982 | New Glenn · BlueBird Block 2 #2 · Blue Origin — 2026-04-19                    |
| 983 | Falcon 9 · GPS III SV10 · SpaceX — 2026-04-20                                 |
| 984 | Electron · Bubbles · Rocket Lab — 2026-04-22                                  |
| 985 | Falcon 9 · Starlink Group 17-14 · SpaceX — 2026-04-22                         |
| 986 | Electron · **Kakushin Rising (JAXA Rideshare)** · **Rocket Lab** — 2026-04-23 |

Briefing counts: SpaceX 3, Rocket Lab 2, Blue Origin 1 — matches DB ground truth. No fabricated names, no J+8/J+10 launches leaking in as in-horizon, no thematic aggregates.

**Residual minor issues** (non-blocking): `HASTE | Bubbles` truncated to `Bubbles` in the LLM's summary (compound-name paraphrase); `externalLaunchId` present in evidence but not surfaced in summary text. Both are skill-prompt tweaks, not structural bugs.

### console-api test pyramid + polish fixes — 2026-04-16

**Test reorganization.** All console-api tests moved into a single pyramidal
structure under [apps/console-api/tests/](apps/console-api/tests/):

```
tests/
  unit/                  # 50+ tests — pure functions, no I/O
    utils/               # 4 test files (async-handler, fabrication, field-constraints, sql-field)
    transformers/        # 5 test files (the row→DTO layer)
    services/            # 2 test files (satellite-view, conjunction-view)
  integration/           # real DB, below HTTP
    repositories/        # satellite.repository.spec.ts (live Postgres)
  e2e/                   # full HTTP via startServer(0)
    setup.ts             # vitest globalSetup, boots Fastify
    conjunctions.spec.ts, enrichment-findings.spec.ts,
    knn-propagation.spec.ts, sweep-mission.spec.ts
  README.md              # documents the pyramid
```

Naming convention enforced: `.test.ts` = unit (fast, parallel-safe),
`.spec.ts` = integration + e2e (requires infra).
[apps/console-api/vitest.config.ts](apps/console-api/vitest.config.ts) updated
to match.

**Polish fixes** (code-review follow-ups):

- `entityRef` de-duplicated between `kg-view.transformer` and
  `finding-view.transformer` — single source of truth in kg-view.
- `asyncHandler` now redacts internal 500 errors in production
  (`NODE_ENV=production` + no explicit `statusCode` → `{ error: "internal error" }`;
  real message still goes to `req.log.error`). Explicit HTTP errors
  (with `.statusCode`) pass through untouched.
- `satellitesController` validates `regime` via `RegimeSchema.safeParse` —
  bad regime values fall through to `undefined` instead of silently matching
  nothing.
- `ConjunctionViewService.list(minPc)` → `list({ minPc })` — symmetry with
  `SatelliteViewService.list(opts)` and `FindingViewService.list(filters)`.
- `FindingViewService` sentinel `"invalid"` split into `"invalid-id"` vs
  `"invalid-decision"` — controller now returns distinct error messages
  (matches original server.ts behaviour, better for UI field-level errors).

### console-api transformers layer — 2026-04-16

Follow-up to the 5-layer refactor: extracted all row→DTO mapping functions
from inside services into a dedicated `apps/console-api/src/transformers/`
directory.

Before: transformers were inline in services (`toView` / `toEdge` / `toListView`
/ `toDetailView` / `entityRef`) — coupled to orchestration, hard to test in
isolation. `mapFindingStatus` / `toDbStatus` / `parseFindingId` were
misclassified as "utils".

After: 5 transformer modules, each a collection of pure functions:

- [transformers/satellite-view.transformer.ts](apps/console-api/src/transformers/satellite-view.transformer.ts)
- [transformers/conjunction-view.transformer.ts](apps/console-api/src/transformers/conjunction-view.transformer.ts)
- [transformers/kg-view.transformer.ts](apps/console-api/src/transformers/kg-view.transformer.ts) (`toRegimeNode`, `toOperatorNode`, `toSatelliteNode`, `toFindingNode`, `toKgEdge`, `entityRef`)
- [transformers/finding-view.transformer.ts](apps/console-api/src/transformers/finding-view.transformer.ts) (`toFindingListView`, `toFindingDetailView`, `entityRef`)
- [transformers/finding-status.transformer.ts](apps/console-api/src/transformers/finding-status.transformer.ts) (`mapFindingStatus`, `toDbStatus`, `parseFindingId` — **moved** from `utils/`)

Impact:

- Services shrank **301 → 125 lines (−58%)** — satellite-view 58→19, conjunction-view 49→15, kg-view 68→29, finding-view 126→62, stats unchanged.
- **51 new unit tests** added (9 satellite + 14 conjunction + 12 kg + 16 finding-view). Pure-function tests, no mocks.
- **Byte-level equivalence** confirmed between extracted transformers and the inline versions they replaced — zero behaviour drift, 4 integration specs still green.
- Full suite: 465 passed / 23 todo (up from 414 / 23).

### console-api 5-layer architecture refactor — 2026-04-16

Decomposed the monolithic `apps/console-api/src/server.ts` (2001 lines) into a
layered Fastify backend:

```
src/
  server.ts          # boot only — 61 lines (was 2001)
  container.ts       # DI composition root — 134 lines
  routes/            # 12 route registrars + index barrel (registerAllRoutes)
  controllers/       # 13 controllers — thin req/reply adapters, asyncHandler-wrapped
  services/          # 13 services — business logic, orchestration, state
  repositories/      # 9 repositories — raw SQL, bigint-typed ids
  types/             # 5 server-only types (mission, autonomy, cycle, reflexion, knn)
  prompts/           # 3 LLM prompts (mission-research, repl-chat, autonomy-queries)
  utils/             # 7 server-only helpers (async-handler, regime, classification,
                     #   finding-status, fabrication-detector, field-constraints, sql-field)
```

Shared DTOs hoisted to [packages/shared/src/ssa/](packages/shared/src/ssa/):

- `satellite-view.ts` — `SatelliteView` + `normaliseRegime` / `regimeFromMeanMotion`
  / `smaFromMeanMotion` / `classificationTier` (moved from console-api).
- `finding-view.ts` — `FindingView` + `FindingStatus`.
- `kg-view.ts` — `KgNode`, `KgEdge`, `KgEntityClass`.
- `conjunction-view.ts` — added `deriveAction(pc)` next to existing
  `deriveCovarianceQuality(sigmaKm)`. Unit tests land next to the types.

Rule applied end-to-end: anything that does not share semantics with the
console frontend stays server-local in `apps/console-api/src/utils/`;
anything consumed by both frontend and backend lives in
`packages/shared/src/ssa/`.

Behaviour preserved except for three intentional improvements:

- `SatelliteRepository.findPayloadNamesByIds` / `updateField` /
  `knnNeighboursForField` tightened from `string`-valued ids to `bigint[]`,
  eliminating a latent `SyntaxError` on malformed input.
- `ResearchEdgeRepository.findByFindingIds` tightened from `string[]` to
  `bigint[]` with `::bigint[]` cast, enabling PK index usage.
- `StatsService.snapshot` now runs its 3 count queries in `Promise.all`
  parallelism (was sequential in the inline server.ts).

Workspace test discipline — [vitest.workspace.ts](vitest.workspace.ts): the
`unit` project now picks up `packages/*/src/**/*.test.ts` (co-located tests),
not just `packages/*/tests/**/*.spec.ts`. This surfaced 20 previously-dead
shared DTO tests.

Workflow — subagent-driven-development with two-stage review (spec + code
quality) per task. 6 feature branches merged back into a single refactor
branch:

- `api-reads` — health + satellites + conjunctions + kg + findings + stats.
- `api-enrichment-infra` — enrichment-cycle + sweep-audit repos +
  enrichment-finding + nano-research services.
- `api-mission-orchestration` — mission + knn-propagation + reflexion
  (service + controller + routes for each; reflexion repo).
- `api-ops-orchestration` — cycle-runner + autonomy + repl-chat
  (service + controller + routes for each).

All 4 integration specs green throughout (conjunctions, enrichment-findings,
knn-propagation, sweep-mission). Full repo suite: 385 passed / 23 todo.

### Per-event conjunction cortex + Foster Pc covariance columns — 2026-04-16

Closes the gap between the SGP4 propagator (which produced min-range + TCA) and
the cortex output (which was emitting data-quality meta-findings instead of
concrete per-event screens). After this change, `conjunction_analysis` emits
one finding per NORAD pair with miss distance, TCA, and calibrated Pc in the
title — the intended contract of the cortex.

Schema — [packages/db-schema/src/schema/conjunction.ts](packages/db-schema/src/schema/conjunction.ts):

- `primary_sigma_km`, `secondary_sigma_km`, `combined_sigma_km` (real) — 1σ
  position uncertainty at TCA for each object and the RSS combination.
- `hard_body_radius_m` (real, default 20) — sum of spherical hardbodies
  (≈ 10 m per object).
- `pc_method` (text) — methodology marker, currently `"foster-gaussian-1d"`.
- Columns added NULLable so existing events survive; re-seed overwrites.

Propagator — [packages/db-schema/src/seed/conjunctions.ts](packages/db-schema/src/seed/conjunctions.ts):

- `sigmaKmFor(regime, ageAtEpochDays, propagationDays)` — regime-conditioned
  baseline + growth rate. LEO/SSO 0.5 km + 0.15 km/day, MEO 1.0 + 0.05, GTO
  2.0 + 0.1, HEO 2.5 + 0.1, GEO 4.0 + 0.02. Plausible for OSINT-derived TLEs.
- **Foster-1992 1D Gaussian Pc** over the miss-distance distribution:
  `Pc ≈ (HBR² / 2σc²) · exp(−d² / 2σc²)` where `σc = √(σp² + σs²)`.
  Clamped to [1e-12, 0.5]. Replaces the previous flat `exp(-minRange/10)`
  heuristic that clipped everything to 1e-2.
- Result: Pc distribution spans 9 orders of magnitude (1e-4 → <1e-12). Top
  event CHUANGXIN 1-02 × 1-03 @ 2.27 km σ=1.93 km → Pc = 2.7e-5 (HIGH).

Helper — [packages/thalamus/src/cortices/queries/conjunction.ts](packages/thalamus/src/cortices/queries/conjunction.ts):

- `ConjunctionScreenRow` extended with `primarySigmaKm`, `secondarySigmaKm`,
  `combinedSigmaKm`, `hardBodyRadiusM`, `pcMethod`. Cortex receives the full
  covariance context, not just Pc.

Prompt rules — strict per-event contract:

- [skills/conjunction-analysis.md](packages/thalamus/src/cortices/skills/conjunction-analysis.md)
  rewritten. Hard rules: **one finding per DATA row**, never invent NORAD IDs,
  never emit data-quality meta-findings when events are present (that's the
  `data_auditor` cortex's job). Title format mandatory:
  `"NORAD 28252 × 38332 — 2.1 km miss, 2026-04-17T14:12Z, Pc=1.8e-04"`.
- Severity ladder — `findingType`: `alert` (Pc≥1e-4) / `forecast` (1e-6…1e-4)
  / `insight`. `urgency`: critical (≥1e-3) / high (≥1e-4) / medium (≥1e-6) /
  low. `confidence = 0.75` default (OSINT-only), lifts to `0.9` with field
  corroboration per the `dual-stream-confidence` spec.
- Pc interpretation table embedded in the skill: ≥1e-3 → wake ops,
  1e-4…1e-3 → NASA threshold, 1e-6…1e-4 → watch, <1e-6 → archive.
- [skills/traffic-spotter.md](packages/thalamus/src/cortices/skills/traffic-spotter.md)
  rewritten to one-finding-per-regime (density rows) + one-per-news-item.
  Bans generic "we have RSS data" meta.

Verified end-to-end: re-run of `THALAMUS_MODE=record make thalamus-cycle`
produces 57 findings / 30 persisted / 75 edges (vs 13 / 5 / 25 before
tuning), with per-event NORAD titles and operator names surfaced on the
top-5 Pc sample.

### Orbit trails + conjunction markers on the OPS globe — 2026-04-16

Ships the "satellite positions" view that matches real SSA console aesthetics:
hybrid orbital trails behind every catalog object and severity-colored ✕
markers at every conjunction's TCA, with a full-SSA info card on hover.

- `/api/conjunctions` extended with `regime`, `covarianceQuality`, `action`,
  `computedAt` — joined from `satellite` (primary mean-motion) and derived
  server-side from `combined_sigma_km` / `probability_of_collision`. No mocks.
- Shared `ConjunctionViewSchema` (Zod) in `packages/shared/src/ssa/` — single
  DTO source of truth for frontend + future CLI consumers.
- `apps/console` + `apps/console-api` moved out of `.gitignore` and tracked
  (they are part of the portfolio tree now).
- `OrbitTrails.tsx` — full orbit rings per regime (merged BufferGeometry, 4
  draw calls across ~1215 sats) + fading 60-sample tails. Tri-state toggle
  `off | tails | full` folded into `RegimeFilter`.
- `ConjunctionMarkers.tsx` — one sprite per conjunction, hidden by default,
  revealed on arc hover with severity palette (green < 1e-6, yellow < 1e-4,
  red ≥ 1e-4) and an info card portal with the 10 SSA fields.
- `orbit.ts` Kepler propagator now exposes `orbitRing(s, n)` — closed-loop
  geometry sampler used by both the trails and the `orbit.test.ts`
  closure/period unit tests (5/5 passing).
- Integration test `tests/conjunctions.spec.ts` parses live `/api/conjunctions`
  against `ConjunctionViewSchema` — guards the API shape against drift.

Verified end-to-end: 13/13 console-api tests, 5/5 console tests, live ISS ↔
POISK conjunction rendering as a red ✕ with `covarianceQuality: MED`,
`action: maneuver_candidate`.

Plan: `docs/specs/2026-04-15-orbit-trails-conjunction-markers.plan.md`
Spec: `docs/specs/2026-04-15-orbit-trails-conjunction-markers.md`

### Sweep enrichment pipeline + KNN propagation + orbital reflexion — 2026-04-16

Closes the loop between catalog enrichment and Thalamus reasoning. Every value
written to the catalog (by web mission or KNN propagation) now emits a
`research_finding` with `research_edge`s — so cortices can cite, trace, and
reason on factual fills rather than treating the DB as a mute oracle. Pitch:
"Null plutôt que plausible" — the system refuses fabrications at decode time
and cites its provenance in the knowledge graph.

Sweep mission pipeline — hardened:

- Structured-outputs JSON schema on gpt-5.4-nano `/v1/responses` (strict)
  forces `{value, unit, confidence, source}` with `source` regex `^https://…`.
  No prose slot = no hedging narrative possible at decode time.
- Hedging-token post-hoc blocklist (typical / approx / around / unknown / …)
  catches any residual narrative that slips through.
- Source validation: the returned URL must appear in the builtin `web_search`
  URL list — rejects invented citations.
- **Range guards per column**: `lifetime ∈ [0.1, 50]`, `launch_year ∈ [1957,
2035]`, `mass_kg ∈ [0.1, 30 000]`, `power ∈ [0.1, 30 000]`. Values outside
  → unobtainable (no DB write).
- **Unit mismatch check**: `lifetime` rejects `hours/days/months`;
  `launch_year` rejects `BC/month/day`.
- **2-vote corroboration**: two independent nano calls with different angles
  (operator docs / eoPortal-Wikipedia), accept iff numeric values agree within
  ±10 % of median (text: exact normalised match). Confidence boosted +0.15 on
  agreement.
- **Object-class filter**: mission only processes `object_class='payload'`
  (debris and rocket stages have no meaningful `lifetime`/`variant`/`power`).
- **Per-satellite granularity**: each suggestion (operator × field) expands to
  N per-satellite tasks with `satelliteName` + `noradId` in the prompt (vs the
  old operator-level question that always returned null).

KNN propagation — zero-LLM enrichment:

- `POST /api/sweep/mission/knn-propagate {field, k, minSim, limit, dryRun}`
  — for each payload missing a field, finds K nearest embedded neighbours
  (Voyage halfvec cosine) that have the field set and propagates their
  consensus value. Consensus rule: numeric = all within ±10 % of median;
  text = mode covers ≥ ⅔ of neighbours. Nearest-neighbour `cos_sim ≥ minSim`.
- Range guards applied to neighbour values too (no garbage in → garbage out).
- 10× cheaper than web mission (pure SQL + HNSW), covers the semantic long
  tail the mission can't afford to hit one-by-one.

Enrichment findings (mission + KNN) — bridge to Thalamus KG:

- New `emitEnrichmentFinding()` called from both fill paths. Writes a
  `research_finding` (`cortex=data_auditor`, `finding_type=insight`) carrying
  the field / value / confidence / source in `evidence` JSONB + a
  `reasoning` string explaining method (KNN propagation vs 2-vote).
- `research_edge` rows: `about` → target sat, `similar_to` → every neighbour
  that voted (KNN) or supporting source URL (mission). Provenance is now
  navigable in the KG, not hidden in a log.
- Feedback loop: each fill pushes an `enrichment` entry to `sweep:feedback`
  so the next nano-sweep can de-prioritise fields that self-heal via KNN.
- Lazy-created long-running cycle `trigger_source='catalog-enrichment'`
  carries every enrichment finding across sessions.
- Every PG parameter cast explicitly (`::bigint`, `::real`, `::jsonb`,
  `::entity_type`, `::relation`, enum types) — `pg@8.x` does not infer these
  via driver and silently drops INSERTs otherwise.

Orbital reflexion pass — factual anomaly detection:

- `POST /api/sweep/reflexion-pass {noradId, dIncMax, dRaanMax, dMmMax}`
  runs **two orbital cross-tabs** on the existing `telemetry_summary`
  (`inclination`, `raan`, `meanMotion`, `meanAnomaly`):
  1. **Strict co-plane companions** — same (inc, raan, meanMotion) within
     tight tolerance, with along-track phase lag in minutes (`Δma / 360 ×
period`). This is the tandem-imaging / SIGINT-pair test.
  2. **Inclination-belt peers** — same inclination regardless of RAAN,
     cross-tabulated by `operator_country × classification_tier ×
object_class`. The "who lives in your SSO neighbourhood" test.
- MIL-lineage name-match (`YAOGAN%`, `COSMOS%`, `NROL%`, `LACROSSE%`,
  `TOPAZ%`, `SHIYAN%`, …) surfaces explicit military platforms hiding in
  the belt.
- Emits an `anomaly` finding (`cortex=classification_auditor`,
  `urgency=high` when MIL-peers ≥ 1, else `medium`) with every cited peer
  traced via `similar_to` edges. Zero LLM, 100 % SQL.
- Live case: FENGYUN 3A (32958, "civilian weather") returned `urgency=high`
  with 3 MIL peers (YAOGAN-11, SHIYAN-3, SHIYAN-4) + SUOMI NPP strict
  co-plane at 54 min phase lag. The orbital fingerprint reveals what the
  declared classification doesn't.

Autonomy controller — continuous Thalamus + Sweep rotation:

- `POST /api/autonomy/start {intervalSec}` / `stop` / `GET /status`. Rotates
  between Thalamus cycles (6 rotating SSA queries: detect suspicious
  behaviour, audit conjunction risk, correlate OSINT feeds…) and Sweep
  nullScan passes. Each tick emits findings live. 3 s refetch front-side so
  the operator sees the catalogue move.
- Briefing mode dropped from rotation (returned 0 operator-countries once
  the catalogue is fully null-scanned) — kept thalamus ↔ sweep-nullscan.

Catalog gap-fill (zero-LLM heuristic):

- `packages/db-schema/src/seed/fill-catalog-gaps.ts` — deterministic filler
  for the three columns that were 100 % NULL: `g_orbit_regime_description`
  (from meanMotion + eccentricity + inclination), `classification_tier`
  (operator name / country heuristic: military → restricted, dual-use →
  sensitive, rest → unclassified), `is_experimental` (mass < 10 kg or
  bus/name signals like CUBESAT / TESTBED / DEMOSAT). Result: 500/504
  regime, 504/504 tier, 504/504 experimental, all traceable to a rule.

Mission-UI — operator-visible state:

- `apps/console/src/components/AutonomyControl.tsx` — topbar pill shows live
  tick count + pulse, toggles the loop on / off. FEED panel below streams
  recent ticks (action · query · `+N findings` · elapsed) + 3 live
  counters (findings / suggestions / KG edges).
- `apps/console/src/modes/sweep/SweepSuggestions.tsx` — LAUNCH FISH MISSION
  button + running banner with completed / filled / unobtainable / errors +
  scrollable recent-tasks feed with clickable source hosts.
- `apps/console/src/components/CommandPalette.tsx` — bare free-text that
  matches no action falls through to REPL chat automatically.
- `/api/repl/chat` — classifier → run_cycle vs plain chat. On run_cycle
  intent it actually dispatches a Thalamus cycle, loads findings, and
  summarises them with satellite names cited. No fixtures, real pipeline.

SQL constraint — cosine-distance threshold:

- Mass-gap KNN propagation over 50 JILIN-1 payloads produced 6 fills at
  `cos_sim ∈ [0.89, 0.92]` converging on 42 kg, 44 others rejected on
  consensus disagreement. Illustrates that "Null rather than plausible" is
  the operating contract, not the exception.

Tests — 13/13 integration specs green:

- `apps/console-api/tests/sweep-mission.spec.ts` (6) — queue expansion,
  Other / Unknown skip, non-writable skip, idempotency, cap,
  double-start-refused.
- `apps/console-api/tests/knn-propagation.spec.ts` (5) — field whitelist
  (400), shape contract, `k`/`minSim` clamping, sampleFills trail,
  `tooFar` monotonicity under `minSim` ↑.
- `apps/console-api/tests/enrichment-findings.spec.ts` (1) — every KNN
  fill emits a `research_finding` with ≥ 1 `about` + ≥ 1 `similar_to`
  edge.
- Snapshot/restore of `sweep:index:pending` between tests — isolated from
  the 163 live pending suggestions, no cross-test contamination.

### SSA catalog expansion + Voyage embeddings + KNN cortex — 2026-04-15

From 504 payloads to a **33,564-object operational catalog** (debris + rocket
stages included), embedded end-to-end with Voyage `voyage-4-large` halfvec(2048)
and served through a new KNN-based conjunction candidate cortex. Pitch: "SSA
doctrine learned by cosine similarity, not coded by hand."

Schema:

- `packages/db-schema/src/schema/satellite.ts` — `objectClass` text column with
  CHECK constraint (`payload`/`rocket_stage`/`debris`/`unknown`). First step
  toward a dedicated `space_object` table; inline for now so the screening
  pipeline can filter without another schema migration.
- `satellite.embedding halfvec(2048)` + `embedding_model` + `embedded_at`
  columns. HNSW cosine index (m=16, ef_construction=64) at
  `satellite_embedding_hnsw`.

Seed pipeline (all idempotent, all in `packages/db-schema/src/seed/`):

- `populate-space-catalog.ts` — CelesTrak SATCAT (`celestrak.org/pub/satcat.csv`,
  ~6 MB, 68k rows). Filters `DECAY_DATE=''` → 33,560 alive objects (18,556
  payloads + 12,544 debris + 2,397 rocket stages + 63 unknown). UPSERT by
  `norad_id`. Apogee / perigee / inclination / RCS / ops_status stashed in
  `metadata` JSONB. 24h disk cache at `/tmp/celestrak-satcat.csv`.
- `enrich-gcat.ts` — switched NORAD source from `telemetry_summary->>'noradId'`
  (legacy JSON field) to the dedicated `norad_id` column. Enrichment pass now
  hits the whole 33k catalog, not just the 504 legacy payloads. Result: 20,556
  mass backfills + 20,213 bus backfills against GCAT (~63% coverage).
- `screen-broadphase.ts` — sweep-line O(n log n + k) pruner with bounded top-K
  max-heap (memory-safe). Stages: naive (542 M pairs) → regime bucketing (385 M)
  → radial overlap @ ±50 km (145 M candidates, **4× pruning in 32 s**). Cross-
  class mix surfaced: 29.5 M payload×debris, 6.7 M debris×rocket_stage.
- `screen-narrow-phase.ts` — SGP4 pipeline: re-runs broad-phase → fetches TLEs
  from CelesTrak `gp.php?CATNR=…` (disk-cached at `/tmp/tle-cache/`) → satellite.js
  propagation → Foster-1992 isotropic Pc with regime-conditioned sigma →
  UPSERT `conjunction_event` by (primary, secondary, epoch).
- `embed-catalog.ts` — Voyage voyage-4-large document embedder. Batches of 128,
  halfvec(2048) literal via `${literal}::halfvec(2048)` cast. One line of
  structured text per object (name, object_class, regime, altitude band,
  inclination, operator, bus, launch year, mass). **33,564/33,564 embedded in
  3m39s, zero failures, ~$0.08 total cost.** Inline Voyage caller avoids the
  circular dep with `@interview/thalamus`.
- `build-embedding-index.sql` — HNSW cosine index + secondary composite index
  on `(metadata->>'apogeeKm', object_class)`.

Cortex (`packages/thalamus/src/cortices/`):

- `queries/conjunction-candidates.ts::queryConjunctionCandidatesKnn` —
  pre-narrow-phase candidate proposer. Combines (a) HNSW cosine KNN on the
  halfvec embedding, (b) radial altitude overlap `[perigee − Δ, apogee + Δ]`,
  (c) `excludeSameFamily` regex to suppress constellation self-clustering.
  Session-scoped `hnsw.ef_search` set per query via a sanitised literal.
  Latency: 100–170 ms on 33k catalog.
- `skills/conjunction-candidate-knn.md` — cortex skill. One finding per KNN
  survivor. Severity: `forecast` if `cos < 0.30 ∧ overlap > 15 km`, `insight`
  otherwise. Explicitly forbidden from asserting Pc — that's the job of
  `conjunction_analysis` downstream. Emits `recommendations: propagate_sgp4`
  with narrow-phase params.
- `queries/index.ts` — barrel re-export of `./conjunction-candidates` so
  `SQL_HELPER_MAP` picks up `queryConjunctionCandidatesKnn` via the existing
  `import * as sqlHelpers from "./queries"` pattern in `executor.ts`.
- Public API: `queryConjunctionCandidatesKnn` + `ConjunctionCandidateKnn` /
  `ConjunctionCandidatesKnnOpts` types exported from `@interview/thalamus`.

KNN sanity (hand-picked validations):

- ISS (NORAD 25544) nearest neighbours (debris-only, excludeSameFamily): 10×
  `FREGAT DEB` at 336-425 km perigee, cos 0.326-0.339. These are the Fregat
  upper-stage fragmentation debris that actually threaten the ISS altitude
  band — the embedding reproduced the DOD watchlist without any rule.
- HST (20580) nearest rocket bodies: `DELTA 2 R/B`, `H-2 R/B`, `SL-8 R/B`,
  `ARIANE 42P R/B` — exactly the clutter Hubble operators track.
- `COSMOS 2251 DEB` KNN: 10 × `COSMOS 2251 DEB` fragments (ASAT-1 cluster
  recovered end-to-end from the name + altitude + regime embedding).

CLI (`packages/cli/`):

- `/candidates <norad> [class=debris] [limit=N]` — new slash verb. Parser
  validates integer NORAD + optional flags; schema discriminated-union entry
  for `action: "candidates"`; dispatch wires to a new `candidates` adapter;
  boot-level real adapter calls `queryConjunctionCandidatesKnn` with `knnK=300`,
  `marginKm=20`, `excludeSameFamily=true`.
- `renderers/candidates.tsx` — colour-coded table (debris red, rocket_stage
  yellow, payload cyan; cos<0.30 green / <0.40 yellow / else gray). Columns:
  cos · ovl · class · alt · regime · name (+ NORAD).
- `tests/router/dispatch.spec.ts` — extended `makeAdapters()` with a mocked
  `candidates.propose`; added a `candidates` dispatch case. **55/55 green,
  `pnpm -r typecheck` clean across 7 packages.**

Bug fixes in the seed path:

- `enrich-gcat.ts` was silently no-op after the NORAD-id migration — the
  source field had moved from `telemetry_summary.noradId` to a dedicated
  column, so 99 % of the catalog was being skipped.
- `embed-catalog.ts` type hygiene: `db.execute<Row>` generic dropped (TS
  rejected `Row` as an index signature), replaced with explicit `as unknown
as Row[]` cast at the call site.

### Conversational CLI (`@interview/cli`) — 2026-04-14

Interactive Ink-based REPL (`pnpm run ssa`) for the SSA console: two-lane
router (slash grammar + interpreter cortex), animated emoji lifecycle
logs, ASCII satellite loader with rolling p50/p95 ETA, pretext-flavored
editorial rendering.

Shared:

- `packages/shared/src/observability/steps.ts` — `StepName` union of 19
  lifecycle steps + `STEP_REGISTRY` (frames + terminal + error emoji per
  step). Discriminated union on `StepEntry` enforces instantaneous vs
  animated at compile time.
- `packages/shared/src/observability/step-logger.ts` — `stepLog(logger,
step, phase, extra?)` emits structured `StepEvent` to pino. Unknown
  steps fall back to `❔` with a dev-mode warning.

Thalamus & sweep retrofit:

- `thalamus.service.ts`, `thalamus-planner.service.ts`,
  `thalamus-executor.service.ts`, `thalamus-reflexion.service.ts`,
  `cortex-llm.ts` emit `stepLog` at `cycle`, `planner`, `cortex`,
  `nano.call`, `reflexion` lifecycle boundaries (start/done/error).
- `telemetry-swarm.service.ts`, `turn-runner-dag.ts`,
  `turn-runner-sequential.ts` emit `swarm`, `fish.turn`,
  `fish.memory.write`.

Package `@interview/cli`:

- Router: slash-grammar parser (`parser.ts`) + Zod `RouterPlanSchema`
  (7 discriminants incl. `clarify`) + `interpreter` cortex skill +
  `dispatch` loop mapping steps to adapters.
- Adapters: `thalamus`, `telemetry`, `logs` (pino ring buffer),
  `graph` (BFS over research_edge), `resolution`, `why` (provenance
  tree) — all thin wrappers.
- Memory: `ConversationBuffer` (token-counted ring) + `MemoryPalace`
  (sim_agent_memory HNSW) with 200k token threshold.
- Utilities: `CostMeter` (per-turn + session), `EtaStore` (rolling
  p50/p95 persisted to `~/.cache/ssa-cli/eta.json`), source-class
  colors (`FIELD` green / `OSINT` yellow / `SIM` gray), sparkline bar.
- Ink components: `Prompt`, `StatusFooter`, `ScrollView`,
  `AnimatedEmoji` (6 fps frame cycler with terminal freeze on
  done/error), `SatelliteLoader` (ASCII sprite + subtitle + ETA band
  green/yellow/red).
- Renderers: `briefing`, `telemetry`, `logTail`, `graphTree`,
  `whyTree`, `clarify`.
- Cortex skills: `interpreter.md` (router) + `analyst-briefing.md`
  (briefing).
- Boot: `boot.ts` + `index.ts` — stubbed adapters in the default path,
  injectable via `BootDeps` for tests. `LogsAdapter` is wired end-to-end
  via pino ring buffer.
- Tests: 46 specs — schema (5), parser (10), interpreter (3), memory
  (7), cost/eta (4), adapters (8), dispatch (2), components (5),
  briefing renderer (1), e2e REPL (1).

Known gaps (deferred):

- `buildRealAdapters` in `boot.ts` still throws for
  thalamus/telemetry/graph/resolution/why — real infra wiring (DB +
  Redis + LLM transport) pending.
- Aggregator / swarm-service / promote `stepLog` emission deferred
  (Task 3 scoped to 4 files).

### sim-fish telemetry inference pipeline — 2026-04-14

End-to-end multi-agent inference of operator-private 14D telemetry scalars,
grounded in public bus datasheets, routed through reviewer-in-the-loop with
SPEC-TH-040 confidence bands.

Data:

- `packages/sweep/src/sim/bus-datasheets.json` — 26 bus archetypes (Maxar SSL-1300,
  Airbus Eurostar 3000, Lockheed A2100, Boeing BSS-702HP, Starlink v1.5 / v2-Mini,
  Iridium NEXT, GPS III / IIF, Galileo, Uragan, GOES-R, Sentinel-1 / 2, Prisma,
  Spacebus 4000, HS-601, DFH-3 / 4, Milstar / DSCS III, TDRS, SSTL-100, CubeSat
  1U / 3U, Microstar, Strela-3). Each entry has `published` (citable ranges with
  URLs) + `inferred` (bus-class engineering typicals with explicit confidence) +
  `context` (design life, mass, battery). Covers ~65% of the catalog via
  `aliases[]` (e.g. A2100 ↔ A2100AX ↔ A2100M ↔ LM2100).

Pipeline:

- `bus-datasheets.ts` loader — resolves a free-form bus name (case / separator
  insensitive, alias fallback) to a flattened prior in the
  `SeedRefs.busDatasheetPrior` shape. Unknown buses return honest null; inferred
  typicals that have no published range get a ±30% envelope.
- `prompt.ts` — injects a "Telemetry inference target" block into the fish user
  prompt when `AgentContext.telemetryTarget` is populated. Shows regime, launch
  year, and the full `[min, typical, max] unit` table so the fish MUST stay
  within ±10% per the `telemetry_inference_agent` skill.
- `load-telemetry-target.ts` — shared between both turn runners; reads
  `sim_run.seed_applied.telemetryTargetSatelliteId` and joins the satellite's
  NORAD id / regime / bus name. Null for UC1 / UC3 fish (non-telemetry swarms).
- `turn-runner-dag.ts` + `turn-runner-sequential.ts` — `pickCortexName(ctx)`
  swaps the skill from `sim_operator_agent` to `telemetry_inference_agent` when
  `ctx.telemetryTarget` is set.
- `telemetry-swarm.service.ts` — `startTelemetrySwarm({ satelliteId })` resolves
  target → operator → bus → prior and launches a K-fish swarm (default K=30)
  with `kind: "uc_telemetry_inference"` and persona perturbations spanning
  `conservative` / `balanced` / `aggressive`. Fish concurrency is clamped to 16
  to stay under the OpenAI nano RPM tier.
- `swarm-fish.worker.ts` — routes `uc_telemetry_inference` through the DAG
  runner (single-agent single-turn) with `terminal = true` after one infer.
- `swarm-aggregate.worker.ts` — branches by `sim_swarm.kind`. Telemetry swarms
  use `TelemetryAggregatorService` (per-scalar median / σ / n + `simConfidence`
  clamped to the `SIM_UNCORROBORATED` band [0.10, 0.35]) and emit K suggestions
  via `emitTelemetrySuggestions`.
- `promote.ts::emitTelemetrySuggestions` — one `sweep_suggestion` per scalar
  with severity graduated by the coefficient of variation: tight consensus
  (cv < 20% + n ≥ 5 + simConfidence ≥ 0.20) → warning (accept candidate); high
  dispersion (cv ≥ 50% + n ≥ 5) → warning (dissent); else info. Never emits
  critical — SPEC-TH-040 I-4 reserves critical for FIELD corroboration.
- `container.ts` — wires `resolutionService.setOnSimUpdateAccepted` to
  `ConfidenceService.promote({ kind: "reviewer-accept" })` via a stable
  FNV-1a `telemetryEdgeId(satelliteId, field)` hash. Accept of a sim-swarm
  suggestion bumps the edge from SIM_UNCORROBORATED → OSINT_CORROBORATED.

Confidence invariants (SPEC-TH-040 extension):

- `SourceClass` grew with `SIM_UNCORROBORATED` [0.10, 0.35] and
  `SIM_CORROBORATED` [0.30, 0.55] — strictly below OSINT_CORROBORATED.
- `EdgeProvenanceEvent.actor` gains `"sim-fish"`; `PromoteEdgeInput.evidence`
  gains `"sim-inference"` (fishCount + dispersion) and `"reviewer-accept"`
  (analystId + citation).
- I-1 preserved: `sim-inference` never promotes over FIELD\_\* or
  OSINT_CORROBORATED (field + reviewer dominance). 18/18 non-regression green.

Demo:

- `pnpm --filter @interview/sweep demo-telemetry` — boots workers, launches
  K=30 swarm on a NIMIQ 5 (SSL-1300), polls to completion, prints the 8-scalar
  distribution table. Live ~8s wall time. Example output at K=30:
  ```
  scalar             median        σ        cv%   severity
  powerDraw         11,000 W       3,412    31%   info
  dataRate           152 Mbps        159   105%   warning (dissent)
  eclipseRatio        2.5 %         3.59   144%   warning (dissent)
  pointingAccuracy  182.5 arcsec     39    22%   info   ← matches SSL-1300 0.05° spec
  ```
- BullMQ 5.x ↔ ioredis 5.x close ordering emits `ERR_OUT_OF_RANGE` on
  `setMaxListeners`; swallowed during demo teardown — purely cosmetic, the
  swarm has already persisted.

Tests: 19 new (14 loader + 5 startTelemetrySwarm).

### TDD pass — `packages/shared` (70/70 tests) — 2026-04-13

All five shared specs covered before touching downstream code. Vitest workspace simplified (`tests/**/*.spec.ts` at package root; `integration/` and `e2e/` as subfolders).

- SPEC-SH-001 `try-async` — 11 tests against existing implementation.
- SPEC-SH-002 `app-error` — 13 tests against existing implementation.
- SPEC-SH-003 `completeness-scorer` — 15 tests. Implementation written from the tests (`src/utils/completeness-scorer.ts`).
- SPEC-SH-004 `domain-normalizer` — 16 tests (NFD diacritic fold, separator normalization, idempotence). Implementation written from the tests (`src/utils/domain-normalizer.ts`). Test examples use SSA vocabulary (Sentinel-2A, Cosmos 2553, ISS Zarya, ENVISAT).
- SPEC-SH-005 `observability` — 15 tests across logger (base bindings, silent in test, dev/prod level, Loki opt-in, redaction) and metrics (default labels, registry isolation, Prometheus text). `pino-pretty` + `pino-loki` added to `@interview/shared` deps.

### SSA (Space Situational Awareness) domain pivot — 2026-04-13

Repo pivoted from its original commercial domain to SSA. Motivation: the CortAIx interview is defense-flavored; SSA is the cleanest critical-system use case that exhibits the full system pattern (dual-stream OSINT × field, HITL, budgeted agents, audit trail, Kessler-cascade consequences).

- **Schema** — `schema/wine.ts` removed. `schema/satellite.ts` is the canonical source: `satellite, operator, operator_country, payload, orbit_regime, platform_class, satellite_bus, satellite_payload` with typed relations. Enum `ResearchCortex` gained 21 SSA keys; `ResearchEntityType` covers satellite / payload / orbit regime / conjunction event / maneuver.
- **Cortices** — 5 new core SSA cortices (`catalog`, `observations`, `conjunction-analysis`, `correlation`, `maneuver-planning`) + 13 analysts/auditors. 4 wine-only skills dropped (sommelier-pairing, seo-strategist, deal-scanner, social-media). `SSA_KEYWORDS` replaces `WINE_KEYWORDS` in guardrails; `SQL_HELPER_MAP` made dynamic.
- **SQL helpers** — 6 renamed (`wine → satellite`, `grape-profiler → payload-profiler`, `terroir → orbit-regime`, `price-context → launch-cost-context`, `user-cellar → user-fleet`, `user-portfolio → user-mission-portfolio`). Audit queries reshaped around regime-mismatch, mass-anomaly, mission-class-inconsistency.
- **Source fetchers** — 6 renamed (ampelography → bus-archetype, chemistry → spectra, climate → space-weather, market → launch-market, terroir → orbit-regime, vintage → celestrak). Storage seed: 30 SSA RSS feeds (CelesTrak, CNEOS, IADC, arxiv astro-ph).
- **Nano-swarm** — 50 researcher lenses remapped to SSA (18SDS, LeoLabs, ESA SDO, BryceTech, SpaceX/OneWeb/Intelsat, Pc/Kp/F10.7). Architecture untouched.
- **Sweep** — wine* files → satellite*, editorial-copilot → briefing-copilot, cdc parser → doctrine parser. Redis prefix `sweep:` unchanged; Redis-key tokens migrated to `satellite-sweep:`.
- **Shared** — `grape-profile.schema.ts` → `payload-profile.schema.ts` with SSA fields (radiometric / optical / rf / thermal / reliability / spaceWeatherSensitivity). `CardCategory` union updated.
- **Result** — zero wine / grape / vintage / appellation / terroir references anywhere in the repo. `packages/shared` tests (70) still green. `packages/db-schema` and `packages/shared` typecheck clean; `packages/thalamus` retains the pre-existing baseline errors tracked under "Build cleanup".

### Specifications — spec-first workflow

Infrastructure:

- `docs/specs/preamble.tex` — shared LaTeX preamble (custom environments: `invariant`, `scenario`, `ac`, `nongoal`; Given/When/Then/And macros; status lifecycle: DRAFT / REVIEW / APPROVED / IMPLEMENTED).
- `docs/specs/template.tex` — reference template for new specs.
- `docs/specs/Makefile` — `make` / `make clean` / `make watch` / `make list` via `latexmk`.
- `docs/specs/README.md` — workflow rules: every module has a spec, every AC has a test, every test carries `@spec <path>` tag, CI gate planned on traceability.

Retroactive specs written in parallel by 10 opus agents (24 total):

`shared/` (5):

- SPEC-SH-001 `try-async` — error-as-value control flow contract.
- SPEC-SH-002 `app-error` — error hierarchy and serialization.
- SPEC-SH-003 `completeness-scorer` — data completeness scoring function.
- SPEC-SH-004 `domain-normalizer` — domain-agnostic string/identifier normalization.
- SPEC-SH-005 `observability` — Pino logger + Prometheus metrics contract (redaction invariant, per-collector registry isolation).

`db-schema/` (2):

- SPEC-DB-001 `schema-contract` — schema stability invariants.
- SPEC-DB-002 `typed-repos` — typed repository pattern.

`thalamus/` (11):

- SPEC-TH-001 `orchestrator` — plan → dispatch → aggregate lifecycle.
- SPEC-TH-002 `cortex-registry` — registration + resolution contract.
- SPEC-TH-003 `cortex-pattern` — invariants every cortex must satisfy.
- SPEC-TH-010 `nano-swarm` — bounded parallel retrieval (≤ 50 × `gpt-5.4-nano`).
- SPEC-TH-011 `source-fetchers` — typed fetcher interface.
- SPEC-TH-012 `curator` — synthesis + deduplication contract.
- SPEC-TH-020 `guardrails` — 5 invariants: non-bypassable, monotonic cost, depth-bounded-by-construction, breach-observable, unverifiable-quarantined.
- SPEC-TH-030 `knowledge-graph-write` — provenance propagation (skill `sha256` carried edge-side).
- SPEC-TH-031 `skills-as-files` — skills as versioned markdown files.
- SPEC-TH-040 `dual-stream-confidence` — OSINT × Field fusion, `source_class ∈ {FIELD_HIGH, FIELD_LOW, OSINT_CORROBORATED, OSINT_UNCORROBORATED}`, confidence bands.
- SPEC-TH-041 `field-correlation` — sub-second p99 SLO (critical 500 ms / routine 2 s / background 10 s), budget split, `LatencyBreach` observable, no drop.

`sweep/` (6):

- SPEC-SW-001 `nano-sweep` — bounded swarm DB audit producer.
- SPEC-SW-002 `finding-routing` — pending buffer dispatch.
- SPEC-SW-003 `resolution` — reviewer-driven HITL apply/reject.
- SPEC-SW-010 `feedback-loop` — reviewer rationale can be reused by next-run prompts.
- SPEC-SW-011 `editorial-copilot` — reviewer-assist flow.
- SPEC-SW-012 `chat-rate-limit` — chat repository rate limits.

Compilation fixes applied to the preamble:

- `\And` collision with other packages — guarded via `\providecommand{\And}{}` + `\renewcommand`.
- `fancyhdr` `\@specID` references moved inside `\makeatletter` / `\makeatother`.
- Added `amsmath` + `amssymb` for `\lceil`, `\rceil`, `\text{}`.
- `lstlisting` UTF-8 handling via `\lstset{inputencoding=utf8, extendedchars=true, literate=...}` covering em-dash, quotes, accented Latin-1, math symbols (`→`, `←`, `×`, `≥`, `≤`, `≠`, `∈`, `⌈`, `⌉`, `∞`, `α`, `β`).
- `observability.tex`: math-mode `\lvert\lvert` inside `\texttt{}` replaced by literal `||`.

Result: all 24 PDFs compile cleanly via `make` in `docs/specs/`.

### Build cleanup

- `tsconfig.base.json` relaxed to match originating monorepo's strictness (`noUncheckedIndexedAccess: false`) — the code was written without that assumption and re-tightening it belongs to a post-interview hardening pass.
- `packages/sweep` missing `package.json` + `tsconfig.json` (to add).
- `packages/shared/src/utils/csv-reader.ts` and `pdf-table-reader.ts` reference missing deps (`csv-parse`, `pdf-parse`) and are unused outside `shared` — slated for removal.
- `packages/db-schema/src/schema/satellite.ts` GIN index uses Drizzle API not present in pinned version — to bump or drop.

## [0.1.0] — 2026-04-13

Initial extraction from a larger production monorepo, trimmed for interview review (Cortex / Thales).

### Added

- pnpm workspace with four packages: `shared`, `db-schema`, `thalamus`, `sweep`
- Root `tsconfig.base.json` with `@interview/*` path aliases
- `vitest.workspace.ts` with unit / integration / e2e projects

### Extracted — `@interview/shared`

- Error primitives: `AppError`, `ValidationError`, `SystemError`, `tryAsync`
- Async/collection/string/JSON utilities
- Domain-agnostic normalizers and HTML entity handling
- Data processing: `column-mapper`, `data-sanitizer`, `completeness-scorer`, `batch-processor`
- Observability: `createLogger`, `MetricsCollector`
- Barrel exports via `src/index.ts`

### Extracted — `@interview/db-schema`

- Drizzle ORM schema (entities, users, research graph, sweep findings, content)
- Typed query helpers kept alongside the schema

### Extracted — `@interview/thalamus`

- Orchestrator + executor (cortex dispatch)
- 11 cortices, each owning skills and SQL helpers
- Explorer subsystem: nano swarm (up to 50 × `gpt-5.4-nano`), scout, curator, crawler
- 20 skill prompts as versioned markdown (`cortices/skills/*.md`)
- 8 typed source fetchers behind a common interface
- Guardrails: cost caps, depth limits, hallucination checks
- Namespace migration: all internal imports rewritten to `@interview/*`

### Extracted — `@interview/sweep`

- Services: `nano-sweep`, `resolution`, `editorial-copilot`, `chat`, `finding-routing`
- Stubs for domain-specific downstream services (decoupled from the original product)
- Controllers: `admin-sweep`, `editorial-copilot`, `chat`
- Admin routes trimmed to sweep-only endpoints
- BullMQ queues, schedulers, workers trimmed to sweep-only jobs
- Redis finding repository with feedback-loop persistence
- Rate-limited chat repository with finding history

### Changed

- Domain-specific identifiers removed from code, docs, and config
- All `@/*` and relative cross-package imports rewritten to `@interview/*`

### Infrastructure stubs

- Redis client stub
- Auth middleware stub
- Messaging (email/notification) stub
- Dependency injection container scaffolding
