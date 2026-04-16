# God files — refactor prep

Principle: **l'abstraction s'arrête toujours au métier.** Split only on domain boundaries, never on technical layers.

Source: [\_depcruise.json](./_depcruise.json) · [\_depcruise-summary.md](./_depcruise-summary.md).

---

## 1. [satellite.repository.ts](../../packages/sweep/src/repositories/satellite.repository.ts) — 1319 lines

### Business concepts

Schema ref: [satellite.ts](../../packages/db-schema/src/schema/satellite.ts).

| #   | Concept                                                                    | Methods (lines)                                                                                                                                                                                                                                                                       | Tables                                                  |
| --- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| A   | **Identity resolution**                                                    | `findByName` L142, `findByExactMatch` L169, `findByVector` L201-232, `batchExactMatch` L234-284, `findById` L286, `findSatelliteByName` L295, `slugExists` L312                                                                                                                       | `satellite`, embeddings                                 |
| B   | **Operator-country reference**                                             | `findOperatorCountry` L323, `findOperatorCountryGeometry` L340, `findOrbitRegimeGeometry` L361-448, `findDominantOperatorCountryForOperator` L450, `findAllOperatorCountries` L480, doctrine L539-568, `insertOperatorCountry` L522                                                   | `operator_country`, `orbit_regime`                      |
| C   | **Reference-taxonomy CRUD** (operator/payload/orbit-regime/platform-class) | L488-520                                                                                                                                                                                                                                                                              | `operator`, `payload`, `orbit_regime`, `platform_class` |
| D   | **Bus telemetry prior** (14D datasheet)                                    | `findFrequentBus` L570, `getBusTelemetry` L593, telemetry helpers L26-62                                                                                                                                                                                                              | `satellite_bus`                                         |
| E   | **Ingest / bulk write**                                                    | `insertSatellitesWithPayloads` L608-657                                                                                                                                                                                                                                               | `satellite`, `satellite_payload`                        |
| F   | **Data-quality audit** (null/mismatch for NanoSweep)                       | `findNullOperatorCountrySatellites` L659, `findByNamePatternMismatch` L675, `findSatellitesWithPayloadsByOperatorCountry` L730, `getOperatorCountrySweepStats` L765-855, `discoverNullableScalarColumns` L1148, `nullScanByColumn` L1194-1290, `findSatelliteIdsWithNullColumn` L1292 | `satellite`, `information_schema`                       |
| G   | **Sweep corrections writeback**                                            | `applyCorrections` L700-728                                                                                                                                                                                                                                                           | `operator_country.profile_metadata.corrections`         |
| H   | **Satellite read/write API**                                               | `findAllPaginated` L857-971, `findByIdWithDetails` L973, `findByIdFull` L998-1093, `update` L1095, `archive` L1118                                                                                                                                                                    | `satellite`                                             |

### Verdict: **SPLIT**

Seven distinct domains under one class. F, G and B are separate subdomains of the catalog.

### Proposed split (domain-named)

- `satellite-catalog.repository.ts` ← **A + H + E** (the "SSA catalog" domain)
- `operator-country.repository.ts` ← **B + C** (reference vocabulary; geometry & doctrine are operator-country attributes)
- `satellite-bus-telemetry.repository.ts` ← **D** (14D bus datasheet prior — consumed by sim-fish)
- `data-quality-audit.repository.ts` ← **F + G** (NanoSweep-facing surface)

### Callers (6 sites)

[sweep/index.ts](../../packages/sweep/src/index.ts) (re-export), [nano-sweep.service.ts](../../packages/sweep/src/services/nano-sweep.service.ts) (F,B), [sweep-resolution.service.ts](../../packages/sweep/src/services/sweep-resolution.service.ts) (A, H.update), [satellite-sweep-chat.service.ts](../../packages/sweep/src/services/satellite-sweep-chat.service.ts), [sweep.worker.ts](../../packages/sweep/src/jobs/workers/sweep.worker.ts), [container.ts](../../packages/sweep/src/config/container.ts).

### Migration order

1. Extract **D** (bus telemetry). Smallest, unblocks sim-fish.
2. Extract **F + G** → `data-quality-audit.repository.ts`. Isolates information_schema ugliness.
3. Extract **B + C** → `operator-country.repository.ts`. Biggest clarity gain.
4. Residual renamed → `satellite-catalog.repository.ts`.

---

## 2. [sweep-resolution.service.ts](../../packages/sweep/src/services/sweep-resolution.service.ts) — 822 lines

### Verdict: **KEEP** (single-concept, optional EXTRACT-TAIL)

Entire file revolves around ONE domain verb: **"apply an accepted sweep suggestion"**. Handlers dispatch by `action.kind` (`update_field`, `link_payload`, `unlink_payload`, `reassign_operator_country`, `enrich`) — each a variant of the same reviewer-accepted mutation. Audit, KG promotion, sim-provenance are tail-effects of the same lifecycle.

Anchors: `resolve` L73-203, `writeAudit` L210-255, `dispatchAction` L259-284, `handleUpdateField` L288-381, `handleLinkPayload/Unlink` L383-485, `handleReassignOperatorCountry` L487-545, `handleEnrich` L547-578, selectors L582-776, `logToKnowledgeGraph` L780-821.

Per the rule, do NOT split into `types.ts / handlers.ts / helpers.ts`. Handlers share the ambiguity-resolution (`PendingSelection`) protocol.

**Optional EXTRACT-TAIL:**

1. Name-resolution selectors (`findPayloadsByName` L599, `findOperatorCountriesByName` L614, `resolveAndUpdate` L701-776) → move to new `operator-country.repository.ts` (§1). They only exist here because the catalog repo lacks a `searchByName` API.
2. `logToKnowledgeGraph` L780-821 → tail into a _different_ bounded context (Thalamus research graph). Could move to `sweep-kg-bridge.ts`; keeping it is also defensible.

### Migration order

After §1 step 3 lands, move name selectors into `operator-country.repository.ts`. Zero risk. Do NOT touch handlers.

---

## 3. [nano-swarm.ts](../../packages/thalamus/src/explorer/nano-swarm.ts) — 777 lines

### Verdict: **KEEP** (single-concept, just large)

~60% is the static `RESEARCHER_LENSES` array L37-257 — **data**, not logic. Rest is a single pipeline: decompose → wave-execute → merge. That pipeline _is_ the business concept ("the Constellation").

Splitting into `decomposer.ts / caller.ts / merger.ts` = technical-layer split = violates the rule.

**Only defensible extraction** (if another swarm ever needs its own catalog): move `RESEARCHER_LENSES` → sibling `nano-swarm-lenses.ts`. Until then, colocated data is correct.

---

## 4. [executor.ts](../../packages/thalamus/src/cortices/executor.ts) — 693 lines, fan-out 10

### Business concepts

| #   | Concept                                                                          | Anchors                                                                                                               |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| A   | **Cortex execution lifecycle** (dispatch → SQL → sources → web → LLM → findings) | `CortexExecutor.execute` L84-281, `runSqlHelper` L313-376, `runSkillFreeform` L291                                    |
| B   | **Web-search fallback** (per-cortex prompts)                                     | `webSearchFallback` L383-480, `CORTEX_SEARCH_PROMPTS` L392-428                                                        |
| C   | **Pre-summarization** (SQL rows → LLM insights, per-cortex)                      | `preSummarize` L492-622 (ApogeeTracker, FleetAnalyst, AdvisoryRadar, ClassificationAuditor, PayloadProfiler branches) |
| D   | **Finding normalization**                                                        | `normalizeFinding` L644-680, `validateEnum` / `clamp` L682-693                                                        |

### Verdict: **EXTRACT-TAIL**

A is the cohesive concept. B and C leak out:

- **B**: per-cortex search prompts = _sources_ concern → belongs in `cortices/sources/`.
- **C**: per-cortex analytical templates (mission-health signals, severity groups) = per-cortex domain logic → own file.

### Proposed

- `cortices/sources/web-fallback.ts` ← B (consolidates with sources pipeline)
- `cortices/summarizers.ts` ← C (or split per-cortex if branches keep growing)
- Residual executor stays A + D (~350 lines)

### Migration order

1. Extract `preSummarize` (C) — already exported, already branch-per-cortex. Biggest readability gain.
2. Extract `webSearchFallback` (B).

---

## 5. [sim/promote.ts](../../packages/sweep/src/sim/promote.ts) — 592 lines

### Business concepts

| #   | Concept                                                                              | Anchors                                                                                                                     |
| --- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| A   | **Promotability predicates**                                                         | `isKgPromotable` L38, `isTerminal` L42                                                                                      |
| B   | **Sim-turn fetch**                                                                   | `loadSimTurn` L51-60                                                                                                        |
| C   | **UC3 swarm-modal promotion** (→ research_cycle + finding + edge + sweep_suggestion) | `emitSuggestionFromModal` L82-295, `actionTarget/composeTitle/composeDescription/describeAction` L301-367, `safeEmbed` L369 |
| D   | **Telemetry-swarm scalar promotion** (per-scalar, NULL-guarded, CV-graded)           | `emitTelemetrySuggestions` L406-543, `findNullTelemetryColumns` L545, `scoreScalar` L568, `round` L589                      |

### Verdict: **SPLIT**

C and D are two distinct flows with non-overlapping vocabulary:

- **C** = UC3 conjunction-negotiation swarm → KG + suggestion. Consumes `SwarmAggregate`. Writes `research_finding` with `cortex=ConjunctionAnalysis`.
- **D** = SPEC-TH-040 telemetry-inference swarm → N sweep_suggestions. Consumes `TelemetryAggregate` (per-scalar median/σ). Writes NO `research_finding`. Severity from CV, source_class `SIM_UNCORROBORATED`.

Share only the output table + logger.

### Proposed

- `sim/kg-promotion.ts` ← **A + B + C** (UC3 swarm-modal → reviewer inbox + KG). A defines the C gate.
- `sim/telemetry-inference-emission.ts` ← **D** (per-scalar inference → enrichment suggestion).

### Callers (4 non-barrel sites)

[turn-runner-sequential.ts](../../packages/sweep/src/sim/turn-runner-sequential.ts) L20 (`isTerminal`), [swarm-aggregate.worker.ts](../../packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts), [demo/telemetry-swarm.ts](../../packages/sweep/src/demo/telemetry-swarm.ts), [swarm-uc3.e2e.spec.ts](../../packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts). Trivial.

### Migration order

1. Extract D first (`telemetry-inference-emission.ts`). Self-contained — only shares logger with C.
2. Rename residual → `kg-promotion.ts`.

---

## 6. [nano-sweep.service.ts](../../packages/sweep/src/services/nano-sweep.service.ts) — 537 lines

### Business concepts

| #   | Concept                                                                            | Anchors                                                                                                                       |
| --- | ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| A   | **LLM data-quality sweep** (nano waves, feedback loop, 5 issue categories)         | `sweep` L131-225, `gatherOperatorCountryData` L327, `buildNanoRequest` L355-422, `parseSuggestions` L469-519, validators L524 |
| B   | **Deterministic null-scan** (no LLM, information_schema, GCAT/CelesTrak citations) | `nullScanSweep` L244-323, `backfillCitationFor` L44-79                                                                        |
| C   | **Briefing mode** (editorial prompt)                                               | `buildBriefingRequest` L430-465                                                                                               |

### Verdict: **SPLIT**

A and B are materially different. File itself documents this: _"Deterministic null-scan path: no LLM, no nano waves."_ Only the `sweep()` entry bridges them at L139.

- **A** = probabilistic LLM audit.
- **B** = deterministic schema-introspection audit.

Mixing creates god class where `sweep("dataQuality")` and `sweep("nullScan")` share nothing but result shape. `backfillCitationFor` is pure B territory but sits at top.

C extends A (same prompt machinery, different system prompt) — stays with A.

### Proposed

- `nano-sweep.service.ts` residual ← **A + C**. Keeps `SweepMode = "dataQuality" | "briefing"`.
- `null-scan-sweep.service.ts` ← **B**. Imports narrower `data-quality-audit.repository.ts` (§1).
- Controller chooses service by mode; in-service branch deleted.

### Callers (4 sites)

[sweep/index.ts](../../packages/sweep/src/index.ts), [admin-sweep.controller.ts](../../packages/sweep/src/controllers/admin-sweep.controller.ts), [container.ts](../../packages/sweep/src/config/container.ts), [finding-routing.ts](../../packages/sweep/src/services/finding-routing.ts).

### Migration order

1. §1 step 2 first (extract `data-quality-audit.repository.ts`).
2. Extract `NullScanSweepService` with `backfillCitationFor` (~100 lines, self-contained).
3. Controller learns 2-way dispatch; internal branch deleted.

---

## Global risk-ordered sequence

1. `satellite-bus-telemetry.repository.ts` (§1.1) — zero breakage, unblocks sim-fish.
2. `data-quality-audit.repository.ts` (§1.2) — prereq for §6.
3. `sim/telemetry-inference-emission.ts` (§5.1) — separates SPEC-TH-040 from UC3.
4. `cortices/summarizers.ts` (§4.1).
5. `operator-country.repository.ts` (§1.3) — unlocks §2 selectors.
6. `null-scan-sweep.service.ts` (§6).
7. `cortices/sources/web-fallback.ts` (§4.2).
8. §2 tail extraction — opportunistic.
9. **Never**: splitting nano-swarm.ts or sweep-resolution handlers.
