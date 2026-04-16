1. [satellite.repository.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts) — **CORRECT**
- Line count: **CONFIRM** (`1319`).
- Business-concept inventory/ranges: **CORRECT**.
  - Most anchors match (e.g. `findByName` 142, `findOrbitRegimeGeometry` 361-444, `nullScanByColumn` 1194-1290, `findSatelliteIdsWithNullColumn` 1292+).
  - Fix 1: “Sweep corrections writeback table” is wrong in doc. `applyCorrections` updates `satellite.profile_metadata` (not `operator_country.profile_metadata`) at [satellite.repository.ts:711](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts:711)-[satellite.repository.ts:717](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts:717).
  - Fix 2: “Reference-taxonomy CRUD” (L488-520) is overstated; this block is lookup + insert for some refs, not full CRUD for all listed concepts ([satellite.repository.ts:488](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts:488)-[satellite.repository.ts:520](/home/jerem/interview-thalamus-sweep/packages/sweep/src/repositories/satellite.repository.ts:520)).
- Caller list (grep importers): **CORRECT**.
  - “6 sites” is accurate for direct imports/re-export.
  - But per-caller concept tags in the sentence are off: `nano-sweep.service` uses F-only APIs (`nullScanByColumn`, `getOperatorCountrySweepStats`) and `sweep-resolution.service` mainly uses `update` ([nano-sweep.service.ts:248](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/nano-sweep.service.ts:248), [nano-sweep.service.ts:330](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/nano-sweep.service.ts:330), [sweep-resolution.service.ts:655](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts:655)).
- Method anchors: **CONFIRM** (all listed declaration lines match).
- Verdict (`SPLIT`): **CONFIRM** (defensible; genuinely multiple bounded concerns in one class).

2. [sweep-resolution.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts) — **CORRECT**
- Line count: **CONFIRM** (`822`).
- Business-concept anchors: **CONFIRM** (`resolve` 73-203, `dispatchAction` 259-284, handlers and helpers at listed lines).
- Caller list (grep importers): **CORRECT**.
  - Doc has no explicit caller list; actual importers include [index.ts:3](/home/jerem/interview-thalamus-sweep/packages/sweep/src/index.ts:3), [container.ts:19](/home/jerem/interview-thalamus-sweep/packages/sweep/src/config/container.ts:19), [admin-sweep.controller.ts:8](/home/jerem/interview-thalamus-sweep/packages/sweep/src/controllers/admin-sweep.controller.ts:8).
- Method anchors: **CONFIRM** (all listed anchors match).
- Verdict (`KEEP`, optional tail extraction): **CORRECT**.
  - KEEP is defensible.
  - Fix: optional extraction “selectors → operator-country.repository.ts” is only partly coherent; `findPayloadsByName` is payload-domain ([sweep-resolution.service.ts:599](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/sweep-resolution.service.ts:599)). Better split into reference-lookup surface, not operator-country-only.

3. [nano-swarm.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-swarm.ts) — **CORRECT**
- Line count: **CONFIRM** (`777`).
- Business-concept inventory/ranges: **CORRECT**.
  - `RESEARCHER_LENSES` range is right ([nano-swarm.ts:37](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-swarm.ts:37)-[nano-swarm.ts:257](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/nano-swarm.ts:257)).
  - “~60% static array” is wrong by lines: 221/777 ≈ 28.4%.
- Caller list (grep importers): **CORRECT**.
  - Doc has no caller list; direct production usage is through [orchestrator.ts:6](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/orchestrator.ts:6) and re-export [explorer/index.ts:5](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/explorer/index.ts:5) (plus tests).
- Method anchors: **CONFIRM** for cited ones (`decompose` 295+, wave execution around 589+, `mergeResults` 618+).
- Verdict (`KEEP`): **CONFIRM** (defensible).

4. [executor.ts](/home/jerem/interview-thalamus-sweep/packages/thalamus/src/cortices/executor.ts) — **CONFIRM**
- Line count: **CONFIRM** (`693`).
- Business-concept inventory/ranges: **CONFIRM**.
  - A/B/C/D anchors align (`execute` 84-281, `webSearchFallback` 383-480, `preSummarize` 492-622, `normalizeFinding` 644-680, `validateEnum/clamp` 682-693).
- Caller list (grep importers): **CONFIRM** (doc didn’t claim one; importers include container/service/index/tests).
- Method anchors: **CONFIRM**.
- Verdict (`EXTRACT-TAIL`): **CONFIRM** (defensible; `preSummarize` and web fallback are separable tails without breaking executor lifecycle cohesion).

5. [sim/promote.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/promote.ts) — **DISPUTE**
- Line count: **CONFIRM** (`592`).
- Business-concept inventory/ranges: **CONFIRM** (anchors all match).
- Caller list: **DISPUTE**.
  - Claim “4 non-barrel sites” is incorrect.
  - Counter-evidence:
    - Direct importers are [turn-runner-sequential.ts:20](/home/jerem/interview-thalamus-sweep/packages/sweep/src/sim/turn-runner-sequential.ts:20) plus barrel [index.ts:72](/home/jerem/interview-thalamus-sweep/packages/sweep/src/index.ts:72).
    - `swarm-aggregate.worker.ts` does not import `promote.ts`; it accepts callback deps only ([swarm-aggregate.worker.ts:41](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts:41)).
    - Demo/e2e import from `@interview/sweep` barrel, not from `sim/promote.ts` ([telemetry-swarm.ts:23](/home/jerem/interview-thalamus-sweep/packages/sweep/src/demo/telemetry-swarm.ts:23), [swarm-uc3.e2e.spec.ts:36](/home/jerem/interview-thalamus-sweep/packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts:36)).
- Method anchors: **CONFIRM**.
- Verdict (`SPLIT`): **CONFIRM** (defensible; UC3 KG flow and telemetry-scalar emission are separable domains).

6. [nano-sweep.service.ts](/home/jerem/interview-thalamus-sweep/packages/sweep/src/services/nano-sweep.service.ts) — **CORRECT**
- Line count: **CONFIRM** (`537`).
- Business-concept inventory/ranges: **CONFIRM** (anchors match; `nullScanSweep` 244-323, `buildBriefingRequest` 430-465, validators 524+).
- Caller list: **CORRECT**.
  - Doc says 4 sites; actual is at least 5 files because `sweep.worker.ts` lazily imports and instantiates `NanoSweepService` ([sweep.worker.ts:18](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sweep.worker.ts:18), [sweep.worker.ts:26](/home/jerem/interview-thalamus-sweep/packages/sweep/src/jobs/workers/sweep.worker.ts:26)).
- Method anchors: **CONFIRM**.
- Verdict (`SPLIT`): **CONFIRM** (defensible; `nullScan` path is deterministic and operationally distinct from LLM sweep/briefing path).

**Key disagreements**
1. `satellite.repository.ts` section misstates writeback target table (`satellite.profile_metadata`, not `operator_country.profile_metadata`).
2. `nano-swarm.ts` “~60% static data” is materially off by line count (~28%).
3. `sim/promote.ts` caller list is wrong about “4 non-barrel sites.”
4. `nano-sweep.service.ts` caller list omits `sweep.worker.ts` dynamic import site.

**Strongest finding the author missed**
- `applyCorrections` mutates `satellite.profile_metadata` in-place; this is a high-impact domain boundary clue and was attributed to the wrong table.
- `sim/promote.ts` is mostly consumed through barrel export/callback wiring, so refactor blast radius is API-surface sensitive, not just local “4 callers.”
- `NanoSweepService` is used in a lazy worker path, so any split must preserve dynamic-import compatibility for background jobs.
