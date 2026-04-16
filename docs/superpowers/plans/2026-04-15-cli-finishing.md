# CLI Finishing (`@interview/cli` — parachèvement) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining gaps in `@interview/cli` so the REPL demo is end-to-end real — `/pc` drives a live Pc-estimator swarm, `/query` renders an analyst briefing from the skill cortex, the satellite loader subtitle streams `stepLog` events in real time, every renderer is unit-tested, and the REPL exposes `/help` + `/clear`.

**Architecture:** Three layers, same boundaries as the foundation plan.

1. **Sweep** — teach `swarm-fish.worker` + `swarm-aggregate.worker` to handle `uc_pc_estimator`; export `startPcEstimatorSwarm` + `PcAggregatorService` from `@interview/sweep`.
2. **CLI adapters** — replace the boot-level `pcEstimator` stub with a real "launch-then-poll-then-aggregate" adapter; add an analyst-briefing invocation step in the CLI's cycle pipeline; wire the pino ring buffer into the `SatelliteLoader` subtitle so step events stream live.
3. **CLI UX** — `/help`, `/clear`, `/reset`; six missing renderer tests (telemetry, logTail, graphTree, whyTree, clarify, pcEstimator); docs (`packages/cli/README.md`) + CHANGELOG entry.

**Tech Stack:** TypeScript, Vitest, ink-testing-library, pino, BullMQ (existing), drizzle-orm (existing).

**Prior plan:** [`2026-04-14-conversational-cli.md`](2026-04-14-conversational-cli.md) (22 tasks, shipped). Baseline: 55/55 CLI tests green.

---

## File Structure

```
packages/sweep/src/
  index.ts                                # ADD: startPcEstimatorSwarm, PcAggregatorService exports
  jobs/workers/
    swarm-fish.worker.ts                  # MODIFY: route uc_pc_estimator → DAG runner (single turn)
    swarm-aggregate.worker.ts             # MODIFY: route uc_pc_estimator → PcAggregatorService
  config/container.ts                     # MODIFY: inject PcAggregatorService into SimServices
  sim/promote.ts                          # ADD: emitPcSuggestion() — persist aggregate as sweep_suggestion
packages/sweep/tests/sim/
  aggregator-pc.spec.ts                   # NEW: pure aggregation test (already partly covered — extend)
  pc-swarm.service.spec.ts                # NEW: baseSeed + perturbation shape

packages/cli/src/
  adapters/
    pcEstimator.ts                        # REWRITE: launch swarm → poll sim_swarm.status → aggregate
    briefingSynthesizer.ts                # NEW: invoke analyst_briefing skill on findings → briefing
    stepStream.ts                         # NEW: subscribe to pino ring buffer, emit StepEvent
  renderers/
    briefing.tsx                          # MODIFY: accept optional synthesizedSummary
  router/
    parser.ts                             # MODIFY: /help, /clear
    schema.ts                             # MODIFY: add "help" | "clear" step kinds
    dispatch.ts                           # MODIFY: dispatch help/clear
  app.tsx                                 # MODIFY: pipe stepStream → SatelliteLoader subtitle; handle clear
  boot.ts                                 # MODIFY: wire real pcEstimator, build analyst-briefing synthesizer
packages/cli/tests/
  adapters/pcEstimator.spec.ts            # NEW: polling + aggregation path
  adapters/briefingSynthesizer.spec.ts    # NEW: nano call shape + fallback on invalid JSON
  adapters/stepStream.spec.ts             # NEW: ring-buffer subscription + filtering
  router/help.spec.ts                     # NEW: /help + /clear parser + dispatch
  renderers/telemetry.spec.tsx            # NEW
  renderers/logTail.spec.tsx              # NEW
  renderers/graphTree.spec.tsx            # NEW
  renderers/whyTree.spec.tsx              # NEW
  renderers/clarify.spec.tsx              # NEW
  renderers/pcEstimator.spec.tsx          # NEW

packages/cli/README.md                    # NEW
CHANGELOG.md                              # MODIFY: add 2026-04-15 CLI finishing entry
```

---

## Phase A — Pc lane end-to-end (sweep)

### Task A1: Extend aggregator-pc tests to cover edge cases

**Files:**

- Test: `packages/sweep/tests/sim/aggregator-pc.spec.ts`

- [ ] **Step 1: Check whether the spec already exists**

Run: `ls packages/sweep/tests/sim/aggregator-pc.spec.ts 2>/dev/null || echo MISSING`
Expected: either a path (extend it) or `MISSING` (create from scratch).

- [ ] **Step 2: Write the failing test (covers median / σ / clusters / severity + empty)**

```typescript
// packages/sweep/tests/sim/aggregator-pc.spec.ts
import { describe, it, expect } from "vitest";
import {
  computePcAggregate,
  aggregateToSuggestion,
  severityFromMedian,
} from "../../src/sim/aggregator-pc";
import type { TurnAction } from "@interview/db-schema";

function est(pc: number, mode = "nominal", flags: string[] = []): TurnAction {
  return {
    kind: "estimate_pc",
    conjunctionId: 42,
    pcEstimate: pc,
    dominantMode: mode,
    flags,
  };
}

describe("computePcAggregate", () => {
  it("returns null on empty input", () => {
    expect(computePcAggregate([])).toBeNull();
  });
  it("computes median / p5 / p95 / sigma across samples", () => {
    const agg = computePcAggregate(
      [est(1e-5), est(1e-4), est(1e-3), est(1e-4), est(1e-4)],
      42,
    )!;
    expect(agg.fishCount).toBe(5);
    expect(agg.medianPc).toBeCloseTo(1e-4, 10);
    expect(agg.p5Pc).toBeLessThanOrEqual(agg.medianPc);
    expect(agg.p95Pc).toBeGreaterThanOrEqual(agg.medianPc);
    expect(agg.sigmaPc).toBeGreaterThan(0);
  });
  it("surfaces clusters with >= 2 fish, sorted by fishCount desc", () => {
    const agg = computePcAggregate([
      est(1e-4, "nominal", []),
      est(2e-4, "nominal", []),
      est(5e-3, "tight", ["cov-clamped"]),
      est(6e-3, "tight", ["cov-clamped"]),
      est(7e-3, "tight", ["cov-clamped"]),
      est(3e-6, "loose"),
    ])!;
    expect(agg.clusters.length).toBe(2);
    expect(agg.clusters[0]!.fishCount).toBe(3);
    expect(agg.clusters[0]!.mode).toBe("tight");
    expect(agg.clusters[0]!.flags).toEqual(["cov-clamped"]);
  });
  it("derives severity from median", () => {
    expect(severityFromMedian(1e-2)).toBe("high");
    expect(severityFromMedian(5e-4)).toBe("medium");
    expect(severityFromMedian(1e-6)).toBe("info");
  });
  it("aggregateToSuggestion preserves payload shape", () => {
    const agg = computePcAggregate([est(1e-4), est(2e-4)], 42)!;
    const s = aggregateToSuggestion(agg);
    expect(s.kind).toBe("pc_estimate");
    expect(s.payload.methodology).toBe("swarm-pc-estimator");
    expect(s.payload.conjunctionId).toBe(42);
  });
});
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @interview/sweep test aggregator-pc -- --run`
Expected: PASS (the aggregator is already implemented in `aggregator-pc.ts`). If anything fails, the implementation already in `packages/sweep/src/sim/aggregator-pc.ts` is wrong — fix it to match the test, do not modify the test.

- [ ] **Step 4: Commit**

```bash
git add packages/sweep/tests/sim/aggregator-pc.spec.ts
git commit -m "test(sweep): pin aggregator-pc behaviour — median, σ, clusters, severity"
```

### Task A2: Route `uc_pc_estimator` in swarm-fish worker

**Files:**

- Modify: `packages/sweep/src/jobs/workers/swarm-fish.worker.ts:75-95`

- [ ] **Step 1: Read the current routing block**

Open `packages/sweep/src/jobs/workers/swarm-fish.worker.ts` and locate the `if (run.kind === "uc3_conjunction") … else if … else throw new Error("unknown sim_run.kind")` cascade (around line 80-95).

- [ ] **Step 2: Write a failing integration-ish unit test**

```typescript
// packages/sweep/tests/sim/pc-swarm-fish-routing.spec.ts
import { describe, it, expect } from "vitest";
import { pickRunnerForKind } from "../../src/jobs/workers/swarm-fish.worker";

describe("pickRunnerForKind", () => {
  it("maps uc_pc_estimator → dag (single-turn estimate)", () => {
    expect(pickRunnerForKind("uc_pc_estimator")).toBe("dag");
  });
  it("still maps uc_telemetry_inference → dag", () => {
    expect(pickRunnerForKind("uc_telemetry_inference")).toBe("dag");
  });
  it("maps uc3_conjunction → sequential", () => {
    expect(pickRunnerForKind("uc3_conjunction")).toBe("sequential");
  });
  it("throws on unknown kind", () => {
    expect(() => pickRunnerForKind("bogus" as never)).toThrow(
      /unknown sim_run.kind/,
    );
  });
});
```

Run: `pnpm --filter @interview/sweep test pc-swarm-fish-routing -- --run`
Expected: FAIL (`pickRunnerForKind` not exported).

- [ ] **Step 3: Extract routing into a pure helper + handle uc_pc_estimator**

In `packages/sweep/src/jobs/workers/swarm-fish.worker.ts`, above the worker factory, add:

```typescript
export type RunnerKind = "dag" | "sequential";

export function pickRunnerForKind(kind: string): RunnerKind {
  switch (kind) {
    case "uc3_conjunction":
      return "sequential";
    case "uc1_operator_behavior":
      return "dag";
    case "uc_telemetry_inference":
      return "dag";
    case "uc_pc_estimator":
      return "dag";
    default:
      throw new Error(`unknown sim_run.kind: ${kind}`);
  }
}
```

Then replace the existing `if / else if / else throw` block inside the worker with:

```typescript
const runner = pickRunnerForKind(run.kind);
if (runner === "dag") {
  result = await dagRunner.runTurn({ simRunId, terminal: true });
} else {
  result = await sequentialRunner.runTurn({ simRunId });
}
```

(Keep surrounding context — `simRunId`, `dagRunner`, `sequentialRunner` names match what's already in scope.)

- [ ] **Step 4: Run the test**

Run: `pnpm --filter @interview/sweep test pc-swarm-fish-routing -- --run`
Expected: PASS.

- [ ] **Step 5: Run the full sweep suite to confirm no regression**

Run: `pnpm --filter @interview/sweep test -- --run`
Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add packages/sweep/src/jobs/workers/swarm-fish.worker.ts packages/sweep/tests/sim/pc-swarm-fish-routing.spec.ts
git commit -m "feat(sweep): route uc_pc_estimator fish through DAG runner (terminal=true)"
```

### Task A3: Route `uc_pc_estimator` in swarm-aggregate worker

**Files:**

- Modify: `packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts`
- Modify: `packages/sweep/src/config/container.ts` — inject `PcAggregatorService`
- Modify: `packages/sweep/src/index.ts` — export `PcAggregatorService`, `startPcEstimatorSwarm`

- [ ] **Step 1: Write a failing worker-level test**

```typescript
// packages/sweep/tests/sim/swarm-aggregate-pc-routing.spec.ts
import { describe, it, expect, vi } from "vitest";
import { aggregateSwarmByKind } from "../../src/jobs/workers/swarm-aggregate.worker";

describe("aggregateSwarmByKind", () => {
  it("uc_pc_estimator delegates to pcAggregator", async () => {
    const pcAgg = {
      aggregate: vi
        .fn()
        .mockResolvedValue({
          aggregate: { medianPc: 1e-4 },
          suggestion: { kind: "pc_estimate", payload: {}, severity: "medium" },
        }),
    };
    const tel = { aggregate: vi.fn() };
    const def = { aggregate: vi.fn() };
    const out = await aggregateSwarmByKind(
      "uc_pc_estimator",
      { swarmId: 7 },
      {
        pcAggregator: pcAgg as never,
        telemetryAggregator: tel as never,
        defaultAggregator: def as never,
      },
    );
    expect(pcAgg.aggregate).toHaveBeenCalledWith({ swarmId: 7 });
    expect(tel.aggregate).not.toHaveBeenCalled();
    expect(def.aggregate).not.toHaveBeenCalled();
    expect(out.kind).toBe("pc");
  });
  it("uc_telemetry_inference delegates to telemetryAggregator", async () => {
    const pcAgg = { aggregate: vi.fn() };
    const tel = {
      aggregate: vi
        .fn()
        .mockResolvedValue({ aggregate: null, suggestions: [] }),
    };
    const def = { aggregate: vi.fn() };
    const out = await aggregateSwarmByKind(
      "uc_telemetry_inference",
      { swarmId: 1 },
      {
        pcAggregator: pcAgg as never,
        telemetryAggregator: tel as never,
        defaultAggregator: def as never,
      },
    );
    expect(tel.aggregate).toHaveBeenCalled();
    expect(pcAgg.aggregate).not.toHaveBeenCalled();
    expect(out.kind).toBe("telemetry");
  });
  it("other kinds fall through to defaultAggregator", async () => {
    const pcAgg = { aggregate: vi.fn() };
    const tel = { aggregate: vi.fn() };
    const def = { aggregate: vi.fn().mockResolvedValue({ aggregate: null }) };
    const out = await aggregateSwarmByKind(
      "uc3_conjunction",
      { swarmId: 3 },
      {
        pcAggregator: pcAgg as never,
        telemetryAggregator: tel as never,
        defaultAggregator: def as never,
      },
    );
    expect(def.aggregate).toHaveBeenCalled();
    expect(out.kind).toBe("default");
  });
});
```

Run: `pnpm --filter @interview/sweep test swarm-aggregate-pc-routing -- --run`
Expected: FAIL (`aggregateSwarmByKind` not exported).

- [ ] **Step 2: Extract the routing helper**

Open `packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts`. Near the top (before the worker factory), add:

```typescript
import { PcAggregatorService } from "../../sim/aggregator-pc";

export interface AggregatorSet {
  pcAggregator: Pick<PcAggregatorService, "aggregate">;
  telemetryAggregator: {
    aggregate(opts: { swarmId: number }): Promise<unknown>;
  };
  defaultAggregator: { aggregate(opts: { swarmId: number }): Promise<unknown> };
}

export async function aggregateSwarmByKind(
  kind: string,
  opts: { swarmId: number },
  set: AggregatorSet,
): Promise<{ kind: "pc" | "telemetry" | "default"; result: unknown }> {
  if (kind === "uc_pc_estimator") {
    const result = await set.pcAggregator.aggregate(opts);
    return { kind: "pc", result };
  }
  if (kind === "uc_telemetry_inference") {
    const result = await set.telemetryAggregator.aggregate(opts);
    return { kind: "telemetry", result };
  }
  const result = await set.defaultAggregator.aggregate(opts);
  return { kind: "default", result };
}
```

Then inside the worker, replace the existing `if (kind === "uc_telemetry_inference") { … } else { default path }` block with a single call to `aggregateSwarmByKind(kind, { swarmId }, { pcAggregator, telemetryAggregator, defaultAggregator: this })`. Wire `pcAggregator` through the worker constructor options; default to `new PcAggregatorService({ db })`.

- [ ] **Step 3: Emit the pc sweep suggestion when severity ≥ medium**

Still in the worker, after `aggregateSwarmByKind` returns with `kind === "pc"`:

```typescript
if (
  kind === "pc" &&
  result &&
  (result as { suggestion: { severity: string } | null }).suggestion
    ?.severity !== "info"
) {
  await emitPcSuggestion(
    this.deps.db,
    swarmId,
    (result as { suggestion: PcSweepSuggestion }).suggestion,
  );
}
```

Add the stub in `packages/sweep/src/sim/promote.ts`:

```typescript
export async function emitPcSuggestion(
  db: Database,
  swarmId: number,
  suggestion: PcSweepSuggestion,
): Promise<void> {
  await db.insert(sweepSuggestion).values({
    swarmId: BigInt(swarmId),
    kind: suggestion.kind,
    severity: suggestion.severity,
    payload: suggestion.payload,
    status: "pending",
  });
}
```

(If `sweepSuggestion` schema differs, match the shape used by `emitTelemetrySuggestions` already in the same file — copy its insert pattern exactly. Do NOT invent new columns.)

- [ ] **Step 4: Export from `packages/sweep/src/index.ts`**

Append:

```typescript
export { startPcEstimatorSwarm } from "./sim/pc-swarm.service";
export type { PcEstimatorSwarmOpts } from "./sim/pc-swarm.service";
export {
  PcAggregatorService,
  computePcAggregate,
  aggregateToSuggestion,
  severityFromMedian,
} from "./sim/aggregator-pc";
export type {
  PcAggregate,
  PcCluster,
  PcSweepSuggestion,
  PcSeverity,
} from "./sim/aggregator-pc";
export { emitPcSuggestion } from "./sim/promote";
```

- [ ] **Step 5: Wire `PcAggregatorService` into the container**

In `packages/sweep/src/config/container.ts`, in the block where `TelemetryAggregatorService` is constructed (grep for `TelemetryAggregator`), add alongside it:

```typescript
import { PcAggregatorService } from "../sim/aggregator-pc";
// ...
const pcAggregator = new PcAggregatorService({ db });
// ...
return {
  // ...
  sim: {
    // ...
    pcAggregator,
    telemetryAggregator,
    // ...
  },
};
```

Update the `SimServices` type to include `pcAggregator: PcAggregatorService`.

- [ ] **Step 6: Run all tests**

Run: `pnpm --filter @interview/sweep test -- --run`
Expected: all green (new test + 0 regressions).

- [ ] **Step 7: Commit**

```bash
git add packages/sweep/src/jobs/workers/swarm-aggregate.worker.ts packages/sweep/src/sim/promote.ts packages/sweep/src/index.ts packages/sweep/src/config/container.ts packages/sweep/tests/sim/swarm-aggregate-pc-routing.spec.ts
git commit -m "feat(sweep): aggregator routes uc_pc_estimator → PcAggregatorService + promote suggestion"
```

---

## Phase B — Real pcEstimator adapter in CLI boot

### Task B1: Write the polling-adapter test

**Files:**

- Test: `packages/cli/tests/adapters/pcEstimator.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/adapters/pcEstimator.spec.ts
import { describe, it, expect, vi } from "vitest";
import { makePcEstimatorAdapter } from "../../src/adapters/pcEstimator";

function fakeDb(sequence: Array<{ status: string }>) {
  let call = 0;
  return {
    execute: vi.fn().mockImplementation(async () => ({
      rows: [sequence[Math.min(call++, sequence.length - 1)]],
    })),
  };
}

describe("makePcEstimatorAdapter", () => {
  it("launches the swarm, polls until done, returns aggregate", async () => {
    const startPcEstimatorSwarm = vi
      .fn()
      .mockResolvedValue({ swarmId: 7, fishCount: 3, conjunctionId: 42 });
    const pcAggregator = {
      aggregate: vi.fn().mockResolvedValue({
        aggregate: {
          conjunctionId: 42,
          medianPc: 1e-4,
          sigmaPc: 2e-5,
          p5Pc: 8e-5,
          p95Pc: 2e-4,
          fishCount: 3,
          clusters: [],
          samples: [1e-4, 1e-4, 1e-4],
          severity: "medium",
        },
        suggestion: { kind: "pc_estimate", payload: {}, severity: "medium" },
      }),
    };
    const db = fakeDb([
      { status: "running" },
      { status: "running" },
      { status: "done" },
    ]);
    const adapter = makePcEstimatorAdapter({
      db: db as never,
      swarmService: {} as never,
      pcAggregator: pcAggregator as never,
      startPcEstimatorSwarm,
      pollMs: 1,
      timeoutMs: 1000,
      fishCount: 3,
    });

    const estimate = await adapter.estimate("ce:42");
    expect(startPcEstimatorSwarm).toHaveBeenCalledWith(expect.anything(), {
      conjunctionId: 42,
      fishCount: 3,
      config: expect.any(Object),
    });
    expect(pcAggregator.aggregate).toHaveBeenCalledWith({ swarmId: 7 });
    expect((estimate as { medianPc: number }).medianPc).toBe(1e-4);
    expect((estimate as { severity: string }).severity).toBe("medium");
    expect((estimate as { fishCount: number }).fishCount).toBe(3);
  });

  it("bails out with a typed error when the swarm times out", async () => {
    const startPcEstimatorSwarm = vi
      .fn()
      .mockResolvedValue({ swarmId: 8, fishCount: 3, conjunctionId: 42 });
    const pcAggregator = { aggregate: vi.fn() };
    const db = fakeDb([{ status: "running" }]);
    const adapter = makePcEstimatorAdapter({
      db: db as never,
      swarmService: {} as never,
      pcAggregator: pcAggregator as never,
      startPcEstimatorSwarm,
      pollMs: 1,
      timeoutMs: 5,
      fishCount: 3,
    });
    await expect(adapter.estimate("ce:42")).rejects.toThrow(/timed out/);
  });

  it("rejects malformed conjunction ids", async () => {
    const adapter = makePcEstimatorAdapter({
      db: {} as never,
      swarmService: {} as never,
      pcAggregator: {} as never,
      startPcEstimatorSwarm: vi.fn(),
      pollMs: 1,
      timeoutMs: 1000,
      fishCount: 3,
    });
    await expect(adapter.estimate("not-a-number")).rejects.toThrow(
      /conjunction id/,
    );
  });
});
```

- [ ] **Step 2: Run it**

Run: `pnpm --filter @interview/cli test pcEstimator -- --run`
Expected: FAIL — `makePcEstimatorAdapter` not exported.

- [ ] **Step 3: Commit the failing test**

```bash
git add packages/cli/tests/adapters/pcEstimator.spec.ts
git commit -m "test(cli): pin real pcEstimator adapter contract — launch → poll → aggregate"
```

### Task B2: Implement the real pcEstimator adapter

**Files:**

- Create/overwrite: `packages/cli/src/adapters/pcEstimator.ts`

- [ ] **Step 1: Replace the file**

```typescript
// packages/cli/src/adapters/pcEstimator.ts
import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import type {
  PcAggregatorService,
  PcAggregate,
  startPcEstimatorSwarm as StartFn,
  SwarmService,
} from "@interview/sweep";

export interface PcEstimatorAdapterDeps {
  db: Database;
  swarmService: SwarmService;
  pcAggregator: Pick<PcAggregatorService, "aggregate">;
  startPcEstimatorSwarm: typeof StartFn;
  pollMs?: number;
  timeoutMs?: number;
  fishCount?: number;
  llmMode?: "cloud" | "fixtures" | "record";
}

export interface PcEstimatorAdapter {
  estimate(conjunctionId: string): Promise<unknown>;
}

const DEFAULT_POLL_MS = 500;
const DEFAULT_TIMEOUT_MS = 90_000;
const DEFAULT_FISH = 12;

function parseConjunctionId(raw: string): number {
  const stripped = raw.startsWith("ce:") ? raw.slice(3) : raw;
  const n = Number(stripped);
  if (!Number.isFinite(n) || n <= 0) {
    throw new Error(`invalid conjunction id: ${raw}`);
  }
  return n;
}

export function makePcEstimatorAdapter(
  deps: PcEstimatorAdapterDeps,
): PcEstimatorAdapter {
  const pollMs = deps.pollMs ?? DEFAULT_POLL_MS;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const fishCount = deps.fishCount ?? DEFAULT_FISH;

  return {
    async estimate(conjunctionIdRaw: string): Promise<unknown> {
      const conjunctionId = parseConjunctionId(conjunctionIdRaw);

      const launch = await deps.startPcEstimatorSwarm(
        { db: deps.db, swarmService: deps.swarmService },
        {
          conjunctionId,
          fishCount,
          config: {
            llmMode: deps.llmMode ?? "fixtures",
            quorumPct: 0.6,
            perFishTimeoutMs: 30_000,
            fishConcurrency: Math.min(fishCount, 8),
          },
        },
      );

      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const rows = await deps.db.execute(
          sql`SELECT status FROM sim_swarm WHERE id = ${BigInt(launch.swarmId)} LIMIT 1`,
        );
        const status = (rows.rows[0] as { status?: string } | undefined)
          ?.status;
        if (status === "done" || status === "failed") break;
        await new Promise((r) => setTimeout(r, pollMs));
      }
      if (Date.now() >= deadline) {
        throw new Error(
          `pc estimator swarm ${launch.swarmId} timed out after ${timeoutMs}ms`,
        );
      }

      const { aggregate, suggestion } = await deps.pcAggregator.aggregate({
        swarmId: launch.swarmId,
      });
      if (!aggregate) {
        return emptyEstimate(conjunctionId);
      }
      return toRendererShape(
        aggregate,
        suggestion ? `sg:${launch.swarmId}` : undefined,
      );
    },
  };
}

function emptyEstimate(conjunctionId: number): unknown {
  return {
    conjunctionId: `ce:${conjunctionId}`,
    medianPc: 0,
    sigmaPc: 0,
    p5Pc: 0,
    p95Pc: 0,
    fishCount: 0,
    clusters: [],
    samples: [],
    severity: "info" as const,
    methodology: "swarm-pc-estimator",
  };
}

function toRendererShape(agg: PcAggregate, suggestionId?: string): unknown {
  return {
    conjunctionId: `ce:${agg.conjunctionId}`,
    medianPc: agg.medianPc,
    sigmaPc: agg.sigmaPc,
    p5Pc: agg.p5Pc,
    p95Pc: agg.p95Pc,
    fishCount: agg.fishCount,
    clusters: agg.clusters,
    samples: agg.samples,
    severity: agg.severity,
    methodology: "swarm-pc-estimator" as const,
    ...(suggestionId ? { suggestionId } : {}),
  };
}
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @interview/cli test pcEstimator -- --run`
Expected: PASS (3/3).

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @interview/cli typecheck`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/adapters/pcEstimator.ts
git commit -m "feat(cli): real pcEstimator adapter — launch swarm, poll sim_swarm, aggregate"
```

### Task B3: Wire the real adapter in `buildRealAdapters`

**Files:**

- Modify: `packages/cli/src/boot.ts:288-307`

- [ ] **Step 1: Replace the `pcEstimator:` block**

Remove the stub (lines ≈ 288-307 in `packages/cli/src/boot.ts`) and replace with:

```typescript
    // --- 7. pcEstimator.estimate ---------------------------------------
    pcEstimator: (() => {
      if (!sweepC.sim) {
        return {
          estimate: async (cid: string) => ({
            conjunctionId: cid, medianPc: 0, sigmaPc: 0, p5Pc: 0, p95Pc: 0,
            fishCount: 0, clusters: [], samples: [], severity: "info" as const,
            methodology: "swarm-pc-estimator",
            note: "sweep.sim not wired — pc estimator disabled",
          }),
        };
      }
      return makePcEstimatorAdapter({
        db,
        swarmService: sweepC.sim.swarmService,
        pcAggregator: sweepC.sim.pcAggregator,
        startPcEstimatorSwarm,
        llmMode,
      });
    })(),
```

Add imports at the top of `boot.ts`:

```typescript
import { startPcEstimatorSwarm } from "@interview/sweep";
import { makePcEstimatorAdapter } from "./adapters/pcEstimator";
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @interview/cli typecheck`
Expected: clean. If `sweepC.sim.pcAggregator` is typed as `never`, go back to Task A3 Step 5 — the container type extension is missing.

- [ ] **Step 3: Re-run the CLI test suite**

Run: `pnpm --filter @interview/cli test -- --run`
Expected: 55 passed + 3 new pcEstimator tests = 58.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/boot.ts
git commit -m "feat(cli): wire real pcEstimator adapter in buildRealAdapters"
```

---

## Phase C — Analyst-briefing synthesizer

The existing `BriefingRenderer` receives a hand-written `executiveSummary: "Research cycle produced N finding(s). Cost $x"`. The `analyst_briefing` skill exists at `packages/thalamus/src/cortices/skills/analyst-briefing.md`. We synthesize a real summary via nano before rendering.

### Task C1: Test-drive the synthesizer

**Files:**

- Test: `packages/cli/tests/adapters/briefingSynthesizer.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/adapters/briefingSynthesizer.spec.ts
import { describe, it, expect, vi } from "vitest";
import { makeBriefingSynthesizer } from "../../src/adapters/briefingSynthesizer";

describe("briefingSynthesizer", () => {
  const findings = [
    {
      id: "f1",
      title: "Conjunction ISS / Cosmos",
      summary: "2.3km miss 2026-04-20",
      sourceClass: "KG",
      confidence: 0.82,
      evidenceRefs: [],
    },
  ];

  it("invokes nano with the analyst_briefing skill and returns structured output", async () => {
    const nano = {
      call: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          executiveSummary: "One conjunction flagged, 2.3 km separation.",
          recommendedActions: ["/pc ce:1"],
          followUpPrompts: ["what drove the mass anomaly?"],
        }),
        costUsd: 0.001,
      }),
    };
    const synth = makeBriefingSynthesizer(nano);
    const out = await synth.synthesize("iss vs cosmos", findings);
    expect(nano.call).toHaveBeenCalledTimes(1);
    expect(nano.call.mock.calls[0][0].responseFormat).toBe("json");
    expect(out.executiveSummary).toMatch(/conjunction/i);
    expect(out.recommendedActions).toContain("/pc ce:1");
    expect(out.costUsd).toBe(0.001);
  });

  it("falls back to a deterministic summary when nano returns invalid JSON", async () => {
    const nano = {
      call: vi.fn().mockResolvedValue({ content: "not-json", costUsd: 0 }),
    };
    const synth = makeBriefingSynthesizer(nano);
    const out = await synth.synthesize("q", findings);
    expect(out.executiveSummary).toMatch(/1 finding/);
    expect(out.recommendedActions).toEqual([]);
    expect(out.followUpPrompts).toEqual([]);
  });

  it("returns an empty summary when findings=[]", async () => {
    const nano = { call: vi.fn() };
    const synth = makeBriefingSynthesizer(nano);
    const out = await synth.synthesize("q", []);
    expect(nano.call).not.toHaveBeenCalled();
    expect(out.executiveSummary).toMatch(/no findings/i);
  });
});
```

Run: `pnpm --filter @interview/cli test briefingSynthesizer -- --run`
Expected: FAIL.

### Task C2: Implement the synthesizer

**Files:**

- Create: `packages/cli/src/adapters/briefingSynthesizer.ts`

- [ ] **Step 1: Write the file**

```typescript
// packages/cli/src/adapters/briefingSynthesizer.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export interface Finding {
  id: string;
  title: string;
  summary: string;
  sourceClass: string;
  confidence: number;
  evidenceRefs: string[];
}
export interface Briefing {
  executiveSummary: string;
  recommendedActions: string[];
  followUpPrompts: string[];
  costUsd: number;
}
export interface NanoLike {
  call(a: {
    system: string;
    user: string;
    temperature: number;
    responseFormat: "json";
  }): Promise<{ content: string; costUsd: number }>;
}

function loadSkill(): string {
  try {
    // Fallback-safe: the CLI may run outside the monorepo tree in bundled builds.
    const p = resolve(
      __dirname,
      "../../../thalamus/src/cortices/skills/analyst-briefing.md",
    );
    return readFileSync(p, "utf-8");
  } catch {
    return "You are an analyst. Summarize findings into JSON {executiveSummary, recommendedActions[], followUpPrompts[]}. Stay under 120 words.";
  }
}

export function makeBriefingSynthesizer(nano: NanoLike) {
  const system = loadSkill();
  return {
    async synthesize(query: string, findings: Finding[]): Promise<Briefing> {
      if (findings.length === 0) {
        return {
          executiveSummary: "No findings produced by this research cycle.",
          recommendedActions: [],
          followUpPrompts: [],
          costUsd: 0,
        };
      }
      try {
        const user = JSON.stringify({ query, findings });
        const { content, costUsd } = await nano.call({
          system,
          user,
          temperature: 0.2,
          responseFormat: "json",
        });
        const parsed = JSON.parse(content) as Partial<Briefing>;
        return {
          executiveSummary: String(
            parsed.executiveSummary ?? fallbackSummary(findings),
          ),
          recommendedActions: Array.isArray(parsed.recommendedActions)
            ? parsed.recommendedActions.map(String)
            : [],
          followUpPrompts: Array.isArray(parsed.followUpPrompts)
            ? parsed.followUpPrompts.map(String)
            : [],
          costUsd,
        };
      } catch {
        return {
          executiveSummary: fallbackSummary(findings),
          recommendedActions: [],
          followUpPrompts: [],
          costUsd: 0,
        };
      }
    },
  };
}

function fallbackSummary(findings: Finding[]): string {
  const top = findings[0];
  return `${findings.length} finding${findings.length === 1 ? "" : "s"}; top: ${top?.summary ?? "—"}.`;
}
```

- [ ] **Step 2: Run the test**

Run: `pnpm --filter @interview/cli test briefingSynthesizer -- --run`
Expected: PASS (3/3).

- [ ] **Step 3: Commit**

```bash
git add packages/cli/src/adapters/briefingSynthesizer.ts packages/cli/tests/adapters/briefingSynthesizer.spec.ts
git commit -m "feat(cli): analyst-briefing synthesizer — nano + skill prompt + JSON fallback"
```

### Task C3: Route briefings through the synthesizer in `App`

**Files:**

- Modify: `packages/cli/src/app.tsx` (briefing render block)
- Modify: `packages/cli/src/boot.ts` — build + pass synthesizer
- Modify: `packages/cli/src/router/dispatch.ts` — already returns `{kind:"briefing", findings, costUsd}`; we synthesize in `app.tsx` **after** dispatch so the render has the summary.

- [ ] **Step 1: Extend `AppProps` with `synthesizeBriefing`**

In `packages/cli/src/app.tsx`, change the `AppProps` interface:

```typescript
export interface AppProps {
  adapters: Adapters;
  interpret: (
    input: string,
    turns: readonly unknown[],
  ) => Promise<{ plan: RouterPlan; costUsd: number }>;
  synthesizeBriefing: (
    query: string,
    findings: unknown[],
  ) => Promise<{
    executiveSummary: string;
    recommendedActions: string[];
    followUpPrompts: string[];
    costUsd: number;
  }>;
  etaEstimate: (kind: string, subject: string) => Estimate;
  etaRecord: (kind: string, subject: string, ms: number) => void;
}
```

- [ ] **Step 2: Pre-synthesize before pushing the briefing result**

In the `onSubmit` loop, replace:

```typescript
if (r.kind === "briefing") cost.add(r.costUsd);
setResults((arr) => [...arr, r]);
```

with:

```typescript
if (r.kind === "briefing") {
  cost.add(r.costUsd);
  const syn = await p.synthesizeBriefing(
    step.action === "query" ? step.q : "",
    r.findings,
  );
  cost.add(syn.costUsd);
  setResults((arr) => [...arr, { ...r, synthesized: syn }]);
} else {
  setResults((arr) => [...arr, r]);
}
```

- [ ] **Step 3: Extend `DispatchResult` to carry the optional synthesis**

In `packages/cli/src/router/dispatch.ts`:

```typescript
export type DispatchResult = {
  kind: "briefing";
  findings: unknown[];
  costUsd: number;
  synthesized?: {
    executiveSummary: string;
    recommendedActions: string[];
    followUpPrompts: string[];
    costUsd: number;
  };
};
// … rest unchanged …
```

- [ ] **Step 4: Use the synthesis in the briefing render block**

In `packages/cli/src/app.tsx`:

```tsx
case "briefing":
  return (
    <BriefingRenderer key={i}
      executiveSummary={r.synthesized?.executiveSummary ?? `Research cycle produced ${r.findings.length} finding(s). Cost $${r.costUsd.toFixed(3)}.`}
      findings={r.findings as never}
      recommendedActions={r.synthesized?.recommendedActions ?? []}
      followUpPrompts={r.synthesized?.followUpPrompts ?? []}
    />
  );
```

- [ ] **Step 5: Wire the synthesizer in `boot.ts`**

In `main()`, after the `nano` declaration:

```typescript
const synth = makeBriefingSynthesizer(nano);
```

Add it to the `render(<App ... />)` props:

```typescript
synthesizeBriefing: (q, findings) => synth.synthesize(q, findings as never),
```

Add import: `import { makeBriefingSynthesizer } from "./adapters/briefingSynthesizer";`

- [ ] **Step 6: Update the e2e spec to pass a stub synthesizer**

Open `packages/cli/tests/e2e/repl.spec.tsx` and `repl-real.e2e.spec.tsx`. In each `render(<App ... />)` call site, add:

```typescript
synthesizeBriefing: async (_q, findings) => ({
  executiveSummary: `stub: ${findings.length} finding(s)`,
  recommendedActions: [],
  followUpPrompts: [],
  costUsd: 0,
}),
```

- [ ] **Step 7: Run the full CLI suite**

Run: `pnpm --filter @interview/cli test -- --run`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/cli/src/app.tsx packages/cli/src/router/dispatch.ts packages/cli/src/boot.ts packages/cli/tests/e2e/
git commit -m "feat(cli): briefing renderer consumes analyst_briefing synthesizer output"
```

---

## Phase D — Live step-stream in SatelliteLoader subtitle

Today the `SatelliteLoader` subtitle shows static text. We wire pino ring-buffer events (which already carry `stepLog` emissions from thalamus + sweep) into the loader so the user sees `🧠 planner · done (412ms)` tick while the command runs.

### Task D1: Test-drive the stepStream

**Files:**

- Test: `packages/cli/tests/adapters/stepStream.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/adapters/stepStream.spec.ts
import { describe, it, expect, vi } from "vitest";
import { PinoRingBuffer } from "../../src/util/pinoRingBuffer";
import { makeStepStream } from "../../src/adapters/stepStream";

describe("stepStream", () => {
  it("subscribes to new ring-buffer entries and emits StepEvent", () => {
    const ring = new PinoRingBuffer(32);
    const stream = makeStepStream(ring);
    const seen: unknown[] = [];
    const unsub = stream.subscribe((ev) => seen.push(ev));

    ring.push({ level: 30, msg: "planner", step: "planner", phase: "start" });
    ring.push({
      level: 30,
      msg: "planner",
      step: "planner",
      phase: "done",
      durationMs: 412,
    });

    expect(seen).toHaveLength(2);
    expect((seen[1] as { phase: string }).phase).toBe("done");
    expect((seen[1] as { durationMs: number }).durationMs).toBe(412);
    unsub();

    ring.push({ level: 30, msg: "x", step: "planner", phase: "done" });
    expect(seen).toHaveLength(2); // unsubscribed
  });

  it("ignores non-step log lines", () => {
    const ring = new PinoRingBuffer(32);
    const stream = makeStepStream(ring);
    const seen: unknown[] = [];
    stream.subscribe((ev) => seen.push(ev));
    ring.push({ level: 30, msg: "plain log" });
    expect(seen).toHaveLength(0);
  });
});
```

Run: `pnpm --filter @interview/cli test stepStream -- --run`
Expected: FAIL.

### Task D2: Add a `subscribe` observer to `PinoRingBuffer` + implement stepStream

**Files:**

- Modify: `packages/cli/src/util/pinoRingBuffer.ts`
- Create: `packages/cli/src/adapters/stepStream.ts`

- [ ] **Step 1: Extend `PinoRingBuffer` with subscribers**

Open `packages/cli/src/util/pinoRingBuffer.ts`. In the class body:

```typescript
private readonly subs = new Set<(entry: Record<string, unknown>) => void>();

subscribe(fn: (entry: Record<string, unknown>) => void): () => void {
  this.subs.add(fn);
  return () => { this.subs.delete(fn); };
}
```

In the `push(entry)` method, after the existing buffer write, add:

```typescript
for (const s of this.subs) s(entry);
```

- [ ] **Step 2: Implement stepStream**

```typescript
// packages/cli/src/adapters/stepStream.ts
import type { PinoRingBuffer } from "../util/pinoRingBuffer";

export interface StepEvent {
  step: string;
  phase: "start" | "done" | "error";
  durationMs?: number;
  extra?: Record<string, unknown>;
}

export function makeStepStream(ring: PinoRingBuffer) {
  return {
    subscribe(fn: (ev: StepEvent) => void): () => void {
      return ring.subscribe((entry) => {
        const step = entry.step;
        const phase = entry.phase;
        if (typeof step !== "string" || !step) return;
        if (phase !== "start" && phase !== "done" && phase !== "error") return;
        fn({
          step,
          phase,
          durationMs:
            typeof entry.durationMs === "number" ? entry.durationMs : undefined,
          extra: { ...entry },
        });
      });
    },
  };
}
```

- [ ] **Step 3: Run the test**

Run: `pnpm --filter @interview/cli test stepStream -- --run`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/util/pinoRingBuffer.ts packages/cli/src/adapters/stepStream.ts packages/cli/tests/adapters/stepStream.spec.ts
git commit -m "feat(cli): step-stream adapter — ring-buffer observer → StepEvent"
```

### Task D3: Feed the stream into `SatelliteLoader`

**Files:**

- Modify: `packages/cli/src/components/SatelliteLoader.tsx`
- Modify: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/boot.ts`

- [ ] **Step 1: Add an optional `latestStep` prop to the loader**

In `packages/cli/src/components/SatelliteLoader.tsx`, extend the props:

```tsx
export interface SatelliteLoaderProps {
  kind: string;
  subject: string;
  etaEstimate: Estimate;
  elapsedMs: number;
  costUsd: number;
  latestStep?: { step: string; phase: "start" | "done" | "error" };
}
```

In the render, under the existing subtitle, add:

```tsx
{
  p.latestStep && (
    <Text dimColor>
      {" "}
      {p.latestStep.phase === "error"
        ? "✗"
        : p.latestStep.phase === "done"
          ? "✓"
          : "…"}{" "}
      {p.latestStep.step}
    </Text>
  );
}
```

- [ ] **Step 2: Subscribe in `App` and thread the latest event**

In `packages/cli/src/app.tsx`, extend `AppProps`:

```typescript
stepStream?: { subscribe(fn: (ev: { step: string; phase: "start" | "done" | "error" }) => void): () => void };
```

Inside `App`, add:

```tsx
const [latestStep, setLatestStep] = useState<
  { step: string; phase: "start" | "done" | "error" } | undefined
>();

useEffect(() => {
  if (!p.stepStream) return;
  const unsub = p.stepStream.subscribe((ev) =>
    setLatestStep({ step: ev.step, phase: ev.phase }),
  );
  return unsub;
}, [p.stepStream]);
```

Pass it to the loader:

```tsx
<SatelliteLoader ... latestStep={latestStep} />
```

And import `useEffect`.

- [ ] **Step 3: Wire in `boot.ts`**

In `main()`, after `ring` is created:

```typescript
const stepStream = makeStepStream(ring);
```

Pass to the App:

```typescript
stepStream,
```

Add import: `import { makeStepStream } from "./adapters/stepStream";`

- [ ] **Step 4: Typecheck + tests**

Run: `pnpm --filter @interview/cli typecheck && pnpm --filter @interview/cli test -- --run`
Expected: clean + green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/components/SatelliteLoader.tsx packages/cli/src/app.tsx packages/cli/src/boot.ts
git commit -m "feat(cli): SatelliteLoader subtitle streams stepLog events live"
```

---

## Phase E — `/help` + `/clear` + `/reset`

### Task E1: Test-drive the new parser verbs

**Files:**

- Test: `packages/cli/tests/router/help.spec.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// packages/cli/tests/router/help.spec.ts
import { describe, it, expect } from "vitest";
import { parseExplicitCommand } from "../../src/router/parser";

describe("/help /clear /reset", () => {
  it("parses /help", () => {
    expect(parseExplicitCommand("/help")).toEqual({
      steps: [{ action: "help" }],
      confidence: 1,
    });
  });
  it("parses /clear (alias for /reset)", () => {
    expect(parseExplicitCommand("/clear")).toEqual({
      steps: [{ action: "clear" }],
      confidence: 1,
    });
  });
  it("parses /reset", () => {
    expect(parseExplicitCommand("/reset")).toEqual({
      steps: [{ action: "clear" }],
      confidence: 1,
    });
  });
  it("is case-insensitive on the verb", () => {
    expect(parseExplicitCommand("/HELP")).toEqual({
      steps: [{ action: "help" }],
      confidence: 1,
    });
  });
});
```

Run: `pnpm --filter @interview/cli test help -- --run`
Expected: FAIL.

### Task E2: Extend the schema + parser + dispatcher

**Files:**

- Modify: `packages/cli/src/router/schema.ts`
- Modify: `packages/cli/src/router/parser.ts`
- Modify: `packages/cli/src/router/dispatch.ts`

- [ ] **Step 1: Add schema variants**

In `packages/cli/src/router/schema.ts`, add two entries to the discriminated union:

```typescript
z.object({ action: z.literal("help") }),
z.object({ action: z.literal("clear") }),
```

And in the `clarify` options enum, append `"help"` (so interpretive clarify can list it).

- [ ] **Step 2: Update the parser**

In `packages/cli/src/router/parser.ts`:

```typescript
type Verb =
  | "query"
  | "telemetry"
  | "logs"
  | "graph"
  | "accept"
  | "explain"
  | "pc"
  | "help"
  | "clear"
  | "reset";
const VERBS: ReadonlySet<Verb> = new Set([
  "query",
  "telemetry",
  "logs",
  "graph",
  "accept",
  "explain",
  "pc",
  "help",
  "clear",
  "reset",
]);
```

Lowercase the raw verb before the `VERBS.has` check:

```typescript
const verb = rawVerb?.toLowerCase() as Verb;
if (!VERBS.has(verb)) return null;
```

Add to the switch:

```typescript
case "help":  return { steps: [{ action: "help" }],  confidence: 1 };
case "clear":
case "reset": return { steps: [{ action: "clear" }], confidence: 1 };
```

- [ ] **Step 3: Update `DispatchResult` + `dispatch`**

In `packages/cli/src/router/dispatch.ts`:

```typescript
export type DispatchResult =
  // … existing …
  { kind: "help" } | { kind: "clear" };
```

Switch cases:

```typescript
case "help":  return { kind: "help" };
case "clear": return { kind: "clear" };
```

- [ ] **Step 4: Run parser + schema tests**

Run: `pnpm --filter @interview/cli test router -- --run`
Expected: PASS.

### Task E3: Render /help and wire /clear side effect

**Files:**

- Create: `packages/cli/src/renderers/help.tsx`
- Modify: `packages/cli/src/app.tsx`

- [ ] **Step 1: Write the help renderer**

```tsx
// packages/cli/src/renderers/help.tsx
import React from "react";
import { Box, Text } from "ink";

const ROWS = [
  ["/query <question>", "research cycle (planner → cortices → findings)"],
  ["/pc <ce:id>", "probability-of-collision swarm (K fish)"],
  ["/telemetry <sat-id>", "launch telemetry-inference swarm"],
  ["/graph <entity>", "research_edge neighbourhood (BFS depth 1)"],
  ["/explain <finding-id>", "provenance tree (findings → edges → source_item)"],
  ["/accept <sugg-id>", "reviewer-accept a sweep suggestion"],
  ["/logs [level=info]", "tail the pino ring buffer"],
  ["/clear | /reset", "clear the scroll history (memory buffer kept)"],
  ["/help", "this list"],
] as const;

export function HelpRenderer(): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>SSA console — commands</Text>
      {ROWS.map(([cmd, desc]) => (
        <Box key={cmd}>
          <Text color="cyan">{cmd.padEnd(24)}</Text>
          <Text dimColor> {desc}</Text>
        </Box>
      ))}
    </Box>
  );
}
```

- [ ] **Step 2: Handle help + clear in `App`**

In `packages/cli/src/app.tsx`, in the render switch:

```tsx
case "help":  return <HelpRenderer key={i} />;
case "clear": return null;
```

After dispatch when `r.kind === "clear"`, also clear results:

```typescript
if (r.kind === "clear") {
  setResults([]);
  continue;
}
setResults((arr) => [...arr, r]);
```

(Place this **before** the generic `setResults` push.)

Import: `import { HelpRenderer } from "./renderers/help";`

- [ ] **Step 3: Add a test for the clear behavior**

```tsx
// packages/cli/tests/renderers/help.spec.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { HelpRenderer } from "../../src/renderers/help";

describe("HelpRenderer", () => {
  it("lists all commands", () => {
    const { lastFrame } = render(<HelpRenderer />);
    const out = lastFrame() ?? "";
    expect(out).toMatch(/\/query/);
    expect(out).toMatch(/\/pc/);
    expect(out).toMatch(/\/clear/);
  });
});
```

- [ ] **Step 4: Run CLI tests**

Run: `pnpm --filter @interview/cli test -- --run`
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/router/schema.ts packages/cli/src/router/parser.ts packages/cli/src/router/dispatch.ts packages/cli/src/renderers/help.tsx packages/cli/src/app.tsx packages/cli/tests/router/help.spec.ts packages/cli/tests/renderers/help.spec.tsx
git commit -m "feat(cli): /help /clear /reset — REPL discoverability + scrollback reset"
```

---

## Phase F — Missing renderer tests

Six renderers ship without a unit test. One test per renderer; each pins the visible shape so future refactors break loudly.

### Task F1-F6: Snapshot-ish tests for each renderer

Create one file per renderer under `packages/cli/tests/renderers/`. Each file has a single `render(...).lastFrame()` assertion plus one edge case.

- [ ] **F1 — telemetry.spec.tsx**

```tsx
// packages/cli/tests/renderers/telemetry.spec.tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { TelemetryRenderer } from "../../src/renderers/telemetry";

describe("TelemetryRenderer", () => {
  it("renders the satId + swarm id", () => {
    const out =
      render(
        <TelemetryRenderer
          satId="42"
          distribution={{ swarmId: 7, fishCount: 3 }}
        />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/42/);
    expect(out).toMatch(/swarm/i);
  });
  it("handles missing distribution gracefully", () => {
    const out =
      render(
        <TelemetryRenderer satId="42" distribution={null} />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/42/);
  });
});
```

Run + commit if green. If fails because props don't match, open `packages/cli/src/renderers/telemetry.tsx` and adjust the test to the actual prop names (do not change the renderer).

- [ ] **F2 — logTail.spec.tsx**

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { LogTailRenderer } from "../../src/renderers/logTail";

describe("LogTailRenderer", () => {
  it("renders events with their msg", () => {
    const out =
      render(
        <LogTailRenderer
          events={[{ level: 30, msg: "hello world", time: Date.now() }]}
        />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/hello world/);
  });
  it("renders an empty-state hint for zero events", () => {
    const out = render(<LogTailRenderer events={[]} />).lastFrame() ?? "";
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **F3 — graphTree.spec.tsx**

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { GraphTreeRenderer } from "../../src/renderers/graphTree";

describe("GraphTreeRenderer", () => {
  it("renders the root entity", () => {
    const out =
      render(
        <GraphTreeRenderer
          tree={{
            root: "satellite:42",
            levels: [
              { depth: 0, nodes: ["satellite:42"] },
              { depth: 1, nodes: ["finding:1(authored-by)"] },
            ],
          }}
        />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/satellite:42/);
    expect(out).toMatch(/finding:1/);
  });
});
```

- [ ] **F4 — whyTree.spec.tsx**

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { WhyTreeRenderer } from "../../src/renderers/whyTree";

describe("WhyTreeRenderer", () => {
  it("renders the finding label and its edge children", () => {
    const tree = {
      id: "finding:1",
      label: "ISS mass anomaly",
      kind: "finding",
      children: [
        {
          id: "edge:7",
          label: "supports → satellite:42",
          kind: "edge",
          children: [],
        },
      ],
    };
    const out = render(<WhyTreeRenderer tree={tree} />).lastFrame() ?? "";
    expect(out).toMatch(/ISS mass anomaly/);
    expect(out).toMatch(/satellite:42/);
  });
  it("renders an empty-state when tree is null", () => {
    const out = render(<WhyTreeRenderer tree={null} />).lastFrame() ?? "";
    expect(out.length).toBeGreaterThan(0);
  });
});
```

- [ ] **F5 — clarify.spec.tsx**

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { ClarifyRenderer } from "../../src/renderers/clarify";

describe("ClarifyRenderer", () => {
  it("renders the question and options", () => {
    const out =
      render(
        <ClarifyRenderer
          question="what do you mean?"
          options={["query", "telemetry"]}
        />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/what do you mean/);
    expect(out).toMatch(/query/);
    expect(out).toMatch(/telemetry/);
  });
});
```

- [ ] **F6 — pcEstimator.spec.tsx**

```tsx
import React from "react";
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { PcEstimatorRenderer } from "../../src/renderers/pcEstimator";

describe("PcEstimatorRenderer", () => {
  const est = {
    conjunctionId: "ce:42",
    medianPc: 1e-4,
    sigmaPc: 3e-5,
    p5Pc: 5e-5,
    p95Pc: 2e-4,
    fishCount: 12,
    clusters: [
      {
        mode: "tight",
        flags: ["cov-clamped"],
        pcRange: [9e-5, 2e-4] as [number, number],
        fishCount: 6,
      },
    ],
    samples: [1e-5, 1e-4, 1e-4, 1e-3],
    severity: "medium" as const,
    methodology: "swarm-pc-estimator",
  };

  it("renders median + severity + cluster line", () => {
    const out =
      render(
        <PcEstimatorRenderer conjunctionId="ce:42" estimate={est} />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/ce:42/);
    expect(out).toMatch(/medium/);
    expect(out).toMatch(/tight/);
  });

  it("falls back to empty-state when fishCount=0", () => {
    const out =
      render(
        <PcEstimatorRenderer
          conjunctionId="ce:0"
          estimate={{ ...est, fishCount: 0 }}
        />,
      ).lastFrame() ?? "";
    expect(out).toMatch(/no fish results/i);
  });
});
```

- [ ] **Final F step: run all + commit**

Run: `pnpm --filter @interview/cli test -- --run`
Expected: all green.

```bash
git add packages/cli/tests/renderers/
git commit -m "test(cli): snapshot-ish tests for 6 renderers (telemetry, logTail, graphTree, whyTree, clarify, pcEstimator)"
```

---

## Phase G — Docs + CHANGELOG

### Task G1: Write `packages/cli/README.md`

**Files:**

- Create: `packages/cli/README.md`

- [ ] **Step 1: Write the file**

```markdown
# `@interview/cli` — SSA console REPL

Interactive Ink-based REPL over Thalamus + Sweep. Launch with `pnpm run ssa` from
the repo root.

## Commands

| Verb                    | Description                                                     |
| ----------------------- | --------------------------------------------------------------- |
| `/query <question>`     | research cycle via Thalamus planner + cortices                  |
| `/pc <ce:id>`           | probability-of-collision swarm (K fish → median + σ + clusters) |
| `/telemetry <sat-id>`   | launch telemetry-inference swarm                                |
| `/graph <entity>`       | research_edge neighbourhood (BFS depth 1)                       |
| `/explain <finding-id>` | provenance tree (findings → edges → source_item + sha256)       |
| `/accept <sugg-id>`     | reviewer-accept a sweep suggestion                              |
| `/logs [level=info]`    | tail the pino ring buffer                                       |
| `/help`                 | list commands                                                   |
| `/clear` \| `/reset`    | clear scroll history                                            |

Free-form text routes through the `interpreter` cortex skill — it emits a Zod
`RouterPlan` (one or more typed steps). Low-confidence parses produce a
`clarify` option list.

## Architecture
```

input ──► parser (slash grammar) ─┐
├──► RouterPlan ──► dispatch ──► adapters ──► renderers
input ──► interpret cortex (nano)─┘ │
▼
pino ring buffer ──► stepStream ──► SatelliteLoader subtitle

```

- Adapters: `thalamus`, `telemetry`, `logs`, `graph`, `resolution`, `why`, `pcEstimator`.
- Renderers: 8 (briefing, telemetry, logTail, graphTree, whyTree, clarify, pcEstimator, help).
- Memory: `ConversationBuffer` (token-counted ring) + `MemoryPalace` (sim_agent_memory HNSW, 200k threshold).

## Fixture mode

`THALAMUS_MODE=fixtures` (default) replays canned LLM responses so the REPL
works offline. `THALAMUS_MODE=cloud` calls OpenAI.
```

- [ ] **Step 2: Commit**

```bash
git add packages/cli/README.md
git commit -m "docs(cli): README — commands + architecture + fixture mode"
```

### Task G2: Update root CHANGELOG

**Files:**

- Modify: `CHANGELOG.md` — prepend under `## [Unreleased]`

- [ ] **Step 1: Insert a new block**

Insert just below `## [Unreleased]`:

```markdown
### CLI finishing — 2026-04-15

- **Real Pc swarm** end-to-end: `/pc <ce:id>` launches `startPcEstimatorSwarm`,
  polls `sim_swarm.status`, aggregates via `PcAggregatorService`, renders
  median / σ / p5 / p95 + dissent clusters. `swarm-fish.worker` + `swarm-aggregate.worker`
  now route `uc_pc_estimator`. Suggestions auto-promoted at severity ≥ medium.
- **Analyst briefing synthesizer** — research cycle output now flows through the
  `analyst_briefing` cortex skill (nano call, JSON output, deterministic
  fallback on parse failure).
- **Live stepLog subtitle** — SatelliteLoader subtitle subscribes to the pino
  ring buffer; planner / cortex / nano / reflexion lifecycle steps tick in real
  time.
- **REPL UX** — `/help`, `/clear`, `/reset`. Case-insensitive slash verbs.
- **Coverage** — 6 new renderer specs (telemetry, logTail, graphTree, whyTree,
  clarify, pcEstimator) + pcEstimator adapter + briefingSynthesizer + stepStream.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: CHANGELOG — 2026-04-15 CLI finishing"
```

### Task G3: Final integration smoke

- [ ] **Step 1: Typecheck the full workspace**

Run: `pnpm -r typecheck`
Expected: clean (known pre-existing OrbitTrails baseline allowed — no new errors in cli/sweep/shared).

- [ ] **Step 2: Run the full test suite**

Run: `pnpm -r test -- --run`
Expected: all green. Flag any regression before moving on.

- [ ] **Step 3: Live demo check**

Run in one terminal:

```bash
pnpm --filter @interview/sweep demo-pc  # if it exists; otherwise skip
```

In another, run:

```bash
pnpm run ssa
```

Inside the REPL, sequentially:

```
/help
/query what conjunctions are active in LEO?
/pc ce:1
/explain finding:1
/clear
/help
```

Expected: each command renders without error; `/pc` shows a median and at least one histogram bar; the SatelliteLoader subtitle shows `stepLog` ticks during `/query`.

- [ ] **Step 4: Commit anything stray, tag the finishing milestone**

```bash
git tag cli-finishing-2026-04-15
git log --oneline -15
```

---

## Done — exit criteria

- `@interview/cli` test count grows from 55 → ~72 (adapter + renderer + parser tests).
- `pnpm -r typecheck` clean (minus pre-existing OrbitTrails baseline, unchanged).
- `/pc ce:<n>` launches a real swarm against the live Postgres + Redis and renders an aggregate. No code path returns the "(no fish results)" stub when the sweep workers are running.
- `/query` briefings carry an analyst-synthesized summary; `recommendedActions` surface `/pc ce:X` when relevant.
- `SatelliteLoader` subtitle ticks during long commands.
- `/help` and `/clear` exist and are documented.
- `packages/cli/README.md` + `CHANGELOG.md` updated.
