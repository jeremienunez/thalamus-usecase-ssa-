# Arch audit — packages/thalamus/

**Scope**: `packages/thalamus/src/`
**Lens**: kernel (agnostique, reusable across domains) vs domain (SSA-specific — satellite / orbit / conjunction / payload / NORAD / TLE)

## Summary

Thalamus src contains **~95 files** (29 skills .md + 28 query .ts + 16 source .ts + 22 other .ts modules). The split is roughly **18 kernel-pure / 73 domain-leaked / 4 ambiguous** — ~77% of the package is SSA-specific, though most of that is expected (skills + queries + several fetchers). The real pathology is kernel-layer files importing `@interview/db-schema` (a 100% SSA schema): **47 files import it**, including `config/container.ts`, `cortices/executor.ts`, `cortices/registry.ts` (indirectly), `services/thalamus-explorer.service.ts`, `explorer/orchestrator.ts`, and `explorer/scout.ts`. `cortex-executor` hardcodes SSA enum checks (`ResearchCortex.FleetAnalyst`, `ApogeeTracker`, `PayloadProfiler`, …) and an SSA-only `preSummarize()` switch. `guardrails.ts` hardcodes a 50-word `SSA_KEYWORDS` allowlist. Planner + reflexion prompts contain "SSA" and "Space Situational Awareness". Planner's `DAEMON_DAGS` hardcodes SSA cortex names. Explorer's `scout.ts` and `curator.ts` have an SSA-specific LLM prompt string. Embedder is named `VoyageEmbedder` with SSA-framed doc but implementation is generic.

Net: the orchestrator/planner/executor/registry/guardrails are **structurally generic but lexically SSA-contaminated**. A new cortex bundle requires code changes in at least 5 kernel files today.

## Kernel-pure (reste dans @interview/thalamus)

- [packages/thalamus/src/index.ts](packages/thalamus/src/index.ts) — barrel; would export a generic surface after refactor. Contains one SSA-specific export (`queryConjunctionCandidatesKnn`) that should move out.
- [packages/thalamus/src/cortices/registry.ts](packages/thalamus/src/cortices/registry.ts) — generic YAML-frontmatter + .md body loader. No SSA references.
- [packages/thalamus/src/cortices/confidence.ts](packages/thalamus/src/cortices/confidence.ts) — SPEC-TH-040 dual-stream source-class model. Pure algorithm, no domain types.
- [packages/thalamus/src/cortices/field-correlation.ts](packages/thalamus/src/cortices/field-correlation.ts) — SPEC-TH-041 FieldCorrelator. Pure algorithm; `FieldEvent.subject.type` is a free-string so no SSA coupling.
- [packages/thalamus/src/cortices/cortex-llm.ts](packages/thalamus/src/cortices/cortex-llm.ts) — mostly generic LLM invoker, but user-prompt fallback branch says "Analyze the following SSA data…" and enumerates SSA `entityType` values; trivial to parameterize.
- [packages/thalamus/src/services/thalamus-reflexion.service.ts](packages/thalamus/src/services/thalamus-reflexion.service.ts) — generic replan evaluator. Only mentions "research" in prompt. Kernel-pure.
- [packages/thalamus/src/services/thalamus-executor.service.ts](packages/thalamus/src/services/thalamus-executor.service.ts) — DAG topo-levels executor. Carries an SSA timeout override (`payload_profiler: 180s`) — parameterize but otherwise pure.
- [packages/thalamus/src/transports/llm-chat.ts](packages/thalamus/src/transports/llm-chat.ts) — Kimi/OpenAI/Local transport. No SSA.
- [packages/thalamus/src/transports/factory.ts](packages/thalamus/src/transports/factory.ts) — mode-aware (cloud/fixtures/record). Generic.
- [packages/thalamus/src/transports/fixture-transport.ts](packages/thalamus/src/transports/fixture-transport.ts) — disk-replay. Generic.
- [packages/thalamus/src/transports/types.ts](packages/thalamus/src/transports/types.ts) — contract. Generic.
- [packages/thalamus/src/utils/llm-json-parser.ts](packages/thalamus/src/utils/llm-json-parser.ts) — 8-strategy LLM JSON extractor. Generic.
- [packages/thalamus/src/utils/ssrf-guard.ts](packages/thalamus/src/utils/ssrf-guard.ts) — re-export shim to `@interview/shared`. Generic.
- [packages/thalamus/src/utils/voyage-embedder.ts](packages/thalamus/src/utils/voyage-embedder.ts) — Voyage API wrapper. SSA-framed in comments only; implementation is generic.
- [packages/thalamus/src/explorer/crawler.ts](packages/thalamus/src/explorer/crawler.ts) — Cheerio crawler. Pulls `extractSatelliteEntities` from utils (leak) but the crawling engine is generic.
- [packages/thalamus/src/explorer/nano-caller.ts](packages/thalamus/src/explorer/nano-caller.ts) — gpt-5.4-nano HTTP caller with fixture replay. Generic.
- [packages/thalamus/src/explorer/index.ts](packages/thalamus/src/explorer/index.ts) — barrel. Generic.
- [packages/thalamus/src/cortices/sources/registry.ts](packages/thalamus/src/cortices/sources/registry.ts) — generic self-registration + cache. `SourceKind` string-union references SSA keys but registry itself is domain-free if that type is extracted.
- [packages/thalamus/src/cortices/sources/fetcher-rss.ts](packages/thalamus/src/cortices/sources/fetcher-rss.ts) — generic RSS/Atom parser. Imports `@interview/db-schema` types only for `Source`/`NewSourceItem` shapes → leak.
- [packages/thalamus/src/cortices/sources/fetcher-arxiv.ts](packages/thalamus/src/cortices/sources/fetcher-arxiv.ts) — generic arXiv Atom fetcher. Same db-schema leak.
- [packages/thalamus/src/cortices/sources/fetcher-ntrs.ts](packages/thalamus/src/cortices/sources/fetcher-ntrs.ts) — generic NASA NTRS fetcher (not SSA-specific, but NASA is space-flavoured). Same db-schema leak.

## Domain-leaked (sort vers apps/ssa-domain/ ou packages/ssa-cortex/)

### Skills (all 29 — SSA vocabulary, SSA queries)

- [packages/thalamus/src/cortices/skills/advisory-radar.md](packages/thalamus/src/cortices/skills/advisory-radar.md) — SSA operator advisories.
- [packages/thalamus/src/cortices/skills/analyst-briefing.md](packages/thalamus/src/cortices/skills/analyst-briefing.md) — SSA analyst briefing.
- [packages/thalamus/src/cortices/skills/apogee-tracker.md](packages/thalamus/src/cortices/skills/apogee-tracker.md) — satellite mission phase / EOL.
- [packages/thalamus/src/cortices/skills/briefing-producer.md](packages/thalamus/src/cortices/skills/briefing-producer.md) — editorial copilot for KG briefings.
- [packages/thalamus/src/cortices/skills/catalog.md](packages/thalamus/src/cortices/skills/catalog.md) — SATCAT catalog.
- [packages/thalamus/src/cortices/skills/classification-auditor.md](packages/thalamus/src/cortices/skills/classification-auditor.md) — satellite classification audit.
- [packages/thalamus/src/cortices/skills/conjunction-analysis.md](packages/thalamus/src/cortices/skills/conjunction-analysis.md) — conjunction events.
- [packages/thalamus/src/cortices/skills/conjunction-candidate-knn.md](packages/thalamus/src/cortices/skills/conjunction-candidate-knn.md) — pgvector kNN screening.
- [packages/thalamus/src/cortices/skills/correlation.md](packages/thalamus/src/cortices/skills/correlation.md) — OSINT correlation.
- [packages/thalamus/src/cortices/skills/data-auditor.md](packages/thalamus/src/cortices/skills/data-auditor.md) — catalog data-quality audit.
- [packages/thalamus/src/cortices/skills/debris-forecaster.md](packages/thalamus/src/cortices/skills/debris-forecaster.md) — fragmentation forecast.
- [packages/thalamus/src/cortices/skills/fleet-analyst.md](packages/thalamus/src/cortices/skills/fleet-analyst.md) — user fleet analyst.
- [packages/thalamus/src/cortices/skills/interpreter.md](packages/thalamus/src/cortices/skills/interpreter.md) — SSA interpreter.
- [packages/thalamus/src/cortices/skills/launch-scout.md](packages/thalamus/src/cortices/skills/launch-scout.md) — launch manifest / rideshare scout.
- [packages/thalamus/src/cortices/skills/maneuver-planning.md](packages/thalamus/src/cortices/skills/maneuver-planning.md) — delta-v / burn planning.
- [packages/thalamus/src/cortices/skills/mission-copywriter.md](packages/thalamus/src/cortices/skills/mission-copywriter.md) — mission editorial.
- [packages/thalamus/src/cortices/skills/observations.md](packages/thalamus/src/cortices/skills/observations.md) — radar/optical observations.
- [packages/thalamus/src/cortices/skills/opacity-scout.md](packages/thalamus/src/cortices/skills/opacity-scout.md) — information-deficit SATCAT diffing.
- [packages/thalamus/src/cortices/skills/orbital-analyst.md](packages/thalamus/src/cortices/skills/orbital-analyst.md) — orbital mechanics narration.
- [packages/thalamus/src/cortices/skills/orbit-slot-optimizer.md](packages/thalamus/src/cortices/skills/orbit-slot-optimizer.md) — slot optimization.
- [packages/thalamus/src/cortices/skills/payload-profiler.md](packages/thalamus/src/cortices/skills/payload-profiler.md) — payload / instrument class.
- [packages/thalamus/src/cortices/skills/pc-estimator-agent.md](packages/thalamus/src/cortices/skills/pc-estimator-agent.md) — probability-of-collision estimator.
- [packages/thalamus/src/cortices/skills/regime-profiler.md](packages/thalamus/src/cortices/skills/regime-profiler.md) — orbit regime profiler.
- [packages/thalamus/src/cortices/skills/replacement-cost-analyst.md](packages/thalamus/src/cortices/skills/replacement-cost-analyst.md) — fleet replacement cost.
- [packages/thalamus/src/cortices/skills/research-loop.md](packages/thalamus/src/cortices/skills/research-loop.md) — SSA research loop.
- [packages/thalamus/src/cortices/skills/sim-operator-agent.md](packages/thalamus/src/cortices/skills/sim-operator-agent.md) — simulated operator agent.
- [packages/thalamus/src/cortices/skills/strategist.md](packages/thalamus/src/cortices/skills/strategist.md) — SSA strategist synthesizer.
- [packages/thalamus/src/cortices/skills/telemetry-inference-agent.md](packages/thalamus/src/cortices/skills/telemetry-inference-agent.md) — telemetry inference.
- [packages/thalamus/src/cortices/skills/traffic-spotter.md](packages/thalamus/src/cortices/skills/traffic-spotter.md) — orbital traffic spotter.

### Queries (all 28 — SQL against satellite/orbit_regime/payload/conjunction tables)

- [packages/thalamus/src/cortices/queries/advisory-feed.ts](packages/thalamus/src/cortices/queries/advisory-feed.ts) — source_item advisories.
- [packages/thalamus/src/cortices/queries/apogee.ts](packages/thalamus/src/cortices/queries/apogee.ts) — satellite apogee / EOL.
- [packages/thalamus/src/cortices/queries/catalog.ts](packages/thalamus/src/cortices/queries/catalog.ts) — satellite catalog.
- [packages/thalamus/src/cortices/queries/classification-audit.ts](packages/thalamus/src/cortices/queries/classification-audit.ts) — classification audit.
- [packages/thalamus/src/cortices/queries/conjunction-candidates.ts](packages/thalamus/src/cortices/queries/conjunction-candidates.ts) — pgvector kNN.
- [packages/thalamus/src/cortices/queries/conjunction.ts](packages/thalamus/src/cortices/queries/conjunction.ts) — conjunction rows.
- [packages/thalamus/src/cortices/queries/correlation.ts](packages/thalamus/src/cortices/queries/correlation.ts) — SSA OSINT correlation.
- [packages/thalamus/src/cortices/queries/data-audit.ts](packages/thalamus/src/cortices/queries/data-audit.ts) — satellite data audit.
- [packages/thalamus/src/cortices/queries/debris-forecast.ts](packages/thalamus/src/cortices/queries/debris-forecast.ts) — debris forecast joins.
- [packages/thalamus/src/cortices/queries/index.ts](packages/thalamus/src/cortices/queries/index.ts) — SSA barrel ("SSA business concept" in comment).
- [packages/thalamus/src/cortices/queries/launch-cost-context.ts](packages/thalamus/src/cortices/queries/launch-cost-context.ts) — launch cost.
- [packages/thalamus/src/cortices/queries/launch-manifest.ts](packages/thalamus/src/cortices/queries/launch-manifest.ts) — launch manifest.
- [packages/thalamus/src/cortices/queries/maneuver.ts](packages/thalamus/src/cortices/queries/maneuver.ts) — maneuver events.
- [packages/thalamus/src/cortices/queries/observations.ts](packages/thalamus/src/cortices/queries/observations.ts) — observation rows.
- [packages/thalamus/src/cortices/queries/opacity-scout.ts](packages/thalamus/src/cortices/queries/opacity-scout.ts) — amateur_track fusion.
- [packages/thalamus/src/cortices/queries/operator-fleet.ts](packages/thalamus/src/cortices/queries/operator-fleet.ts) — operator fleet.
- [packages/thalamus/src/cortices/queries/orbital-primer.ts](packages/thalamus/src/cortices/queries/orbital-primer.ts) — orbital primer.
- [packages/thalamus/src/cortices/queries/orbital-traffic.ts](packages/thalamus/src/cortices/queries/orbital-traffic.ts) — orbital traffic.
- [packages/thalamus/src/cortices/queries/orbit-regime.ts](packages/thalamus/src/cortices/queries/orbit-regime.ts) — orbit regime.
- [packages/thalamus/src/cortices/queries/orbit-slot.ts](packages/thalamus/src/cortices/queries/orbit-slot.ts) — orbit slot.
- [packages/thalamus/src/cortices/queries/payload-profiler.ts](packages/thalamus/src/cortices/queries/payload-profiler.ts) — payload profiler.
- [packages/thalamus/src/cortices/queries/replacement-cost.ts](packages/thalamus/src/cortices/queries/replacement-cost.ts) — replacement cost.
- [packages/thalamus/src/cortices/queries/repl-inspection.ts](packages/thalamus/src/cortices/queries/repl-inspection.ts) — SSA REPL inspection.
- [packages/thalamus/src/cortices/queries/rss.ts](packages/thalamus/src/cortices/queries/rss.ts) — RSS feed (SSA domain filter).
- [packages/thalamus/src/cortices/queries/satellite.ts](packages/thalamus/src/cortices/queries/satellite.ts) — satellite entity.
- [packages/thalamus/src/cortices/queries/search.ts](packages/thalamus/src/cortices/queries/search.ts) — satellite search.
- [packages/thalamus/src/cortices/queries/user-fleet.ts](packages/thalamus/src/cortices/queries/user-fleet.ts) — user fleet.
- [packages/thalamus/src/cortices/queries/user-mission-portfolio.ts](packages/thalamus/src/cortices/queries/user-mission-portfolio.ts) — user mission portfolio.

### Source fetchers — SSA-specific

- [packages/thalamus/src/cortices/sources/fetcher-celestrak.ts](packages/thalamus/src/cortices/sources/fetcher-celestrak.ts) — CelesTrak TLE.
- [packages/thalamus/src/cortices/sources/fetcher-seesat.ts](packages/thalamus/src/cortices/sources/fetcher-seesat.ts) — SeeSat-L amateur tracks.
- [packages/thalamus/src/cortices/sources/spacetrack-diff.ts](packages/thalamus/src/cortices/sources/spacetrack-diff.ts) — Space-Track SATCAT diff via Redis.
- [packages/thalamus/src/cortices/sources/fetcher-space-weather.ts](packages/thalamus/src/cortices/sources/fetcher-space-weather.ts) — NOAA SWPC (arguably shared with SSA).
- [packages/thalamus/src/cortices/sources/fetcher-launch-market.ts](packages/thalamus/src/cortices/sources/fetcher-launch-market.ts) — launch-market manifests.
- [packages/thalamus/src/cortices/sources/fetcher-bus-archetype.ts](packages/thalamus/src/cortices/sources/fetcher-bus-archetype.ts) — satellite bus Wikidata.
- [packages/thalamus/src/cortices/sources/fetcher-orbit-regime.ts](packages/thalamus/src/cortices/sources/fetcher-orbit-regime.ts) — ESA DISCOS debris density.
- [packages/thalamus/src/cortices/sources/fetcher-regulation.ts](packages/thalamus/src/cortices/sources/fetcher-regulation.ts) — ITU filings, FAA AST.
- [packages/thalamus/src/cortices/sources/fetcher-spectra.ts](packages/thalamus/src/cortices/sources/fetcher-spectra.ts) — ITU SRS RF/optical spectra.
- [packages/thalamus/src/cortices/sources/fetcher-knowledge-graph.ts](packages/thalamus/src/cortices/sources/fetcher-knowledge-graph.ts) — KG semantic search; imports ResearchGraphService + ResearchEntityType (SSA schema).
- [packages/thalamus/src/cortices/sources/index.ts](packages/thalamus/src/cortices/sources/index.ts) — barrel explicitly importing every SSA fetcher.
- [packages/thalamus/src/cortices/sources/types.ts](packages/thalamus/src/cortices/sources/types.ts) — `SourceKind` hardcodes SSA keys (celestrak, space-weather, bus-archetype, orbit-regime, spectra).

### Domain-leaked kernel files

- [packages/thalamus/src/services/thalamus.service.ts](packages/thalamus/src/services/thalamus.service.ts) — comment "autonomous SSA research", imports `ResearchCortex` enum, defaults to `ResearchCortex.FleetAnalyst` in `findingCortex()`. Orchestration is structurally generic but lexically pinned to SSA enum.
- [packages/thalamus/src/services/thalamus-planner.service.ts](packages/thalamus/src/services/thalamus-planner.service.ts) — `DAEMON_DAGS` enumerates SSA cortex names (`fleet_analyst`, `conjunction_analysis`, `regime_profiler`, `debris_forecaster`, …). Fallback DAG hardcodes the same. Planner prompt starts "You are Thalamus, an SSA research planner".
- [packages/thalamus/src/services/thalamus-executor.service.ts](packages/thalamus/src/services/thalamus-executor.service.ts) — `CORTEX_TIMEOUT_OVERRIDES` has `payload_profiler` key. Minor but domain.
- [packages/thalamus/src/services/thalamus-explorer.service.ts](packages/thalamus/src/services/thalamus-explorer.service.ts) — imports `Database` from db-schema.
- [packages/thalamus/src/services/research-graph.service.ts](packages/thalamus/src/services/research-graph.service.ts) — imports `ResearchEntityType`, `ResearchRelation`, `ResearchCortex`, `ResearchFindingType` (SSA enums). Embedding + dedup logic is algorithmic but the entity model is SSA.
- [packages/thalamus/src/cortices/executor.ts](packages/thalamus/src/cortices/executor.ts) — **hot leak**. Imports `Database` from db-schema. Hardcodes `ResearchCortex.{Strategist, FleetAnalyst, AdvisoryRadar, LaunchScout, DebrisForecaster, RegimeProfiler, ApogeeTracker, PayloadProfiler, BriefingProducer, ClassificationAuditor}`. `KNOWN_ORBIT_REGIMES` set LEO/MEO/GEO/HEO/SSO/GTO/Lunar/Cislunar/Heliocentric. `preSummarize()` is a per-cortex SSA switch. `webSearchFallback` prompt hardcodes "Space Situational Awareness / CelesTrak / Space-Track / ESA / NASA CNEOS".
- [packages/thalamus/src/cortices/guardrails.ts](packages/thalamus/src/cortices/guardrails.ts) — `SSA_KEYWORDS` set (70+ SSA-specific tokens). `domainRelevance()` is hardcoded to SSA. `sanitizeText()` + `sanitizeDataPayload()` injection-filter are generic.
- [packages/thalamus/src/cortices/types.ts](packages/thalamus/src/cortices/types.ts) — `CortexFinding.busContext` carries satellite-bus metadata. Imports `ResearchEntityType`, `ResearchRelation` etc. from shared/enum (SSA vocabulary).
- [packages/thalamus/src/cortices/config.ts](packages/thalamus/src/cortices/config.ts) — `correlation` section documents "probabilityOfCollisionAlert 1e-4 NASA convention", `data` section hardcodes `satellites: 30_000, orbitRegimes: 9, operators: 450`. Iteration budgets are generic but the config file mixes both.
- [packages/thalamus/src/prompts/planner.prompt.ts](packages/thalamus/src/prompts/planner.prompt.ts) — "You are Thalamus, an SSA (Space Situational Awareness) research planner".
- [packages/thalamus/src/prompts/opacity-scout.prompt.ts](packages/thalamus/src/prompts/opacity-scout.prompt.ts) — SSA analyst prompt; `OpacityScout` is an SSA cortex.
- [packages/thalamus/src/prompts/index.ts](packages/thalamus/src/prompts/index.ts) — barrel exporting both (ambiguous — planner should stay with kernel, opacity-scout should move).
- [packages/thalamus/src/repositories/research-finding.repository.ts](packages/thalamus/src/repositories/research-finding.repository.ts) — CRUD against `researchFinding` (SSA table). Semantic-search generic, tables SSA.
- [packages/thalamus/src/repositories/research-edge.repository.ts](packages/thalamus/src/repositories/research-edge.repository.ts) — joins satellite/operator/operatorCountry/satelliteBus/payload/orbitRegime/platformClass for orphan cleanup. Heavy SSA.
- [packages/thalamus/src/repositories/research-cycle.repository.ts](packages/thalamus/src/repositories/research-cycle.repository.ts) — CRUD against `researchCycle`. Table-bound.
- [packages/thalamus/src/repositories/exploration.repository.ts](packages/thalamus/src/repositories/exploration.repository.ts) — CRUD against `explorationLog`.
- [packages/thalamus/src/repositories/entity-name-resolver.ts](packages/thalamus/src/repositories/entity-name-resolver.ts) — `ENTITY_TABLE_MAP` hardcodes satellite/operator/orbit_regime/payload/platform_class/satellite_bus. 100% SSA.
- [packages/thalamus/src/entities/research.entity.ts](packages/thalamus/src/entities/research.entity.ts) — `InferSelectModel<typeof researchCycle/researchFinding/researchEdge>` — bound to SSA schema by naming convention (research = SSA knowledge graph).
- [packages/thalamus/src/config/container.ts](packages/thalamus/src/config/container.ts) — wires everything together around `Database` from db-schema.
- [packages/thalamus/src/explorer/orchestrator.ts](packages/thalamus/src/explorer/orchestrator.ts) — imports `Database`, uses `ExplorerScout.gatherSignals(db)` which runs SSA-shaped queries.
- [packages/thalamus/src/explorer/scout.ts](packages/thalamus/src/explorer/scout.ts) — `SCOUT_PROMPT` is SSA-specific ("curiosity engine of a SSA research brain called Thalamus"). Imports Database.
- [packages/thalamus/src/explorer/curator.ts](packages/thalamus/src/explorer/curator.ts) — `CURATOR_PROMPT` SSA-specific ("content curator for a SSA research system").
- [packages/thalamus/src/explorer/nano-swarm.ts](packages/thalamus/src/explorer/nano-swarm.ts) — imports `extractSatelliteEntities` from utils. Swarm mechanics generic.
- [packages/thalamus/src/utils/satellite-entity-patterns.ts](packages/thalamus/src/utils/satellite-entity-patterns.ts) — NORAD/COSPAR regex + Sentinel/Starlink/GPS/GOES/Cosmos/Iridium/Galileo patterns. 100% SSA.
- [packages/thalamus/src/controllers/thalamus.controller.ts](packages/thalamus/src/controllers/thalamus.controller.ts) — imports SSA enums; API surface but returns SSA findings.
- [packages/thalamus/src/routes/thalamus.routes.ts](packages/thalamus/src/routes/thalamus.routes.ts) — Fastify routes mounting the SSA controller.
- [packages/thalamus/src/demo/cycle.ts](packages/thalamus/src/demo/cycle.ts) — hard-coded SSA query ("Upcoming conjunctions … Starlink"), imports db-schema.
- [packages/thalamus/src/demo/ssa-repl.ts](packages/thalamus/src/demo/ssa-repl.ts) — explicitly named `ssa-repl`; drives SSA flow.
- [packages/thalamus/src/config/enrichment.ts](packages/thalamus/src/config/enrichment.ts) — "For the SSA interview artifact we inline the reads here". Logic is generic Kimi/OpenAI/local config; comment + naming are SSA-framed.

## Ambiguous / à discuter

- [packages/thalamus/src/cortices/sources/types.ts](packages/thalamus/src/cortices/sources/types.ts) — `SourceResult`/`SourceFetcher` generic; `SourceKind` union is SSA. Split: keep generic types in kernel, move `SourceKind` union to the SSA bundle.
- [packages/thalamus/src/cortices/cortex-llm.ts](packages/thalamus/src/cortices/cortex-llm.ts) — 90% generic, user-prompt fallback enumerates SSA entity types. Parameterize finding schema via the registry.
- [packages/thalamus/src/cortices/confidence.ts](packages/thalamus/src/cortices/confidence.ts) — generic algorithm but SPEC-TH-041 band thresholds were tuned for SSA priors. Keep in kernel; allow band overrides via constructor.
- [packages/thalamus/src/cortices/field-correlation.ts](packages/thalamus/src/cortices/field-correlation.ts) — generic pure; latency budgets (500/2000/10000) are "SPEC-TH-041 AC-2/3" SSA-spec but numerically reasonable for any real-time cortex. Keep in kernel.

## Imports `@interview/db-schema` dans thalamus (47 files — each a leak)

Every file listed here loads the SSA Drizzle schema and therefore cannot ship inside a domain-agnostic kernel package.

- `demo/cycle.ts:15`
- `demo/ssa-repl.ts:26,27`
- `repositories/research-finding.repository.ts:10`
- `repositories/research-cycle.repository.ts:6`
- `repositories/research-edge.repository.ts:20`
- `repositories/exploration.repository.ts:2,3`
- `repositories/entity-name-resolver.ts:10`
- `services/thalamus-explorer.service.ts:8`
- `config/container.ts:8`
- `entities/research.entity.ts:11`
- `explorer/orchestrator.ts:2`
- `explorer/scout.ts:4`
- `cortices/executor.ts:13`
- `cortices/sources/fetcher-arxiv.ts:2`
- `cortices/sources/fetcher-ntrs.ts:2`
- `cortices/sources/fetcher-rss.ts:2`
- `cortices/sources/spacetrack-diff.ts:21`
- `cortices/sources/fetcher-seesat.ts:29`
- All 23 query files under `cortices/queries/*.ts` (every file imports `Database`)

## Cortex skills (all domain) — count by category

| Category              | Count  | Files                                                                                                                                              |
| --------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSA ops / traffic     | 8      | advisory-radar, conjunction-analysis, conjunction-candidate-knn, correlation, maneuver-planning, pc-estimator-agent, traffic-spotter, observations |
| SSA fleet / satellite | 5      | apogee-tracker, fleet-analyst, payload-profiler, orbit-slot-optimizer, replacement-cost-analyst                                                    |
| SSA orbits / debris   | 3      | debris-forecaster, regime-profiler, orbital-analyst                                                                                                |
| SSA catalog / audit   | 4      | catalog, classification-auditor, data-auditor, opacity-scout                                                                                       |
| SSA market / launch   | 1      | launch-scout                                                                                                                                       |
| SSA editorial / meta  | 5      | analyst-briefing, briefing-producer, mission-copywriter, interpreter, strategist                                                                   |
| SSA simulation        | 3      | sim-operator-agent, telemetry-inference-agent, research-loop                                                                                       |
| **Total**             | **29** | all SSA                                                                                                                                            |

## Cortex queries (all domain) — count: 28

All 28 .ts files target SSA tables (satellite, orbit_regime, payload, conjunction_event, maneuver, operator, operator_country, satellite_bus, platform_class, amateur_track, source_item, research_cycle, research_finding, research_edge, exploration_log).

## Source fetchers — split generic / domain

### Generic (4)

- `fetcher-rss.ts` — generic RSS/Atom parser (only db-schema type-import leak).
- `fetcher-arxiv.ts` — generic arXiv Atom parser (same leak).
- `fetcher-ntrs.ts` — generic NTRS API fetcher (same leak).
- `registry.ts` — generic cortex→fetcher routing with TTL cache.

### Domain (12)

- `fetcher-celestrak.ts` — TLE catalog + SGP4 reference.
- `fetcher-seesat.ts` — SeeSat-L amateur tracks.
- `spacetrack-diff.ts` — Space-Track SATCAT diff via Redis SDIFF.
- `fetcher-space-weather.ts` — NOAA SWPC (F10.7, Kp).
- `fetcher-launch-market.ts` — launch manifests.
- `fetcher-bus-archetype.ts` — satellite bus Wikidata.
- `fetcher-orbit-regime.ts` — ESA DISCOS debris density.
- `fetcher-regulation.ts` — ITU filings, FAA AST.
- `fetcher-spectra.ts` — ITU SRS RF/optical spectra.
- `fetcher-knowledge-graph.ts` — SSA KG re-injection.
- `index.ts` — SSA barrel (imports every SSA fetcher for self-registration).
- `types.ts` — `SourceKind` string-union SSA keys.

## Target architecture proposal

```
packages/
├── thalamus/                              # kernel-only (agnostic)
│   └── src/
│       ├── orchestrator/                  # runCycle / DAG loop (was services/thalamus.service)
│       ├── planner/                       # DAG planning (no DAEMON_DAGS, no SSA prompt)
│       │   ├── planner.ts
│       │   └── prompts/planner.prompt.ts  # parameterize "domain label"
│       ├── executor/                      # topo-levels DAG exec (no SSA timeout overrides)
│       ├── reflexion/                     # reflexion loop
│       ├── cortex/
│       │   ├── registry.ts                # generic .md frontmatter loader
│       │   ├── executor.ts                # generic (remove preSummarize switch, accept hooks)
│       │   ├── types.ts                   # generic CortexFinding (busContext → generic "context")
│       │   ├── cortex-llm.ts              # generic LLM invoker (finding schema via registry)
│       │   ├── confidence.ts              # SPEC-TH-040 (pure)
│       │   ├── field-correlation.ts       # SPEC-TH-041 (pure)
│       │   └── guardrails.ts              # sanitizeText (generic); domainRelevance → plugin
│       ├── explorer/
│       │   ├── orchestrator.ts            # no Database dep; signals via plugin
│       │   ├── crawler.ts                 # entity extraction → plugin
│       │   ├── curator.ts                 # prompt parameterized via domain label
│       │   ├── scout.ts                   # prompt parameterized
│       │   ├── nano-caller.ts, nano-swarm.ts
│       │   └── index.ts
│       ├── transports/                    # llm-chat, factory, fixture, types
│       ├── sources/
│       │   ├── registry.ts                # generic
│       │   ├── types.ts                   # no SourceKind hardcoding
│       │   └── fetchers/                  # rss, arxiv, ntrs only
│       ├── utils/llm-json-parser.ts, ssrf-guard.ts, voyage-embedder.ts
│       ├── config/enrichment.ts           # LLM config only
│       └── index.ts
│
├── ssa-cortex/                            # NEW — SSA domain bundle
│   └── src/
│       ├── skills/                        # all 29 .md
│       ├── queries/                       # all 28 .ts
│       ├── sources/
│       │   ├── fetcher-celestrak.ts
│       │   ├── fetcher-seesat.ts
│       │   ├── spacetrack-diff.ts
│       │   ├── fetcher-space-weather.ts
│       │   ├── fetcher-launch-market.ts
│       │   ├── fetcher-bus-archetype.ts
│       │   ├── fetcher-orbit-regime.ts
│       │   ├── fetcher-regulation.ts
│       │   ├── fetcher-spectra.ts
│       │   ├── fetcher-knowledge-graph.ts
│       │   └── source-kinds.ts           # SSA SourceKind union
│       ├── prompts/
│       │   └── opacity-scout.prompt.ts
│       ├── entity-patterns/
│       │   └── satellite-entity-patterns.ts
│       ├── guardrails/
│       │   └── ssa-keywords.ts           # SSA_KEYWORDS + domainRelevance(title,summary,keywords)
│       ├── daemon-dags.ts                # predefined SSA DAGs
│       ├── repositories/                  # research-finding, research-edge, research-cycle, entity-name-resolver, exploration
│       ├── entities/research.entity.ts
│       ├── services/
│       │   ├── research-graph.service.ts
│       │   └── thalamus-explorer.service.ts
│       ├── controllers/thalamus.controller.ts
│       ├── routes/thalamus.routes.ts
│       └── container.ts                   # wires ssa-cortex + thalamus kernel + db-schema
│
└── (future) pharma-cortex/, maritime-cortex/, threat-intel-cortex/
```

Transposition contract: a new domain bundle provides `{ skills/, queries/, sources/fetchers/, daemon-dags, entity-patterns, repositories, domain-keywords, finding-schema }` and hands them to `buildThalamusContainer({ kernel, domain })`.

## Cross-package dependency risks

- **Moving repositories + entities out of thalamus kernel**: every consumer that today imports `{ ResearchFindingRepository, ResearchEdgeRepository, ResearchCycleRepository, ResearchGraphService }` from `@interview/thalamus` needs re-routing to `@interview/ssa-cortex`. Most likely callers: `apps/console-api`, daemons, scripts. Need to grep for `from "@interview/thalamus"` across the monorepo before the cut.
- **Planner registry coupling**: planner today calls `registry.getHeadersForPlanner()` which embeds `[sql: ${h.sqlHelper}]`. Kernel planner must not know about SQL helpers — replace with a generic `routingHint: string` field.
- **Executor helper discovery**: today `CortexExecutor` imports `* as sqlHelpers from "./queries"` at module scope. Replace with a constructor-injected `Record<string, (ctx, params) => Promise<unknown[]>>`.
- **`preSummarize()` cortex switch**: inlined in `cortices/executor.ts` — must move to the SSA bundle as a `PreSummarizer` plugin keyed by cortex name.
- **`WEB_ENRICHED_CORTICES` + `USER_SCOPED_CORTICES` sets**: same problem. Move to skill frontmatter (`webEnrichment: true`, `scope: user|global`).
- **Shared enum package `@interview/shared/enum`**: `ResearchCortex`, `ResearchEntityType`, `ResearchRelation`, `ResearchFindingType`, `ResearchUrgency`, `ResearchCycleTrigger`, `ResearchCycleStatus`, `ResearchStatus` are all SSA-named. Either rename the enum package to `@interview/ssa-enum` or split into `generic-research-enum` + `ssa-entity-enum`.
- **db-schema**: currently the single Drizzle schema for SSA. Separate tables (`satellite`, `orbit_regime`, …) from research-graph scaffolding (`research_cycle`, `research_finding`, `research_edge`, `exploration_log`). The research-graph scaffolding is reusable across domains — consider `@interview/research-graph-schema` (kernel) + `@interview/ssa-schema` (domain).
- **Fixtures directory**: fixture-transport hashes `systemPrompt + userPrompt` → fixtures recorded with SSA prompts won't match a refactored prompt that parameterizes the domain label. Re-record after any prompt string touch.
- **`fetcher-knowledge-graph` circularity**: sits in generic sources barrel but imports `ResearchGraphService` + `ResearchEntityType`. Pure SSA. Must move to ssa-cortex and have kernel sources registry accept late-registration.
- **`explorer/orchestrator` SQL dependencies**: `ExplorerScout.gatherSignals(db)` queries SSA tables directly. Need an injected `SignalsProvider` interface.

## Estimated refactor scope (tasks, not hours)

1. Extract `@interview/research-graph-schema` from `@interview/db-schema` (research_cycle / research_finding / research_edge / exploration_log + generic enums). Update db-schema to re-export.
2. Split `@interview/shared/enum` into kernel (ResearchFindingType, ResearchUrgency, ResearchCycleTrigger, ResearchCycleStatus, ResearchStatus) and SSA (ResearchCortex, ResearchEntityType, ResearchRelation).
3. Create `packages/ssa-cortex/` scaffolding (package.json, tsconfig, index.ts).
4. Move all 29 `cortices/skills/*.md` → `packages/ssa-cortex/src/skills/`.
5. Move all 28 `cortices/queries/*.ts` → `packages/ssa-cortex/src/queries/`.
6. Move 10 SSA source fetchers → `packages/ssa-cortex/src/sources/fetchers/`. Keep rss/arxiv/ntrs in kernel.
7. Move `repositories/*` + `entities/research.entity.ts` → ssa-cortex.
8. Move `services/research-graph.service.ts` + `services/thalamus-explorer.service.ts` → ssa-cortex.
9. Move `controllers/*` + `routes/*` → ssa-cortex (or apps/console-api — depends on how the API is shaped).
10. Move `utils/satellite-entity-patterns.ts` → ssa-cortex.
11. Move SSA_KEYWORDS half of `guardrails.ts` → ssa-cortex (`ssa-keywords.ts`). Keep sanitizeText/sanitizeDataPayload generic in kernel.
12. Move `prompts/opacity-scout.prompt.ts` → ssa-cortex. Parameterize `prompts/planner.prompt.ts` with a `domainLabel` / `domainDescription` input; remove SSA literals.
13. Refactor `cortex/executor.ts`: remove `ResearchCortex.*` enum references, remove SSA `preSummarize()` switch, remove hardcoded `KNOWN_ORBIT_REGIMES`, remove `USER_SCOPED_CORTICES`/`WEB_ENRICHED_CORTICES` sets (move to skill frontmatter). Remove SSA web-search prompt.
14. Refactor `services/thalamus-planner.service.ts`: extract `DAEMON_DAGS` → ssa-cortex. Planner fallback uses first N registered cortices, not SSA-hardcoded ones. Remove `[sql: ...]` header formatting.
15. Refactor `services/thalamus.service.ts`: drop `ResearchCortex` enum coupling (`findingCortex` + default `FleetAnalyst`). Rely on DAG-node-provided cortex identifier.
16. Refactor `services/thalamus-executor.service.ts`: move `CORTEX_TIMEOUT_OVERRIDES` to a generic Registry-sourced map (override via skill frontmatter).
17. Refactor `cortices/types.ts`: make `CortexFinding` domain-neutral (drop `busContext` field, accept `domainContext?: Record<string, unknown>`). Decouple edge types from SSA enums (use string types at the kernel boundary).
18. Refactor `explorer/orchestrator.ts` + `scout.ts` + `curator.ts`: inject `SignalsProvider` + `DomainPromptProvider`. Remove direct `Database` dep and SSA prompt strings.
19. Refactor `config/container.ts` → kernel `buildThalamusKernel({ transports, registry, ... })`; create `ssa-cortex/src/container.ts` `buildSsaContainer({ db })` composing kernel + SSA plugins.
20. Refactor `sources/types.ts` — drop `SourceKind`; let ssa-cortex declare its own union.
21. Re-record all LLM fixtures (SHA changes once prompts are parameterized).
22. Update `apps/console-api` + daemon entry points to import from both `@interview/thalamus` and `@interview/ssa-cortex`.
23. Move `demo/ssa-repl.ts` + `demo/cycle.ts` → ssa-cortex (they are SSA demos).
24. Update root exports in `packages/thalamus/src/index.ts` — remove `queryConjunctionCandidatesKnn`, `ThalamusController`, `thalamusRoutes`, the repositories, and confidence/field-correlation remain.
25. Write kernel/domain contract tests that prove a new stub domain ("test-cortex") boots through `buildThalamusKernel` + `buildTestDomainContainer` with zero imports of `@interview/db-schema` in kernel.
