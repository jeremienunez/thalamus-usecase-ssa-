# TO-REVIEW

Partially implemented items — shipped work + what's missing. Audited 2026-04-19.

Sister files: [DONE.md](DONE.md) (complete), [TODO.md](TODO.md) (open).

---

## Plan 5 — Sim five-layer integration

Spec: [docs/superpowers/plans/2026-04-18-plan5-sim-five-layer.md](docs/superpowers/plans/2026-04-18-plan5-sim-five-layer.md)

- **Shipped**: Phase A (sim-run / sim-agent / sim-swarm / sim-turn / sim-memory / sim-terminal repos), Phase B (sim.routes.ts with controllers), Phase C (sim-run, sim-swarm, sim-promotion services).
- **Missing**: Phase D kernel slim-down — `packages/sweep/src/sim/promote.ts` still owns SQL + Redis + KG + embeddings + formatting. Phase E worker placement. Phase F cleanup.

## Plan 6 — Sweep five-layer + sim↔sweep boundary

Spec: [docs/superpowers/plans/2026-04-18-plan6-sweep-five-layer.md](docs/superpowers/plans/2026-04-18-plan6-sweep-five-layer.md)

- **Shipped**: `SimPromotionAdapter` port (`packages/sweep/src/sim/ports/promotion.port.ts`), `SimRunRepository`, `SimPromotionService`.
- **Missing**: `ResearchKgRepository`, `SatelliteTelemetryRepository`, `ConfidencePromotionService` — none found by name. `promote.ts` still resident in kernel.

## Plan 3 — CLI → HTTP

- **Shipped**: `POST /api/sim/telemetry/start` + `POST /api/sim/pc/start` (`sim.routes.ts:236,239`).
- **Missing**: `GET /api/kg/graph/:id`, `GET /api/why/:findingId`. `packages/cli/src/boot.ts` still 498 L (target ~80). `buildRealAdapters` still present (`boot.ts:179`). Heavy deps still listed in CLI package.json (@interview/sweep, @interview/thalamus, @interview/db-schema, drizzle, pg, ioredis). No `packages/cli/tests/arch-guard.spec.ts`.

## Strategic tests — thalamus

- **Shipped**: `orchestrator.spec.ts`, `nano-swarm.spec.ts`, `guardrails.spec.ts`.
- **Missing**: dedicated "end-to-end cortex path: query → plan → explore → entity write (LLM mocked)" spec.

## E2E tests — thalamus & sweep

- **Shipped**: `apps/console-api/tests/e2e/` has conjunctions, enrichment-findings, knn-propagation, sweep-mission, swarm-uc3, telemetry-swarm specs.
- **Missing**: specific labelled scenarios "Thalamus: one end-to-end query routed through executor, LLM mocked, graph write verified" and "Sweep: trigger → finding → reviewer accept → DB write + audit row (all in-memory/redis-mock)".

## Priority 2 — Fish quick-wins

- **Shipped**: Conjunction Pc probabilistic estimator (`packages/sweep/src/sim/swarms/pc.ts` + `pc-estimator-agent.md`).
- **Missing** (7 items):
  - Maneuver cost estimator (Pareto front)
  - Why? button (provenance trace via `research_edge` → ASCII tree)
  - Anomaly triage (K fish × 3-5 explanation hypotheses, clustered)
  - Operator posture inference (commercial / institutional / military-like vote)
  - "Dig into" follow-up (scoped micro-swarm from previous finding)
  - Debris decay forecaster (live NOAA F10.7 + altitude)
  - What-if scenario (100 sats SSO → conjunction rate distribution)

## Multi-agent sim swarm — Phase 8

- **Shipped**: `swarm-uc3.e2e.spec.ts` covers the basic end-to-end path.
- **Missing**: individually labelled unit/integration tests for quorum fail-soft, determinism, cross-fish isolation. Final anti-pattern sweep not recorded.
