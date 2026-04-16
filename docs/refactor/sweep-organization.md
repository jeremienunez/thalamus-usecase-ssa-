# Sweep — intra-file organization audit

Scope: `packages/sweep/src/**/*.ts`. Complements [god-files.md](./god-files.md) (cross-file splits) and [duplication.md](./duplication.md) (cross-package merges).

---

## 1. Mixed-responsibility offenders

| File                                                                                                                                                                                                                    | Mixed concerns                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Proposed split                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [config/container.ts](../../packages/sweep/src/config/container.ts#L81-L177)                                                                                                                                            | DI wiring + domain primitive `telemetryEdgeId` FNV-1a [L190-198](../../packages/sweep/src/config/container.ts#L190-L198) + inline business-hook closure (sim→confidence promotion [L131-153](../../packages/sweep/src/config/container.ts#L131-L153)) + hardcoded provenance citation template [L150](../../packages/sweep/src/config/container.ts#L150)                                                                                                                      | Hoist to `sim/sim-confidence-promotion.ts` — one export `wireSimAcceptToConfidence(deps)`. Container → pure wiring                                                         |
| [services/nano-sweep.service.ts](../../packages/sweep/src/services/nano-sweep.service.ts)                                                                                                                               | (a) 2 prompts inlined L377-407, L432-452; (b) domain table `backfillCitationFor` L44-79 (GCAT/CelesTrak); (c) 2 enum validators L524-537 duplicating [sweep.dto.ts L10-24](../../packages/sweep/src/transformers/sweep.dto.ts#L10-L24); (d) `nullScanSweep` L244-323 (already god-files §6)                                                                                                                                                                                   | Prompts → §2. `backfillCitationFor` → `null-scan-sweep.service.ts` (god-files §6). Validators → derive from `sweepCategoryEnum.options`                                    |
| [services/satellite-sweep-chat.service.ts](../../packages/sweep/src/services/satellite-sweep-chat.service.ts)                                                                                                           | (a) 107-line system prompt builder L130-237; (b) extraction prompt L258-261; (c) streaming + extraction in same class                                                                                                                                                                                                                                                                                                                                                         | Prompts → §2. Service keeps `chat()` orchestration + `extractFindings()` glue                                                                                              |
| [sim/promote.ts](../../packages/sweep/src/sim/promote.ts)                                                                                                                                                               | Beyond god-files §5: **title/description composition** for UC3 (`composeTitle` L319-323, `composeDescription` L325-346, `describeAction` L348-367) is presentation-layer, not promotion. Telemetry suggestion title/description hand-formatted inline L498-508 — same pattern, different grammar                                                                                                                                                                              | When splitting per god-files §5, extract `sim/swarm-suggestion-copy.ts` — `renderUc3SuggestionCopy(agg)` + `renderTelemetryInferenceCopy(stats)`                           |
| [sim/turn-runner-sequential.ts](../../packages/sweep/src/sim/turn-runner-sequential.ts) + [sim/turn-runner-dag.ts](../../packages/sweep/src/sim/turn-runner-dag.ts)                                                     | Mix driver-specific persistence with **identical** LLM-call + JSON-parse + cortex-pick + context-assembly. `pickCortexName`, `MAX_JSON_RETRIES`, `callAgent` (seq L191-239 / dag L253-300), `loadGodEvents`, `loadAgents`, `LoadedAgent`, `buildContext` — line-identical except the memory recall query. DAG file even comments L249-251 _"kept inline to avoid a shared-class factory that would complicate DI"_ — **duplication is now larger than the factory it avoids** | See §4.A + §4.B — extract `sim/turn-agent-call.ts` + `sim/turn-context.ts`. Each runner shrinks to ~120L focused on its actual concern (alternation vs parallel reconcile) |
| [services/finding-routing.ts](../../packages/sweep/src/services/finding-routing.ts)                                                                                                                                     | Routing config map L16-35 + sweep-specific notification wirer `wireSweepNotifications` L78-113. Two unrelated topics under one label                                                                                                                                                                                                                                                                                                                                          | Keep routing; move `wireSweepNotifications` → `services/sweep-notifications.ts` or fold into DI container                                                                  |
| [controllers/admin-sweep.controller.ts](../../packages/sweep/src/controllers/admin-sweep.controller.ts) + [satellite-sweep-chat.controller.ts](../../packages/sweep/src/controllers/satellite-sweep-chat.controller.ts) | Clean — parse → service → reply                                                                                                                                                                                                                                                                                                                                                                                                                                               | Not offenders                                                                                                                                                              |
| [transformers/\*.dto.ts](../../packages/sweep/src/transformers)                                                                                                                                                         | Pure Zod + inferred types                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Not offenders                                                                                                                                                              |
| [jobs/queues.ts](../../packages/sweep/src/jobs/queues.ts)                                                                                                                                                               | Queue defs + payload interfaces + `QueueEvents` listeners + `closeQueues`                                                                                                                                                                                                                                                                                                                                                                                                     | Acceptable — splitting saves nothing                                                                                                                                       |

---

## 2. Prompt hoisting

Target: `packages/sweep/src/prompts/` — one prompt per business concept, each exporting `build*Prompt(args): { instructions, input }` (matches `NanoRequest`).

| Source                                                                                                                                      | Concept                                                               | New file                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------- |
| [nano-sweep.service.ts L377-407](../../packages/sweep/src/services/nano-sweep.service.ts#L377-L407) `buildNanoRequest`                      | SSA data-quality auditor (operator-country batch + feedback)          | `prompts/data-quality-audit.prompt.ts`                |
| [nano-sweep.service.ts L432-452](../../packages/sweep/src/services/nano-sweep.service.ts#L432-L452) `buildBriefingRequest`                  | Mission-operator briefing editor                                      | `prompts/operator-country-briefing.prompt.ts`         |
| [satellite-sweep-chat.service.ts L130-237](../../packages/sweep/src/services/satellite-sweep-chat.service.ts#L130-L237) `buildSystemPrompt` | Per-satellite SSA chat analyst                                        | `prompts/satellite-chat-system.prompt.ts`             |
| [satellite-sweep-chat.service.ts L258-261](../../packages/sweep/src/services/satellite-sweep-chat.service.ts#L258-L261)                     | Sweep-finding structured extraction                                   | `prompts/satellite-chat-finding-extraction.prompt.ts` |
| [sim/agent-builder.ts L167-206](../../packages/sweep/src/sim/agent-builder.ts#L167-L206)                                                    | Operator-agent persona (deterministic — fixture-cache load-bearing)   | `prompts/operator-agent-persona.prompt.ts`            |
| [sim/prompt.ts L14-154](../../packages/sweep/src/sim/prompt.ts#L14-L154) `renderTurnPrompt` + sub-renderers                                 | Per-turn user prompt (sim_operator_agent / telemetry_inference_agent) | **Rename** → `prompts/sim-turn-user.prompt.ts`        |

**Note:** cortex _system_ prompts for `sim_operator_agent` / `telemetry_inference_agent` live in the thalamus skill registry (loaded via `cortexRegistry.get(name).body` at [turn-runner-sequential.ts L194-200](../../packages/sweep/src/sim/turn-runner-sequential.ts#L194-L200)). Out of sweep's scope — correctly externalised.

After hoisting: `nano-sweep.service.ts` 537 → ~340L; `satellite-sweep-chat.service.ts` 283 → ~170L. Fixture caches: zero changes (prompts byte-identical).

---

## 3. Hidden domain primitives

### A. `telemetryEdgeId` — DI hosts a domain primitive

[container.ts L190-198](../../packages/sweep/src/config/container.ts#L190-L198). FNV-1a 32-bit fingerprint of `(satelliteId, field)` synthesising stable `ConfidenceService` edgeId when no `research_edge` row exists.

**Home:** `sim/telemetry-edge-id.ts` — `telemetryInferenceEdgeId(satelliteId, field)`. Business name: "synthetic edge id for operator-private telemetry inference, used by SIM_UNCORROBORATED → OSINT_CORROBORATED promotion path". Already H4 in [duplication.md](./duplication.md).

### B. `sim_swarm:{swarmId}` provenance template — N=2 sweep sites

[container.ts L150](../../packages/sweep/src/config/container.ts#L150) `\`sim_swarm:${event.swarmId ?? "?"} field=${event.field}\``, [promote.ts L138](../../packages/sweep/src/sim/promote.ts#L138) `\`sim_swarm:${swarmId}\``. Already H2 in [duplication.md](./duplication.md).

**Home:** `sim/sim-swarm-provenance.ts`:

- `simSwarmTriggerSource(swarmId)` → `sim_swarm:${swarmId}`
- `simSwarmFieldCitation(swarmId | null, field)` → `sim_swarm:${swarmId ?? "?"} field=${field}`

Co-locate with the sim-confidence-promotion module from §1.

### C. `sim_swarm_telemetry` / `sim_swarm_modal` source-tags — N=4 literals

[promote.ts L181, L218, L260, L492](../../packages/sweep/src/sim/promote.ts) + [sweep-resolution.service.ts L354](../../packages/sweep/src/services/sweep-resolution.service.ts#L354). Two distinct values compared by string equality; resolution-service even uses inline cast L350-351.

**Home:** same `sim/sim-swarm-provenance.ts` — `const SIM_SWARM_PROVENANCE = { Modal: "sim_swarm_modal", Telemetry: "sim_swarm_telemetry" } as const` + discriminated `SimProvenance` type.

### D. `SIM_UNCORROBORATED` / `OSINT_CORROBORATED` band — magic strings

6 sites across sweep (+ thalamus `ConfidenceService`). **Cross-package — belongs in `@interview/db-schema` or `@interview/shared`.** Flag for follow-up.

### E. Telemetry scalar field-name mapping duplicates the schema

[sweep-resolution.service.ts L324-336](../../packages/sweep/src/services/sweep-resolution.service.ts#L324-L336) hand-maintains snake_case → camelCase for the 8 telemetry scalars. Same vocabulary lives as `TELEMETRY_SCALAR_COLUMN` in `@interview/db-schema` (used at [promote.ts L387, L455](../../packages/sweep/src/sim/promote.ts)).

**Action:** derive from `TELEMETRY_SCALAR_COLUMN` inverse + Drizzle column metadata. One source of truth.

### F. Default sim turn budgets duplicated

`DEFAULT_UC1_MAX_TURNS = 15` / `DEFAULT_UC3_MAX_TURNS = 20` at [sim-orchestrator.service.ts L39-40](../../packages/sweep/src/sim/sim-orchestrator.service.ts#L39-L40), re-encoded at [swarm.service.ts L127-128](../../packages/sweep/src/sim/swarm.service.ts#L127-L128) with comment _"defaults; caller can override via config extensions later"_.

**Home:** `sim/sim-defaults.ts` or extend [sim/types.ts](../../packages/sweep/src/sim/types.ts) with `SIM_DEFAULTS`.

---

## 4. Extractable patterns (N≥2, ≥5 lines)

### A. Turn-runner LLM-call + JSON-parse loop — N=2, ~50L each

[turn-runner-sequential.ts L191-239](../../packages/sweep/src/sim/turn-runner-sequential.ts#L191-L239) + [turn-runner-dag.ts L253-300](../../packages/sweep/src/sim/turn-runner-dag.ts#L253-L300) — line-identical except a `snippet` field.

**Helper:** `callTurnAgent(deps, ctx): Promise<TurnResponse>` in `sim/turn-agent-call.ts`. Bundle `MAX_JSON_RETRIES` + `pickCortexName`. Saves ~100 LOC + centralises cortex dispatch.

### B. Per-turn context loaders — N=2, ~80L

`buildContext` / `loadGodEvents` / `loadAgents` / `LoadedAgent` duplicated verbatim between [seq L245-340](../../packages/sweep/src/sim/turn-runner-sequential.ts#L245-L340) and [dag L307-402](../../packages/sweep/src/sim/turn-runner-dag.ts#L307-L402). Only divergence: the recall-query string (pass in).

**Helpers:** `buildAgentContext(db, memory, args, recallQuery)` + `loadAgentsForRun(db, simRunId)` + `loadRecentGodEvents(db, simRunId, turnIndex)` in `sim/turn-context.ts`. `LoadedAgent` moves with it.

### C. `describeAction` / `labelFromAction` — N=2, same TurnAction switch

[promote.ts L348-367](../../packages/sweep/src/sim/promote.ts#L348-L367) (long-form) and [aggregator.service.ts L314-333](../../packages/sweep/src/sim/aggregator.service.ts#L314-L333) (short-form). Same switch on `TurnAction.kind`, two grammars.

**Helper:** `sim/turn-action-describe.ts` — `describeTurnAction(a, mode: "long" | "short")`. Consumed by promote, aggregator, and (after god-files §5) `swarm-suggestion-copy.ts`.

### D. Operator + operator-country lookup by `satelliteId` — N=3 SQL near-repeats

Same `LEFT JOIN operator op LEFT JOIN operator_country oc … WHERE s.id = …` with different projections at [promote.ts L101-110, L419-430](../../packages/sweep/src/sim/promote.ts) + [load-telemetry-target.ts L35-49](../../packages/sweep/src/sim/load-telemetry-target.ts#L35-L49).

**Action:** do NOT extract generic helper (each call needs different columns). DO add `findOperatorContext(satelliteId): {operatorName, countryId, countryName, satelliteName?} | null` to `satellite-catalog.repository.ts` (god-files §1). Both promote sites collapse to one call; target-metadata site keeps its own SQL. **Sequence after god-files §1 lands.**

### E. `safeEmbed` / `safelyEmbed` — REJECT

[promote.ts L369-379](../../packages/sweep/src/sim/promote.ts#L369-L379) takes free `embed`; [memory.service.ts L226-233](../../packages/sweep/src/sim/memory.service.ts#L226-L233) wraps `this.embed`. Different surface, 4 lines each. Inline is cheaper.

### F. Quorum check + load-terminal-actions — N=2 aggregators

[aggregator.service.ts L67-143](../../packages/sweep/src/sim/aggregator.service.ts#L67-L143) and [aggregator-telemetry.ts L56-175](../../packages/sweep/src/sim/aggregator-telemetry.ts#L56-L175): both load swarm meta → DISTINCT-ON-per-fish latest turn → check `done >= ceil(size * quorumPct)` → early-return on miss. Quorum check itself is 4 identical lines.

**Helper:** `sim/swarm-quorum.ts` — `evaluateQuorum({size, succeeded, quorumPct}): {met, required}`. SQL projections stay separate.

### G-I REJECT

- `BigInt(numericId)` ceremony: 1-char per site, no content.
- `(rows.rows[0] as {…} | undefined)`: narrowing types differ.
- Fastify SSE write: only 1 site.

---

## 5. Proposed feature layout

Current layout works — sweep serves three coherent surfaces:

1. **Data-quality audit** — services/{nano-sweep, sweep-resolution, messaging, finding-routing} + repositories/sweep + nullScan slice of repositories/satellite + controllers/admin-sweep + transformers/sweep.dto + jobs/workers/sweep.
2. **Sim engine** (UC1, UC3, UC_TELEMETRY) — sim/_ + jobs/workers/{sim-turn, swarm-fish, swarm-aggregate} + jobs/queues.{sim,swarm}_ + the sim? block of container.ts.
3. **Per-satellite chat** — services/satellite-sweep-chat + matching repo/controller/route/dto. Only external dep: `repositories/satellite.findByIdFull`.

**Verdict: do NOT preemptively reorganize into `features/uc3-conjunction/` etc.** Diff cost high. `sim/` is de-facto feature folder; chat is siloed by basename; data-quality is the only cross-cutter and god-files §1 already proposes the right repo split.

**Two micro-moves worth doing now** (low diff, high clarity):

| Move                                                                                                                              | Why                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Create `packages/sweep/src/prompts/`; rename `sim/prompt.ts` → `prompts/sim-turn-user.prompt.ts`                                  | Single home for all LLM prompts; §2 hoists land here                                                                               |
| Co-locate chat surface as `packages/sweep/src/satellite-chat/{controller,service,repository,dto,prompt-system,prompt-extract}.ts` | Today the 5 chat files share a verbose prefix and live in 5 different directories. Self-contained mini-feature with 1 external dep |

Defer the rest until god-files §1-§5 lands — those splits redraw the import graph; any feature reshuffle done now would be redone.

---

## TL;DR

- **5 mixed-resp offenders**; biggest is seq/DAG turn-runner pair (~250 LOC line-identical, justified by a stale "would complicate DI" comment).
- **6 LLM prompts** (4 distinct features) inlined in service code → unify in `packages/sweep/src/prompts/`.
- **6 hidden domain primitives misfiled**: `telemetryEdgeId` in DI, `sim_swarm:{id}` template (N=2), `sim_swarm_*` source-tags (N=4), telemetry-scalar field map duplicating db-schema, sim turn-budget defaults.
- **Patterns A/B/C/D/F** extract now (~250 LOC of true duplication); E/G/H/I rejected.
