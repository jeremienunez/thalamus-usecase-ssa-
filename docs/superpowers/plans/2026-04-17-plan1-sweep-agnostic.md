# Plan 1 — `packages/sweep/` becomes agnostic (reuse-first)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Turn `packages/sweep/` into a generic sweep/finding engine. **Reuse console-api's existing 5-layer stack**: `SweepSuggestionsService`, `SweepAuditRepository`, `SweepFeedbackRepository`, `SatelliteAuditService`, `IngestionService`, `CycleRunnerService` already do 80% of what the SSA side needs. The refactor is mostly: (a) lift SSA bodies out of sweep's services, (b) fold them into the existing console-api services, (c) bridge via six thin ports, (d) delete dead code.

**Strangler fig principle:** Every public API in sweep keeps its current signature until Plan 3. `NanoSweepService.sweep(limit, mode)`, `SweepResolutionService.resolve(id)` / `.resolve(id, selections)`, `IngestionRegistry.{has,names,register,dispatch}` — all preserved. Callers change when we're ready; we don't flip them under their feet.

**Reference:** [docs/specs/2026-04-17-sweep-target-architecture.md](../../specs/2026-04-17-sweep-target-architecture.md) for the overall boundaries, overridden where this plan is more specific.

**Risk gates (run between every task):**

- `pnpm -r typecheck` clean
- UC3 E2E green: `cd packages/sweep && pnpm exec vitest run tests/e2e/swarm-uc3.e2e.spec.ts`
- Console-api unit tests green

**Branch:** `refactor/sim-agnostic`

---

## Decisions confirmed upfront

1. `satellite.repository.ts` / `satellite.service.ts` in sweep are **NOT** merged into console-api's (different methods, different purpose). Sweep's satellite audit methods fold into **console-api's existing `SatelliteAuditService`**.
2. `SweepRepository` gets a `FindingDomainSchema` port with concrete `serialize(insert)` / `deserialize(redisRow)` methods. The Redis format stays flat SSA (no data migration); the schema maps `{domain, attributes, summary, severity}` ↔ `{operatorCountryName, category, title, description, ...}`.
3. `admin-sweep.controller.ts` + `admin.routes.ts` in sweep are **dead code** (never mounted by console-api; the real HTTP surface is `sweep.routes.ts` + `sweep-suggestions.controller.ts` + `sweep-mission.controller.ts`). **DELETE, don't move.**
4. `finding-routing.ts` → port + SSA impl in pack.
5. CLI `sweepC.resolutionService.resolve(suggestionId)` at [boot.ts:286](../../../packages/cli/src/boot.ts#L286) — **preserved via 1-arg façade** on `SweepResolutionService`. CLI migration is Plan 3's problem.
6. `SsaPromotionAdapter` takes `confidence?: ConfidenceService | null`. In Plan 1's console-api wiring we pass `null` to avoid a container-construction cycle; sim-source-class promotion remains on the legacy sweep/sim path until Plan 2 consolidates it.

## Reuse map — what console-api already gives us

| Feature needed                                                              | Already in console-api                                                         | New work                                                                                              |
| --------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| List/review suggestions HTTP                                                | `SweepSuggestionsService` + `sweep-suggestions.controller` + `sweep.routes.ts` | zero                                                                                                  |
| Write `sweep_audit` rows after accept                                       | `SweepAuditRepository`                                                         | extend with `insertResolutionAudit(...)` while keeping `insertEnrichmentSuccess(...)` for KNN/mission |
| Write feedback                                                              | `SweepFeedbackRepository.push`                                                 | shape adapter only (`accepted` → `wasAccepted`, carry `operatorCountryName`)                          |
| Enqueue ingestion jobs                                                      | `IngestionService.{enqueue,listJobs}`                                          | preserve `has/names/noop` in registry port                                                            |
| Call nano audit                                                             | `CycleRunnerService` → `sweep.nanoSweepService.sweep(limit, mode)`             | keep façade intact                                                                                    |
| Satellite lookup/insert                                                     | `SatelliteRepository` (console-api)                                            | zero                                                                                                  |
| Satellite audit queries (listWithOrbital, updateField, listNullCandidates…) | **folds into** `SatelliteAuditService`                                         | move 8 methods                                                                                        |

## New files to create in console-api

```
apps/console-api/src/agent/ssa/sweep/
  finding-schema.ssa.ts         # serialize/deserialize flat SSA ↔ generic
  audit-provider.ssa.ts         # DomainAuditProvider impl (ex nano-sweep SSA body)
  resolution-handlers.ssa.ts    # 5 action handlers lifted from sweep-resolution
  promotion.ssa.ts              # thin delegate: SweepAuditRepository + ConfidenceService
  finding-routing.ssa.ts        # cortex→tier map (moved)
  doctrine-parser.ssa.ts        # util (moved)
  ingesters/
    tle-history-fetcher.ts      # moved
    itu-filings-fetcher.ts      # moved
    launch-manifest-fetcher.ts  # moved
    fragmentation-events-fetcher.ts  # moved
    notam-fetcher.ts            # moved
    space-weather-fetcher.ts    # moved
    index.ts                    # IngestionSourceProvider aggregate
  index.ts
```

No new repositories in console-api. No new services in console-api (except the 7 files above, all SSA-pack).

## Files deleted in sweep

- `packages/sweep/src/controllers/admin-sweep.controller.ts` (dead)
- `packages/sweep/src/routes/admin.routes.ts` (dead)
- `packages/sweep/src/repositories/satellite.repository.ts` (folded into SatelliteAuditService)
- `packages/sweep/src/services/satellite.service.ts` (verify consumers first; expected dead)
- `packages/sweep/src/services/finding-routing.ts` (moved)
- `packages/sweep/src/utils/doctrine-parser.ts` (moved)
- `packages/sweep/src/jobs/ingesters/*` (moved)
- `packages/sweep/src/services/satellite-sweep-chat.service.ts` + controller + route + repo + dto + viz.service.ts (moved to console-api)

---

# Phase 0 — Ports + arch-guard + widen container (zero runtime change)

## Task 0.1 — Define 6 ports with concrete interfaces

**Files:**

- Create: `packages/sweep/src/ports/{finding-schema,nano-audit,promotion,finding-routing,resolution-handlers,ingestion-registry}.port.ts` + `index.ts`

### Port interfaces (concrete)

```ts
// packages/sweep/src/ports/finding-schema.port.ts
import type { z } from "zod";

/** Generic row returned by SweepRepository generic reads. */
export interface GenericSuggestionRow {
  id: string;
  domain: string;
  createdAt: string;
  accepted: boolean | null;
  reviewedAt: string | null;
  reviewerNote: string | null;
  resolutionStatus: string;
  resolvedAt: string | null;
  resolutionErrors: string | null;
  simSwarmId: string | null;
  simDistribution: string | null;
  /** Domain-typed payload after deserialize. Schema decides its shape. */
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
}

export interface GenericInsertSuggestion {
  domain: string;
  /** Free-form domain payload; schema.serialize encodes into the Redis hash. */
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
  simSwarmId?: string | null;
  simDistribution?: string | null;
}

/**
 * The kernel holds no knowledge of domain row shape. The pack supplies
 * this schema at container construction time.
 */
export interface FindingDomainSchema {
  /** Validate + normalize the domain payload before insert. */
  serialize(input: Record<string, unknown>): {
    /** Top-level Redis hash fields the pack wants stored flat (for indexing/filtering). */
    flatFields: Record<string, string | number | null>;
    /** Anything that should go into a JSON blob under a single key. */
    blob: Record<string, unknown>;
  };
  /** Reconstruct the domain payload from the Redis hash read. */
  deserialize(raw: {
    flatFields: Record<string, string | null>;
    blob: Record<string, unknown>;
  }): Record<string, unknown>;
  /** Flat field names that the pack wants filterable in list queries. */
  indexedFields: string[];
}
```

```ts
// packages/sweep/src/ports/nano-audit.port.ts

/**
 * Engine → pack. The pack runs the audit pass (nano calls, batching,
 * prompt composition, result validation). Engine only knows it gets
 * candidates back, which it persists via SweepRepository.
 */
export interface AuditCycleContext {
  cycleId: string;
  /** Legacy compat: "nullScan" | "briefing" strings passed by CycleRunnerService. */
  mode: string;
  /** Legacy compat: limit parameter from the original .sweep(limit, mode) signature. */
  limit: number;
}

export interface AuditCandidate {
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
}

export interface DomainAuditProvider {
  runAudit(ctx: AuditCycleContext): Promise<AuditCandidate[]>;
  /** Optional feedback mining; engine calls after each review. */
  recordFeedback?(input: {
    suggestionId: string;
    accepted: boolean;
    reviewerNote: string | null;
    domainFields: Record<string, unknown>;
  }): Promise<void>;
}
```

```ts
// packages/sweep/src/ports/promotion.port.ts

export interface AcceptedSuggestionInput {
  suggestionId: string;
  domain: string;
  domainFields: Record<string, unknown>;
  resolutionPayload: string | null;
  reviewer: string | null;
  reviewerNote: string | null;
}

export interface PromotionResult {
  ok: boolean;
  kgFindingId?: string;
  errors?: string[];
}

export interface SweepPromotionAdapter {
  /** Called by SweepResolutionService after the action handler returns ok. */
  promote(input: AcceptedSuggestionInput): Promise<PromotionResult>;
}
```

```ts
// packages/sweep/src/ports/finding-routing.port.ts
export type FindingTier = string;
export interface FindingRoutingPolicy {
  tiersForSource(source: { kind: string; name: string }): FindingTier[];
}
```

```ts
// packages/sweep/src/ports/resolution-handlers.port.ts

export interface ResolutionActionContext {
  suggestionId: string;
  reviewer: string | null;
  reviewerNote: string | null;
  /** Selectors from the original .resolve(id, selections) 2-arg façade. */
  selectors?: Record<string, unknown>;
}

export interface ResolutionSelectionOption {
  value: string | number;
  label: string;
  detail?: string;
}

export interface ResolutionPendingSelection {
  key: string;
  label: string;
  options: ResolutionSelectionOption[];
}

export interface ResolutionHandlerResult {
  ok: boolean;
  /** Number of rows mutated by the handler; preserved for ResolutionResult. */
  affectedRows: number;
  /** When the handler needs user disambiguation; engine surfaces this back. */
  pending?: ResolutionPendingSelection[];
  errors?: string[];
}

export interface ResolutionHandler {
  kind: string;
  handle(
    action: Record<string, unknown>,
    ctx: ResolutionActionContext,
  ): Promise<ResolutionHandlerResult>;
}

export interface ResolutionHandlerRegistry {
  get(kind: string): ResolutionHandler | undefined;
  list(): ResolutionHandler[];
}
```

```ts
// packages/sweep/src/ports/ingestion-registry.port.ts
import type { Database } from "@interview/db-schema";
import type Redis from "ioredis";

export interface IngestionRunContext {
  db: Database;
  /** Optional for future sources; current fetchers only require db + logger. */
  redis?: Redis;
  logger: {
    info: (obj: unknown, msg?: string) => void;
    warn: (obj: unknown, msg?: string) => void;
    error: (obj: unknown, msg?: string) => void;
  };
  signal?: AbortSignal;
}

export interface IngestionSource<TResult = unknown> {
  /** Job name — also used by BullMQ + schedulers. */
  id: string;
  description?: string;
  /** Optional cron; when present, schedulers.ts auto-registers a repeat job. */
  cron?: string;
  run(ctx: IngestionRunContext): Promise<TResult>;
}

export interface IngestionRegisterContext {
  add(source: IngestionSource): void;
}

export interface IngestionSourceProvider {
  register(ctx: IngestionRegisterContext): void;
}
```

```ts
// packages/sweep/src/ports/index.ts
export * from "./finding-schema.port";
export * from "./nano-audit.port";
export * from "./promotion.port";
export * from "./finding-routing.port";
export * from "./resolution-handlers.port";
export * from "./ingestion-registry.port";
```

- [ ] **0.1.1** Create all 7 files with the bodies above.
- [ ] **0.1.2** Typecheck: `cd packages/sweep && pnpm exec tsc --noEmit` — expect clean.
- [ ] **0.1.3** Commit: `feat(sweep): port interfaces (finding-schema, audit, promotion, routing, resolution, ingestion)`

## Task 0.2 — Arch-guard + SSA pack barrel

**Files:**

- Create: `packages/sweep/tests/arch-guard-package.spec.ts`
- Create: `apps/console-api/src/agent/ssa/sweep/index.ts` (empty)

Paste the `describe("packages/sweep/ is SSA-agnostic — sim/ excluded")` spec from the previous Plan 1 draft (three checks: forbidden file names, forbidden db-schema imports, forbidden SQL FROM). Sim/ excluded path kept.

Empty barrel for pack.

- [ ] **0.2.1** Write both files.
- [ ] **0.2.2** `cd packages/sweep && pnpm exec vitest run tests/arch-guard-package.spec.ts` → expect RED (many violations — the progress dashboard).
- [ ] **0.2.3** Commit: `test(sweep): arch-guard + SSA sweep pack barrel`

## Task 0.3 — Widen `BuildSweepOpts` with optional port overrides

**Files:**

- Modify: `packages/sweep/src/config/container.ts`

Current shape ([container.ts:55-90](../../../packages/sweep/src/config/container.ts#L55-L90)): `BuildSweepOpts` takes `db`, `redis`, optional `graphService`, optional `sim`. Internally constructs `confidenceService`, `satelliteRepo` (sweep's), `nanoSweepService(satelliteRepo, sweepRepo)`, etc.

**Change:** Add optional fields; when supplied, override internal construction. When absent, current behavior preserved.

```ts
export interface BuildSweepOpts {
  db: Database;
  redis: IORedis;
  /** Keep optional: existing console-api + UC3 E2E callers omit it today. */
  graphService?: ResearchGraphService;
  sim?: SimServicesOpts;

  // NEW — all optional; zero-arg defaults mean existing callers still work.
  ports?: {
    findingSchema?: FindingDomainSchema;
    audit?: DomainAuditProvider;
    promotion?: SweepPromotionAdapter;
    findingRouting?: FindingRoutingPolicy;
    resolutionHandlers?: ResolutionHandlerRegistry;
    ingestion?: IngestionSourceProvider[];
  };
}
```

Inside `buildSweepContainer`, keep the existing instantiation order but gate each SSA construction on whether a port override was supplied. Do **not** strengthen any existing required constructor arg in this task; the point is additive compatibility only.

**This task creates NO new wiring paths yet** — it just widens the opts type. Default behavior is identical; no caller change. Safe to land alone.

- [ ] **0.3.1** Add the `ports` field + type imports.
- [ ] **0.3.2** Typecheck + run UC3 E2E.
- [ ] **0.3.3** Commit: `refactor(sweep): widen BuildSweepOpts with optional port overrides (behavior unchanged)`

---

# Phase 1 — Build SSA pack impls (not wired to runtime)

Each file below is a port impl; unit tests prove it does the right thing in isolation. Runtime still uses the old inlined SSA code. Wiring happens in Phase 3.

## Task 1.1 — `finding-schema.ssa.ts` — serialize/deserialize

**Files:**

- Create: `apps/console-api/src/agent/ssa/sweep/finding-schema.ssa.ts`
- Test: `apps/console-api/tests/unit/agent/ssa/sweep/finding-schema.spec.ts`

Read [repositories/sweep.repository.ts:27-90](../../../packages/sweep/src/repositories/sweep.repository.ts#L27-L90) to see the current flat SSA fields: `operatorCountryId`, `operatorCountryName`, `category`, `severity`, `title`, `description`, `affectedSatellites`, `suggestedAction`, `webEvidence`, `resolutionPayload`, `simSwarmId`, `simDistribution`.

```ts
// apps/console-api/src/agent/ssa/sweep/finding-schema.ssa.ts
import { z } from "zod";
import type { FindingDomainSchema } from "@interview/sweep";

const ssaInsert = z.object({
  operatorCountryId: z
    .union([z.bigint(), z.null()])
    .transform((v) => (v === null ? null : String(v))),
  operatorCountryName: z.string(),
  category: z.enum(/* paste SweepCategory enum values */),
  severity: z.enum(/* paste SweepSeverity enum values */),
  title: z.string(),
  description: z.string(),
  affectedSatellites: z.number().int(),
  suggestedAction: z.string(),
  webEvidence: z.string().nullable(),
});

export const ssaFindingSchema: FindingDomainSchema = {
  indexedFields: ["operatorCountryId", "category", "severity", "accepted"],

  serialize(input) {
    const parsed = ssaInsert.parse(input);
    return {
      flatFields: {
        operatorCountryId: parsed.operatorCountryId,
        operatorCountryName: parsed.operatorCountryName,
        category: parsed.category,
        severity: parsed.severity,
        title: parsed.title,
        description: parsed.description,
        affectedSatellites: parsed.affectedSatellites,
        suggestedAction: parsed.suggestedAction,
        webEvidence: parsed.webEvidence,
      },
      blob: {},
    };
  },

  deserialize(raw) {
    const f = raw.flatFields;
    return {
      operatorCountryId: f.operatorCountryId ?? null,
      operatorCountryName: f.operatorCountryName ?? "",
      category: f.category ?? "",
      severity: f.severity ?? "",
      title: f.title ?? "",
      description: f.description ?? "",
      affectedSatellites: Number(f.affectedSatellites ?? 0),
      suggestedAction: f.suggestedAction ?? "",
      webEvidence: f.webEvidence ?? null,
    };
  },
};
```

**Why this shape:** `serialize/deserialize` powers the **generic** repo API added in Phase 2 (`insertGeneric`, `listGeneric`, `getGeneric`). Existing flat readers (`SweepSuggestionsService`, `MissionService`, CLI) stay on the old flat `.list()` / `.getById()` API throughout Plan 1, so Task 1.1 changes **no** console-api service reader.

- [ ] **1.1.1** Write `finding-schema.ssa.ts` + unit test (roundtrip serialize/deserialize).
- [ ] **1.1.2** Commit: `feat(console-api/ssa): SsaFindingSchema with serialize/deserialize`

## Task 1.2 — `promotion.ssa.ts` — delegate + extend `SweepAuditRepository`

**Files:**

- Create: `apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts`
- Modify: `apps/console-api/src/repositories/sweep-audit.repository.ts`
- Modify: `apps/console-api/src/types/sweep.types.ts`

Read [sweep-resolution.service.ts:205-244](../../../packages/sweep/src/services/sweep-resolution.service.ts#L205-L244) for the current durable `sweep_audit` write, and [sweep-resolution.service.ts](../../../packages/sweep/src/services/sweep-resolution.service.ts) for the `ConfidenceService.promote(...)` call + edge-id construction. This task keeps reuse, but **extends** `SweepAuditRepository` with a second method that preserves the current resolution-audit payload instead of trying to shoehorn it into `insertEnrichmentSuccess(...)`.

```ts
// apps/console-api/src/types/sweep.types.ts
export type ResolutionAuditInsertInput = {
  suggestionId: string;
  operatorCountryId: string | null;
  operatorCountryName: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  suggestedAction: string;
  affectedSatellites: number;
  webEvidence: string | null;
  accepted: boolean;
  reviewerNote: string | null;
  reviewedAt: string;
  resolutionStatus: "success" | "partial" | "failed" | "pending_selection";
  resolutionPayload: unknown;
  resolutionErrors: string[] | null;
  resolvedAt: string;
};

// apps/console-api/src/repositories/sweep-audit.repository.ts
async insertResolutionAudit(input: ResolutionAuditInsertInput): Promise<void> {
  // Mirrors packages/sweep/src/services/sweep-resolution.service.ts:writeAudit(...)
  // without changing insertEnrichmentSuccess(), which remains for mission/knn.
}

// apps/console-api/src/agent/ssa/sweep/promotion.ssa.ts
import type { ConfidenceService } from "@interview/thalamus";
import type {
  SweepPromotionAdapter,
  AcceptedSuggestionInput,
  PromotionResult,
} from "@interview/sweep";
import type { SweepAuditRepository } from "../../../repositories/sweep-audit.repository";

export class SsaPromotionAdapter implements SweepPromotionAdapter {
  constructor(
    private readonly deps: {
      sweepAuditRepo: SweepAuditRepository;
      confidence?: ConfidenceService | null;
    },
  ) {}

  async promote(input: AcceptedSuggestionInput): Promise<PromotionResult> {
    const df = input.domainFields as Record<string, unknown>;
    await this.deps.sweepAuditRepo.insertResolutionAudit({
      suggestionId: input.suggestionId,
      operatorCountryId:
        df.operatorCountryId == null ? null : String(df.operatorCountryId),
      operatorCountryName: String(df.operatorCountryName ?? ""),
      category: String(df.category ?? ""),
      severity: String(df.severity ?? ""),
      title: String(df.title ?? ""),
      description: String(df.description ?? ""),
      suggestedAction: String(df.suggestedAction ?? ""),
      affectedSatellites: Number(df.affectedSatellites ?? 0),
      webEvidence: df.webEvidence == null ? null : String(df.webEvidence),
      accepted: true,
      reviewerNote: input.reviewerNote,
      reviewedAt: new Date().toISOString(),
      resolutionStatus: "success",
      resolutionPayload: input.resolutionPayload
        ? JSON.parse(input.resolutionPayload)
        : null,
      resolutionErrors: null,
      resolvedAt: new Date().toISOString(),
    });

    // ConfidenceService promotion is only meaningful for sim-provenance rows.
    // When confidence is absent (Plan 1 console-api wiring), skip it cleanly.
    if (this.deps.confidence) {
      try {
        // paste exact promote() call + edge-id construction from sweep-resolution
      } catch (err) {
        return { ok: false, errors: [String(err)] };
      }
    }

    return { ok: true };
  }
}
```

- [ ] **1.2.1** Add `ResolutionAuditInsertInput` + `SweepAuditRepository.insertResolutionAudit(...)`, mirroring the current `writeAudit(...)` payload.
- [ ] **1.2.2** Read sweep-resolution.service.ts for the exact `ConfidenceService.promote(...)` call + its edge-id construction; paste into the adapter behind an optional-confidence guard.
- [ ] **1.2.3** Unit test — mock both repo + confidence, assert the full audit payload is preserved and confidence is skipped when absent.
- [ ] **1.2.4** Commit: `feat(console-api/ssa): SsaPromotionAdapter + SweepAuditRepository preserve sweep resolution audit payload`

## Task 1.3 — `resolution-handlers.ssa.ts` — lift 5 handlers

**Files:**

- Create: `apps/console-api/src/agent/ssa/sweep/resolution-handlers.ssa.ts`

Lift from [sweep-resolution.service.ts](../../../packages/sweep/src/services/sweep-resolution.service.ts) (825 lines today):

- `handleUpdateField` — uses `satelliteRepo.update(satelliteId, {…})` at line ~657
- `handleLinkPayload`
- `handleUnlinkPayload`
- `handleReassignOperatorCountry`
- `handleEnrich`

Each becomes a `ResolutionHandler`. The satellite update/mutation calls must now go through **console-api's `SatelliteAuditService`** (once the sweep audit methods fold in during Phase 4). In this task, they temporarily still use a `SatelliteRepository` dep — console-api passes sweep's `SatelliteRepository` into the registry for now. Phase 4 swaps the dep.

```ts
// apps/console-api/src/agent/ssa/sweep/resolution-handlers.ssa.ts
import type {
  ResolutionHandler,
  ResolutionHandlerRegistry,
  ResolutionHandlerResult,
} from "@interview/sweep";

export interface SsaHandlerDeps {
  satelliteRepo: {
    /* methods used by the 5 handlers — type from sweep for now */
  };
}

export function createUpdateFieldHandler(
  deps: SsaHandlerDeps,
): ResolutionHandler {
  return {
    kind: "update_field",
    async handle(action, ctx): Promise<ResolutionHandlerResult> {
      // paste body from sweep-resolution.service handleUpdateField
    },
  };
}
// … 4 more handler factories

export function createSsaResolutionRegistry(
  deps: SsaHandlerDeps,
): ResolutionHandlerRegistry {
  const handlers: Record<string, ResolutionHandler> = {
    update_field: createUpdateFieldHandler(deps),
    link_payload: createLinkPayloadHandler(deps),
    unlink_payload: createUnlinkPayloadHandler(deps),
    reassign_operator_country: createReassignOperatorCountryHandler(deps),
    enrich: createEnrichHandler(deps),
  };
  return {
    get: (k) => handlers[k],
    list: () => Object.values(handlers),
  };
}
```

- [ ] **1.3.1** Lift each handler verbatim. Preserve the "pending selection" path (ambiguous match case) — that's what the `selectors` arg on `.resolve(id, selections)` feeds.
- [ ] **1.3.2** Unit-test at least `update_field` with a mocked repo asserting the UPDATE is called.
- [ ] **1.3.3** Commit: `feat(console-api/ssa): lift 5 SSA resolution handlers behind ResolutionHandlerRegistry port`

## Task 1.4 — `audit-provider.ssa.ts` — lift nano-sweep SSA body

**Files:**

- Create: `apps/console-api/src/agent/ssa/sweep/audit-provider.ssa.ts`

Read [services/nano-sweep.service.ts](../../../packages/sweep/src/services/nano-sweep.service.ts) (537 lines). Core flow:

1. Accept `mode` — "nullScan" or "briefing".
2. Gather operator-country batches via `satelliteRepo` (sweep-side) — `listNullCandidates`, `listByOperator`.
3. Call `callNanoWaves` from thalamus.
4. Validate response with `resolutionPayloadSchema`.
5. Produce `InsertSuggestion`s.

Wrap that body:

```ts
// apps/console-api/src/agent/ssa/sweep/audit-provider.ssa.ts
import type {
  DomainAuditProvider,
  AuditCycleContext,
  AuditCandidate,
} from "@interview/sweep";

export interface SsaAuditDeps {
  satelliteRepo: /* sweep's SatelliteRepository for now — swapped in Phase 4 */ unknown;
  feedbackRepo: /* console-api's SweepFeedbackRepository */ unknown;
  nano: {
    callWaves(req: {
      systems: string[];
      users: string[];
      temperature: number;
      responseFormat: "json";
    }): Promise<{ responses: string[]; costUsd: number }>;
  };
}

export class SsaAuditProvider implements DomainAuditProvider {
  constructor(private readonly deps: SsaAuditDeps) {}

  async runAudit(ctx: AuditCycleContext): Promise<AuditCandidate[]> {
    // paste body of NanoSweepService.sweep(ctx.limit, ctx.mode) here.
    // Where the old body returned InsertSuggestion[], map each to AuditCandidate:
    //   { domainFields: { operatorCountryId, operatorCountryName, category, severity, title, description, affectedSatellites, suggestedAction, webEvidence }, resolutionPayload }
  }

  async recordFeedback(input) {
    await this.deps.feedbackRepo.push({
      suggestionId: input.suggestionId,
      accepted: input.accepted,
      category: String(input.domainFields.category ?? ""),
      wasAccepted: input.accepted,
      reviewerNote: input.reviewerNote ?? "",
      operatorCountryName: String(input.domainFields.operatorCountryName ?? ""),
    });
  }
}
```

- [ ] **1.4.1** Lift the whole `nano-sweep.service.ts:sweep()` body. Keep all helpers (BATCH_SIZE, NULL_SCAN_MAX_IDS_PER_SUGGESTION, the per-column backfill citation logic) as private methods of `SsaAuditProvider`.
- [ ] **1.4.2** Unit test with mocked nano + satelliteRepo; assert `runAudit` returns `AuditCandidate[]` with correct shape.
- [ ] **1.4.3** Commit: `feat(console-api/ssa): SsaAuditProvider lifts nano-sweep SSA body`

## Task 1.5 — `finding-routing.ssa.ts` (move)

**Files:**

- Create: `apps/console-api/src/agent/ssa/sweep/finding-routing.ssa.ts`

```ts
import type { FindingRoutingPolicy, FindingTier } from "@interview/sweep";

const CORTEX_TIER_MAP: Record<string, string[]> = {
  /* paste from sweep/services/finding-routing.ts */
};

export class SsaFindingRoutingPolicy implements FindingRoutingPolicy {
  tiersForSource(source: { kind: string; name: string }): FindingTier[] {
    if (source.kind === "cortex") return CORTEX_TIER_MAP[source.name] ?? [];
    if (source.kind === "sweep" || source.kind === "research-cycle")
      return ["admin"];
    return [];
  }
}
```

- [ ] **1.5.1** Paste the SSA map verbatim.
- [ ] **1.5.2** Commit: `feat(console-api/ssa): SsaFindingRoutingPolicy (cortex→tier map moved)`

## Task 1.6 — `doctrine-parser.ssa.ts` (move)

```bash
git mv packages/sweep/src/utils/doctrine-parser.ts \
       apps/console-api/src/agent/ssa/sweep/doctrine-parser.ssa.ts
```

Update imports inside the moved file. Grep consumers — expected hits only in `SsaAuditProvider` + `SsaResolutionHandlers` (same pack, relative imports).

- [ ] **1.6.1** git mv + fix imports.
- [ ] **1.6.2** Commit: `refactor: move doctrine-parser to console-api SSA pack`

## Task 1.7 — Move 6 ingesters + `IngestionSourceProvider` impl

**Files:**

- `git mv` each ingester from `packages/sweep/src/jobs/ingesters/` → `apps/console-api/src/agent/ssa/sweep/ingesters/`
- Create: `apps/console-api/src/agent/ssa/sweep/ingesters/index.ts`

Inside each moved file, adapt the fetcher signature. Current fetchers use `{ db, logger }` from the local registry context; post-port they implement `IngestionSource.run(ctx: IngestionRunContext)`, which preserves those and optionally exposes `redis` for future sources. Update:

```ts
// BEFORE (sweep-side)
export async function fetchTleHistory(ctx: { db; logger; redis }) {
  /* body */
}

// AFTER
import type { IngestionSource } from "@interview/sweep";

export const tleHistoryFetcher: IngestionSource = {
  id: "tle-history",
  description: "CelesTrak TLE history backfill",
  cron: "0 */6 * * *", // or whatever the current schedule is — read from schedulers.ts
  async run(ctx) {
    const { db, logger, redis } = ctx;
    // paste existing body
  },
};
```

Repeat for `itu-filings-fetcher`, `launch-manifest-fetcher`, `fragmentation-events-fetcher`, `notam-fetcher`, `space-weather-fetcher`.

```ts
// apps/console-api/src/agent/ssa/sweep/ingesters/index.ts
import type { IngestionSourceProvider } from "@interview/sweep";
import { tleHistoryFetcher } from "./tle-history-fetcher";
import { ituFilingsFetcher } from "./itu-filings-fetcher";
import { launchManifestFetcher } from "./launch-manifest-fetcher";
import { fragmentationEventsFetcher } from "./fragmentation-events-fetcher";
import { notamFetcher } from "./notam-fetcher";
import { spaceWeatherFetcher } from "./space-weather-fetcher";

export const ssaIngestionProvider: IngestionSourceProvider = {
  register(ctx) {
    ctx.add(tleHistoryFetcher);
    ctx.add(ituFilingsFetcher);
    ctx.add(launchManifestFetcher);
    ctx.add(fragmentationEventsFetcher);
    ctx.add(notamFetcher);
    ctx.add(spaceWeatherFetcher);
  },
};
```

**Keep sweep's `IngestionRegistry` unchanged** — Phase 2's Task 2.4 adapts it to accept provider[] while preserving `has/names/noop/register/dispatch`.

- [ ] **1.7.1** Move the 6 files.
- [ ] **1.7.2** Wrap each as `IngestionSource`.
- [ ] **1.7.3** Create aggregate provider.
- [ ] **1.7.4** Delete empty `packages/sweep/src/jobs/ingesters/` dir.
- [ ] **1.7.5** Typecheck + full tests (sweep-side registry still works because we haven't wired the provider yet — it's dead code in console-api for this task).
- [ ] **1.7.6** Commit: `refactor: move 6 SSA ingesters to console-api SSA pack`

---

# Phase 2 — Generalize kernel internals (façades preserved)

Every change here is internal to sweep's engine. Public signatures unchanged. Callers untouched.

## Task 2.1 — `SweepRepository` accepts `FindingDomainSchema` via opts

**Files:**

- Modify: `packages/sweep/src/repositories/sweep.repository.ts`

**Strategy:** Keep current Redis keys + field names (no data migration). Add a `findingSchema?: FindingDomainSchema` dep.

- Old API stays old:
  - `insert(input: InsertSuggestion)` keeps taking the flat SSA shape.
  - `list(opts)` keeps returning flat `SweepSuggestionRow[]`.
  - `getById(id)` keeps returning flat `SweepSuggestionRow | null`.
- New generic API is opt-in and requires `schema`:
  - `insertGeneric(input: GenericInsertSuggestion)`
  - `listGeneric(opts): { rows: GenericSuggestionRow[] }`
  - `getGeneric(id): GenericSuggestionRow | null`

Add a dual API instead of overloading one method with two return shapes. This keeps `SweepSuggestionsService`, `MissionService`, CLI, and existing tests unchanged.

**Concrete change — minimal surface:**

```ts
interface SweepRepositoryOpts {
  redis: IORedis;
  schema?: FindingDomainSchema;
}

export class SweepRepository {
  constructor(private readonly opts: SweepRepositoryOpts) {}

  // OLD API PRESERVED
  async insert(input: InsertSuggestion): Promise<string> {
    /* paste existing body */
  }
  async list(opts: ListOpts): Promise<{ rows: SweepSuggestionRow[] }> {
    /* paste */
  }
  async review(id: string, accepted: boolean, note?: string): Promise<boolean> {
    /* paste */
  }
  // … all existing methods

  // NEW generic API — only active when schema is supplied
  async insertGeneric(input: GenericInsertSuggestion): Promise<string> {
    if (!this.opts.schema)
      throw new Error("insertGeneric requires findingSchema opt");
    const { flatFields, blob } = this.opts.schema.serialize(input.domainFields);
    // Adapt to the existing flat-field Redis write using flatFields.* as hash fields.
    // blob: stored under key "sweep:suggestions:{id}:blob" only when non-empty (future domains).
    return this.insert({
      ...(flatFields as any), // flat SSA today matches InsertSuggestion 1:1
      resolutionPayload: input.resolutionPayload,
      simSwarmId: input.simSwarmId,
      simDistribution: input.simDistribution,
    });
  }

  async listGeneric(opts: ListOpts): Promise<{ rows: GenericSuggestionRow[] }> {
    if (!this.opts.schema)
      throw new Error("listGeneric requires findingSchema opt");
    const { rows } = await this.list(opts);
    return {
      rows: rows.map((r) => ({
        id: r.id,
        domain: "ssa", // from schema — hardcoded today; could come from schema metadata later
        createdAt: r.createdAt,
        accepted: r.accepted,
        reviewedAt: r.reviewedAt,
        reviewerNote: r.reviewerNote,
        resolutionStatus: r.resolutionStatus ?? "pending",
        resolvedAt: r.resolvedAt,
        resolutionErrors: r.resolutionErrors,
        simSwarmId: r.simSwarmId ?? null,
        simDistribution: r.simDistribution ?? null,
        domainFields: this.opts.schema!.deserialize({
          flatFields: {
            operatorCountryId: r.operatorCountryId,
            operatorCountryName: r.operatorCountryName,
            category: r.category,
            severity: r.severity,
            title: r.title,
            description: r.description,
            affectedSatellites: String(r.affectedSatellites),
            suggestedAction: r.suggestedAction,
            webEvidence: r.webEvidence,
          },
          blob: {},
        }),
        resolutionPayload: r.resolutionPayload,
      })),
    };
  }

  async getGeneric(id: string): Promise<GenericSuggestionRow | null> {
    if (!this.opts.schema)
      throw new Error("getGeneric requires findingSchema opt");
    const row = await this.getById(id);
    if (!row) return null;
    return {
      id: row.id,
      domain: "ssa",
      createdAt: row.createdAt,
      accepted: row.accepted,
      reviewedAt: row.reviewedAt,
      reviewerNote: row.reviewerNote,
      resolutionStatus: row.resolutionStatus ?? "pending",
      resolvedAt: row.resolvedAt,
      resolutionErrors: row.resolutionErrors,
      simSwarmId: row.simSwarmId ?? null,
      simDistribution: row.simDistribution ?? null,
      domainFields: this.opts.schema.deserialize({
        flatFields: {
          operatorCountryId: row.operatorCountryId,
          operatorCountryName: row.operatorCountryName,
          category: row.category,
          severity: row.severity,
          title: row.title,
          description: row.description,
          affectedSatellites: String(row.affectedSatellites),
          suggestedAction: row.suggestedAction,
          webEvidence: row.webEvidence,
        },
        blob: {},
      }),
      resolutionPayload: row.resolutionPayload,
    };
  }
}
```

Why dual API: zero caller change today. Console-api's `SweepSuggestionsService` and `MissionService` keep calling `.list(opts)` and getting the flat shape. Generic engine code uses `.listGeneric()` / `.getGeneric()`. Neither breaks.

- [ ] **2.1.1** Add schema opt + `insertGeneric` + `listGeneric` + `getGeneric`.
- [ ] **2.1.2** Unit test: feed `SsaFindingSchema`, insert via generic, list via flat, round-trip matches.
- [ ] **2.1.3** Unit test: `getGeneric()` returns the deserialized domainFields for a flat Redis row.
- [ ] **2.1.4** Typecheck + UC3 E2E.
- [ ] **2.1.5** Commit: `refactor(sweep): SweepRepository accepts FindingDomainSchema; dual API (flat + generic), old callers unchanged`

## Task 2.2 — `NanoSweepService.sweep(limit, mode)` façade delegates to `DomainAuditProvider`

**Files:**

- Modify: `packages/sweep/src/services/nano-sweep.service.ts`

```ts
export interface NanoSweepDeps {
  audit: DomainAuditProvider;
  sweepRepo: SweepRepository;
  domain: string; // "ssa"
}

export class NanoSweepService {
  constructor(private readonly deps: NanoSweepDeps) {}

  /**
   * Façade preserved for CycleRunnerService + admin-sweep.controller callers.
   * Delegates to the audit port; engine persists candidates.
   */
  async sweep(limit: number, mode: string): Promise<{ suggestionsStored: number }> {
    const cycleId = /* uuid */;
    const candidates = await this.deps.audit.runAudit({ cycleId, limit, mode });
    let stored = 0;
    for (const c of candidates) {
      await this.deps.sweepRepo.insertGeneric({
        domain: this.deps.domain,
        domainFields: c.domainFields,
        resolutionPayload: c.resolutionPayload,
      });
      stored++;
    }
    return { suggestionsStored: stored };
  }
}
```

**Compat path chosen:** do **not** add a second constructor or any cross-package import hack. In this task, make `sweep.worker.ts` accept an **injected** `NanoSweepService` via its deps arg, and update its one call site in `buildSweepContainer` in the same commit.

[sweep.worker.ts:14-30](../../../packages/sweep/src/jobs/workers/sweep.worker.ts#L14-L30):

```ts
// BEFORE
export function createSweepWorker(deps: { /* …, sweepRepo, satelliteRepo */ }) {
  // inside: new NanoSweepService(satelliteRepo, sweepRepo)
}

// AFTER
export function createSweepWorker(deps: {
  /* …, sweepRepo, nanoSweepService */
}) {
  // inside: deps.nanoSweepService.sweep(limit, mode)
}
```

In `buildSweepContainer`, pass the constructed `nanoSweepService` instead of the loose repos.

- [ ] **2.2.1** Refactor NanoSweepService to take `{ audit, sweepRepo, domain }`.
- [ ] **2.2.2** Update `sweep.worker.ts` to accept injected service.
- [ ] **2.2.3** Update `buildSweepContainer` to branch cleanly:
  - when `opts.ports?.audit` is supplied, use it;
  - otherwise construct a **legacy inline SSA audit provider inside sweep** from the current nano-sweep body + sweep's internal `SatelliteRepository`.
  - This keeps CLI + UC3 E2E + current call sites working without any import from `apps/console-api` into `packages/sweep`.
- [ ] **2.2.4** Typecheck + UC3 E2E + unit tests for NanoSweepService.
- [ ] **2.2.5** Commit: `refactor(sweep): NanoSweepService.sweep façade delegates to DomainAuditProvider; sweep.worker injected`

## Task 2.3 — `SweepResolutionService.resolve` façade delegates to registry + promotion

**Files:**

- Modify: `packages/sweep/src/services/sweep-resolution.service.ts`

```ts
export interface SweepResolutionDeps {
  registry: ResolutionHandlerRegistry;
  promotion: SweepPromotionAdapter;
  sweepRepo: SweepRepository;
}

export class SweepResolutionService {
  constructor(private readonly deps: SweepResolutionDeps) {}

  /** 1-arg façade for console-api + CLI. */
  async resolve(id: string): Promise<ResolutionResult>;
  /** 2-arg façade for admin-sweep caller (which is dead code but let's be safe). */
  async resolve(
    id: string,
    selectors: Record<string, unknown> | undefined,
  ): Promise<ResolutionResult>;
  async resolve(
    id: string,
    selectors?: Record<string, unknown>,
  ): Promise<ResolutionResult> {
    const generic = await this.deps.sweepRepo.getGeneric(id);
    if (!generic) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Suggestion not found"],
      };
    }
    if (!generic.resolutionPayload) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["No resolution payload"],
      };
    }

    const payload = resolutionPayloadSchema.parse(
      JSON.parse(generic.resolutionPayload),
    );

    let totalAffected = 0;
    const errors: string[] = [];
    const pendingSelections: PendingSelection[] = [];

    for (const action of payload.actions) {
      const handler = this.deps.registry.get(action.kind);
      if (!handler) {
        errors.push(`Unknown action: ${action.kind}`);
        continue;
      }
      const hr = await handler.handle(action, {
        suggestionId: id,
        reviewer: null,
        reviewerNote: null,
        selectors,
      });
      totalAffected += hr.affectedRows;
      if (hr.pending) pendingSelections.push(...hr.pending);
      if (!hr.ok && hr.errors) errors.push(...hr.errors);
    }

    if (pendingSelections.length > 0) {
      return {
        status: "pending_selection",
        affectedRows: 0,
        pendingSelections,
      };
    }

    const pr = await this.deps.promotion.promote({
      suggestionId: id,
      domain: generic.domain,
      domainFields: generic.domainFields,
      resolutionPayload: generic.resolutionPayload,
      reviewer: null,
      reviewerNote: null,
    });
    if (!pr.ok && pr.errors) errors.push(...pr.errors);

    const status: ResolutionResult["status"] =
      errors.length === 0
        ? "success"
        : totalAffected > 0
          ? "partial"
          : "failed";

    return {
      status,
      resolvedAt: new Date().toISOString(),
      affectedRows: totalAffected,
      errors: errors.length > 0 ? errors : undefined,
    };
  }
}
```

Preserve the `ResolutionResult` type from the original file ([sweep-resolution.service.ts](../../../packages/sweep/src/services/sweep-resolution.service.ts)'s exported type) so console-api + CLI consumers compile unchanged.

- [ ] **2.3.1** Rewrite with dual overload + façade body. Length target: ~150 lines (from 825).
- [ ] **2.3.2** Delete internal SSA handlers (they live in SsaResolutionRegistry now) and drop SweepResolutionService's direct ConfidenceService dependency entirely; the promotion port owns that concern now.

- [ ] **2.3.3** Typecheck + tests + UC3 E2E.
- [ ] **2.3.4** Commit: `refactor(sweep): SweepResolutionService.resolve façade delegates to ResolutionHandlerRegistry + SweepPromotionAdapter`

## Task 2.4 — `IngestionRegistry` accepts providers while preserving has/names/noop

**Files:**

- Modify: `packages/sweep/src/jobs/ingestion-registry.ts`

Read [current ingestion-registry.ts](../../../packages/sweep/src/jobs/ingestion-registry.ts) (157 lines). Preserve:

- `register(jobName: string, fetcher)` — existing method
- `dispatch(jobName, ctx)` — existing method
- `has(jobName)` — line 58
- `names()` — line 62
- baseline `noop` fetcher registration — line 92

Add: optional `providers: IngestionSourceProvider[]` on `IngestionRegistryDeps`. On construction, iterate providers and call `provider.register({ add: (source) => this.register(source.id, source.run) })`.

```ts
export interface IngestionRegistryDeps {
  db: Database;
  logger?: Logger;
  redis?: Redis;
  providers?: IngestionSourceProvider[];
}

export function createIngestionRegistry(
  deps: IngestionRegistryDeps,
): IngestionRegistry {
  const registry = new IngestionRegistry({
    db: deps.db,
    logger: deps.logger,
    redis: deps.redis,
  });
  registry.register("noop" /* existing noop body */);

  for (const p of deps.providers ?? []) {
    p.register({
      add: (source) => {
        registry.register(source.id, source.run);
      },
    });
  }
  return registry;
}
```

The `IngestionRunContext` interface in the port must align with what the CURRENT fetchers use (`db`, `logger`; optional `redis` is available for future sources). Already done in Task 0.1.

- [ ] **2.4.1** Add providers opt; preserve all existing methods.
- [ ] **2.4.2** Unit test: provider registration + `has/names/dispatch` for registered source.
- [ ] **2.4.3** Commit: `refactor(sweep): IngestionRegistry accepts IngestionSourceProvider[]; has/names/noop preserved`

## Task 2.5 — `FindingRouterService` + delete `finding-routing.ts`

**Files:**

- Create: `packages/sweep/src/services/finding-router.service.ts`
- Delete: `packages/sweep/src/services/finding-routing.ts`

```ts
export interface FindingRouterDeps {
  policy: FindingRoutingPolicy;
}
export class FindingRouterService {
  constructor(private readonly deps: FindingRouterDeps) {}
  tiersForFinding(source: { kind: string; name: string }): FindingTier[] {
    return this.deps.policy.tiersForSource(source);
  }
}
```

Grep old callers of `getTiersForCortex` / `wireSweepNotifications`: they're re-exported from [sweep/src/index.ts:7-10](../../../packages/sweep/src/index.ts#L7-L10). Check if actually called by console-api — if yes, replace callers with `FindingRouterService`; if no, remove exports.

- [ ] **2.5.1** `grep -rn "getTiersForCortex\|wireSweepNotifications" packages apps`. Migrate any callers to `FindingRouterService`.
- [ ] **2.5.2** `git rm packages/sweep/src/services/finding-routing.ts`
- [ ] **2.5.3** Strip `getTiersForCortex`/`wireSweepNotifications` from sweep/src/index.ts.
- [ ] **2.5.4** Commit: `refactor(sweep): FindingRouterService consumes FindingRoutingPolicy port; SSA map removed`

---

# Phase 3 — Wire console-api container

## Task 3.1 — Container constructs port impls + passes to `buildSweepContainer`

**Files:**

- Modify: `apps/console-api/src/container.ts`

```ts
import * as SsaSweep from "./agent/ssa/sweep";
import { SatelliteRepository } from "./repositories/satellite.repository";
import { SweepAuditRepository } from "./repositories/sweep-audit.repository";
import { SweepFeedbackRepository } from "./repositories/sweep-feedback.repository";
// … existing imports

// Existing repos:
const satelliteRepo = new SatelliteRepository(db);
const sweepAuditRepo = new SweepAuditRepository(db);
const sweepFeedbackRepo = new SweepFeedbackRepository(redis);

// Temp: sweep-side satellite repo still needed by SsaResolutionRegistry in Phase 3;
// deleted after Phase 4 folds its methods into SatelliteAuditService.
import { SatelliteRepository as SweepSideSatelliteRepo } from "@interview/sweep"; // will vanish in Phase 4
const sweepSideSatRepo = new SweepSideSatelliteRepo(db);

// Construct all SSA providers:
const findingSchema = SsaSweep.ssaFindingSchema;
const promotion = new SsaSweep.SsaPromotionAdapter({
  sweepAuditRepo,
  confidence: null, // Plan 1 console-api does not build sweep sim services; no cycle.
});
const resolutionRegistry = SsaSweep.createSsaResolutionRegistry({
  satelliteRepo: sweepSideSatRepo,
});
const auditProvider = new SsaSweep.SsaAuditProvider({
  satelliteRepo: sweepSideSatRepo,
  feedbackRepo: sweepFeedbackRepo,
  nano: nanoClient,
});
const findingRouting = new SsaSweep.SsaFindingRoutingPolicy();
const ingestionProviders = [SsaSweep.ssaIngestionProvider];

// Build sweep container — now passes the ports in
const sweepC = buildSweepContainer({
  db,
  redis,
  graphService: thalamusC.graphService,
  ports: {
    findingSchema,
    audit: auditProvider,
    promotion,
    findingRouting,
    resolutionHandlers: resolutionRegistry,
    ingestion: ingestionProviders,
  },
});
```

Inside `buildSweepContainer` ([packages/sweep/src/config/container.ts](../../../packages/sweep/src/config/container.ts)):

- When `opts.ports.audit` is set, construct `NanoSweepService` with it + the generic repo (with `schema: opts.ports.findingSchema`).
- When `opts.ports.resolutionHandlers` + `opts.ports.promotion` are set, construct `SweepResolutionService` with them.
- When `opts.ports.ingestion` is set, construct `IngestionRegistry` with those providers.
- In Plan 1 console-api wiring, `SsaPromotionAdapter` gets `confidence: null` to avoid a build-order cycle. Legacy sweep/sim wiring keeps owning its own ConfidenceService when `opts.sim` is supplied.
- When the ports aren't supplied, fall back to the **legacy inline construction** using sweep's internal SatelliteRepository — this keeps the E2E fixture working without forcing it to supply all 6 ports.

- [ ] **3.1.1** Extend `buildSweepContainer` to branch on `opts.ports`.
- [ ] **3.1.2** Wire console-api container per above.
- [ ] **3.1.3** Typecheck + run the full sweep suite + console-api suite + UC3 E2E.
- [ ] **3.1.4** Commit: `feat: console-api wires 6 sweep ports; sweep container branches on opts.ports`

---

# Phase 4 — Fold satellite audit queries into `SatelliteAuditService`

**Why now:** after Phase 3, the only runtime consumers of sweep's `SatelliteRepository` are `SsaAuditProvider` and `SsaResolutionRegistry` (both in console-api, constructed with `sweepSideSatRepo`). Folding its 8 methods into console-api's own `SatelliteAuditService` lets us drop sweep's repo entirely.

## Task 4.1 — Add the 8 methods to `SatelliteAuditService`

**Files:**

- Modify: `apps/console-api/src/services/satellite-audit.service.ts`

From [packages/sweep/src/repositories/satellite.repository.ts](../../../packages/sweep/src/repositories/satellite.repository.ts) bring in:

- `listWithOrbital`
- `findPayloadNamesByIds`
- `updateField`
- `listNullCandidatesForField`
- `knnNeighboursForField`
- `findByIdFull`
- `listByOperator`
- `listMissionWindows`

Add them as methods on `SatelliteAuditService` (the service already has `auditData`, `auditClassification`, `listApogeeHistory` — these new 8 are in the same SSA-audit domain).

- [ ] **4.1.1** Port each method verbatim. Keep the existing SQL.
- [ ] **4.1.2** Unit tests for at least `updateField` + `listNullCandidatesForField` (the two most critical for the audit loop).
- [ ] **4.1.3** Commit: `feat(satellite-audit): fold 8 audit query methods from sweep SatelliteRepository`

## Task 4.2 — Swap SsaAuditProvider + SsaResolutionRegistry to use `SatelliteAuditService`

**Files:**

- Modify: `apps/console-api/src/agent/ssa/sweep/audit-provider.ssa.ts`
- Modify: `apps/console-api/src/agent/ssa/sweep/resolution-handlers.ssa.ts`
- Modify: `apps/console-api/src/container.ts`

Replace `satelliteRepo: /* sweep's */` with `satelliteAudit: SatelliteAuditService`. Method calls: `satelliteRepo.updateField(…)` → `satelliteAudit.updateField(…)` (same signature, just a different owner).

- [ ] **4.2.1** Rewire both pack files.
- [ ] **4.2.2** Container: pass `satelliteAudit` instead of `sweepSideSatRepo`.
- [ ] **4.2.3** Typecheck + UC3 E2E.
- [ ] **4.2.4** Commit: `refactor(ssa): SsaAuditProvider + SsaResolutionRegistry use SatelliteAuditService`

## Task 4.3 — Delete sweep's `satellite.repository.ts` + `satellite.service.ts`

**Files:**

- Delete: `packages/sweep/src/repositories/satellite.repository.ts`
- Delete (verify no consumers): `packages/sweep/src/services/satellite.service.ts`
- Delete sweep's `satelliteRepo` default construction in `buildSweepContainer` (container.ts:84)
- Drop `SatelliteRepository` export from `packages/sweep/src/index.ts`

- [ ] **4.3.1** `grep -rn "SatelliteRepository\|satellite-service" packages apps` — zero hits outside console-api's own + sim (sim is fine, it's scoped by sim arch-guard in Plan 2).
- [ ] **4.3.2** `git rm` both files.
- [ ] **4.3.3** Strip exports.
- [ ] **4.3.4** Typecheck + full tests.
- [ ] **4.3.5** Commit: `refactor(sweep): delete satellite repo+service (folded into SatelliteAuditService)`

---

# Phase 5 — Move satellite-sweep-chat stack

## Task 5.1 — Atomic move of 5 files + viz stub + route mount

**Files:**

- git mv: 5 satellite-sweep-chat files + viz.service to console-api's respective dirs
- Mount route in console-api server
- Drop exports from sweep's index.ts

Steps:

```bash
git mv packages/sweep/src/repositories/satellite-sweep-chat.repository.ts \
       apps/console-api/src/repositories/satellite-sweep-chat.repository.ts
git mv packages/sweep/src/services/satellite-sweep-chat.service.ts \
       apps/console-api/src/services/satellite-sweep-chat.service.ts
git mv packages/sweep/src/controllers/satellite-sweep-chat.controller.ts \
       apps/console-api/src/controllers/satellite-sweep-chat.controller.ts
git mv packages/sweep/src/transformers/satellite-sweep-chat.dto.ts \
       apps/console-api/src/transformers/satellite-sweep-chat.dto.ts
git mv packages/sweep/src/routes/satellite-sweep-chat.routes.ts \
       apps/console-api/src/routes/satellite-sweep-chat.routes.ts
git mv packages/sweep/src/services/viz.service.ts \
       apps/console-api/src/services/viz.service.ts
```

Fix imports inside each moved file (relative paths adjust).

Mount in console-api server: `apps/console-api/src/server.ts` or `routes/index.ts`: `await app.register(satelliteSweepChatRoutes, { prefix: "/api" });` (or equivalent).

Remove from `packages/sweep/src/index.ts`:

- `SatelliteSweepChatService`
- `SatelliteSweepChatRepository`
- `SatelliteSweepChatController`
- `satelliteSweepChatRoutes`
- `* from "./transformers/satellite-sweep-chat.dto"`

Move tests if any: `find packages/sweep/tests -name "*satellite-sweep-chat*"` + git mv to console-api tests.

- [ ] **5.1.1** Execute the 6 git mvs.
- [ ] **5.1.2** Fix relative imports.
- [ ] **5.1.3** Mount route + drop sweep exports.
- [ ] **5.1.4** Move tests.
- [ ] **5.1.5** Typecheck + full tests.
- [ ] **5.1.6** Commit: `refactor: move satellite-sweep-chat stack + viz to console-api`

---

# Phase 6 — Delete dead code

## Task 6.1 — Delete `admin-sweep.controller.ts` + `admin.routes.ts`

**Files:**

- Delete: `packages/sweep/src/controllers/admin-sweep.controller.ts`
- Delete: `packages/sweep/src/routes/admin.routes.ts`
- Strip exports from `packages/sweep/src/index.ts`: `AdminSweepController`, `registerAdminSweepRoutes`

- [ ] **6.1.1** `grep -rn "AdminSweepController\|registerAdminSweepRoutes" packages apps` — confirm zero runtime references (we checked earlier: console-api never mounts these).
- [ ] **6.1.2** `git rm` both.
- [ ] **6.1.3** Strip exports.
- [ ] **6.1.4** Commit: `refactor(sweep): delete dead AdminSweepController + admin.routes (superseded by console-api's sweep.routes)`

## Task 6.2 — Strip `packages/sweep/src/index.ts` to engine-only surface

Per the target-architecture spec's "final index.ts" layout. Remove every SSA symbol that's now in console-api. Keep generic engines + ports + sim (Plan 2 handles sim exports).

- [ ] **6.2.1** Rewrite index.ts.
- [ ] **6.2.2** Grep breakages: `grep -rn "from ['\"]\@interview/sweep['\"]" packages apps | awk -F: '{print $3}' | sort -u`. Every removed symbol must be gone from outside sweep.
- [ ] **6.2.3** Typecheck + full tests.
- [ ] **6.2.4** Commit: `refactor(sweep): strip index.ts to engine + ports surface`

---

# Phase 7 — Arch-guard green + CHANGELOG

## Task 7.1 — Run sweep arch-guard (must be green)

```bash
cd packages/sweep && pnpm exec vitest run tests/arch-guard-package.spec.ts
```

If red, the reported file name/import is a leftover. Typically:

- An SSA-named type in a kernel file → rename
- An SSA SQL string in a utility → move

- [ ] **7.1.1** Remove `describe.skip` (→ `describe`) in `packages/sweep/tests/arch-guard-package.spec.ts`. The suite was skipped during Plan 1 so red intermediate tests wouldn't block pre-commit.
- [ ] **7.1.2** Run guard.
- [ ] **7.1.3** Fix reported violations.
- [ ] **7.1.4** Re-run; expect GREEN.

## Task 7.2 — CHANGELOG + TODO

```md
### Refactor — sweep package agnostic (Plan 1)

- `packages/sweep/` is now a generic sweep/finding engine. All SSA bodies
  (nano-audit, resolution handlers, promotion, finding-routing, doctrine-parser,
  6 ingesters, satellite audit queries, satellite-sweep-chat stack) moved to
  `apps/console-api/src/agent/ssa/sweep/` OR folded into existing console-api
  services (SatelliteAuditService, SweepAuditRepository, SweepFeedbackRepository).
- 6 ports introduced: FindingDomainSchema, DomainAuditProvider, SweepPromotionAdapter,
  FindingRoutingPolicy, ResolutionHandlerRegistry, IngestionSourceProvider.
- Public API preserved: NanoSweepService.sweep(limit, mode), SweepResolutionService
  .resolve(id) / .resolve(id, selectors), IngestionRegistry.{has,names,register,
  dispatch,noop}. CycleRunnerService + CLI + admin suggestion HTTP unchanged.
- SweepRepository gets dual API (flat + generic via FindingDomainSchema); Redis
  data format unchanged, no migration.
- Dead code deleted: packages/sweep/src/controllers/admin-sweep.controller.ts,
  packages/sweep/src/routes/admin.routes.ts (superseded by console-api's
  sweep-suggestions.controller + sweep-mission.controller).
- Satellite repository+service in sweep deleted (methods folded into
  SatelliteAuditService).
- Arch-guard `packages/sweep/tests/arch-guard-package.spec.ts` prevents regression.
```

- [ ] **7.2.1** Write CHANGELOG + update TODO.
- [ ] **7.2.2** Commit: `docs: record Plan 1 (sweep-agnostic) completion`

---

# Self-review checklist

- [x] Strangler fig: every public API keeps its signature. `.sweep(limit, mode)`, `.resolve(id)`, `.resolve(id, selectors)`, `IngestionRegistry.{has,names,noop}`.
- [x] Reuse console-api: SweepSuggestionsService, SweepAuditRepository, SweepFeedbackRepository, SatelliteAuditService, IngestionService, CycleRunnerService unchanged in behavior; extended where needed.
- [x] Every task maintains `pnpm -r typecheck` clean and UC3 E2E green.
- [x] Ports have concrete contracts (serialize/deserialize, db in ctx, pending on handler, preserved has/names in registry).
- [x] SatelliteRepository not deleted until all consumers migrated (Phase 4).
- [x] NanoSweepService consumers (cycle-runner, sweep.worker) see identical signature.
- [x] SweepResolutionService consumers (sweep-suggestions.service, CLI boot) see identical signature.
- [x] No container-construction cycle: Plan 1 console-api wiring passes `confidence: null` to `SsaPromotionAdapter`; legacy sweep/sim keeps its own ConfidenceService path until Plan 2.
- [x] Dead code (admin-sweep controller+routes) DELETED, not moved.
- [x] AuditCycleContext carries `limit` + `mode` to preserve legacy signature call path.
- [x] GenericInsertSuggestion vs InsertSuggestion: repo has dual API to avoid caller break.
- [x] No duplicate satellite.repository / satellite.service in console-api (folded into SatelliteAuditService).

# Spec coverage

| Target-arch spec decision                                                   | Task              |
| --------------------------------------------------------------------------- | ----------------- |
| 6 ports with concrete bodies                                                | 0.1               |
| Arch-guard                                                                  | 0.2, 7.1          |
| Widen BuildSweepOpts                                                        | 0.3               |
| SsaFindingSchema                                                            | 1.1               |
| SsaPromotionAdapter delegates to existing repos                             | 1.2               |
| 5 resolution handlers lifted                                                | 1.3               |
| SsaAuditProvider lifts nano-sweep body                                      | 1.4               |
| finding-routing port + SSA impl                                             | 1.5, 2.5          |
| doctrine-parser moved                                                       | 1.6               |
| 6 ingesters moved behind provider                                           | 1.7, 2.4          |
| SweepRepository<T> via FindingDomainSchema                                  | 2.1               |
| NanoSweepService.sweep façade                                               | 2.2               |
| SweepResolutionService.resolve 1-arg + 2-arg façade                         | 2.3               |
| IngestionRegistry preserves has/names/noop/register/dispatch                | 2.4               |
| Console-api container wires 6 ports                                         | 3.1               |
| Satellite audit queries fold into SatelliteAuditService                     | 4.1, 4.2          |
| Sweep's satellite repo+service deleted                                      | 4.3               |
| satellite-sweep-chat stack moved                                            | 5.1               |
| admin-sweep controller+routes DELETED (dead)                                | 6.1               |
| Index.ts stripped                                                           | 6.2               |
| SweepSuggestionsService.list unchanged (deserialize returns flat SSA shape) | 1.1 design        |
| CLI `.resolve(id)` preserved                                                | 2.3 dual overload |
