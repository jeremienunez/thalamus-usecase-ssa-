# Todo — Test Remediation

Master plan: `docs/superpowers/specs/2026-04-21-test-remediation-master-plan.md`

Current branch: `feat/test-strategy` (unstaged: +3287/-1425 across 69 files).

## Sub-projects

### SP-0 — CI bedrock (~40 % done)

- [x] `scripts/test-policy-check.ts` AST enforcer
- [x] `.githooks/pre-commit` runs `pnpm test:policy`
- [x] `.github/workflows/arch-check.yml` runs policy + spec check
- [x] `Makefile` exposes `make test-policy`
- [x] `docs/testing/README.md` documents the contract
- [ ] derive detailed spec
- [ ] `.github/workflows/test.yml` matrix (unit / integration / e2e)
- [ ] provision `postgres:16` + `redis:7` in CI
- [ ] fix `vitest.workspace.ts` integration project filter → `apps/console-api/tests/integration/**`
- [ ] `pnpm test:integration` fails loudly on zero tests (`--passWithNoTests=false`)
- [ ] verify policy gate fires against every spec (fix `runtime-config-cycle.bdd.spec.ts` .todo blocks)

### SP-1 — Critical bug locks (~35 % done)

- [x] cycle-runner defensive copy (real happy-path projection)
- [x] mission-service status=filled → unobtainable on out-of-range
- [x] aggregator-pc via `turnActionSchema.parse`
- [~] runtime-config-cortex stub — partial; remove hot-reload claim or prove it
- [ ] derive detailed spec
- [ ] guardrails.ts:152 JSON-slice invalid JSON (re-prove + fix)
- [ ] dual-stream-confidence class ordering (re-prove + fix + all 6 classes)
- [ ] sweep arch-guard actually runs dep-cruise
- [ ] enrichment-findings E2E `filled===0` short-circuit
- [ ] runtime-config-cycle.bdd split LLM-gated vs contract
- [ ] telemetry-swarm inject → real HTTP

### SP-5 — Type + arch guardrails (~15 % done)

- [x] `typedSpy<Fn>()` helper invented in `__fixtures.ts` (7 importers)
- [ ] derive detailed spec
- [ ] promote helper to shared `test-kit/`
- [ ] `fakeRepo<T>()`, `fakePort<T>()`, `parseFixture<S>()`, `stubLogger()`, `stubNanoCaller()`, `stubCortexLlm()`
- [ ] ESLint ban on `as never` / `as unknown as` in tests + grandfather list
- [ ] sweep arch-guard real `dep-cruise` invocation
- [ ] CLAUDE.md boundary test (`packages/* → apps/*` forbidden)

### SP-2 — Thalamus test rewrite (~20 % done)

- [x] cortex-pattern (real CortexDataProvider fake, no .skip)
- [x] knowledge-graph-write (+670L, typed FindingsGraphPort fakes)
- [~] nano-swarm deleted — need replacement coverage decision
- [ ] derive detailed spec
- [ ] dual-stream-confidence (overlaps SP-1)
- [ ] guardrails (overlaps SP-1)
- [ ] llm-json-parser — add markdown fences, trailing commas, unterminated strings
- [ ] embedder-port / source-fetcher-port — test real adapter, not just null/noop
- [ ] field-correlation — fix `promote` vs `demote` title mismatch (AC-5)
- [ ] logger — test real `createLogger`, not inline import("pino")
- [ ] skills-as-files — move out of thalamus/ (references `apps/console-api/src/agent/ssa/skills`, boundary violation)
- [ ] standard-strategy-source-port + ingestion-registry — test real registry

### SP-3 — SSA / console-api rewrite (~60 % done)

- [x] reflexion / repl-chat / repl-followup / repl-turn / mission / cycle-runner / aggregator-pc / source-fetchers / audit-provider suite
- [x] 13 controllers boot real routes via `registerXxxRoutes`
- [x] server-banner.test.ts (new), finding-view.service.test.ts
- [~] curator.test.ts + orchestrator.test.ts deleted — need replacement decision
- [ ] derive detailed spec
- [ ] remove ~60 `service as never` in controllers (via SP-5 helpers)
- [ ] verify runtime-config.service.test.ts rewrite against schema drift
- [ ] finish any unit specs not yet surveyed

### SP-4 — Repository integration (~4 % done)

- [x] satellite repo: 125→508L, live Pool + temp-schema harness
- [ ] derive detailed spec
- [ ] promote satellite harness to `apps/console-api/tests/integration/_harness.ts`
- [ ] integration specs for 27 remaining repos
- [ ] depends on SP-0 PG service + SP-5 harness primitives

### SP-6 — E2E hardening (0 % done)

- [ ] derive detailed spec
- [ ] conjunctions.spec.ts — pagination, filter, empty-result
- [ ] sweep-mission.spec.ts — positive path + one negative
- [ ] runtime-config-contract.e2e.spec.ts:90 — per-domain key assertions
- [ ] audit `.stub.spec.ts` / `.bdd.spec.ts` lures: real or delete

## Ordering

```
SP-0 finish → SP-1 finish → SP-5 → { SP-2 tail, SP-3 tail, SP-4, SP-6 } (parallel)
```

## Master-level acceptance

§5 of the master plan. Do not close this todo until all 9 criteria hold on `main`.
