# Plan — Multi-agent simulation swarm in `packages/sweep`

**Goal:** ship a v0 of the sim-swarm engine specified in [docs/specs/sweep/multi-agent-sim.tex](docs/specs/sweep/multi-agent-sim.tex). Two runnable demos at the finish line:

- `make swarm-uc3` — 50 fish explore conjunction negotiation outcomes from a seeded finding → writes one `sweep_suggestion` with modal resolution + full distribution metadata.
- `make swarm-uc1` — 50 fish × 3 operators × 5-day horizon, each fish perturbed (ASAT variants, regulation, launch surge, persona tweaks) → final coverage report with outcome distribution.

Both must run in **fixtures mode** (deterministic, no network) and in **cloud mode** (real nano model per fish via `callNano`). Target wall-clock: 50 fish in < 2 min on fixtures, < 5 min on cloud nano.

**Why this matters:** MiroFish's insight is that many cheap small-model fish cover the *possibility space* — the reviewer sees a distribution of futures, not a single verdict. Thalamus today answers *what is*. The swarm answers *what could happen, and how often*. UC3 closes the loop: a high-urgency conjunction finding auto-spawns a swarm whose modal resolution becomes a `sweep_suggestion` annotated with confidence.

**Cost model (nano):** ~$0.01/fish × 50 fish = ~$0.50/swarm. Per-fish timeout 60s. Fan-out concurrency 8–16.

---

## Phase 0 — Discovery (DONE)

Consolidated inventory from subagent run (2026-04-14). Key references, grounded in real file paths:

| Subject | File:line | Notes |
|---|---|---|
| `CortexRegistry` | [packages/thalamus/src/cortices/registry.ts:105](packages/thalamus/src/cortices/registry.ts#L105) | API: `get/has/names/getHeaders/getHeadersForPlanner`. No long-lived agent concept. |
| Per-turn LLM primitive | [packages/thalamus/src/cortices/executor.ts:291](packages/thalamus/src/cortices/executor.ts#L291) `runSkillFreeform` | Bypasses SQL helper + findings pipeline — exactly what we need for a turn call. |
| LLM transport | [packages/thalamus/src/transports/llm-chat.ts:245](packages/thalamus/src/transports/llm-chat.ts#L245) `createLlmTransport` | Kimi K2 primary, OpenAI fallback. **Non-streaming**, that's fine for turns. |
| Mode switch | [packages/thalamus/src/transports/llm-chat.ts:273](packages/thalamus/src/transports/llm-chat.ts#L273) `createLlmTransportWithMode` | Reads `THALAMUS_MODE=cloud/fixtures/record`. Reuse verbatim. |
| Fixture transport | [packages/thalamus/src/transports/fixture-transport.ts:47](packages/thalamus/src/transports/fixture-transport.ts#L47) | sha256(system+user) → JSON on disk. Determinism comes for free. |
| DAG executor | [packages/thalamus/src/services/thalamus-executor.service.ts:27](packages/thalamus/src/services/thalamus-executor.service.ts#L27) | One-shot (can't self-loop) but **can model one turn**: N agents = N parallel cortex nodes in a level + reconciler node. Used by the UC1 driver. Wrap with BullMQ for the turn sequence. |
| Cycle orchestrator | [packages/thalamus/src/services/thalamus.service.ts:50](packages/thalamus/src/services/thalamus.service.ts#L50) `runCycle({ dag })` | Accepts a DAG override — entry point for the DAG driver. |
| Sweep BullMQ | [packages/sweep/src/jobs/queues.ts:12](packages/sweep/src/jobs/queues.ts#L12) | `sweepQueue`, `satelliteQueue`, `sweepQueueEvents`. Add `simTurnQueue`. |
| Worker factory | [packages/sweep/src/jobs/workers/helpers.ts:20](packages/sweep/src/jobs/workers/helpers.ts#L20) `createWorker` | Reuse verbatim. |
| Finding routing | [packages/sweep/src/services/finding-routing.ts:16](packages/sweep/src/services/finding-routing.ts#L16) | Hook point for UC3 auto-spawn. |
| Sweep resolution | [packages/sweep/src/services/sweep-resolution.service.ts:51](packages/sweep/src/services/sweep-resolution.service.ts#L51) | UC3 output surfaces here as a suggestion. |
| Chat (deep interact) | [packages/sweep/src/services/satellite-sweep-chat.service.ts:44](packages/sweep/src/services/satellite-sweep-chat.service.ts#L44) | Generalize scope to accept `simRunId`. |
| DB schema barrel | [packages/db-schema/src/index.ts](packages/db-schema/src/index.ts) | Add `sim.ts` schema file + re-export. |
| pgvector | [packages/db-schema/src/schema/_vector.ts:16](packages/db-schema/src/schema/_vector.ts#L16) | `EMBEDDING_DIMENSIONS = 1024` (Voyage-3). Reuse. |
| HNSW template | `packages/db-schema/migrations/0001_hnsw_index.sql` | Copy pattern for `sim_agent_memory.embedding`. |
| No `conjunction_event` table | confirmed in [tasks/cortex-helpers-plan.md:16](tasks/cortex-helpers-plan.md#L16) | UC3 must seed from `research_finding` where `cortex='conjunction_analysis'`, not a dedicated table. |
| Package dep direction | `sweep → thalamus → db-schema → shared` | **Never reverse.** New code lives in sweep. |

### Allowed APIs (re-use, don't reinvent)

| API | Import | Use for |
|---|---|---|
| `Database` | `@interview/db-schema` | all DB access |
| `CortexExecutor.runSkillFreeform` | `@interview/thalamus/cortices/executor` | per-turn LLM call with Zod schema |
| `createLlmTransportWithMode` | `@interview/thalamus/transports/llm-chat` | respects `THALAMUS_MODE` |
| Embedding helper | grep for `embedText` / Voyage call in thalamus | `sim_agent_memory.embedding` |
| BullMQ `createWorker` | `@interview/sweep/jobs/workers/helpers` | sim-turn worker |
| `SweepRepository.enqueueSuggestion` | `@interview/sweep/repositories/sweep.repository` | UC3 → suggestion |
| `MessagingService` | `@interview/sweep/services/messaging.service` | sim complete → admin inbox |

### Anti-patterns (grep after each phase; all should return 0)

```bash
# Do not re-import MiroFish patterns from Python
grep -rn 'from camel' packages/sweep/src/sim/   # expect empty

# DAG executor is used via runCycle, not reimplemented
grep -rn 'new ThalamusDAGExecutor' packages/sweep/src/sim/   # expect 0 (go through thalamusService.runCycle)

# Do not bypass mode switch
grep -rn 'createLlmTransport(' packages/sweep/src/sim/   # expect 0 (must use WithMode)

# Do not import sweep from thalamus
grep -rn '@interview/sweep' packages/thalamus/src/   # expect 0

# Do not forget sim_run_id on suggestions
grep -rn 'enqueueSuggestion(' packages/sweep/src/sim/ | grep -v simRunId
# expect 0 (every sim-emitted suggestion must be tagged)
```

---

## Phase 1 — Schema + migration — ~30 min

**What to implement** — four new tables + HNSW index, wired through the barrel.

### 1a. Create [packages/db-schema/src/schema/sim.ts](packages/db-schema/src/schema/sim.ts)

Five tables exactly as in the spec §Architecture/Data model:

- `sim_swarm` — swarm metadata: kind, baseSeed, perturbations[], size, config, status, outcomeReportFindingId, suggestionId.
- `sim_run` — one fish. FK `swarm_id` (cascade), `fish_index`, `seedApplied` (post-perturbation), run status, report finding id.
- `sim_agent` — one row per operator per fish.
- `sim_turn` — atomic timeline entry. `actor_kind ∈ {agent, god, system}`. Unique on `(sim_run_id, turn_index, agent_id)`.
- `sim_agent_memory` — vector store, append-only, scoped by `(sim_run_id, agent_id)` — **never bleeds across fish**.

All bigserial PKs, all FKs `onDelete: cascade` off `sim_run`. Timestamps `withTimezone: true`. `embedding` column uses `vector(name, { dimensions: EMBEDDING_DIMENSIONS })` exactly like [packages/db-schema/src/schema/research.ts:103](packages/db-schema/src/schema/research.ts#L103).

### 1b. Re-export from [packages/db-schema/src/index.ts](packages/db-schema/src/index.ts)

```ts
export * from "./schema/sim";
```

### 1c. Generate + write migration

```bash
pnpm --filter @interview/db-schema drizzle:generate
```

Then hand-edit the generated SQL to add:

```sql
-- packages/db-schema/migrations/000X_sim_memory_hnsw.sql
CREATE INDEX IF NOT EXISTS sim_agent_memory_embedding_hnsw
  ON sim_agent_memory USING hnsw (embedding vector_cosine_ops);
```

Use [packages/db-schema/migrations/0001_hnsw_index.sql](packages/db-schema/migrations/0001_hnsw_index.sql) as reference.

### Verification
- `pnpm --filter @interview/db-schema typecheck` → 0 errors
- `make db-migrate` applies cleanly on a fresh DB
- `make psql -c '\d sim_run'` shows all columns
- `make psql -c "SELECT indexname FROM pg_indexes WHERE tablename='sim_agent_memory'"` includes `sim_agent_memory_embedding_hnsw`

### Anti-pattern guard
- Don't JSON-encode the persona — it's a plain text system-prompt fragment (`text` column, not `jsonb`).
- Don't make `sim_turn.agent_id` NOT NULL — god/system turns have null agent.

---

## Phase 2 — Core types + agent builder + memory service — ~45 min

**What to implement** — foundation primitives used by every phase that follows.

### 2a. [packages/sweep/src/sim/types.ts](packages/sweep/src/sim/types.ts)

```ts
export type SimKind = "uc1_operator_behavior" | "uc3_conjunction";
export type ActorKind = "agent" | "god" | "system";
export type SimStatus = "pending" | "running" | "paused" | "done" | "failed";

export interface TurnAction { /* discriminated union, see 2b */ }
export interface GodEventSeed {
  kind: "regulation" | "asat_event" | "launch_surge" | "debris_cascade" | "custom";
  summary: string;              // one-line observable headline
  detail?: string;              // optional longer context
  targetSatelliteId?: number;
  targetOperatorId?: number;
}
export interface SeedRefs {
  operatorIds?: number[];
  conjunctionFindingId?: number;
  horizonDays?: number;
}
export interface SimConfig {
  turnsPerDay: number;
  maxTurns: number;
  llmMode: "cloud" | "fixtures" | "record";
  seed: number;
}

// Swarm-level
export interface SwarmConfig {
  llmMode: "cloud" | "fixtures" | "record";
  quorumPct: number;          // default 0.8
  perFishTimeoutMs: number;   // default 60_000
  fishConcurrency: number;    // default 8, clamp [1, 16]
  nanoModel: string;          // default "gpt-5.4-nano"
}

export type PerturbationSpec =
  | { kind: "noop" }                                     // baseline control
  | { kind: "god_event"; event: GodEventSeed }
  | { kind: "constraint_override"; agentIndex: number; overrides: Record<string, unknown> }
  | { kind: "persona_tweak"; agentIndex: number; riskProfile: "conservative"|"balanced"|"aggressive" }
  | { kind: "launch_surge"; regimeId: number; extraSatellites: number }
  | { kind: "delta_v_budget"; agentIndex: number; maxPerSat: number };
```

### 2b. [packages/sweep/src/sim/schema.ts](packages/sweep/src/sim/schema.ts) — Zod schemas

```ts
export const turnActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("maneuver"), satelliteId: z.number(), deltaVmps: z.number(), reason: z.string() }),
  z.object({ kind: z.literal("propose_split"),
             ownShareDeltaV: z.number(), counterpartyShareDeltaV: z.number(), reason: z.string() }),
  z.object({ kind: z.literal("accept"),    reason: z.string() }),
  z.object({ kind: z.literal("reject"),    reason: z.string() }),
  z.object({ kind: z.literal("launch"),    satelliteCount: z.number(), regimeId: z.number().optional(), reason: z.string() }),
  z.object({ kind: z.literal("retire"),    satelliteId: z.number(), reason: z.string() }),
  z.object({ kind: z.literal("lobby"),     policyTopic: z.string(), stance: z.enum(["support","oppose"]), reason: z.string() }),
  z.object({ kind: z.literal("hold"),      reason: z.string() }),
]);

export const turnResponseSchema = z.object({
  action: turnActionSchema,
  rationale: z.string().min(10),            // private, not shown to other agents
  observableSummary: z.string().min(5),     // what other agents see next turn
});
```

### 2c. [packages/sweep/src/sim/agent-builder.ts](packages/sweep/src/sim/agent-builder.ts)

`buildOperatorAgent(db, { operatorId, simRunId })`:

1. Read `operator` + `operator_country` + aggregate satellite stats (count, regime mix, avg age).
2. Compose a persona string — single paragraph, 2nd-person:
   > *You are the SSA operations lead for {operatorName} ({country}). You operate {N} satellites ({regimeMix}). Your mandate is {mandate derived from platform mix: comms / earth-obs / dual-use}. You are {riskProfile: conservative / balanced / aggressive, derived from operator country doctrine}.*
3. Derive `goals` (2–4 strings): e.g. `["preserve fleet availability", "minimize delta-v spend", "defend regime slot share"]`.
4. Derive `constraints` (JSON): e.g. `{ maxDeltaVBudgetPerSat: 100, avgReplacementCostUsd: <from queryReplacementCost>, jurisdiction: "US" }`.
5. Insert `sim_agent` row, return the id.

For UC3, same function; persona is slightly tuned (negotiation-framing appended).

### 2d. [packages/sweep/src/sim/memory.service.ts](packages/sweep/src/sim/memory.service.ts)

```ts
export class MemoryService {
  constructor(private db: Database, private embed: EmbedFn) {}

  async write(row: {
    simRunId: number; agentId: number; turnIndex: number;
    kind: "self_action" | "observation" | "belief"; content: string;
  }): Promise<number>;

  async topK(opts: {
    simRunId: number; agentId: number; query: string; k?: number;
  }): Promise<MemoryRow[]>;   // vector search scoped by (sim_run_id, agent_id)

  async recentObservable(opts: {
    simRunId: number; sinceTurn: number; excludeAgentId?: number;
  }): Promise<ObservableTurn[]>; // sim_turn rows where observableSummary is visible
}
```

**Critical:** `topK` MUST filter by `sim_run_id = $1 AND agent_id = $2` before the vector similarity — invariant (cross-sim isolation).

### Verification (Phase 2)
- `pnpm --filter @interview/sweep typecheck` → 0 errors
- No direct `createLlmTransport(` call — only `createLlmTransportWithMode`
- Grep: `grep -n 'sim_run_id' packages/sweep/src/sim/memory.service.ts` returns ≥ 2 (every query is scoped)

### Anti-pattern guard
- Don't compute embeddings inline — take `EmbedFn` in the constructor so tests can inject a fixture embed.
- Don't return rationale from `recentObservable` — only `observableSummary`. Rationale is private to the author.

---

## Phase 3 — Shared cortex skill + two turn drivers — ~75 min

**What to implement** — one cortex skill shared by both drivers, a SQL helper for agent context, then the two drivers (DAG for UC1, Sequential for UC3) that both invoke that skill.

### 3a. Cortex skill [packages/thalamus/src/cortices/skills/sim_operator_agent.md](packages/thalamus/src/cortices/skills/sim_operator_agent.md)

```yaml
---
name: sim_operator_agent
description: One turn of reasoning for a simulated satellite-operator agent.
sqlHelper: querySimAgentContext
params:
  simRunId: { type: number, required: true }
  agentId:  { type: number, required: true }
  turnIndex: { type: number, required: true }
---
```

Body (system prompt) — 2nd-person framing, expects persona to be concatenated in by the caller. Outputs must conform to `turnResponseSchema` (see 2b).

### 3b. SQL helper [packages/thalamus/src/cortices/sql-helpers.sim-context.ts](packages/thalamus/src/cortices/sql-helpers.sim-context.ts)

`querySimAgentContext(db, { simRunId, agentId, turnIndex })` returns a single row bundling:
- agent persona + goals + constraints
- top-8 memories for (simRunId, agentId) via vector search on recent observations
- last-5 `sim_turn` rows where `agent_id != $agentId` OR `actor_kind='god'` (observable timeline)
- fleet snapshot (cached in `sim_run.seed_refs.fleetSnapshot` — refreshed server-side every 10 turns)

Export through [packages/thalamus/src/cortices/sql-helpers.ts](packages/thalamus/src/cortices/sql-helpers.ts) barrel.

### 3c. DAG driver [packages/sweep/src/sim/turn-runner-dag.ts](packages/sweep/src/sim/turn-runner-dag.ts)

```ts
export class DagTurnRunner {
  async runTurn(simRunId: number, turnIndex: number): Promise<void> {
    const agents = await loadAgents(simRunId);
    const dag: DAGPlan = {
      intent: `sim ${simRunId} turn ${turnIndex}`,
      complexity: "moderate",
      nodes: [
        ...agents.map((a) => ({
          cortex: "sim_operator_agent",
          params: { simRunId, agentId: a.id, turnIndex },
          dependsOn: [],
        })),
        {
          cortex: "sim_reconciler",
          params: { simRunId, turnIndex },
          dependsOn: agents.map((a) =>
            `sim_operator_agent`   // level-based, see DAG executor topological sort
          ),
        },
      ],
    };
    await this.thalamusService.runCycle({ dag, mode: this.llmMode });
  }
}
```

The reconciler node is a **new thin cortex** (`sim_reconciler`) whose job is post-processing:
- Read the agent findings from the cycle context (`previousFindings`).
- Insert one `sim_turn` row per agent action.
- Insert `sim_agent_memory` rows (self + observations).
- Promote `maneuver/launch/retire` actions to `research_finding` via the normal cortex pipeline.

Skill file: [packages/thalamus/src/cortices/skills/sim_reconciler.md](packages/thalamus/src/cortices/skills/sim_reconciler.md). It's a **no-LLM cortex** (uses the "skipLlm" flag in skill frontmatter — verify this exists in `CortexExecutor`; if not, make it a tiny LLM call that just echoes through, or add the flag).

### 3d. Sequential driver [packages/sweep/src/sim/turn-runner-sequential.ts](packages/sweep/src/sim/turn-runner-sequential.ts)

```ts
export class SequentialTurnRunner {
  async runTurn(simRunId: number, turnIndex: number): Promise<SimTurnRow> {
    const agents = await loadAgents(simRunId);
    const speaker = agents[turnIndex % agents.length]; // strict alternation
    const ctx = await buildAgentContext(this.db, speaker.id, turnIndex);

    const response = await this.cortexExecutor.runSkillFreeform({
      skillName: "sim_operator_agent",
      systemPrompt: speaker.persona + "\n" + goalsBlock(speaker),
      userPrompt: renderTurnPrompt(ctx),
      schema: turnResponseSchema,
      mode: this.llmMode,
    });

    return await this.db.transaction(async (tx) => {
      const turn = await insertSimTurn(tx, { simRunId, turnIndex, speaker, response });
      await this.memory.write(tx, { kind: "self_action", agentId: speaker.id, content: `${response.action.kind} — ${response.rationale}` });
      for (const other of agents.filter((a) => a.id !== speaker.id)) {
        await this.memory.write(tx, { kind: "observation", agentId: other.id, content: response.observableSummary });
      }
      if (isKgPromotable(response.action)) {
        await this.promote(tx, turn); // maneuver/launch/retire
      }
      if (isTerminal(response.action)) {
        await markRunDone(tx, simRunId); // accept/reject ends UC3
      }
      return turn;
    });
  }
}
```

### 3e. Promotion helper [packages/sweep/src/sim/promote.ts](packages/sweep/src/sim/promote.ts)

`isKgPromotable(action)` → `action.kind in {"maneuver", "launch", "retire"}`.

`promote(tx, turn)` inserts a `research_finding` row with:
- `cortex = "sim_operator_agent"`
- `summary = turn.observableSummary`
- `entityType`, `entityId` from the action payload (satelliteId for maneuver/retire, operatorId for launch)
- `provenance = { simRunId, turnIndex, turnId: turn.id }` in the metadata column
- Embedding computed from summary

### 3f. Prompt renderer [packages/sweep/src/sim/prompt.ts](packages/sweep/src/sim/prompt.ts)

Same as before: `renderTurnPrompt(ctx)` with goals / constraints / memories / observable / fleet snapshot / "what do you do this turn?".

### 3g. BullMQ worker [packages/sweep/src/jobs/workers/sim-turn.worker.ts](packages/sweep/src/jobs/workers/sim-turn.worker.ts)

```ts
export function createSimTurnWorker(deps) {
  return createWorker({
    name: "sim-turn",
    concurrency: 2,
    processor: async (job: Job<SimTurnJobPayload>) => {
      const run = await loadSimRun(deps.db, job.data.simRunId);
      const runner = run.kind === "uc1_operator_behavior"
        ? deps.dagRunner
        : deps.sequentialRunner;
      await runner.runTurn(job.data.simRunId, job.data.turnIndex);
      await deps.orchestrator.scheduleNext(job.data.simRunId);
    },
  });
}
```

`SimTurnJobPayload = { simRunId: number; turnIndex: number }` — note: **no** `agentId`. The DAG driver processes all agents in one job (parallel via the DAG). The sequential driver picks the speaker from `turnIndex` parity. One job = one turn of the sim-clock, regardless of driver.

### 3h. Queue — add to [packages/sweep/src/jobs/queues.ts](packages/sweep/src/jobs/queues.ts)

```ts
export const simTurnQueue = new Queue<SimTurnJobPayload>("sim-turn", { connection: redis });
```

Re-export from [packages/sweep/src/index.ts](packages/sweep/src/index.ts).

### Verification (Phase 3)
- `pnpm --filter @interview/sweep typecheck` → 0 errors
- `pnpm --filter @interview/thalamus typecheck` → 0 errors (new cortex skill + SQL helper wired)
- Unit test (DAG driver): mock `thalamusService.runCycle` → `runTurn` calls it with a DAG containing `N + 1` nodes (N agents + reconciler).
- Unit test (Sequential driver): mock `runSkillFreeform` → on 2-agent UC3, speaker alternates on turn parity; exactly `1 + (N-1)` memory rows per turn; terminal action transitions `sim_run.status` to `done`.
- Unit test (promotion): `action.kind='maneuver'` → 1 `research_finding` row; `action.kind='propose_split'` → 0 `research_finding` rows.

### Anti-pattern guard
- Don't duplicate prompt rendering between drivers — both call `renderTurnPrompt(ctx)`.
- Don't call `embed()` inside the transaction — best-effort, log on failure.
- Don't let the DAG driver bypass `thalamusService.runCycle` — going direct to `ThalamusDAGExecutor` skips cycle persistence.
- Don't write to `sim_turn` from inside the `sim_operator_agent` cortex body — that's the reconciler's (DAG) or the sequential driver's job.

---

## Phase 4 — Orchestrator + god channel — ~45 min

**What to implement** — start runs, schedule turns, handle pause/resume/inject.

### 4a. [packages/sweep/src/sim/sim-orchestrator.service.ts](packages/sweep/src/sim/sim-orchestrator.service.ts)

```ts
export class SimOrchestrator {
  constructor(private db: Database, private queues: { simTurn: Queue<SimTurnJobPayload> }) {}

  async startUc1(opts: Uc1StartOpts): Promise<{ simRunId: number }>;
  async startUc3(opts: Uc3StartOpts): Promise<{ simRunId: number }>;
  async pause(simRunId: number): Promise<void>;
  async resume(simRunId: number): Promise<void>;
  async inject(simRunId: number, event: GodEventSeed): Promise<void>;
  async scheduleNext(simRunId: number): Promise<void>;
  async status(simRunId: number): Promise<SimStatus>;
}
```

**`scheduleNext` contract (uniform across both drivers):**
- Load `sim_run`. If `status != running` → noop (handles pause).
- Find the highest completed `turn_index`. If ≥ `maxTurns` OR last turn was a terminal action (UC3 accept/reject) → transition to `done`, trigger reporter (Phase 5), trigger `messagingService.send` (sweep-style admin digest).
- Otherwise, enqueue **one** `simTurnQueue` job with `turn_index = maxCompleted + 1`, `jobId = ${simRunId}:${turnIndex}` (BullMQ dedupe). The worker picks the driver from `sim_run.kind`.

**`inject` contract:**
- Insert a `sim_turn` row with `actor_kind='god'`, `turn_index = currentTurn + 1`, action JSON = god event.
- Write `sim_agent_memory` rows with `kind='observation'` for EVERY agent — god events are globally observable.

**`startUc3` contract:**
- Load the conjunction finding by `conjunctionFindingId`.
- Derive the two operator ids from the finding's edges (`research_edge` → `operator` entity).
- Insert `sim_run`, build 2 agents via `agent-builder`, enqueue turn 0 for both.

### 4b. [packages/sweep/src/sim/god-channel.service.ts](packages/sweep/src/sim/god-channel.service.ts)

Wraps `orchestrator.inject` with validation of the `GodEventSeed` — keep thin. Optional: pre-defined god-event templates (regulation text, ASAT event narrative) as constants here.

### 4c. Wire into [packages/sweep/src/config/container.ts](packages/sweep/src/config/container.ts)

Build `SimOrchestrator` + `DagTurnRunner` + `SequentialTurnRunner` + `MemoryService` + register `createSimTurnWorker` alongside the existing sweep worker. Both runners receive the same `MemoryService` and `llmMode`; the DAG runner additionally holds a reference to `thalamusService`.

### Verification (Phase 4)
- Integration test (real BullMQ + test Redis): `startUc1({ operatorIds: [1,2,3], horizonDays: 2, turnsPerDay: 1 })` + drain queue → exactly 6 `sim_turn` rows (3 agents × 2 turns).
- Integration test: after 6 turns, `sim_run.status = "done"` and `completed_at` is set.
- Integration test: `pause` mid-run → `scheduleNext` is noop → resume → remaining turns complete.

### Anti-pattern guard
- Don't use `setTimeout` for turn scheduling — BullMQ `jobId` dedupe is the correctness mechanism.
- Don't allow `inject` during `status=done` — throw 409.

---

## Phase 4.5 — Swarm service + perturbation + fish fan-out — ~60 min

**What to implement** — the swarm is the public API. Each fish is one `sim_run`. The swarm fans out K fish via BullMQ, tracks quorum, fires the aggregator when quorum hits.

### 4.5a. [packages/sweep/src/sim/perturbation.ts](packages/sweep/src/sim/perturbation.ts)

```ts
export function applyPerturbation(base: SeedRefs, spec: PerturbationSpec): SeedRefs {
  // Pure function: takes the base seed + a spec, returns a new seed for one fish.
  // Must be deterministic: (base, spec) -> output is byte-identical across runs.
}

export function generateDefaultPerturbations(kind: SimKind, size: number, rng: Rng): PerturbationSpec[] {
  // UC1 default set: 1 noop + evenly-spread god_event + persona_tweak + launch_surge variants
  // UC3 default set: 1 noop + delta_v_budget sweep + persona_tweak sweep + constraint_override
}
```

The RNG is seeded from `swarm.config.seed` (fallback: hash of baseSeed) for determinism.

### 4.5b. [packages/sweep/src/sim/swarm.service.ts](packages/sweep/src/sim/swarm.service.ts)

```ts
export class SwarmService {
  constructor(
    private db: Database,
    private orchestrator: SimOrchestrator,
    private queues: { swarmFish: Queue<FishJobPayload>; swarmAggregate: Queue<AggregateJobPayload> },
  ) {}

  async launchSwarm(opts: LaunchSwarmOpts): Promise<{ swarmId: number }> {
    // 1. Insert sim_swarm row (status=pending, size=perturbations.length).
    // 2. For each perturbation i: applyPerturbation(baseSeed, spec) -> fishSeed.
    //    Insert sim_run row with swarm_id, fish_index=i, status=pending.
    //    Enqueue swarmFish job with { swarmId, simRunId, fishIndex }.
    // 3. Transition swarm.status=running.
  }

  async onFishComplete(swarmId: number, simRunId: number, outcome: FishOutcome): Promise<void> {
    // Count done fish. When done >= quorum * size OR all done:
    //   Enqueue swarmAggregate job (dedupe by swarmId jobId).
  }

  async status(swarmId: number): Promise<SwarmStatus>;
  async abort(swarmId: number): Promise<void>;
}
```

### 4.5c. [packages/sweep/src/jobs/workers/swarm-fish.worker.ts](packages/sweep/src/jobs/workers/swarm-fish.worker.ts)

```ts
export function createSwarmFishWorker(deps) {
  return createWorker({
    name: "swarm-fish",
    concurrency: deps.config.fishConcurrency, // 8 default
    processor: async (job: Job<FishJobPayload>) => {
      const { swarmId, simRunId } = job.data;
      // 1. Mark sim_run.status=running.
      // 2. Run the whole fish lifecycle inline: build agents, drain turns via orchestrator.
      //    Use llmMode + nanoModel from sim_run.config (inherited from swarm.config).
      //    Each turn enqueues-and-awaits via simTurnQueue OR runs inline (see note below).
      // 3. Build FishOutcome { simRunId, terminalAction, summaryVector, cost }.
      // 4. swarmService.onFishComplete(swarmId, simRunId, outcome).
    },
  });
}
```

**Inline vs queued turns inside a fish.** A fish is short (≤20 turns). Two options:
- **Queued** (uniform with orchestrator.scheduleNext): robust but slow — each turn is a BullMQ round-trip.
- **Inline**: the fish worker drives turns synchronously in a loop, calling `runner.runTurn()` directly. Faster by 10× for short fish.

**Decision: inline for fish inside the swarm.** The orchestrator's `scheduleNext` is retained for standalone single-run invocations (useful for debugging and for live-interactive UC1 runs in the admin UI). But inside a swarm fish, turns run inline.

### 4.5d. [packages/sweep/src/sim/aggregator.service.ts](packages/sweep/src/sim/aggregator.service.ts)

```ts
export class AggregatorService {
  async aggregate(swarmId: number): Promise<SwarmAggregate> {
    // 1. Load all completed sim_run rows for the swarm.
    // 2. For each fish, extract FishOutcome (terminal action kind, key params, embedding).
    // 3. Cluster embeddings with a cheap k-means (k=3..7 adaptive). Fallback: group by (action.kind, coarse params).
    // 4. Produce SwarmAggregate {
    //      totalFish, quorumMet, failedFish,
    //      clusters: [{ label, fraction, exemplarSimRunId, centroid, sampleActions }],
    //      modal: { kind, params, fraction, fishIds },
    //      divergenceScore: 1 - maxClusterFraction,
    //    }.
  }
}
```

**K-means implementation: inline 30-LOC cosine k-means**, no external dependency. Init = k-means++ on cosine distance; 10 iterations max; converge on centroid delta < 1e-4.

**Terminal embedding: embed the last turn's `observableSummary` directly** — no extra nano summarize-fish call. The `observableSummary` is already a canonical externally-visible summary (that's what it was designed for), so reusing it is free and avoids a round-trip per fish. One vector per fish, pre-existing in `sim_agent_memory`.

### 4.5e. [packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts](packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts)

```ts
export function createSwarmAggregateWorker(deps) {
  return createWorker({
    name: "swarm-aggregate",
    concurrency: 2,
    processor: async (job: Job<AggregateJobPayload>) => {
      const agg = await deps.aggregator.aggregate(job.data.swarmId);
      const reportFindingId = await deps.swarmReporter.render(job.data.swarmId, agg);
      if (swarmKind === "uc3_conjunction") {
        await deps.promote.emitSuggestionFromModal(job.data.swarmId, agg); // modal action -> sweep_suggestion
      }
      await markSwarmDone(deps.db, job.data.swarmId, { reportFindingId });
    },
  });
}
```

### 4.5f. Queues — add to [packages/sweep/src/jobs/queues.ts](packages/sweep/src/jobs/queues.ts)

```ts
export const swarmFishQueue = new Queue<FishJobPayload>("swarm-fish", { connection: redis });
export const swarmAggregateQueue = new Queue<AggregateJobPayload>("swarm-aggregate", { connection: redis });
```

### Verification (Phase 4.5)
- `pnpm --filter @interview/sweep typecheck` → 0 errors.
- Unit test: `applyPerturbation(base, { kind: "noop" })` → output equals base.
- Unit test: `applyPerturbation` is deterministic — same inputs twice → identical outputs.
- Integration test: `launchSwarm({ size: 10 })` → 10 fish jobs enqueued, 10 `sim_run` rows inserted, status transitions running → done.
- Integration test: 2 fish fail (mock throw) → quorum (80% of 10 = 8) still met → aggregate still runs.
- Integration test: 3 fish fail out of 10 → below quorum → swarm.status=failed, no suggestion emitted.

### Anti-pattern guard
- Don't have fish talk to each other — each fish is independent.
- Don't persist embeddings for every turn of every fish — only the terminal observation is embedded for aggregation (1 vector per fish, not 1 per turn).
- Don't call `aggregate` more than once per swarm — BullMQ `jobId = swarm:${swarmId}:aggregate` dedupes.
- Don't pull in an external k-means package — write it inline (cosine distance, k-means++ init, 10 iters max, 30 LOC).

### RPS backstop — UC1 nano rate-limit fallback

UC1 swarm = 50 fish × 15 turns × N agents × (potentially 2 nano calls per turn if the observable-summary second-pass is kept nano). Worst case ≈ 50 × 15 × 3 × 2 = 4500 nano calls per swarm. At `fishConcurrency=8` this bursts up to ~24 RPS.

**If nano 429s become common, switch to mailbox pacing** instead of raising concurrency or retrying tight:
- Introduce a `nano-mailbox` BullMQ queue that gates nano calls behind a token-bucket rate limiter (BullMQ's `limiter` option, configured per the nano provider's documented RPS).
- The fish worker pushes each nano call onto the mailbox and awaits; the mailbox processor enforces global RPS regardless of `fishConcurrency`.
- This keeps fan-out semantics but smooths the request rate.

Flag this as a follow-up if cloud swarm runs hit rate limits. Fixtures mode is unaffected (no network).

---

## Phase 5 — Reporter cortex + report renderer — ~30 min

**What to implement** — final narrative via a new Thalamus cortex skill.

### 5a. Create [packages/thalamus/src/cortices/skills/sim_reporter.md](packages/thalamus/src/cortices/skills/sim_reporter.md)

```yaml
---
name: sim_reporter
description: Render a multi-agent simulation timeline as a briefing for reviewers.
sqlHelper: querySimTimeline
params:
  simRunId: { type: number, required: true }
---
```

Body (system prompt):
> You render a multi-agent SSA simulation as a structured briefing. You receive the full timeline (agent turns + god events) and produce: (1) a one-paragraph abstract, (2) a per-operator summary, (3) key decision points with timestamps, (4) outcomes and second-order implications. Be concrete — reference operator names, satellite ids, and turn indices. Do NOT invent events not present in the timeline.

### 5b. Create [packages/thalamus/src/cortices/sql-helpers.sim-timeline.ts](packages/thalamus/src/cortices/sql-helpers.sim-timeline.ts)

`querySimTimeline(db, { simRunId })`:
- JOIN `sim_turn` + `sim_agent` + `operator` to produce one row per turn with operator name + action + observable summary + `actor_kind`.
- Return ordered by `turn_index ASC`.
- **Mode-agnostic**: reads from `sim_turn` exclusively, so DAG and Sequential runs look identical to the reporter.

Export through `sql-helpers.ts` barrel (same pattern as [tasks/cortex-helpers-plan.md:313](tasks/cortex-helpers-plan.md#L313)).

### 5c. [packages/sweep/src/sim/reporter.service.ts](packages/sweep/src/sim/reporter.service.ts)

```ts
export class SimReporterService {
  async renderReport(simRunId: number): Promise<{ findingId: number }>;
}
```

Calls `cortexExecutor.execute('sim_reporter', { simRunId })`. The cortex produces a `research_finding` as usual. Store the finding id on `sim_run.report_finding_id`. Used for **single-fish** debugging; the swarm flow uses the swarm reporter below.

### 5d. Swarm reporter cortex [packages/thalamus/src/cortices/skills/sim_swarm_reporter.md](packages/thalamus/src/cortices/skills/sim_swarm_reporter.md)

```yaml
---
name: sim_swarm_reporter
description: Render a sim-swarm aggregate as a coverage report with outcome distribution.
sqlHelper: querySwarmOutcomes
params:
  swarmId: { type: number, required: true }
---
```

Body: "You render a swarm of $K$ short SSA simulations as a coverage briefing. You receive cluster counts, the modal outcome, exemplar fish, and a divergence score. Produce: (1) headline (modal action + confidence), (2) distribution table (each cluster: fraction, representative action, rationale synthesis), (3) tail scenarios (low-probability but high-impact clusters), (4) reviewer guidance. Never cite a specific fish without its simRunId."

### 5e. [packages/sweep/src/sim/swarm-reporter.service.ts](packages/sweep/src/sim/swarm-reporter.service.ts)

```ts
export class SwarmReporterService {
  async render(swarmId: number, agg: SwarmAggregate): Promise<{ findingId: number }> {
    // Runs sim_swarm_reporter cortex. The SQL helper returns:
    //   swarm metadata + per-cluster aggregate + modal + tail clusters.
    // Returns the research_finding id. Store it on sim_swarm.outcome_report_finding_id.
  }
}
```

### 5f. UC3 suggestion promotion — [packages/sweep/src/sim/promote.ts](packages/sweep/src/sim/promote.ts) extension

```ts
export async function emitSuggestionFromModal(
  db: Database, swarmId: number, agg: SwarmAggregate,
): Promise<number | null> {
  // Only UC3. Take agg.modal. If modal.fraction >= 0.5 AND modal.kind === 'accept':
  //   Walk back through the exemplar fish to extract the final propose_split parameters.
  //   Enqueue a sweep_suggestion tagged with sim_swarm_id, carrying the full distribution as metadata.
  // Otherwise (no clear modal OR non-accept modal):
  //   Do not auto-emit. The reviewer reads the swarm report and decides manually.
  // Returns the suggestion id or null.
}
```

### Verification (Phase 5)
- `querySimTimeline` returns rows in `turn_index` order.
- `querySwarmOutcomes` returns one row per fish with terminal action + embedding.
- After a UC3 swarm with 30 fish where `modal.kind='accept' AND modal.fraction=0.6`: one `sweep_suggestion` exists with `sim_swarm_id` + distribution in metadata.
- After a UC3 swarm where `modal.fraction=0.35` (high divergence): zero suggestions emitted; swarm report still rendered.

### Anti-pattern guard
- Don't stream the report — one-shot via existing cortex pipeline.
- Don't write to `research_finding` directly — go through cortex executor so embeddings + edges are populated.
- Don't emit a suggestion per fish. Only the swarm aggregator emits, and at most one per swarm.

### Verification (Phase 5)
- `querySimTimeline` returns rows in `turn_index` order
- After a UC3 run, `sim_run.report_finding_id IS NOT NULL`
- After a UC3 run with an `accept` on the final turn, a `sweep_suggestion` exists with `sim_run_id` set

### Anti-pattern guard
- Don't stream the report — one-shot via existing cortex pipeline.
- Don't write to `research_finding` directly — go through cortex executor so embeddings + edges are populated.

---

## Phase 6 — UC3 auto-spawn hook + UC1 entrypoint — ~30 min

**What to implement** — wire UC3 into finding routing, expose UC1 via admin routes.

### 6a. Hook in [packages/sweep/src/services/finding-routing.ts](packages/sweep/src/services/finding-routing.ts)

Add a new exported function `wireSwarmAutoSpawn(deps: { swarmService, findingRepo, thresholds })`:
- Subscribe to a `research_finding` insert event (Redis pub/sub or poll-and-dedupe via `findings_routed` table — check existing pattern).
- Filter: `cortex = 'conjunction_analysis'` AND `urgency >= 0.7`.
- Extract 2 operator ids from edges; if fewer than 2, skip.
- Call `swarmService.launchSwarm({ kind: "uc3_conjunction", baseSeed: { conjunctionFindingId, operatorIds }, perturbations: generateDefaultPerturbations("uc3_conjunction", 30, rng), llmMode })`.

### 6b. Routes [packages/sweep/src/routes/swarm.routes.ts](packages/sweep/src/routes/swarm.routes.ts)

```ts
POST   /admin/swarm/uc1              -> swarmService.launchSwarm(kind: uc1, ...)
POST   /admin/swarm/uc3              -> swarmService.launchSwarm(kind: uc3, ...)
GET    /admin/swarm/:id              -> swarm status + per-fish summary
GET    /admin/swarm/:id/report       -> swarm coverage report (finding)
GET    /admin/swarm/:id/fish/:i      -> single-fish details + turns
POST   /admin/swarm/:id/abort        -> swarmService.abort

# Keep single-sim routes for debugging / live-interactive UC1:
POST   /admin/sim/uc1                -> orchestrator.startUc1 (single run, no swarm)
GET    /admin/sim/:id                -> single-sim status
POST   /admin/sim/:id/god            -> orchestrator.inject
POST   /admin/sim/:id/pause
POST   /admin/sim/:id/resume
```

Use existing auth middleware (`authenticate` + admin guard, see [packages/sweep/src/middleware/auth.middleware.ts](packages/sweep/src/middleware/auth.middleware.ts)).

### 6c. Chat scoping — extend [packages/sweep/src/services/satellite-sweep-chat.service.ts](packages/sweep/src/services/satellite-sweep-chat.service.ts)

Add optional `simRunId` scope parameter. When set, the chat service's context retrieval reads from `sim_turn` + `sim_agent_memory` (scoped by `sim_run_id`) instead of the global KG. Keep the existing code path unchanged when `simRunId` is absent.

### Verification (Phase 6)
- Integration test: insert a fake conjunction finding with urgency=0.85 + 2 operator edges → within 5s, a `sim_run` of kind `uc3_conjunction` exists.
- `curl POST /admin/sim/uc1 -d '{...}'` returns `{ simRunId }`.
- Chat with `simRunId` param returns turns from that run only.

### Anti-pattern guard
- Don't auto-spawn on EVERY conjunction finding — rate-limit per (operatorA, operatorB, satelliteA, satelliteB) tuple (e.g. max 1 sim per hour per tuple).
- Don't let `inject` or chat bypass auth.

---

## Phase 7 — Demo entrypoints + Makefile targets — ~20 min

### 7a. [packages/sweep/src/demo/swarm-uc3.ts](packages/sweep/src/demo/swarm-uc3.ts)

1. Boot Pool + Redis + container.
2. Seed a conjunction finding if absent (insert into `research_finding` + 2 `research_edge` to operators).
3. `swarmService.launchSwarm({ kind: "uc3_conjunction", baseSeed, perturbations: generateDefaultPerturbations("uc3_conjunction", 30, rngFromSeed(42)), config: { llmMode, fishConcurrency: 8, perFishTimeoutMs: 60000, quorumPct: 0.8, nanoModel: "gpt-5.4-nano" } })`.
4. Wait for `swarm.status=done` (poll every 3s, timeout 180s).
5. Print the coverage report + suggestion id (if any) + distribution summary.

### 7b. [packages/sweep/src/demo/swarm-uc1.ts](packages/sweep/src/demo/swarm-uc1.ts)

1. Boot Pool + Redis + container.
2. Pick top 3 operators by satellite count.
3. `swarmService.launchSwarm({ kind: "uc1_operator_behavior", baseSeed: { operatorIds, horizonDays: 5, turnsPerDay: 1 }, perturbations: generateDefaultPerturbations("uc1_operator_behavior", 50, rngFromSeed(42)), config })`.
4. Wait for done, print coverage report + top-3 clusters.

### 7c. Single-sim demos (debugging) — keep `sim-uc3.ts` / `sim-uc1.ts` as size-1 swarm wrappers

These invoke `launchSwarm(..., perturbations: [{ kind: "noop" }])`, so they exercise the same pipeline but with K=1. Useful for `THALAMUS_MODE=record` to capture fixtures fish-by-fish.

### 7d. Makefile targets (append to [Makefile](Makefile))

```makefile
# Swarm demos (primary)
swarm-uc3:
	THALAMUS_MODE=fixtures pnpm --filter @interview/sweep exec node --env-file=../../.env --import tsx src/demo/swarm-uc3.ts

swarm-uc1:
	THALAMUS_MODE=fixtures pnpm --filter @interview/sweep exec node --env-file=../../.env --import tsx src/demo/swarm-uc1.ts

swarm-uc3-cloud:
	THALAMUS_MODE=cloud    pnpm --filter @interview/sweep exec node --env-file=../../.env --import tsx src/demo/swarm-uc3.ts

# Single-fish demos (debugging)
sim-uc3:
	THALAMUS_MODE=fixtures pnpm --filter @interview/sweep exec node --env-file=../../.env --import tsx src/demo/sim-uc3.ts

sim-uc1:
	THALAMUS_MODE=fixtures pnpm --filter @interview/sweep exec node --env-file=../../.env --import tsx src/demo/sim-uc1.ts
```

### 7d. Record fixtures (first time only)

```bash
THALAMUS_MODE=record make sim-uc3
THALAMUS_MODE=record make sim-uc1
```

Commit the resulting `fixtures/recorded/*.json`.

### Verification (Phase 7)
- `make swarm-uc3` completes in < 180s in fixtures mode, 30 fish run, at least 24 (80% quorum) succeed, coverage report printed with distribution, one suggestion if modal ≥ 50%.
- `make swarm-uc1` completes in < 300s in fixtures mode, 50 fish run, coverage report mentions all 3 operators + at least 3 distinct outcome clusters.
- Re-running `make swarm-uc3` produces byte-identical aggregator output (same cluster fractions, same modal, same suggestion payload).
- `make sim-uc3` (size-1 swarm) completes in < 30s, exercises same pipeline as swarm-uc3 with K=1.

---

## Phase 8 — Tests + final anti-pattern sweep — ~30 min

### 8a. Unit tests in [packages/sweep/tests/sim/](packages/sweep/tests/sim/)

- `agent-builder.test.ts` — persona generation is deterministic for fixed operator.
- `memory.service.test.ts` — `topK` returns zero rows for a different sim_run_id.
- `turn-runner.test.ts` — LLM throw → no DB writes; success → 1 self_action + (N-1) observation rows.
- `orchestrator.test.ts` — maxTurns respected, pause/resume idempotent, god inject appears in next turn's observable.

### 8b. Integration test — UC3 happy path

Against a seeded DB + real BullMQ + fixture LLM:
- Seed conjunction finding.
- `orchestrator.startUc3(...)`.
- Drain queue.
- Assert: `sim_run.status=done`, `report_finding_id` set, one `sweep_suggestion` with `sim_run_id`.

### 8c. Final anti-pattern sweep

```bash
# Thalamus must not import sweep
grep -rn '@interview/sweep' packages/thalamus/src/                # expect empty

# Must use mode-aware transport
grep -rn 'createLlmTransport(' packages/sweep/src/sim/            # expect 0
grep -rn 'createLlmTransportWithMode' packages/sweep/src/sim/     # expect >= 1

# No Python / MiroFish leftovers
grep -rn 'camel\|oasis\|miroFish\|miro-fish' packages/sweep/src/  # expect empty

# Memory queries must be scoped
grep -rn 'from sim_agent_memory' packages/sweep/src/sim/ | grep -v 'sim_run_id'
# expect empty (every vector query is scoped to sim_run_id)

# No DAG executor reuse for turns
grep -rn 'ThalamusDAGExecutor' packages/sweep/src/sim/            # expect empty

# Suggestions emitted by sim must carry sim_run_id
grep -rn 'enqueueSuggestion(' packages/sweep/src/sim/ | grep -v simRunId
# expect 0
```

All should pass.

---

## Execution sequencing notes

- Phases 1 and 2 are mostly independent but Phase 2 imports types that live in Phase 1 schema (via the `Database` type and the vector helper). Do 1 → 2 strictly.
- Phase 3 depends on 2 (uses `MemoryService`).
- Phase 4 depends on 3 (enqueues to the worker).
- Phase 5 can start in parallel with Phase 4 once Phase 1 lands (reporter only needs the schema).
- Phase 6 depends on 4 + 5.
- Phase 7 depends on everything.
- Phase 8 runs last.

Each phase ends with `pnpm typecheck` → 0 errors. Never advance with red.

## Exit criteria for plan complete

1. `pnpm typecheck` → 0 errors across all 4 packages.
2. `make db-migrate` applies cleanly; `sim_swarm`, `sim_run`, `sim_agent`, `sim_turn`, `sim_agent_memory` exist with HNSW index.
3. `make swarm-uc3` (30 fish, Sequential driver) completes in < 180s in fixtures mode, ≥ 24 fish succeed (quorum), coverage report rendered, suggestion emitted when modal ≥ 50%, tagged with `sim_swarm_id` + distribution metadata.
4. `make swarm-uc1` (50 fish, DAG driver) completes in < 300s in fixtures mode, coverage report distinguishes ≥ 3 outcome clusters and names all 3 operators.
5. Re-running both swarm demos produces byte-identical aggregator output (clusters, modal, suggestion payload).
6. Final anti-pattern grep returns 0 matches across all six checks.
7. `packages/thalamus` has zero imports from `packages/sweep`.
8. Both drivers write to `sim_turn` in a byte-compatible shape — swarm reporter reads uniformly.
9. `sim_turn` rows emitted during negotiation micro-actions (`propose_split/accept/reject/hold/lobby`) produce **zero** `research_finding` rows — KG stays clean.
10. At most ONE `sweep_suggestion` per swarm (never per fish). Below-quorum swarms emit zero suggestions.
11. Fan-out: 30 fish with `fishConcurrency=8` shows ≤ 8 concurrent `sim_run.status='running'` rows at any instant during the swarm.
12. Cost ceiling: a 50-fish cloud-mode UC1 swarm incurs ≤ $1.00 measured via LLM cost telemetry (nano model).

## Not in scope for v0 (tracked separately)

- Real orbital propagation (SGP4 / TLE integration).
- Multi-tenant sim ownership UI.
- Sim snapshotting / forking mid-run.
- Non-operator agents (regulators, insurers) — persona framework supports them but not wired.
- WebSocket streaming of turns to the admin UI (polling GET is enough for v0).
