No session skill applied; this audit does not match `skill-creator` or `skill-installer`.

1. **Test organization**
- Root split is configured correctly: unit includes all `packages/*/tests/**/*.spec.ts` except `integration`/`e2e`, with dedicated integration/e2e projects ([vitest.workspace.ts](/home/jerem/interview-thalamus-sweep/vitest.workspace.ts#L62), [vitest.workspace.ts](/home/jerem/interview-thalamus-sweep/vitest.workspace.ts#L74), [vitest.workspace.ts](/home/jerem/interview-thalamus-sweep/vitest.workspace.ts#L83)). Scripts align (`test:unit`, `test:integration`, `test:e2e`) ([package.json](/home/jerem/interview-thalamus-sweep/package.json#L10)).
- `sweep`: folder placement is coherent for existing files (`unit` + one real `e2e`) ([telemetry-swarm.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/unit/telemetry-swarm.spec.ts#L1), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L1)). `integration/` is empty ([sweep integration dir](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/integration)).
- `thalamus`: all specs are top-level under `tests/`, so they run in the **unit** project; `tests/unit`, `tests/integration`, `tests/e2e` are empty ([thalamus tests dir](/home/jerem/interview-thalamus-sweep/packages/thalamus/tests), [thalamus integration dir](/home/jerem/interview-thalamus-sweep/packages/thalamus/tests/integration)).
- Classification mismatch signal: several thalamus specs explicitly defer real behavior to integration tests, but those integration tests do not exist yet ([source-fetchers.spec.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/tests/source-fetchers.spec.ts#L6), [source-fetchers.spec.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/tests/source-fetchers.spec.ts#L96), [nano-swarm.spec.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/tests/nano-swarm.spec.ts#L7), [curator.spec.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/tests/curator.spec.ts#L7)).

2. **Fixture reuse (`packages/sweep/tests/fixtures`)**
- Only one fixture file exists: [`_swarm_fallback.json`](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/fixtures/_swarm_fallback.json#L1).
- It is consumed by one spec via env fallback naming (`FALLBACK = "_swarm_fallback"`), not reused elsewhere ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L59), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L79)).
- No evidence of a shared fixture being bypassed by inline duplicates in other files.
- Minor intra-file drift risk: repeated inline satellite row literals in unit test (`mockDb` calls) could diverge over time ([telemetry-swarm.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/unit/telemetry-swarm.spec.ts#L46), [telemetry-swarm.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/unit/telemetry-swarm.spec.ts#L132)).

3. **Setup/teardown duplication (counts)**
- `pg-mem` / `newDb(`: **0**
- `ioredis-mock`: **0**
- `buildSweepContainer(`: **1** ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L100))
- `new IORedis(` + `setRedisClient(`: **1 each** ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L83), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L84))
- Seed/reset sequence (`cleanE2E` + `seedOperators` + queue drain): centralized inside one e2e file ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L95), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L98), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L490))
- BullMQ queue clear calls are centralized in one helper (`simTurnQueue`, `swarmFishQueue`, `swarmAggregateQueue`) ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L492)).

4. **Golden/snapshot dependencies**
- No snapshot assertions (`toMatchSnapshot` / file snapshots) in scoped tests.
- No prompt/LLM/SQL golden files referenced by 2+ tests.
- Only fallback JSON fixture is referenced, and only by one e2e spec (no duplication).

5. **Missing shared helpers**
- No strong N≥2 cross-file setup primitive in scope that clearly demands a shared helper today.
- Best next helper (once adding more e2e specs): extract the current swarm harness (`beforeAll` infra boot + cleanup + seeding + drains) into `packages/sweep/tests/helpers/swarm-e2e-harness.ts` from this file’s setup/helpers ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L75), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L361)).
- SatelliteRepository + pg-mem helper: not applicable yet (no such tests in scope).

6. **Test-file size outliers**
- Outlier found: [`swarm-uc3.e2e.spec.ts`](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L1) at **500 lines**.
- It spans at least 4 concerns: infra boot/teardown, UC3 swarm completion, suggestion emission/inbox, KG audit trail ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L75), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L153), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L255), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L313)).
- Recommendation: split by business concept into separate specs sharing one harness.

7. **Cross-package duplication + refactor migration impact**
- Direct cross-package overlap is limited.
- One sweep e2e assertion checks thalamus skill discovery (`CortexRegistry` + `sim_operator_agent` presence), which is arguably thalamus responsibility but acceptable as sweep runtime precondition ([swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L34), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L89)).
- For planned splits in [`god-files.md`](/home/jerem/interview-thalamus-sweep/docs/refactor/god-files.md#L9):
  - `satellite.repository` → 4 files: no scoped tests directly target repository methods now; migration mostly means **adding** integration tests per extracted repo ([god-files.md](/home/jerem/interview-thalamus-sweep/docs/refactor/god-files.md#L32)).
  - `sim/promote` → `kg-promotion` + `telemetry-inference-emission`: existing sweep e2e assertions from modal/suggestion/KG should align to `kg-promotion`; there is currently no dedicated telemetry-emission test, so add one under `sweep/tests/integration` ([god-files.md](/home/jerem/interview-thalamus-sweep/docs/refactor/god-files.md#L136), [swarm-uc3.e2e.spec.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts#L255)).
  - `nano-sweep.service` → `nano-sweep` + `null-scan-sweep`: no scoped test currently covers this split path; add targeted tests as the service is split ([god-files.md](/home/jerem/interview-thalamus-sweep/docs/refactor/god-files.md#L173)).
