# Todo — Test Remediation

Master plan: `docs/superpowers/specs/2026-04-21-test-remediation-master-plan.md`

Current branch: `feat/test-strategy`

## Sub-projects

### SP-0 — CI bedrock (landed)

- [x] `scripts/test-policy-check.ts` AST enforcer
- [x] `.githooks/pre-commit` runs `pnpm test:policy`
- [x] `.github/workflows/arch-check.yml` runs policy + spec check
- [x] `Makefile` exposes `make test-policy`
- [x] `docs/testing/README.md` documents the contract
- [x] detailed spec
- [x] `.github/workflows/test.yml` matrix (unit / integration / e2e)
- [x] provision `postgres` + `redis` in CI
- [x] `vitest.workspace.ts` integration project filter → `apps/console-api/tests/integration/**`
- [x] `pnpm test:integration` fails loudly on zero tests (`--passWithNoTests=false`)
- [x] policy gate fires against every current spec

### SP-1 — Critical bug locks (landed)

- [x] cycle-runner defensive copy (real happy-path projection)
- [x] mission-service status=filled → unobtainable on out-of-range
- [x] aggregator-pc via `turnActionSchema.parse`
- [x] runtime-config hot-reload false claim removed instead of faked
- [x] detailed spec
- [x] guardrails.ts invalid JSON truncation lock + fix
- [x] dual-stream-confidence class ordering lock + fix
- [x] sweep arch-guard runs real dep-cruise
- [x] enrichment-findings E2E no longer short-circuits on `filled===0`
- [x] runtime-config-cycle.bdd split into visible per-test skips
- [x] telemetry-swarm uses real HTTP

### SP-5 — Type + arch guardrails (landed)

- [x] `typedSpy<Fn>()` helper invented in `__fixtures.ts` (7 importers)
- [x] derive detailed spec
- [x] promote helper to shared `test-kit/`
- [x] `fakeRepo<T>()`, `fakePort<T>()`, `parseFixture<S>()`, `stubLogger()`, `stubNanoCaller()`, `stubCortexLlm()`
- [x] policy ban on `as never` / `as unknown as` in tests + grandfather list
- [x] sweep arch-guard real `dep-cruise` invocation
- [x] CLAUDE.md boundary test (`packages/* → apps/*` forbidden)

### SP-2 — Thalamus test rewrite (landed after rebaseline)

- [x] cortex-pattern (real CortexDataProvider fake, no .skip)
- [x] knowledge-graph-write (+670L, typed FindingsGraphPort fakes)
- [x] dedicated SP-2 design doc
- [x] llm-json-parser — markdown fences, trailing commas, unterminated strings
- [x] embedder-port / source-fetcher-port contract suites
- [x] field-correlation AC-5 realigned to the shipped behavior
- [x] skills-as-files split so thalamus no longer reads SSA app files
- [x] standard-strategy-source-port rewritten without cast drift
- [x] `nano-swarm` gap closed later in SP-3 and documented accordingly

### SP-3 — SSA explorer + cross-layer rewrite (landed)

- [x] reflexion / repl-chat / repl-followup / repl-turn / mission / cycle-runner / aggregator-pc / source-fetchers / audit-provider suite
- [x] 13 controllers boot real routes via `registerXxxRoutes`
- [x] server-banner.test.ts (new), finding-view.service.test.ts
- [x] dedicated SP-3 design doc
- [x] explorer unit coverage: scout / crawler / curator / orchestrator / satellite-entity-patterns
- [x] `packages/thalamus/tests/nano-swarm.spec.ts`
- [x] `ExplorationRepository` integration coverage
- [x] remaining SSA cast-drift sites touched by this slice removed

### SP-4 — Repository integration (landed after rebaseline)

- [x] dedicated SP-4 design doc
- [x] shared migrated harness at `apps/console-api/tests/integration/_harness.ts`
- [x] integration specs for every runtime-backed `console-api` repository
- [x] `pnpm test:integration` green on the shared harness
- [x] `user-fleet.repository.ts` explicitly carved out as an orphaned non-migrated seam instead of being hidden behind fake fixtures

### SP-6 — E2E hardening (landed after rebaseline)

- [x] dedicated SP-6 design doc
- [x] conjunctions e2e hardened on current contract: list filter + screen limit/filter + empty-result
- [x] sweep-mission e2e shifted to positive task-materialisation paths + one negative guardrail
- [x] runtime-config-contract.e2e.spec.ts uses per-domain key assertions
- [x] e2e lure audit: no root `describe.skipIf`, no `.stub.spec.ts` files left in `apps/console-api/tests/e2e`

## Remaining master-level work

- [x] burn down `scripts/test-policy-grandfather.json` from `57` cast sites to `0`
- [x] sync the master plan narrative so the top-level progress table matches the landed SP docs
- [x] close the master plan once §5 acceptance is true on the remediation branch and ready it for merge onto `main`
