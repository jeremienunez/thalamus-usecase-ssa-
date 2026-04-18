# Plan 2 — `packages/sweep/src/sim/` becomes agnostic

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Make `packages/sweep/src/sim/` a domain-agnostic simulation kernel. All SSA logic (fleet SQL, personas, action schema, perturbation generators, god-event templates, promotion, bus datasheets, telemetry/pc swarm launchers, aggregators) moves to `apps/console-api/src/agent/ssa/sim/` alongside the ssa/sweep pack from Plan 1. Ten ports bridge the two.

**Assumes:** Plan 1 is merged. `apps/console-api/src/agent/ssa/` already contains the ssa/sweep pack. `packages/sweep/` is generic outside sim/. Sim still SSA internally (untouched by Plan 1).

**Strangler fig:** Every public sim API keeps its signature. `startTelemetrySwarm`, `startPcEstimatorSwarm`, `SwarmService.launchSwarm`, `SimOrchestrator.startStandalone`, `DagTurnRunner.runTurn`, `SequentialTurnRunner.runTurn`, `AggregatorService.aggregate`, `GodChannelService.*`. CLI and workers untouched until Plan 3.

**Reference:** original combined draft (now obsolete) was `docs/superpowers/plans/2026-04-17-sim-agnostic-refactor.md`. This plan supersedes its Phases A + B + E.

**Risk gates (between every task):**

- `pnpm -r typecheck` clean
- UC3 E2E: `cd apps/console-api && pnpm exec vitest run tests/e2e/swarm-uc3.e2e.spec.ts` (moved there in Plan 1's Task B9 equivalent — if still in sweep, run there)
- Telemetry swarm unit: `pnpm exec vitest run tests/unit/telemetry-swarm.spec.ts` (wherever it lives)
- Sim arch-guard goes RED → GREEN over the plan's lifetime

**Branch:** continuation of `refactor/sim-agnostic` after Plan 1 lands.

---

## Reuse map — what Plan 1 and console-api already give us

| Feature needed                            | Already present                                                        | New work                                                |
| ----------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------- |
| SSA pack location                         | `apps/console-api/src/agent/ssa/sweep/` (Plan 1) + skills dir          | parallel `agent/ssa/sim/` barrel                        |
| DI composition root                       | `apps/console-api/src/container.ts` (wires sweep ports in Plan 1)      | extend with 10 sim ports                                |
| Confidence service                        | built inside `buildSweepContainer` (post Plan 1, flows into promotion) | reuse for `SimPromotionAdapter` too                     |
| Satellite audit queries                   | `SatelliteAuditService` (Plan 1 merged sweep's satellite queries in)   | reuse — `SimFleetProvider` reads fleet snapshots via it |
| ResearchGraphService for promotion writes | `thalamus.graphService`                                                | reuse via `SimPromotionAdapter`                         |
| Test fixture for E2E                      | `apps/console-api/tests/e2e/swarm-uc3.e2e.spec.ts` (moved in Plan 1)   | passes in-pack SSA providers                            |

## Ports introduced (10)

`packages/sweep/src/sim/ports/`:

1. `SimActionSchemaProvider` — pack-owned action Zod schema
2. `SimFleetProvider` — agent subject (operator) snapshot + author labels
3. `SimTurnTargetProvider` — telemetry/pc target bag per-fish
4. `SimAgentPersonaComposer` — persona/goals/constraints from subject snapshot
5. `SimPromptComposer` — turn prompt (fleet/telemetry/pc sections)
6. `SimCortexSelector` — which skill name per turn
7. `SimPerturbationPack` — uc1/uc3 generators + god-event templates + extractGodEvents
8. `SimAggregationStrategy` — labelAction + clusterFallback
9. `SimKindGuard` — validateLaunch + defaultMaxTurns
10. `SimPromotionAdapter` — accept sim-sourced suggestions (wraps existing SweepPromotionAdapter from Plan 1 in SSA pack)

## New files in `apps/console-api/src/agent/ssa/sim/`

```
action-schema.ts
fleet-provider.ts          # uses SatelliteAuditService (Plan 1) — no new SQL
targets.ts                 # merges load-telemetry-target + load-pc-target
persona-composer.ts
prompt-renderer.ts
cortex-selector.ts
perturbation-pack.ts       # uc1/uc3 generators + god-event templates + extractGodEvents
aggregation-strategy.ts
kind-guard.ts
promotion.ts               # delegates to Plan 1's SsaPromotionAdapter + ConfidenceService
bus-datasheets/
  loader.ts                # moved
  datasheets.json          # moved
swarms/
  telemetry.ts             # ex telemetry-swarm.service.ts
  pc.ts                    # ex pc-swarm.service.ts (unstubs startPcEstimatorSwarm for Plan 3)
aggregators/
  telemetry.ts             # ex aggregator-telemetry.ts
  pc.ts                    # ex aggregator-pc.ts
index.ts
```

## Files deleted from `packages/sweep/src/sim/`

- `agent-builder.ts` body simplified (reads via ports)
- `load-pc-target.ts` (moved)
- `load-telemetry-target.ts` (moved)
- `prompt.ts` (moved)
- `bus-datasheets.ts` + `bus-datasheets.json` (moved)
- `telemetry-swarm.service.ts` (moved)
- `pc-swarm.service.ts` (moved)
- `aggregator-telemetry.ts` (moved)
- `aggregator-pc.ts` (moved)
- `promote.ts` (moved)

---

# Phase A — Scaffolding (zero runtime change)

## Task A.1 — Generic types + action schema envelope

**Files:**

- Create: `packages/sweep/src/sim/ports/action-schema.port.ts`
- Modify: `packages/sweep/src/sim/types.ts`
- Modify: `packages/sweep/src/sim/schema.ts`

Port:

```ts
// packages/sweep/src/sim/ports/action-schema.port.ts
import type { z } from "zod";
export interface SimActionSchemaProvider {
  actionSchema(): z.ZodTypeAny;
}
```

In `schema.ts` add (keep existing SSA body intact; removed in Task B5):

```ts
export function buildTurnResponseSchema<T extends z.ZodTypeAny>(action: T) {
  return z.object({
    action,
    rationale: z.string().min(1),
    observableSummary: z.string().min(1),
  });
}
```

Make `types.ts` generic — `AgentContext<TDomain>`, `FishSeed<TSeed>`, `TurnResponse<TAction>`, `FishOutcome<TAction>`. Add a **temporary compat block** at the bottom re-exporting `TurnAction`/`SeedRefs`/`PerturbationSpec`/`FleetSnapshot`/`TelemetryTarget`/`PcEstimatorTarget` so kernel callers still compile between tasks:

```ts
// TEMPORARY COMPAT — delete in Task B7 (when all internal callers migrated)
export type {
  TurnAction,
  SeedRefs,
  PerturbationSpec,
  SwarmConfig,
  SimConfig,
  SimKind,
} from "@interview/db-schema";
export type {
  FleetSnapshot,
  TelemetryTarget,
  PcEstimatorTarget,
} from "./sim-ssa-types-temp";
// `./sim-ssa-types-temp.ts` is a tiny re-export file we create to hold these three
// until the pack-side equivalents take over. Delete with the block.
```

- [ ] **A.1.1** Create port, envelope builder, generic types, compat block.
- [ ] **A.1.2** Unit test: `buildTurnResponseSchema(z.object({kind: z.literal("noop")}))` accepts valid, rejects invalid.
- [ ] **A.1.3** `pnpm -r typecheck` + full tests.
- [ ] **A.1.4** Commit: `refactor(sim): generic types + action schema envelope port`

## Task A.2 — Sim arch-guard + SSA sim pack barrel

**Files:**

- Create: `packages/sweep/tests/sim/arch-guard.spec.ts`
- Create: `packages/cli/tests/arch-guard.spec.ts` (defers until Plan 3 activates — can land here as a `.skip` placeholder or wait for Plan 3)
- Create: `apps/console-api/src/agent/ssa/sim/index.ts` (empty barrel)

Sim arch-guard: forbidden db-schema symbols (`satellite`, `operator`, `conjunctionEvent`, `TELEMETRY_SCALAR_KEYS`), forbidden domain types (`TurnAction`, `SeedRefs`, `PerturbationSpec`, `FleetSnapshot`, `TelemetryTarget`, `PcEstimatorTarget`), forbidden SQL FROM. Walk `packages/sweep/src/sim/` only.

**Note:** The temporary compat block in types.ts from A.1 will fail the type check. Mark the guard with an allowlist for `types.ts` during the plan — remove the allowlist in Task B7 when the compat block is deleted.

- [ ] **A.2.1** Write both guards.
- [ ] **A.2.2** Run sim guard → RED (violations are the refactor worklist).
- [ ] **A.2.3** Commit: `test(sim): arch-guard + SSA sim pack barrel`

---

# Phase B — Extract SSA pack (10 ports, reuse console-api services)

## Task B.1 — `SimFleetProvider` via `SatelliteAuditService`

**Files:**

- Create: `packages/sweep/src/sim/ports/fleet.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/fleet-provider.ts`
- Modify: `packages/sweep/src/sim/agent-builder.ts` (consume port)
- Modify: `packages/sweep/src/sim/memory.service.ts` (consume port for author labels)

Port:

```ts
// packages/sweep/src/sim/ports/fleet.port.ts
export interface AgentSubjectRef {
  kind: string;
  id: number;
}
export interface AgentSubjectSnapshot {
  displayName: string;
  attributes: Record<string, unknown>;
}
export interface SimFleetProvider {
  getAgentSubject(ref: AgentSubjectRef): Promise<AgentSubjectSnapshot>;
  getAuthorLabels(agentIds: number[]): Promise<Map<number, string>>;
}
```

**Reuse:** after Plan 1 Task 4.1, `SatelliteAuditService` has `listByOperator` + satellite/operator lookups. `SimFleetProvider` impl delegates — does NOT duplicate SQL.

```ts
// apps/console-api/src/agent/ssa/sim/fleet-provider.ts
import type { SimFleetProvider, AgentSubjectRef, AgentSubjectSnapshot } from "@interview/sweep";
import type { SatelliteAuditService } from "../../../services/satellite-audit.service";
import type { SatelliteRepository } from "../../../repositories/satellite.repository";

export class SsaFleetProvider implements SimFleetProvider {
  constructor(private readonly deps: {
    satelliteAudit: SatelliteAuditService;
    satelliteRepo: SatelliteRepository;
  }) {}

  async getAgentSubject(ref: AgentSubjectRef): Promise<AgentSubjectSnapshot> {
    if (ref.kind !== "operator") throw new Error(`SsaFleetProvider only supports kind=operator`);
    // Compose the snapshot from SatelliteAuditService.listByOperator (satellite count, regime mix, platform mix)
    // + SatelliteRepository.findOperatorCountry (country) + satellite audit aggregates.
    // Paste the SQL body from the OLD sweep agent-builder.loadFleetSnapshot here,
    // adapted to call methods on the injected services instead of raw db.execute.
    return {
      displayName: /* operator.name */,
      attributes: {
        operatorCountry: /* from findOperatorCountry */,
        satelliteCount: /* from listByOperator */,
        regimeMix: /* aggregate */,
        platformMix: /* aggregate */,
        avgLaunchYear: /* compute */,
      },
    };
  }

  async getAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
    // Paste from memory.service lookupAuthorLabels; uses satellite repo / operator lookup.
  }
}
```

**If `SatelliteAuditService` lacks the right aggregate method**, add it there in the same commit (follows Plan 1's "extend existing service" rule).

- [ ] **B.1.1** Write port + provider; extend `SatelliteAuditService` if needed (add `getOperatorFleetSnapshot(operatorId)`).
- [ ] **B.1.2** Rewrite agent-builder.ts to take `deps.fleet + deps.persona` (persona port stub — placeholder in B.3).
- [ ] **B.1.3** Rewrite memory.service.ts author labels via `deps.fleet.getAuthorLabels`.
- [ ] **B.1.4** Update `BuildSweepOpts.sim` to accept fleet + persona ports.
- [ ] **B.1.5** Update console-api container construction + E2E fixture.
- [ ] **B.1.6** Typecheck + UC3 E2E.
- [ ] **B.1.7** Commit: `refactor(sim): SimFleetProvider + ssa impl via SatelliteAuditService (no new SQL)`

## Task B.2 — `SimTurnTargetProvider`

**Files:**

- Create: `packages/sweep/src/sim/ports/target.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/targets.ts`
- Delete: `packages/sweep/src/sim/load-pc-target.ts`, `load-telemetry-target.ts`
- Modify: both turn runners

Port:

```ts
export interface SimTurnTargetProvider {
  loadTargets(args: {
    simRunId: number;
    seedHints: Record<string, unknown>;
  }): Promise<Record<string, unknown>>;
}
```

Fuse `load-telemetry-target.ts` + `load-pc-target.ts` bodies into a single provider. Reuse `SatelliteRepository` (console-api's) for the satellite/bus lookups instead of re-running SQL.

- [ ] **B.2.1** Move + fuse + rewire runners.
- [ ] **B.2.2** Container + fixture updates.
- [ ] **B.2.3** Typecheck + E2E + telemetry-swarm unit.
- [ ] **B.2.4** Commit: `refactor(sim): SimTurnTargetProvider port; targets loaded via console-api repos`

## Task B.3 — `SimAgentPersonaComposer`

**Files:**

- Create: `packages/sweep/src/sim/ports/persona.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/persona-composer.ts`

Lift `inferRiskProfile` + `composePersona` + `composeGoals` + `composeConstraints` + `riskProfileDescription` verbatim from old `agent-builder.ts:159-240`. Adapt to read from `subject.attributes`.

- [ ] **B.3.1** Move bodies. Port:

```ts
export interface ComposedPersona {
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}
export interface SimAgentPersonaComposer {
  compose(
    subject: AgentSubjectSnapshot,
    hints: Record<string, unknown>,
  ): ComposedPersona;
}
```

- [ ] **B.3.2** Unit test: same subject → same persona (determinism load-bearing for fixture cache).
- [ ] **B.3.3** Commit: `refactor(sim): SimAgentPersonaComposer port; SSA persona in console-api`

## Task B.4 — `SimPromptComposer` + `SimCortexSelector`

**Files:**

- Create: `packages/sweep/src/sim/ports/prompt.port.ts`, `cortex-selector.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/prompt-renderer.ts`, `cortex-selector.ts`
- Delete: `packages/sweep/src/sim/prompt.ts`
- Modify: both turn runners

Move `renderTurnPrompt` and all its section builders (fleet snapshot, telemetry target, pc target) to `prompt-renderer.ts`. Sections read from `ctx.domain.fleet`, `ctx.domain.telemetryTarget`, `ctx.domain.pcEstimatorTarget`.

Cortex selector replaces `pickCortexName` from [turn-runner-dag.ts:42-46](../../../packages/sweep/src/sim/turn-runner-dag.ts#L42-L46).

- [ ] **B.4.1** Create ports + move impls.
- [ ] **B.4.2** Rewire runners — drop `import { renderTurnPrompt }` and the `DEFAULT_CORTEX_NAME`/`TELEMETRY_CORTEX_NAME`/`PC_ESTIMATOR_CORTEX_NAME` constants.
- [ ] **B.4.3** Unit test SsaPromptRenderer with fleet-only, telemetry-only, pc-only contexts.
- [ ] **B.4.4** Commit: `refactor(sim): PromptComposer + CortexSelector ports`

## Task B.5 — `SimActionSchemaProvider` (move SSA schemas)

**Files:**

- Create: `apps/console-api/src/agent/ssa/sim/action-schema.ts`
- Modify: `packages/sweep/src/sim/schema.ts` (strip)

Move `turnActionSchema`, `godEventSchema`, `perturbationSchema`, `seedRefsSchema`, `launchSwarmSchema` verbatim to the pack. Kernel schema.ts retains only `buildTurnResponseSchema` + generic `genericLaunchSwarmSchema`.

Rewire turn runners: `buildTurnResponseSchema(deps.schemaProvider.actionSchema())`.

- [ ] **B.5.1** Move + strip + rewire.
- [ ] **B.5.2** UC3 E2E + telemetry unit.
- [ ] **B.5.3** Commit: `refactor(sim): lift SSA action/seed/swarm schemas to console-api`

## Task B.6 — `SimPerturbationPack`

**Files:**

- Create: `packages/sweep/src/sim/ports/perturbation-pack.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/perturbation-pack.ts`
- Modify: `packages/sweep/src/sim/perturbation.ts` (thin)
- Modify: `packages/sweep/src/sim/god-channel.service.ts` (drop templates)
- Modify: `packages/sweep/src/sim/sim-orchestrator.service.ts` (delegate extractGodEvents)

Lift `uc1Generators`, `uc3Generators`, `GOD_EVENT_TEMPLATES`, `extractGodEvents` to the pack. Kernel `perturbation.ts` keeps only `rngFromSeed` (Mulberry32) + `applyPerturbation(seed, spec, pack)` wrapper.

**Strangler note:** `generateDefaultPerturbations` is re-exported from `packages/sweep/src/index.ts` — Task B.6 replaces it with a call through the pack (`pack.generateSet(...)`). The export name stays in sweep's index.ts as a **thin passthrough** until Plan 3 drops it.

- [ ] **B.6.1** Move bodies.
- [ ] **B.6.2** Kernel orchestrator delegates via `deps.perturbationPack.extractGodEvents(spec)`.
- [ ] **B.6.3** Unit test: deterministic generateSet given same RNG seed.
- [ ] **B.6.4** Commit: `refactor(sim): SimPerturbationPack port; uc1/uc3 + god templates to console-api`

## Task B.7 — Remove types.ts temporary compat block

**Files:**

- Modify: `packages/sweep/src/sim/types.ts` (delete compat block)
- Delete: `packages/sweep/src/sim/sim-ssa-types-temp.ts` (if created in A.1)
- Modify: `packages/sweep/tests/sim/arch-guard.spec.ts` (remove types.ts allowlist)

By this task, all kernel consumers use generic types. The compat block becomes dead. Delete it and verify the arch-guard goes from "red with allowlist" to "red without allowlist, fewer violations".

- [ ] **B.7.1** Delete block.
- [ ] **B.7.2** Run typecheck — fix any residual flat-type references.
- [ ] **B.7.3** Commit: `refactor(sim): drop types.ts compat block; kernel fully generic`

## Task B.8 — `SimAggregationStrategy`

**Files:**

- Create: `packages/sweep/src/sim/ports/aggregation-strategy.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/aggregation-strategy.ts`
- Modify: `packages/sweep/src/sim/aggregator.service.ts`

Lift `labelFromAction` + `clusterByActionKind` (fallback). Kernel keeps k-means + cosine/l2.

- [ ] **B.8.1** Move + rewire.
- [ ] **B.8.2** Unit tests.
- [ ] **B.8.3** Commit: `refactor(sim): SimAggregationStrategy port`

## Task B.9 — `SimKindGuard` + `SimPromotionAdapter`

**Files:**

- Create: `packages/sweep/src/sim/ports/kind-guard.port.ts`, `promotion.port.ts`
- Create: `apps/console-api/src/agent/ssa/sim/kind-guard.ts`, `promotion.ts`
- Modify: `packages/sweep/src/sim/swarm.service.ts` (drop `kind === "uc3_conjunction"` guards)
- Modify: `packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts` (promotion via port)
- Delete: `packages/sweep/src/sim/promote.ts` (move body)

**Promotion reuses Plan 1:** `SsaSimPromotionAdapter` (console-api) wraps `SsaPromotionAdapter` (already in Plan 1's ssa/sweep) — the sim-sourced suggestions go through the SAME promotion path as sweep-sourced ones. Zero duplication.

```ts
// apps/console-api/src/agent/ssa/sim/promotion.ts
import type { SimPromotionAdapter } from "@interview/sweep";
import type { SsaPromotionAdapter } from "../sweep/promotion.ssa"; // Plan 1

export class SsaSimPromotionAdapter implements SimPromotionAdapter {
  constructor(private readonly deps: { sweepPromotion: SsaPromotionAdapter }) {}
  async promote(input) {
    // Map sim suggestion → AcceptedSuggestionInput and delegate
    return this.deps.sweepPromotion.promote({
      /* mapped fields */
    });
  }
}
```

- [ ] **B.9.1** Move promote.ts body to sim/promotion.ts, wrap as adapter over Plan 1's SsaPromotionAdapter.
- [ ] **B.9.2** Create SsaKindGuard from swarm.service guards + maxTurns.
- [ ] **B.9.3** Rewire swarm.service + swarm-aggregate worker.
- [ ] **B.9.4** Commit: `refactor(sim): KindGuard + PromotionAdapter ports; promotion reuses Plan 1's SsaPromotionAdapter`

## Task B.10 — Move swarm launchers + aggregators + bus-datasheets

**Files:** 5 moves + 1 rewrite

```bash
git mv packages/sweep/src/sim/telemetry-swarm.service.ts apps/console-api/src/agent/ssa/sim/swarms/telemetry.ts
git mv packages/sweep/src/sim/pc-swarm.service.ts        apps/console-api/src/agent/ssa/sim/swarms/pc.ts
git mv packages/sweep/src/sim/aggregator-telemetry.ts    apps/console-api/src/agent/ssa/sim/aggregators/telemetry.ts
git mv packages/sweep/src/sim/aggregator-pc.ts           apps/console-api/src/agent/ssa/sim/aggregators/pc.ts
mkdir -p apps/console-api/src/agent/ssa/sim/bus-datasheets
git mv packages/sweep/src/sim/bus-datasheets.ts          apps/console-api/src/agent/ssa/sim/bus-datasheets/loader.ts
git mv packages/sweep/src/sim/bus-datasheets.json        apps/console-api/src/agent/ssa/sim/bus-datasheets/datasheets.json
```

Fix imports in moved files. `startTelemetrySwarm` + `startPcEstimatorSwarm` now live in console-api.

**Strangler for CLI:** `packages/sweep/src/index.ts` still exports `startTelemetrySwarm` — but as a THIN PASSTHROUGH that re-imports from... wait, packages can't import from apps. Two options:

**(a)** Break CLI compile NOW; CLI migration in Plan 3 fixes it. Plan 3 must land immediately after Plan 2.
**(b)** Keep a stub `startTelemetrySwarm` in sweep that throws `"Moved to console-api — use HTTP route"`. CLI gets a useful error at runtime.

Choose **(a)** — ugly to keep a stub. Accept temporary CLI breakage between Plan 2 and Plan 3 merges. The branch `refactor/sim-agnostic` holds all three plans' commits; merge the whole branch when all three land. Intermediate commits have CLI broken; that's acceptable because the branch isn't merged to main until Plan 3 completes.

Also strip from `packages/sweep/src/index.ts`:

- `startTelemetrySwarm`, `TelemetrySwarmOpts`
- `TelemetryAggregatorService`, `TelemetryAggregate`, `TelemetryAggregatorDeps`, `TelemetryScalarStats`
- `lookupBusPrior`, `lookupBusEntry`, `listBusNames`
- `emitSuggestionFromModal`, `emitTelemetrySuggestions`, `EmitSuggestionDeps`, `EmitTelemetrySuggestionsDeps`
- `isKgPromotable`, `isTerminal`, `loadSimTurn` (all from promote.ts)
- `renderTurnPrompt`
- `buildOperatorAgent`, `BuildAgentOpts`, `BuildAgentResult`, `RiskProfile`
- `GOD_EVENT_TEMPLATES`
- `generateDefaultPerturbations`

- [ ] **B.10.1** Move + fix imports.
- [ ] **B.10.2** Strip sweep/src/index.ts SSA sim re-exports.
- [ ] **B.10.3** Populate `apps/console-api/src/agent/ssa/sim/index.ts` barrel.
- [ ] **B.10.4** `pnpm -r typecheck` — expect CLI package to fail (flagged acceptable above). Sweep + console-api must be clean.
- [ ] **B.10.5** UC3 E2E (must pass — it's run via console-api now).
- [ ] **B.10.6** Commit: `refactor(sim): relocate UC launchers + aggregators + bus-datasheets to console-api SSA; CLI will be fixed in Plan 3`

## Task B.11 — Wire console-api container: 10 sim ports

**Files:**

- Modify: `apps/console-api/src/container.ts`

```ts
import * as SsaSim from "./agent/ssa/sim";
// after Plan 1's sweep ports wiring:

const simFleet = new SsaSim.SsaFleetProvider({ satelliteAudit, satelliteRepo });
const simTargets = new SsaSim.SsaTurnTargetProvider({
  satelliteRepo /* bus loader */,
});
const simPersona = new SsaSim.SsaPersonaComposer();
const simPrompt = new SsaSim.SsaPromptRenderer();
const simCortexSel = new SsaSim.SsaCortexSelector();
const simPerturbPack = new SsaSim.SsaPerturbationPack();
const simAggStrategy = new SsaSim.SsaAggregationStrategy();
const simSchema = new SsaSim.SsaActionSchemaProvider();
const simKindGuard = new SsaSim.SsaKindGuard();
const simPromotion = new SsaSim.SsaSimPromotionAdapter({
  sweepPromotion: promotion,
});

const sweepC = buildSweepContainer({
  db,
  redis,
  graphService: thalamusC.graphService,
  ports: {
    /* Plan 1's 6 */
  },
  sim: {
    cortexRegistry: registry,
    embed,
    llmMode,
    fleet: simFleet,
    targets: simTargets,
    persona: simPersona,
    prompt: simPrompt,
    cortexSelector: simCortexSel,
    perturbationPack: simPerturbPack,
    aggStrategy: simAggStrategy,
    schemaProvider: simSchema,
    kindGuard: simKindGuard,
    promotion: simPromotion,
  },
});
```

Extend `SimServicesOpts` in `packages/sweep/src/config/container.ts` to require the 10 ports. Update E2E fixture accordingly (it passes minimal mocks for all 10).

- [ ] **B.11.1** Extend SimServicesOpts type.
- [ ] **B.11.2** Wire console-api container.
- [ ] **B.11.3** Update E2E fixture (tests/e2e/swarm-uc3.e2e.spec.ts — now in console-api).
- [ ] **B.11.4** Typecheck + E2E.
- [ ] **B.11.5** Commit: `feat: console-api wires 10 sim ports; BuildSweepOpts.sim requires them`

---

# Phase C — Arch-guard green + cleanup

## Task C.1 — Sim arch-guard green

Run `cd packages/sweep && pnpm exec vitest run tests/sim/arch-guard.spec.ts`. Expect GREEN.

If red: the reported file name is the last SSA leftover. Fix + rerun.

## Task C.2 — Sweep's `agent-builder.ts` rename

`buildOperatorAgent` → `buildSimAgent`. Since this export is already removed from sweep index.ts in B.10, the rename is internal to the kernel and its console-api caller.

- [ ] Rename, update references, commit.

## Task C.3 — CHANGELOG + TODO

```md
### Refactor — sim kernel agnostic (Plan 2)

- `packages/sweep/src/sim/` is a domain-agnostic simulation kernel. All SSA
  logic (fleet SQL via `SatelliteAuditService`, personas, action schema,
  perturbation generators, god-event templates, bus datasheets, telemetry + pc
  swarm launchers, aggregators, promotion) lives in `apps/console-api/src/agent/ssa/sim/`.
- 10 ports introduced: SimActionSchemaProvider, SimFleetProvider,
  SimTurnTargetProvider, SimAgentPersonaComposer, SimPromptComposer,
  SimCortexSelector, SimPerturbationPack, SimAggregationStrategy, SimKindGuard,
  SimPromotionAdapter.
- No new SQL — SimFleetProvider reads fleet data via Plan 1's `SatelliteAuditService`.
  SimPromotionAdapter wraps Plan 1's `SsaPromotionAdapter` — zero duplicate
  KG-write logic.
- `packages/sweep/src/index.ts` drops all SSA sim exports (startTelemetrySwarm,
  GOD_EVENT_TEMPLATES, TelemetryAggregatorService, etc.). CLI is broken on this
  commit — Plan 3 restores it via HTTP routes.
- Sim arch-guard (`packages/sweep/tests/sim/arch-guard.spec.ts`) prevents regression.
```

- [ ] Commit: `docs: record Plan 2 (sim-agnostic) completion`

---

# Self-review

- [x] Strangler: all sim public APIs preserved EXCEPT the SSA-specific launchers (`startTelemetrySwarm`, etc.) which relocate to console-api — this breaks CLI, accepted until Plan 3 lands in the same branch.
- [x] Reuse-first: `SimFleetProvider` delegates to `SatelliteAuditService`. `SimPromotionAdapter` wraps `SsaPromotionAdapter`. Zero new SQL, zero duplicate promotion logic.
- [x] Arch-guard written early (A.2), green at C.1.
- [x] Port interfaces concrete (no TODO shapes).
- [x] Every task risk-gated by UC3 E2E + typecheck.
- [x] Types generic throughout: `AgentContext<TDomain>`, `FishSeed<TSeed>`, `TurnResponse<TAction>`, `FishOutcome<TAction>`.
- [x] Types.ts compat block explicitly removed (B.7) once kernel-generic.
