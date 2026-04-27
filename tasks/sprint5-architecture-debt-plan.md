# Sprint 5 — Architecture Debt Plan (figé 2026-04-27)

Goal: collapse `research_*` writes behind one app-owned writer, then split the
two god-services (`sim-promotion.service.ts`, `research-graph.service.ts`),
finish the small items, then close the kernel/domain decoupling. The order is
chosen so splits do not duplicate insert-shape knowledge: the writer is unified
**before** any split.

Covers: `I6`, `M2`, `C1`, `C2`, `M3`, `M1`, `M4`, `M8`, `I5`, `C4`.

CLAUDE.md anchors: §1 single contract, §3.1 no private bypass, §3.2 no second
contract, §6 completion criteria.

## Execution status — 2026-04-28

Phases 1-8 and the Phase 9 scope (`I5`, `C4`) are landed in the current
workspace. The checklist below is kept as the frozen execution plan; the active
status source is the Sprint 5 section in `TODO.md`.

Important implementation refinements from the 2026-04-28 audit:

- `ResearchWriterPort` uses the public Thalamus research DTOs, not Drizzle
  entity or `$inferInsert` types.
- `POST /api/research/finding-emissions` delegates to
  `ResearchWriterPort.emitFindingTransactional`; the controller no longer
  orchestrates upsert + cycle link + edges.
- `POST /api/research/edges` was intentionally not added because no standalone
  edge writer caller survived migration.
- Sim promotion consumes the same writer surface; the old
  `SimPromotionStorePort`/inline Drizzle adapter is gone.
- `0015_research_stats_views.sql` is now included in the production migration
  runner.
- Guardrails are covered by
  `packages/test-kit/tests/arch/sprint5-architecture-debt.bdd.spec.ts`,
  including the single-writer scan, DTO-only writer port, transactional
  finding-emission delegation, deleted façade checks, and kernel/domain
  decoupling checks.

---

## Phase 1 — I6: dedupe app-side ports (zero behavior change)

- [ ] Create `apps/console-api/src/services/ports/research-write.port.ts` with
      `CyclesPort`, `FindingsWritePort`, `EdgesWritePort`.
- [ ] Remove the local definitions from
      `apps/console-api/src/services/enrichment-finding.service.ts` and
      `apps/console-api/src/services/reflexion.service.ts`; import from the new
      port file.
- [ ] Diff the two `SatellitesReadPort` shapes: - `apps/console-api/src/services/satellite-view.service.ts` → `listWithOrbital(limit, regime)` - `apps/console-api/src/services/sweep-task-planner.service.ts` → `findPayloadNamesByIds(ids)`
      Confirmed divergent (different responsibilities). Rename:
      `SatelliteOrbitalReadPort` and `SatellitePayloadNameReadPort`. No fat
      port, no merge.

Validation: typecheck green, all impacted services compile, no test changes
needed. PR is a pure dedup commit.

---

## Phase 2 — M2: relocate thalamus ports

- [ ] Move out of `packages/thalamus/src/cortices/types.ts`: - `CortexDataProvider` → `packages/thalamus/src/ports/cortex-data-provider.port.ts` - `DomainConfig` + `noopDomainConfig` → `packages/thalamus/src/ports/domain-config.port.ts` - `CortexExecutionStrategy` → `packages/thalamus/src/ports/cortex-execution-strategy.port.ts`
- [ ] Update imports in: - `packages/thalamus/src/config/container.ts` - `packages/thalamus/src/cortices/strategies/*` - `apps/console-api/src/agent/ssa/domain-config.ts` - `apps/console-api/src/agent/ssa/cortex-data-provider.ts` - `packages/thalamus/src/index.ts` (barrel)

Validation: typecheck green; barrel re-export preserves public surface.

---

## Phase 3 — C1 step A: app-owned business writer

- [ ] Create `apps/console-api/src/services/research-write.service.ts` with a
      business interface (no Drizzle types in the surface):

      ```ts
      createCycle(input: CreateResearchCycleInput): Promise<{ id: string }>
      storeFinding(input: StoreResearchFindingInput): Promise<{ id: string }>
      linkCycleFinding(input: LinkCycleFindingInput): Promise<void>
      createEdge(input: CreateResearchEdgeInput): Promise<void>
      incrementCycleFindings(input: { cycleId: string; by?: number }): Promise<void>
      emitFindingTransactional(input: FindingEmissionInput): Promise<{
        findingId: string;
        edgeIds: string[];
      }>
      ```

- [ ] DTO types in `apps/console-api/src/types/research-write.types.ts`.
- [ ] DB shape mappers in `apps/console-api/src/transformers/research-write.transformer.ts`.
- [ ] Persistence stays in the existing repos but their write methods become
      _internal_ to the writer (see Phase 5).

Constraint: services consuming the writer must never see
`researchCycle.$inferInsert`, `researchFinding.$inferInsert`,
`researchEdge.$inferInsert`. Those types remain in the transformer/repo
boundary only.

---

## Phase 4 — C1 step B: kernel-only HTTP routes

CLAUDE.md §1 requires HTTP, not a private port, when the kernel needs the
capability. Routes:

- [x] `POST /api/research/cycles` — bootstraps an empty cycle (sweep needs this
      before any finding exists).
- [x] `POST /api/research/finding-emissions` — single transactional path:
      finding + edges + cycle link in one DB transaction (the dominant case).
- [x] `POST /api/research/cycles/:id/increment-findings` — async aggregate
      counter update.
- [ ] `POST /api/research/edges` — only if a real standalone caller exists
      after migration; otherwise drop.

For each route:

- [x] Zod schema under `apps/console-api/src/schemas/research-write.schema.ts`.
- [x] Controller in `apps/console-api/src/controllers/research-write.controller.ts`.
- [x] Auth scope: kernel-only (mirror `/api/sim/queue/*` pattern, CLAUDE.md §5).
- [x] Contract/e2e test posts the **business DTO** (not the DB shape) and asserts
      the row is written and reads back through the read path. Kept under e2e
      because the test crosses the HTTP boundary.
- [x] e2e smoke test in
      `apps/console-api/tests/e2e/research-write.routes.e2e.spec.ts` that
      exercises a finding-emission round trip.

---

## Phase 5 — migrate callers + delete second contracts

- [ ] `SimPromotionService` no longer receives a Drizzle-shaped
      `SimPromotionStorePort`. It receives a `ResearchWritePort` (business).
      Inline impl in `apps/console-api/src/container.ts` is replaced by
      `ResearchWriteService`.
- [ ] `enrichment-finding.service.ts` and `reflexion.service.ts` switch their
      writes to `ResearchWritePort`.
- [ ] **Delete** (not privatize) the public write methods on app-side repos: - `apps/console-api/src/repositories/finding.repository.ts` → drop
      `insert`/`updateCycleFindingsCount` exports if not consumed elsewhere
      after migration. - `apps/console-api/src/repositories/research-edge.repository.ts` → drop
      `insert` export. - The repos remain only as read paths or as internal-only writers
      consumed exclusively by `ResearchWriteService`.

Constraint: any "deprecated but exported" path is a second contract waiting to
be re-imported. Deletion only.

---

## Phase 6 — C2: split sim-promotion (after Phase 5 only)

- [ ] `apps/console-api/src/services/sim-outcome-promotion.service.ts` —
      promote logic.
- [ ] `apps/console-api/src/services/sim-modal-suggestion.service.ts` —
      `emitSuggestionFromModal`.
- [ ] `apps/console-api/src/services/sim-telemetry-suggestion.service.ts` —
      `emitTelemetrySuggestions`.
- [ ] `apps/console-api/src/services/sim-promotion-text.ts` —
      `composeTitle`/`composeDescription`/`describeAction` (pure, unit-tested).
- [ ] `apps/console-api/src/services/sim-telemetry-scoring.ts` —
      `telemetryColumn`/`scoreScalar`/`round` (pure, unit-tested).

All three services depend on the same `ResearchWritePort`. No new DTOs per
service, no new ports. Pure orchestration split.

Old `sim-promotion.service.ts` deleted in the same PR (no façade).

---

## Phase 7 — M3: split research-graph (no permanent façade)

- [ ] `packages/thalamus/src/services/finding-store.service.ts` —
      `storeFinding`, dedup, cycle link, cross-links.
- [ ] `packages/thalamus/src/services/kg-query.service.ts` —
      `queryByEntity`, `semanticSearch`, `listFindings`, `getFindingWithEdges`,
      `getKnowledgeGraph`, `getGraphStats`.
- [ ] `packages/thalamus/src/services/finding-lifecycle.service.ts` —
      `archiveFinding`, `expireAndClean`.
- [ ] `packages/thalamus/src/services/finding-events.ts` — `onFinding`
      callbacks via shared event emitter.

Migration policy: imports updated in the **same PR** as the split (~15-20
files). No `ResearchGraphService` façade is committed. If risk forces a
transitional façade, it must ship `@deprecated since YYYY-MM-DD` + an issue +
a lint/grep gate that fails on new imports of the façade.

---

## Phase 8 — small items

- [x] **M1** — `apps/console-api/src/repositories/stats.repository.ts` stops
      `SELECT count(*) FROM research_*` directly. Two viable shapes: - dedicated read-only PG view (`vw_research_stats`), or - `ResearchReadModelPort` consuming the writer's mirror.
      Pick the simpler one once C1 lands.
- [x] **M4** — extract the inline launcher closure from
      `apps/console-api/src/container.ts:647-658` into
      `apps/console-api/src/services/sim-launcher.service.ts` with an explicit
      `SimLauncherPort`.
- [x] **M8** — replace `zrevrange(IDX_ALL, 0, -1)` at
      `packages/sweep/src/repositories/sweep.repository.ts:379` and `:537`
      with cursor pagination (or top-N + cursor). Update callers.

---

## Phase 9 — kernel/domain decoupling

- [ ] **I5** — `packages/sweep` stops importing from `@interview/thalamus`.
      Decision (binary): - merge sweep + thalamus into one kernel package, or - extract `cortex-kernel` package owning `CortexRegistry`,
      `ConfidenceService`, `callNanoWithMode`; both sweep and thalamus
      depend on it.
      Document the chosen path in
      `docs/specs/architecture/03-layout.tex` once shipped.
- [ ] **C4** — strip SSA tokens from the kernel: - `packages/thalamus/src/cortices/config.ts:6,79,81` - `packages/thalamus/src/services/thalamus.service.ts:2` - `packages/thalamus/src/services/thalamus-planner.service.ts` (7 SSA
      refs) - `packages/thalamus/src/cortices/guardrails.ts:6` - `packages/thalamus/src/prompts/curator.prompt.ts:5` - `packages/thalamus/src/prompts/nano-swarm.prompt.ts:14`
      Replace defaults with generic stubs; SSA copy injected from
      `apps/console-api/src/agent/ssa/` via the existing setter ports
      (memory: `feedback_package_agnosticity.md`).

---

## Definition of Done

C1 only counts as closed when **all** of the following hold:

- No app service touches `researchCycle.$inferInsert`,
  `researchFinding.$inferInsert`, or `researchEdge.$inferInsert`.
- Exactly one business writer surface exists (`ResearchWriteService` +
  `ResearchWritePort`).
- HTTP routes exist with Zod schema, controller, contract tests, and e2e
  smoke; auth-scoped kernel-only.
- Direct write methods on app-side `finding.repository.ts` and
  `research-edge.repository.ts` are deleted, not exported, not "private".
- The following greps return **zero hits outside the writer/transformer**:

  ```sh
  rg "db\.insert\(research(Cycle|Finding|Edge)\)" apps packages
  rg "from .*repositories/research-(cycle|finding|edge)" apps/console-api/src
  rg "from '@interview/thalamus/src/repositories/" packages apps
  rg "researchCycle\.\$inferInsert|researchFinding\.\$inferInsert|researchEdge\.\$inferInsert" apps/console-api/src/services
  ```

- Contract tests cover both the business DTO path (typed surface) and at least
  one transactional emission round trip.

C2/M3 only count as closed when:

- Old `sim-promotion.service.ts` and `research-graph.service.ts` are deleted
  (no `@deprecated` re-export survives in `main`).
- All consumers import the new split services directly.
- Per-service unit tests exist; the pure helpers (`sim-promotion-text.ts`,
  `sim-telemetry-scoring.ts`, `finding-events.ts`) have their own units.

I5/C4 only count as closed when:

- `rg "@interview/thalamus" packages/sweep/src` returns zero hits (or only
  `cortex-kernel` if that route is chosen).
- `rg -i "satellite|orbit|conjunction|SSA" packages/thalamus/src` returns only
  generic vocabulary references (no domain-specific defaults, no SSA
  prompts).

---

## Anti-duplication rules (hold across all phases)

- Ports defined once, even when there is a single implementation.
- New services consume ports, not impls.
- No "FindingForPromotion" / "FindingForGraph" DTOs — one shared `Finding`
  type. Divergent views go through transformers, never new types.
- `apps/console-api/src/container.ts` is the only place that wires impls to
  ports. Tests use port doubles, never reach into impls.
- Contract tests live at the port boundary so swapping impls does not
  invalidate them.
- Any transitional façade ships with deletion deadline + lint gate.

---

## Sequencing notes

- Phases 1 and 2 are zero-risk and ship as standalone PRs first. They make
  the dependency graph readable before the writer work begins.
- Phase 3 ships before Phase 4 lands so the local writer compiles even if HTTP
  routes are still being reviewed.
- Phases 6 and 7 absolutely must not start before Phase 5 is complete:
  splitting before unification is what made the debt grow (C2 +53 LOC,
  M3 +11 LOC since Pass 1).
- Phase 9 is independent of phases 3-8 and could parallelize, but is scheduled
  last to avoid context-switching while the writer migration is in flight.

---

## Out of scope for this sprint

- Frontend changes (Sprint 3 and Sprint 7 own those).
- Eval protocol items (Sprint 4 owns those).
- Spec status bumps DRAFT → APPROVED (separate spec hardening pass).
