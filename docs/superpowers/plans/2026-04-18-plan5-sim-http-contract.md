# Plan 5 — Sim HTTP contract (Phase 0.1 · 0.2 · 0.3)

> **Purpose.** The single source of truth for the HTTP surface that the sim
> kernel (`packages/sweep/src/sim/**`) consumes. Every route listed in
> `2026-04-18-plan5-sim-five-layer.md` §5 has its complete Zod schema here.
> Implementation commits (Phase 1+) copy these schemas verbatim into
> `apps/console-api/src/schemas/sim.schema.ts` and the kernel-side
> `packages/sweep/src/sim/types/wire.ts`.

> **Change discipline.** This document is the contract. If during
> implementation a schema needs to change, update this doc **first** (in its
> own commit), re-request review, then implement. No drift.

---

## 0. Conventions

### 0.1 Base URL + auth

- All sim routes live under the path prefix **`/api/sim`**.
- Mounted from `apps/console-api/src/routes/sim.routes.ts` via
  `registerAllRoutes(app, services)`.
- **Default auth preHandler** matches the existing pattern from
  `apps/console-api/src/routes/satellite-sweep-chat.routes.ts`:

  ```ts
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireTier("investment", "franchise"));
  ```

  Today's `authenticate` is stubbed (interview build) — every request gets
  a synthetic `{id:1, role:"admin", tier:"investment"}`. Real JWT arrives
  post-interview; the contract shape doesn't change.

- **Kernel → localhost auth**: when the kernel runs inline in the
  console-api process, its HTTP client must still present valid
  credentials. Options: (a) shared-secret header read from
  `SIM_KERNEL_SHARED_SECRET` env, (b) mint a short-lived JWT with
  `sim-kernel` role. Phase 0 decides: **(a) shared-secret header**
  (`X-Sim-Kernel-Secret`) — simplest for interview, zero key-rotation
  machinery. Production swaps for (b).

- **Queue routes are kernel-only.** `/api/sim/queue/*` is not an admin
  surface. Those routes require the kernel secret and reject ordinary
  authenticated user/admin calls. Humans trigger jobs through
  `/api/sim/telemetry/start`, `/api/sim/pc/start`, `/api/sim/standalone/start`,
  etc., never by enqueueing raw worker jobs.

### 0.2 Error envelope (uniform, §5 of the plan's §7.5.2)

All sim routes return the same error shape on any 4xx/5xx:

```ts
export const SimErrorEnvelope = z.object({
  error: z.object({
    code: z.string(), // e.g. "not_found", "invalid_input", "conflict", "internal"
    message: z.string(), // human-readable
    details: z.record(z.string(), z.unknown()).optional(),
    requestId: z.string().optional(),
  }),
});
export type SimError = z.infer<typeof SimErrorEnvelope>;
```

Conventional status→code mapping:

| HTTP | `code`                | When                                               |
| ---- | --------------------- | -------------------------------------------------- |
| 400  | `invalid_input`       | Zod parse failure; `details.issues` = `ZodIssue[]` |
| 401  | `unauthenticated`     | missing/invalid auth                               |
| 403  | `forbidden`           | tier/role check fails                              |
| 404  | `not_found`           | path id resolves to no row                         |
| 409  | `conflict`            | state transition illegal (pause on `done`, etc.)   |
| 422  | `precondition_failed` | input well-formed but semantically invalid         |
| 500  | `internal`            | uncaught — message redacted in prod                |

### 0.3 Path-id convention

Every path id is a string in the URL but represents a `bigint` server-side.
The schema always declares:

```ts
const IdParam = z.object({
  id: z
    .string()
    .regex(/^[0-9]+$/, "id must be numeric")
    .transform((s) => BigInt(s)),
});
```

This keeps the URL clean (`/api/sim/runs/42`) while preserving bigint
semantics on the server. DTOs exposed to the kernel use `string` for
bigints on the wire (JSON-safe).

### 0.4 Bigint-on-wire convention

Database rows carry `bigint` for ids. JSON cannot carry bigint. Rule:

- **Wire representation**: every id is a numeric string (`"42"`).
- **Server-side**: controllers convert with `BigInt(value)` / `String(value)`.
- **Kernel-side**: DTOs declare ids as `string`; the kernel treats ids as
  opaque tokens — never arithmetic on them.

### 0.5 File layout in implementation

- `apps/console-api/src/schemas/sim.schema.ts` — server-side Zod (validation + types).
- `packages/sweep/src/sim/types/wire.ts` — kernel-side types `z.infer<typeof ...>` or hand-written mirrors; **no zod dependency in kernel** (the kernel only has to parse responses, which it does via a narrow runtime-guard helper; request bodies it produces are plain objects).

Concretely, kernel-side `wire.ts` exports TypeScript `type`s — no Zod — to
keep the kernel dependency-free. The shapes **mirror** the server-side
Zod `z.infer` output exactly; drift caught by the contract test in Phase
1.F.1.

---

## 1. Shared wire DTOs

### 1.1 Enums

```ts
// kernel + server share these; they're already in @interview/shared:
// Aligned with @interview/db-schema (sim.ts):
// SimKind = "uc1_operator_behavior" | "uc3_conjunction" | "uc_telemetry_inference" | "uc_pc_estimator"
// SimRunStatus = "pending" | "running" | "paused" | "done" | "failed"
// SimSwarmStatus = "pending" | "running" | "done" | "failed"
// MemoryKind = "self_action" | "observation" | "belief"
// TurnActorKind = "agent" | "god" | "system"
//
// GodEventKind = "regulation" | "asat_event" | "launch_surge" | "debris_cascade" | "custom"

export const SimKind = z.enum([
  "uc1_operator_behavior",
  "uc3_conjunction",
  "uc_telemetry_inference",
  "uc_pc_estimator",
]);

export const SimRunStatus = z.enum([
  "pending",
  "running",
  "paused",
  "done",
  "failed",
]);
export const SimSwarmStatus = z.enum(["pending", "running", "done", "failed"]);
export const MemoryKind = z.enum(["self_action", "observation", "belief"]);
export const TurnActorKind = z.enum(["agent", "god", "system"]);
export const GodEventKind = z.enum([
  "regulation",
  "asat_event",
  "launch_surge",
  "debris_cascade",
  "custom",
]);
```

### 1.2 Primitive wire DTOs

```ts
export const SeedRefsDto = z.object({
  operatorIds: z.array(z.string()), // bigint stringified
  conjunctionFindingId: z.string().optional(),
  telemetryTargetSatelliteId: z.string().optional(),
  pcEstimatorTarget: z.string().optional(),
  horizonDays: z.number().int().nonnegative().optional(),
  turnsPerDay: z.number().int().positive().optional(),
  busDatasheetPrior: z
    .object({
      busArchetype: z.string(),
      scalars: z.record(
        z.string(),
        z.object({
          typical: z.number(),
          min: z.number(),
          max: z.number(),
          unit: z.string(),
        }),
      ),
    })
    .optional(),
  pcAssumptions: z
    .object({
      hardBodyRadiusMeters: z.number(),
      covarianceScale: z.enum(["tight", "nominal", "loose"]),
    })
    .optional(),
});

export const PerturbationSpecDto = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("noop") }),
  z.object({
    kind: z.literal("persona_tweak"),
    agentIndex: z.number().int().nonnegative(),
    riskProfile: z.enum(["conservative", "balanced", "aggressive"]),
  }),
  z.object({
    kind: z.literal("constraint_override"),
    agentIndex: z.number().int().nonnegative(),
    overrides: z.record(z.string(), z.unknown()),
  }),
  z.object({
    kind: z.literal("delta_v_budget"),
    agentIndex: z.number().int().nonnegative(),
    maxPerSat: z.number().positive(),
  }),
  z.object({
    kind: z.literal("pc_assumptions"),
    hardBodyRadiusMeters: z.number().positive(),
    covarianceScale: z.enum(["tight", "nominal", "loose"]),
  }),
  z.object({
    kind: z.literal("datasheet_jitter"),
    fractionPct: z.number().min(0).max(1),
  }),
  z.object({
    kind: z.literal("god_event"),
    event: z.object({
      kind: GodEventKind,
      summary: z.string(),
      detail: z.string().optional(),
      targets: z
        .object({
          targetSatelliteId: z.number().int().optional(),
          targetOperatorId: z.number().int().optional(),
        })
        .optional(),
    }),
  }),
]);

export const SwarmConfigDto = z.object({
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  quorumPct: z.number().min(0).max(1),
  perFishTimeoutMs: z.number().int().positive(),
  fishConcurrency: z.number().int().positive(),
  nanoModel: z.string(),
  seed: z.number().int(),
});

export const SimConfigDto = z.object({
  turnsPerDay: z.number().int().positive(),
  maxTurns: z.number().int().positive(),
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  seed: z.number().int(),
  nanoModel: z.string(),
});

// TurnAction is a discriminated union defined in @interview/shared (kind =
// "hold" | "maneuver" | "launch" | "retire" | "infer_telemetry" | "pc_estimate"
// | "observe" | "request_support" | ...). We pass it through as an opaque
// record on the wire; Zod validates the outer envelope only. The kernel
// provides a factory (buildTurnResponseSchema) that the controllers use
// to tighten validation per-kind at the route boundary.
export const TurnActionDto = z.record(z.string(), z.unknown());

export const AgentSubjectSnapshotDto = z.object({
  displayName: z.string(),
  attributes: z.record(z.string(), z.unknown()),
});

export const TelemetryTargetDto = z.object({
  satelliteId: z.number().int(),
  satelliteName: z.string(),
  noradId: z.number().int().nullable(),
  regime: z.string().nullable(),
  launchYear: z.number().int().nullable(),
  busArchetype: z.string().nullable(),
  busDatasheetPrior: z
    .record(
      z.string(),
      z.object({
        typical: z.number(),
        min: z.number(),
        max: z.number(),
        unit: z.string(),
      }),
    )
    .nullable(),
  sources: z.array(z.string()),
});

export const PcEstimatorTargetDto = z.object({
  conjunctionId: z.number().int(),
  tca: z.string().datetime().nullable(),
  missDistanceKm: z.number().nullable(),
  relativeVelocityKmps: z.number().nullable(),
  currentPc: z.number().nullable(),
  hardBodyRadiusMeters: z.number().nullable(),
  combinedSigmaKm: z.number().nullable(),
  primary: z.object({
    id: z.number().int(),
    name: z.string(),
    noradId: z.number().int().nullable(),
    bus: z.string().nullable(),
  }),
  secondary: z.object({
    id: z.number().int(),
    name: z.string(),
    noradId: z.number().int().nullable(),
    bus: z.string().nullable(),
  }),
  assumptions: z
    .object({
      hardBodyRadiusMeters: z.number(),
      covarianceScale: z.enum(["tight", "nominal", "loose"]),
    })
    .nullable(),
});

export const SimMemoryRowDto = z.object({
  id: z.string(), // bigint stringified
  turnIndex: z.number().int().nonnegative(),
  kind: MemoryKind,
  content: z.string(),
  score: z.number().optional(), // cosine sim, only on vector searches
});

export const SimObservableTurnDto = z.object({
  turnIndex: z.number().int().nonnegative(),
  actorKind: TurnActorKind,
  agentId: z.string().nullable(), // bigint stringified
  observableSummary: z.string(),
});

export const SimFishTerminalDto = z.object({
  simRunId: z.string(),
  fishIndex: z.number().int().nonnegative(),
  agentIndex: z.number().int().nullable(),
  action: TurnActionDto.nullable(),
  observableSummary: z.string().nullable(),
  runStatus: SimRunStatus,
  turnsPlayed: z.number().int().nonnegative(),
});

export const SimFishTerminalActionDto = z.object({
  simRunId: z.string(),
  runStatus: SimRunStatus,
  action: TurnActionDto.nullable(),
});

export const SimGodEventDto = z.object({
  turnIndex: z.number().int(),
  observableSummary: z.string(),
  action: z.object({ detail: z.string().optional() }).nullable(),
});
```

### 1.3 Status DTOs (aggregated views used by `/status` routes)

```ts
export const SimRunDto = z.object({
  id: z.string(),
  swarmId: z.string(),
  fishIndex: z.number().int().nonnegative(),
  kind: SimKind,
  status: SimRunStatus,
  seedApplied: SeedRefsDto,
  perturbation: PerturbationSpecDto,
  config: SimConfigDto,
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const SimSwarmDto = z.object({
  id: z.string(),
  kind: SimKind,
  title: z.string(),
  size: z.number().int().positive(),
  status: SimSwarmStatus,
  baseSeed: SeedRefsDto,
  config: SwarmConfigDto,
  outcomeReportFindingId: z.string().nullable(),
  suggestionId: z.string().nullable(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().nullable(),
});

export const SwarmFishCountsDto = z.object({
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
});

export const SimStatusDto = z.object({
  swarmId: z.string(),
  simRunId: z.string(),
  status: SimRunStatus,
  turnsPlayed: z.number().int().nonnegative(),
  maxTurns: z.number().int().positive(),
  lastTurnAt: z.string().datetime().nullable(),
});

export const SwarmStatusDto = z.object({
  swarmId: z.string(),
  kind: SimKind,
  status: SimSwarmStatus,
  size: z.number().int().positive(),
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  running: z.number().int().nonnegative(),
  pending: z.number().int().nonnegative(),
  reportFindingId: z.string().nullable(),
  suggestionId: z.string().nullable(),
});

export const LaunchSwarmResultDto = z.object({
  swarmId: z.string(),
  fishCount: z.number().int().positive(),
  firstSimRunId: z.string(),
});

export const StartStandaloneResultDto = z.object({
  swarmId: z.string(),
  simRunId: z.string(),
  agentIds: z.array(z.string()),
});

// (Removed 2026-04-18 session 2 — see §11 decision.) Earlier drafts
// exposed SwarmAggregateSnapshotDto + TelemetryAggregateSnapshotDto
// through dedicated routes; the sim_swarm table has no columns to
// receive these snapshots today, and the aggregate outcome is already
// reachable via outcomeReportFindingId → research_finding +
// suggestionId → sweep_suggestion. Readding them is a migration + table
// change, not a route tweak.

// Promotion routes are command endpoints. The kernel does not consume a
// structured return payload; all side effects (KG rows, sweep_suggestion
// rows, sim_swarm linkage) are owned server-side.
export const EmptyCommandResponse = z.object({});
```

---

## 2. Routes — §5.1 Run lifecycle

### `POST /api/sim/runs` — create a sim_run (fish or standalone)

```ts
export const CreateRunBody = z.object({
  swarmId: z.string(),
  fishIndex: z.number().int().nonnegative(),
  kind: SimKind,
  seedApplied: SeedRefsDto,
  perturbation: PerturbationSpecDto,
  config: SimConfigDto,
});
export const CreateRunResponse = z.object({ simRunId: z.string() });
```

- **201** on success; **400** on Zod fail; **409** if `(swarmId, fishIndex)` already exists.

### `GET /api/sim/runs/:id` — single run row

- **Params**: `IdParam`.
- **200** → `SimRunDto` · **404** not found.

### `PATCH /api/sim/runs/:id/status`

```ts
export const UpdateRunStatusBody = z.object({
  status: SimRunStatus,
  completedAt: z.string().datetime().nullable().optional(),
});
export const UpdateRunStatusResponse = z.object({});
```

- Illegal transitions (e.g. `done` → `running`) → 409.

### `GET /api/sim/runs/:id/agent-count`

- **200** → `{count: number}` (non-negative int).

### `GET /api/sim/runs/:id/agent-turn-count`

- **200** → `{count: number}`.

### `GET /api/sim/runs/:id/seed`

- **200** → `SeedRefsDto` · **404** if run missing.

---

## 3. Routes — §5.2 Swarm lifecycle

### `POST /api/sim/swarms`

```ts
export const CreateSwarmBody = z.object({
  kind: SimKind,
  title: z.string().min(1).max(200),
  baseSeed: SeedRefsDto,
  perturbations: z.array(PerturbationSpecDto).min(1),
  size: z.number().int().positive(),
  config: SwarmConfigDto,
  createdBy: z.string().optional(), // bigint stringified
});
export const CreateSwarmResponse = z.object({ swarmId: z.string() });
```

- **201** on success.

### `GET /api/sim/swarms/:id` → `SimSwarmDto`

### `GET /api/sim/swarms/:id/fish-counts` → `SwarmFishCountsDto`

### `POST /api/sim/swarms/:id/done`

```ts
export const SwarmTerminalBody = z.object({}).strict(); // body must be empty
export const SwarmTerminalResponse = z.object({});
```

- 409 if swarm already terminal.

### `POST /api/sim/swarms/:id/failed` — same shape as `/done`.

### `PATCH /api/sim/swarms/:id/outcome`

```ts
export const LinkOutcomeBody = z
  .object({
    reportFindingId: z.string().optional(),
    suggestionId: z.string().optional(),
  })
  .refine((b) => b.reportFindingId || b.suggestionId, {
    message: "at least one of reportFindingId or suggestionId must be provided",
  });
export const LinkOutcomeResponse = z.object({});
```

> **Removed routes (session 2):** `POST /api/sim/swarms/:id/aggregate-snapshot`
> and `POST /api/sim/swarms/:id/telemetry-snapshot` appeared in the first
> draft of this doc. Dropped — `sim_swarm` has no columns to receive these
> snapshots today, and the aggregate outcome is already reachable via
> `outcomeReportFindingId → research_finding` + `suggestionId → sweep_suggestion`
> (both already covered by §5.8 `GET /api/sim/swarms/:id/status`).
> Reintroducing them requires a migration, not a plan tweak.

---

## 4. Routes — §5.3 Turn persistence

### `POST /api/sim/runs/:simRunId/turns`

```ts
export const InsertAgentTurnBody = z.object({
  turnIndex: z.number().int().nonnegative(),
  agentId: z.string(),
  action: TurnActionDto,
  rationale: z.string().nullable(),
  observableSummary: z.string(),
  llmCostUsd: z.number().nullable(),
});
export const InsertAgentTurnResponse = z.object({ simTurnId: z.string() });
```

### `POST /api/sim/runs/:simRunId/turns/batch`

```ts
export const PersistTurnBatchBody = z.object({
  agentTurns: z.array(InsertAgentTurnBody).min(0),
  memoryRows: z.array(
    z.object({
      agentId: z.string(),
      turnIndex: z.number().int().nonnegative(),
      kind: MemoryKind,
      content: z.string(),
      embedding: z.array(z.number()).nullable(),
    }),
  ),
});
export const PersistTurnBatchResponse = z.object({
  simTurnIds: z.array(z.string()), // order matches agentTurns[]
});
```

**Atomicity**: controller wraps `persistTurnBatch({agentTurns, memoryRows})`
in `db.transaction`. Batch is all-or-nothing.

**Ordering contract**: `simTurnIds[i]` corresponds to `agentTurns[i]`.
Implementation must preserve this explicitly (insert one-by-one inside the
transaction and append ids in JS order, or an equivalent indexed strategy).
Do **not** rely on bare `INSERT ... RETURNING` row order.

### `POST /api/sim/runs/:simRunId/god-turns`

```ts
export const InsertGodTurnBody = z.object({
  turnIndex: z.number().int().nonnegative(),
  event: z.object({
    kind: GodEventKind,
    summary: z.string(),
    detail: z.string().optional(),
    targetSatelliteId: z.number().int().optional(),
    targetOperatorId: z.number().int().optional(),
  }),
});
export const InsertGodTurnResponse = z.object({ simTurnId: z.string() });
```

### `GET /api/sim/runs/:simRunId/god-events`

```ts
export const ListGodEventsQuery = z.object({
  beforeTurn: z.preprocess((v) => Number(v), z.number().int().nonnegative()),
  limit: z
    .preprocess((v) => Number(v), z.number().int().min(1).max(100))
    .default(10),
});
export const ListGodEventsResponse = z.array(SimGodEventDto);
```

### `GET /api/sim/runs/:simRunId/last-turn-at`

- **200** → `{ at: string | null }` (ISO 8601 datetime).

---

## 5. Routes — §5.4 Memory

### `POST /api/sim/runs/:simRunId/memory/batch`

```ts
export const WriteMemoryBatchBody = z.array(
  z.object({
    agentId: z.string(),
    turnIndex: z.number().int().nonnegative(),
    kind: MemoryKind,
    content: z.string(),
    embedding: z.array(z.number()).nullable(),
  }),
);
export const WriteMemoryBatchResponse = z.object({
  ids: z.array(z.string()), // matches input order
});
```

### `POST /api/sim/runs/:simRunId/memory/search`

```ts
export const MemorySearchBody = z.object({
  agentId: z.string(),
  vec: z.array(z.number()), // pre-computed query embedding
  k: z.number().int().min(1).max(50),
});
export const MemorySearchResponse = z.array(SimMemoryRowDto);
```

### `GET /api/sim/runs/:simRunId/memory/recent`

```ts
export const MemoryRecentQuery = z.object({
  agentId: z.string(),
  k: z.preprocess((v) => Number(v), z.number().int().min(1).max(50)),
});
export const MemoryRecentResponse = z.array(SimMemoryRowDto);
```

### `GET /api/sim/runs/:simRunId/observable`

```ts
export const ObservableQuery = z.object({
  sinceTurn: z.preprocess((v) => Number(v), z.number().int().min(-1)),
  limit: z
    .preprocess((v) => Number(v), z.number().int().min(1).max(200))
    .default(20),
  excludeAgentId: z.string().optional(),
});
export const ObservableResponse = z.array(SimObservableTurnDto);
```

---

## 6. Routes — §5.5 Terminal (aggregator reads)

### `GET /api/sim/swarms/:swarmId/terminals` → `SimFishTerminalDto[]`

### `GET /api/sim/swarms/:swarmId/terminal-actions` → `SimFishTerminalActionDto[]`

---

## 7. Routes — §5.6 Queue

### `POST /api/sim/queue/sim-turn`

```ts
export const EnqueueSimTurnBody = z.object({
  simRunId: z.string(),
  turnIndex: z.number().int().nonnegative(),
  jobId: z.string().optional(),
});
export const EnqueueResponse = z.object({});
```

### `POST /api/sim/queue/swarm-fish`

```ts
export const EnqueueSwarmFishBody = z.object({
  swarmId: z.string(),
  simRunId: z.string(),
  fishIndex: z.number().int().nonnegative(),
  jobId: z.string().optional(),
});
```

### `POST /api/sim/queue/swarm-aggregate`

```ts
export const EnqueueSwarmAggregateBody = z.object({
  swarmId: z.string(),
  jobId: z.string().optional(),
});
```

All three return `{}`. All three honour `jobId` as BullMQ idempotency key.
All three are protected by the kernel-only auth rule from §0.1.

---

## 8. Routes — §5.7 Domain (SSA pack translation)

### `GET /api/sim/ssa/agent-subject`

```ts
export const AgentSubjectQuery = z.object({
  kind: z.string().min(1), // e.g. "operator"
  id: z.preprocess((v) => String(v), z.string().min(1)),
});
// Response
export const AgentSubjectResponse = AgentSubjectSnapshotDto;
```

Controller → `SimFleetService.getAgentSubject(kind, id)` → SSA translator.

### `POST /api/sim/ssa/author-labels`

```ts
export const AuthorLabelsBody = z.object({
  agentIds: z.array(z.string()),
});
export const AuthorLabelsResponse = z.object({
  labels: z.record(z.string(), z.string()), // agentId → label
});
```

### `GET /api/sim/runs/:simRunId/targets`

```ts
export const TargetsResponse = z.object({
  telemetryTarget: TelemetryTargetDto.nullable(),
  pcEstimatorTarget: PcEstimatorTargetDto.nullable(),
});
```

### `POST /api/sim/ssa/promotion/from-modal`

```ts
export const PromotionFromModalBody = z.object({
  swarmId: z.string(),
  aggregate: z.object({
    modal: z.object({
      actionKind: z.string(),
      fraction: z.number(),
      exemplarSimRunId: z.string(),
      exemplarAction: TurnActionDto,
    }),
    divergenceScore: z.number(),
    succeededFish: z.number().int().nonnegative(),
    clusterCount: z.number().int().nonnegative(),
  }),
});
export const PromotionFromModalResponse = EmptyCommandResponse;
```

### `POST /api/sim/ssa/promotion/telemetry-scalars`

```ts
export const PromotionTelemetryBody = z.object({
  swarmId: z.string(),
  satelliteId: z.string(),
  scalars: z.record(
    z.string(), // TelemetryScalarKey
    z.object({
      median: z.number(),
      sigma: z.number(),
      n: z.number().int().positive(),
      unit: z.string(),
      avgFishConfidence: z.number().min(0).max(1),
    }),
  ),
  simConfidence: z.number().min(0).max(1),
});
export const PromotionTelemetryResponse = EmptyCommandResponse;
```

---

## 9. Routes — §5.8 Launcher / lifecycle

### `POST /api/sim/telemetry/start`

```ts
export const StartTelemetryBody = z.object({
  satelliteId: z.string(),
  fishCount: z.number().int().min(1).max(100).optional(),
  priorJitter: z.number().min(0).max(1).optional(),
  config: SwarmConfigDto.partial().optional(),
  createdBy: z.string().optional(),
});
export const StartTelemetryResponse = LaunchSwarmResultDto;
```

### `POST /api/sim/pc/start`

```ts
export const StartPcBody = z.object({
  conjunctionId: z.string(),
  fishCount: z.number().int().min(1).max(100).optional(),
  config: SwarmConfigDto.partial().optional(),
  createdBy: z.string().optional(),
});
export const StartPcResponse = LaunchSwarmResultDto.extend({
  conjunctionId: z.string(),
});
```

### `POST /api/sim/standalone/start`

```ts
export const StartStandaloneBody = z.object({
  kind: SimKind,
  title: z.string().min(1).max(200),
  operatorIds: z.array(z.string()).min(1),
  horizonDays: z.number().int().positive().optional(),
  turnsPerDay: z.number().int().positive().optional(),
  maxTurns: z.number().int().positive().optional(),
  llmMode: z.enum(["cloud", "fixtures", "record"]),
  nanoModel: z.string().optional(),
  seed: z.number().int().optional(),
  createdBy: z.string().optional(),
  conjunctionFindingId: z.string().optional(),
});
export const StartStandaloneResponse = StartStandaloneResultDto;
```

### `POST /api/sim/runs/:id/inject`

```ts
export const InjectBody = z.object({
  kind: GodEventKind,
  summary: z.string().min(1).max(500),
  detail: z.string().max(5000).optional(),
  targetSatelliteId: z.number().int().optional(),
  targetOperatorId: z.number().int().optional(),
});
export const InjectResponse = z.object({ simTurnId: z.string() });
```

### `POST /api/sim/runs/:id/pause` · `POST /api/sim/runs/:id/resume`

- Body `{}`, response `{}`. 409 if state transition illegal.

### `POST /api/sim/runs/:id/schedule-next`

```ts
export const ScheduleNextResponse = z.object({
  scheduled: z.boolean(),
  reason: z.string().optional(),
});
```

### `GET /api/sim/runs/:id/status` → `SimStatusDto`

### `GET /api/sim/swarms/:id/status` → `SwarmStatusDto`

### `POST /api/sim/swarms/:id/abort` — body `{}`, response `{}`.

---

## 10. Fixture mode (0.3 answer)

### 10.1 Purpose

Fixture mode lets the UC3 E2E (and future kernel tests) replay without a
live DB, and pins byte-level determinism for the fixture-mode prompt cache
that keys on `sha256(system+user)`.

### 10.2 Wire format

The HTTP client in `packages/sweep/src/sim/http/client.ts` serialises a
canonical request:

```ts
interface CanonicalRequest {
  method: string; // "GET" | "POST" | "PATCH" | "DELETE"
  path: string; // e.g. "/api/sim/runs/42/turns/batch"
  sortedQuery: Record<string, string>; // sorted by key
  body: unknown; // JSON-stable: keys sorted recursively, undefined elided
}

function canonicalHash(req: CanonicalRequest): string {
  return sha256(JSON.stringify(req)); // lowercase hex
}
```

On a request, the client computes `hash`. Behaviour forks by env:

| `SIM_HTTP_FIXTURES` | Behaviour                                                                                                                               |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| (unset)             | Normal pass-through.                                                                                                                    |
| `record`            | Pass-through + write `fixtures/sim-http/<hash>.json` with `{request, response, status, timestamp}`. Existing files are overwritten.     |
| `replay`            | Read `fixtures/sim-http/<hash>.json`; return its `response`. Miss → throw `Error("fixture miss: " + hash + " " + method + " " + path)`. |

The shared secret header (`X-Sim-Kernel-Secret`) is **excluded** from the
canonical request — it's auth, not semantically meaningful.

### 10.3 Fixture directory location

`${repoRoot}/apps/console-api/tests/fixtures/sim-http/` — inline with
existing test fixtures (`apps/console-api/tests/fixtures/` already used
by the E2E suite). Checked into git.

### 10.4 Recording convention

Record once against a well-seeded DB, commit the fixtures, run tests in
`replay` afterwards. Update when the schema or seeds change (rare —
schema changes require migration commits anyway).

### 10.5 Determinism guarantees

The HTTP client **must** normalise `Date` → ISO 8601 string before hashing
(browsers and Node differ in default JSON serialization). The client
rejects `NaN`, `Infinity`, `-Infinity` in request bodies (JSON doesn't
encode them).

---

## 11. Decisions made in Phase 0

| Decision                         | Choice                                                                                    | Rationale                                                          |
| -------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Base URL                         | `/api/sim`                                                                                | Consistent with `/api/sweep`, `/api/satellites`, etc.              |
| Auth scheme (user flow)          | `authenticate` + `requireTier("investment","franchise")` preHandlers                      | Matches existing pattern; interview build has synthetic user.      |
| Auth scheme (kernel → localhost) | Shared-secret header `X-Sim-Kernel-Secret`, validated by a kernel-specific preHandler     | Simpler than minting JWTs for the interview; rotatable via env.    |
| Bigints on wire                  | Stringified                                                                               | JSON-safe; kernel treats as opaque.                                |
| Ids in URL                       | Numeric strings, regex-guarded                                                            | `/api/sim/runs/42` reads naturally.                                |
| Error envelope                   | `{error: {code, message, details?, requestId?}}`                                          | One shape everywhere.                                              |
| Request validation               | Zod in controllers; Fastify schema left minimal (auto-generated from Zod later if needed) | Schemas dir already uses Zod.                                      |
| Fixture key                      | `sha256(canonical(method+path+sortedQuery+stableBody))`                                   | Deterministic across Node versions.                                |
| Fixture directory                | `apps/console-api/tests/fixtures/sim-http/`                                               | Co-located with existing test fixtures.                            |
| Embedding transport              | `number[]` in body                                                                        | ~2-4 KB per vector × small batches → under any sane payload limit. |

---

## 12. Phase 0 resolutions

1. **`buildTurnResponseSchema` stays local to the kernel.** The turn-runner
   still renders the prompt, calls the LLM transport, and Zod-parses the
   model response locally with the injected `ActionSchemaProvider`. This is
   a kernel concern, not an app-boundary concern, so it does **not** move to
   HTTP. Keeping it local preserves fixture-mode tractability and keeps the
   route boundary focused on persistence / orchestration / queue / SSA
   translation concerns.

2. **Promotion routes return `{}`.** Promotion is a command endpoint. The
   kernel does not consume `findingId`, `suggestionId`, or `kgPromoted`;
   those are server-owned side effects. The HTTP contract therefore drops the
   previous `PromotionResultDto` and standardizes both promotion routes on an
   empty command response.

3. **Batch turn ordering is guaranteed explicitly.** `PersistTurnBatchResponse.simTurnIds[]`
   must match `agentTurns[]` by index, and the repository/controller tests
   must pin that. Implementation must preserve order deliberately rather than
   relying on Postgres `RETURNING` order.

4. **Queue routes are kernel-only.** `/api/sim/queue/*` requires the kernel
   shared secret and rejects ordinary user/admin traffic. Human-triggered
   flows go through the higher-level `/start` routes.
