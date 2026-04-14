# Conversational CLI (`@interview/cli`) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Ink-based REPL (`pnpm run ssa`) that routes natural language + slash commands through Thalamus + Sweep, with pretext-flavored rendering, animated emoji lifecycle logs, a satellite loader with ETA, and auditable provenance.

**Architecture:** New package `packages/cli/` depending on thalamus/sweep/shared/db-schema. Two-lane router (slash grammar + interpreter cortex emitting a Zod `RouterPlan`). Full-replay conversation up to 200k tokens, then memory-palace via the existing `sim_agent_memory` pgvector store. Emoji-tagged pino events (two-state: animated in-progress, terminal on done/error) powered by a shared `stepLog` helper. Ink renders per-action screens with source-class color bars, confidence sparklines, cost dial, and an ASCII satellite loader whose subtitle shows p50/p95 ETA from a rolling store.

**Tech Stack:** TypeScript, pnpm workspaces, Ink 4, React 18, Zod 3, pino, pgvector/HNSW (existing), tiktoken, picocolors, Vitest + ink-testing-library.

**Source spec:** [`docs/superpowers/specs/2026-04-14-conversational-cli-design.md`](../specs/2026-04-14-conversational-cli-design.md)

---

## File Structure

```
packages/shared/src/observability/
  step-logger.ts          # stepLog() + StepEvent type (NEW)
  steps.ts                # exhaustive Step union + emoji map (NEW)
packages/shared/tests/
  step-logger.spec.ts     # exhaustiveness + fallback (NEW)

packages/cli/
  package.json            # "ssa" bin (NEW)
  tsconfig.json           # (NEW)
  src/
    index.ts              # boot container, spawn Ink (NEW)
    app.tsx               # Ink root (NEW)
    components/
      Prompt.tsx          # input line with autocomplete hints (NEW)
      StatusFooter.tsx    # session/tokens/cost (NEW)
      ScrollView.tsx      # windowed history (NEW)
      SatelliteLoader.tsx # animated ASCII + subtitle + ETA (NEW)
      AnimatedEmoji.tsx   # 6fps frame cycler with terminal freeze (NEW)
    router/
      parser.ts           # slash grammar (NEW)
      schema.ts           # Zod StepSchema / RouterPlanSchema (NEW)
      interpreter.ts      # cortex adapter producing RouterPlan (NEW)
      dispatch.ts         # step → adapter dispatch (NEW)
    adapters/
      thalamus.ts         # runCycle wrapper (NEW)
      telemetry.ts        # startTelemetrySwarm wrapper (NEW)
      logs.ts             # pino ring-buffer tail (NEW)
      graph.ts            # research_edge neighbourhood (NEW)
      resolution.ts       # sweepResolutionService wrapper (NEW)
      why.ts              # provenance tree builder (NEW)
    memory/
      buffer.ts           # full-replay ring (NEW)
      palace.ts           # sim_agent_memory HNSW adapter (NEW)
      tokens.ts           # tiktoken wrapper (NEW)
    renderers/
      briefing.tsx        # executive summary + findings (NEW)
      telemetry.tsx       # 14D distribution bars (NEW)
      logTail.tsx         # emoji-animated timeline (NEW)
      graphTree.tsx       # entity neighbourhood (NEW)
      whyTree.tsx         # provenance ASCII tree (NEW)
      clarify.tsx         # multiple-choice prompt (NEW)
    util/
      colors.ts           # source-class palette (NEW)
      costMeter.ts        # per-turn + session totals (NEW)
      etaStore.ts         # rolling p50/p95 persisted to ~/.cache (NEW)
      pinoRingBuffer.ts   # bounded log transport (NEW)
  tests/
    router/parser.spec.ts
    router/interpreter.spec.ts
    router/dispatch.spec.ts
    memory/buffer.spec.ts
    memory/palace.spec.ts
    memory/tokens.spec.ts
    adapters/thalamus.spec.ts
    adapters/telemetry.spec.ts
    adapters/logs.spec.ts
    adapters/graph.spec.ts
    adapters/resolution.spec.ts
    adapters/why.spec.ts
    util/etaStore.spec.ts
    util/costMeter.spec.ts
    components/SatelliteLoader.spec.tsx
    components/AnimatedEmoji.spec.tsx
    renderers/briefing.spec.tsx
    renderers/logTail.spec.tsx
    e2e/repl.spec.ts

packages/thalamus/src/cortices/skills/
  interpreter.md          # router cortex skill (NEW)
  analyst-briefing.md     # briefing cortex skill (NEW)

packages/thalamus/src/services/  # RETROFIT to stepLog
  thalamus.service.ts
  thalamus-executor.service.ts
  thalamus-planner.service.ts
  thalamus-reflexion.service.ts
packages/thalamus/src/cortices/
  cortex-llm.ts           # nano.call / nano.done events

packages/sweep/src/sim/    # RETROFIT to stepLog
  turn-runner-dag.ts
  turn-runner-sequential.ts
packages/sweep/src/services/
  telemetry-swarm.service.ts
  nano-sweep.service.ts
```

---

## Task 1: Shared step registry and emoji map

**Files:**

- Create: `packages/shared/src/observability/steps.ts`
- Create: `packages/shared/src/observability/step-logger.ts`
- Create: `packages/shared/tests/step-logger.spec.ts`
- Modify: `packages/shared/src/observability/index.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/shared/tests/step-logger.spec.ts
import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import {
  stepLog,
  STEP_REGISTRY,
  type StepName,
} from "../src/observability/step-logger.js";

describe("stepLog", () => {
  it("emits a structured event with frames + terminal for known step", () => {
    const logs: unknown[] = [];
    const logger = pino(
      { level: "trace" },
      { write: (m) => logs.push(JSON.parse(m)) },
    );
    stepLog(logger, "cortex", "start", { cortex: "conjunction-analysis" });
    const e = logs[0] as {
      step: string;
      phase: string;
      frames: string[];
      terminal: string;
      cortex: string;
    };
    expect(e.step).toBe("cortex");
    expect(e.phase).toBe("start");
    expect(e.frames.length).toBeGreaterThanOrEqual(3);
    expect(e.terminal).toBeDefined();
    expect(e.cortex).toBe("conjunction-analysis");
  });

  it("falls back to unknown step with ❔ and warns in dev", () => {
    const logs: unknown[] = [];
    const logger = pino(
      { level: "trace" },
      { write: (m) => logs.push(JSON.parse(m)) },
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stepLog(logger, "bogus.step" as StepName, "done");
    expect((logs[0] as { terminal: string }).terminal).toBe("❔");
    warn.mockRestore();
  });

  it("registry is exhaustive — every declared step has animated frames OR is instantaneous", () => {
    for (const [name, entry] of Object.entries(STEP_REGISTRY)) {
      if (entry.instantaneous) {
        expect(entry.terminal).toBeDefined();
      } else {
        expect(entry.frames.length).toBeGreaterThanOrEqual(3);
        expect(entry.terminal).toBeDefined();
        expect(entry.error).toBeDefined();
      }
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @interview/shared test step-logger`
Expected: FAIL — `step-logger.ts` does not exist.

- [ ] **Step 3: Implement step registry**

```ts
// packages/shared/src/observability/steps.ts
export type StepName =
  | "cycle"
  | "planner"
  | "cortex"
  | "nano.call"
  | "fetch.osint"
  | "fetch.field"
  | "curator.dedup"
  | "kg.write"
  | "guardrail.breach"
  | "reflexion"
  | "swarm"
  | "fish.spawn"
  | "fish.perturb"
  | "fish.turn"
  | "fish.memory.read"
  | "fish.memory.write"
  | "aggregator"
  | "suggestion.emit"
  | "swarm.fail-soft";

export interface StepEntry {
  frames: string[];
  terminal: string;
  error?: string;
  instantaneous?: boolean;
}

export const STEP_REGISTRY: Readonly<Record<StepName, StepEntry>> =
  Object.freeze({
    cycle: { frames: ["🧠", "💭", "🧠", "💫"], terminal: "🏁", error: "💥" },
    planner: { frames: ["🗺️", "🧭", "🗺️", "📐"], terminal: "📍", error: "⚠️" },
    cortex: { frames: ["🧩", "⚙️", "🧩", "🔩"], terminal: "✅", error: "❌" },
    "nano.call": {
      frames: ["💭", "💬", "💭", "🗯️"],
      terminal: "✨",
      error: "💔",
    },
    "fetch.osint": {
      frames: ["🛰️", "📶", "🛰️", "🌐"],
      terminal: "📥",
      error: "🕳️",
    },
    "fetch.field": {
      frames: ["📡", "⚡", "📡", "🔭"],
      terminal: "📥",
      error: "🕳️",
    },
    "curator.dedup": {
      frames: ["🧹", "🧽", "🧹", "✂️"],
      terminal: "🧴",
      error: "⚠️",
    },
    "kg.write": {
      frames: ["📝", "✍️", "📝", "🖋️"],
      terminal: "📚",
      error: "❌",
    },
    "guardrail.breach": { frames: [], terminal: "🚧", instantaneous: true },
    reflexion: {
      frames: ["🔁", "🌀", "🔁", "♻️"],
      terminal: "🪞",
      error: "⚠️",
    },
    swarm: { frames: ["🐟", "🐠", "🐡", "🦈"], terminal: "🏆", error: "🚨" },
    "fish.spawn": { frames: ["🐠", "🫧", "🐠", "💦"], terminal: "🐟" },
    "fish.perturb": { frames: ["🎲", "🌪️", "🎲", "⚡"], terminal: "🎯" },
    "fish.turn": {
      frames: ["💧", "🌊", "💧", "🫧"],
      terminal: "🎣",
      error: "💔",
    },
    "fish.memory.read": { frames: ["🧠", "🔍", "🧠", "📖"], terminal: "📚" },
    "fish.memory.write": { frames: ["🫧", "💾", "🫧", "📥"], terminal: "💽" },
    aggregator: {
      frames: ["🕸️", "🧬", "🕸️", "🔬"],
      terminal: "🎯",
      error: "⚠️",
    },
    "suggestion.emit": { frames: [], terminal: "💡", instantaneous: true },
    "swarm.fail-soft": { frames: [], terminal: "🚨", instantaneous: true },
  });
```

- [ ] **Step 4: Implement `stepLog` helper**

```ts
// packages/shared/src/observability/step-logger.ts
import type { Logger } from "pino";
import { STEP_REGISTRY, type StepName } from "./steps.js";

export { STEP_REGISTRY } from "./steps.js";
export type { StepName } from "./steps.js";

export type StepPhase = "start" | "done" | "error";

export interface StepEvent {
  step: StepName | "unknown";
  phase: StepPhase;
  frames: string[];
  terminal: string;
  [extra: string]: unknown;
}

export function stepLog(
  logger: Logger,
  step: StepName,
  phase: StepPhase,
  extra: Record<string, unknown> = {},
): void {
  const entry = STEP_REGISTRY[step];
  if (!entry) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(`[stepLog] unknown step: ${step}`);
    }
    logger.info({
      step: "unknown",
      phase,
      frames: [],
      terminal: "❔",
      ...extra,
    });
    return;
  }
  const terminal =
    phase === "error" ? (entry.error ?? entry.terminal) : entry.terminal;
  logger.info({ step, phase, frames: entry.frames, terminal, ...extra });
}
```

- [ ] **Step 5: Re-export and run tests**

```ts
// packages/shared/src/observability/index.ts — append:
export * from "./step-logger.js";
export * from "./steps.js";
```

Run: `pnpm --filter @interview/shared test`
Expected: PASS (3 new tests + existing).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/observability/step-logger.ts \
        packages/shared/src/observability/steps.ts \
        packages/shared/src/observability/index.ts \
        packages/shared/tests/step-logger.spec.ts
git commit -m "feat(shared): stepLog helper + emoji step registry"
```

---

## Task 2: Retrofit thalamus lifecycle to stepLog

**Files:**

- Modify: `packages/thalamus/src/services/thalamus.service.ts`
- Modify: `packages/thalamus/src/services/thalamus-executor.service.ts`
- Modify: `packages/thalamus/src/services/thalamus-planner.service.ts`
- Modify: `packages/thalamus/src/services/thalamus-reflexion.service.ts`
- Modify: `packages/thalamus/src/cortices/cortex-llm.ts`

- [ ] **Step 1: Grep existing logger.info call sites**

Run: `rg -n 'logger\.(info|warn|error)' packages/thalamus/src/services/ packages/thalamus/src/cortices/cortex-llm.ts`

- [ ] **Step 2: Replace cycle/planner/cortex/nano boundaries with stepLog**

For each service file, at the lifecycle boundary matching the table in spec §8bis, replace the ad-hoc log with:

```ts
import { stepLog } from "@interview/shared";
// entry:
stepLog(logger, "cycle", "start", { cycleId });
// on success:
stepLog(logger, "cycle", "done", { cycleId, durationMs, cost });
// on catch:
stepLog(logger, "cycle", "error", { cycleId, err: e.message });
```

Apply to: `cycle` (thalamus.service), `planner` (planner.service), `cortex` (executor.service — wrap each cortex dispatch), `nano.call` (cortex-llm.ts), `reflexion` (reflexion.service). Keep existing info logs for unrelated context.

- [ ] **Step 3: Run thalamus tests**

Run: `pnpm --filter @interview/thalamus test`
Expected: PASS. (Tests should not assert log text; they assert behavior.)

- [ ] **Step 4: Commit**

```bash
git add packages/thalamus/src/
git commit -m "feat(thalamus): emit stepLog lifecycle events"
```

---

## Task 3: Retrofit sweep lifecycle to stepLog

**Files:**

- Modify: `packages/sweep/src/services/telemetry-swarm.service.ts`
- Modify: `packages/sweep/src/services/nano-sweep.service.ts`
- Modify: `packages/sweep/src/sim/turn-runner-dag.ts`
- Modify: `packages/sweep/src/sim/turn-runner-sequential.ts`

- [ ] **Step 1: Grep existing log sites**

Run: `rg -n 'logger\.(info|warn|error)' packages/sweep/src/services/ packages/sweep/src/sim/turn-runner-*.ts`

- [ ] **Step 2: Inject stepLog at boundaries**

```ts
import { stepLog } from "@interview/shared";
// swarm launch:
stepLog(logger, "swarm", "start", { swarmId, k, kind });
// per fish:
stepLog(logger, "fish.spawn", "start", { swarmId, fishIdx });
stepLog(logger, "fish.perturb", "done", { swarmId, fishIdx, perturbation });
stepLog(logger, "fish.turn", "start", { swarmId, fishIdx, turn });
stepLog(logger, "fish.turn", "done", { swarmId, fishIdx, turn, durationMs });
// memory:
stepLog(logger, "fish.memory.read", "done", { swarmId, fishIdx, count });
stepLog(logger, "fish.memory.write", "done", { swarmId, fishIdx });
// aggregator:
stepLog(logger, "aggregator", "start", { swarmId });
stepLog(logger, "aggregator", "done", { swarmId, clusters });
stepLog(logger, "suggestion.emit", "done", { swarmId, suggestionId });
stepLog(logger, "swarm", "done", { swarmId, durationMs });
// fail-soft:
stepLog(logger, "swarm.fail-soft", "done", { swarmId, quorum });
```

- [ ] **Step 3: Run sweep tests**

Run: `pnpm --filter @interview/sweep test`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/sweep/src/
git commit -m "feat(sweep): emit stepLog lifecycle events for swarm + fish"
```

---

## Task 4: CLI package scaffold

**Files:**

- Create: `packages/cli/package.json`
- Create: `packages/cli/tsconfig.json`
- Create: `packages/cli/src/index.ts`
- Modify: root `package.json` (add `ssa` script)

- [ ] **Step 1: Write package.json**

```json
{
  "name": "@interview/cli",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "bin": { "ssa": "./src/index.ts" },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "start": "node --env-file=../../.env --import tsx src/index.ts",
    "test": "vitest run"
  },
  "dependencies": {
    "@interview/shared": "workspace:*",
    "@interview/db-schema": "workspace:*",
    "@interview/thalamus": "workspace:*",
    "@interview/sweep": "workspace:*",
    "ink": "^4.4.1",
    "react": "^18.2.0",
    "picocolors": "^1.0.0",
    "zod": "^3.22.0",
    "pino": "^8.17.0",
    "js-tiktoken": "^1.0.10"
  },
  "devDependencies": {
    "@types/react": "^18.2.0",
    "ink-testing-library": "^3.0.0",
    "typescript": "^5.4.0",
    "tsx": "^4.21.0",
    "vitest": "^1.6.1"
  }
}
```

- [ ] **Step 2: tsconfig.json**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "react",
    "lib": ["ES2022"],
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"]
}
```

- [ ] **Step 3: Placeholder entry**

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
console.log("@interview/cli boot placeholder — Ink app wired in Task 15");
```

- [ ] **Step 4: Root script**

In root `package.json` scripts, add: `"ssa": "pnpm --filter @interview/cli start"`.

- [ ] **Step 5: Install + typecheck**

Run: `pnpm install && pnpm -r typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/ package.json pnpm-lock.yaml
git commit -m "chore(cli): scaffold @interview/cli package"
```

---

## Task 5: Router slash-grammar parser

**Files:**

- Create: `packages/cli/src/router/parser.ts`
- Create: `packages/cli/tests/router/parser.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/router/parser.spec.ts
import { describe, it, expect } from "vitest";
import { parseExplicitCommand } from "../../src/router/parser.js";

describe("parseExplicitCommand", () => {
  it("returns null for free text", () => {
    expect(parseExplicitCommand("tell me about starlink 3099")).toBeNull();
  });
  it("parses /query", () => {
    expect(
      parseExplicitCommand("/query riskiest conjunction this week"),
    ).toEqual({
      steps: [{ action: "query", q: "riskiest conjunction this week" }],
      confidence: 1,
    });
  });
  it("parses /telemetry with satId", () => {
    expect(parseExplicitCommand("/telemetry 25544")).toEqual({
      steps: [{ action: "telemetry", satId: "25544" }],
      confidence: 1,
    });
  });
  it("parses /logs with level + service flags", () => {
    const r = parseExplicitCommand("/logs level=warn service=thalamus");
    expect(r).toEqual({
      steps: [{ action: "logs", level: "warn", service: "thalamus" }],
      confidence: 1,
    });
  });
  it("parses /logs bare", () => {
    expect(parseExplicitCommand("/logs")).toEqual({
      steps: [{ action: "logs" }],
      confidence: 1,
    });
  });
  it("parses /graph", () => {
    expect(parseExplicitCommand("/graph SpaceX")).toEqual({
      steps: [{ action: "graph", entity: "SpaceX" }],
      confidence: 1,
    });
  });
  it("parses /accept", () => {
    expect(parseExplicitCommand("/accept SWEEP-428")).toEqual({
      steps: [{ action: "accept", suggestionId: "SWEEP-428" }],
      confidence: 1,
    });
  });
  it("parses /explain", () => {
    expect(parseExplicitCommand("/explain F-77")).toEqual({
      steps: [{ action: "explain", findingId: "F-77" }],
      confidence: 1,
    });
  });
  it("returns null for unknown verb", () => {
    expect(parseExplicitCommand("/unknown foo")).toBeNull();
  });
  it("returns null for missing required arg", () => {
    expect(parseExplicitCommand("/telemetry")).toBeNull();
    expect(parseExplicitCommand("/accept")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @interview/cli test parser`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement parser**

```ts
// packages/cli/src/router/parser.ts
import type { RouterPlan } from "./schema.js";

type Verb = "query" | "telemetry" | "logs" | "graph" | "accept" | "explain";
const VERBS: ReadonlySet<Verb> = new Set([
  "query",
  "telemetry",
  "logs",
  "graph",
  "accept",
  "explain",
]);
const LOG_LEVELS = ["debug", "info", "warn", "error"] as const;

export function parseExplicitCommand(input: string): RouterPlan | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const [rawVerb, ...rest] = trimmed.slice(1).split(/\s+/);
  if (!VERBS.has(rawVerb as Verb)) return null;
  const verb = rawVerb as Verb;
  const args = rest.join(" ").trim();

  switch (verb) {
    case "query":
      if (!args) return null;
      return { steps: [{ action: "query", q: args }], confidence: 1 };
    case "telemetry":
      if (!args) return null;
      return {
        steps: [{ action: "telemetry", satId: args.split(/\s+/)[0] }],
        confidence: 1,
      };
    case "graph":
      if (!args) return null;
      return { steps: [{ action: "graph", entity: args }], confidence: 1 };
    case "accept":
      if (!args) return null;
      return {
        steps: [{ action: "accept", suggestionId: args.split(/\s+/)[0] }],
        confidence: 1,
      };
    case "explain":
      if (!args) return null;
      return {
        steps: [{ action: "explain", findingId: args.split(/\s+/)[0] }],
        confidence: 1,
      };
    case "logs": {
      const flags = Object.fromEntries(
        args
          .split(/\s+/)
          .filter(Boolean)
          .map((kv) => {
            const [k, v] = kv.split("=");
            return [k, v];
          }),
      );
      const level =
        flags.level && (LOG_LEVELS as readonly string[]).includes(flags.level)
          ? (flags.level as (typeof LOG_LEVELS)[number])
          : undefined;
      const service = flags.service;
      return {
        steps: [
          {
            action: "logs",
            ...(level && { level }),
            ...(service && { service }),
          },
        ],
        confidence: 1,
      };
    }
  }
}
```

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm --filter @interview/cli test parser`
Expected: PASS — 10 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/router/parser.ts packages/cli/tests/router/parser.spec.ts
git commit -m "feat(cli): router slash-grammar parser"
```

---

## Task 6: RouterPlan Zod schema

**Files:**

- Create: `packages/cli/src/router/schema.ts`
- Create: `packages/cli/tests/router/schema.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/cli/tests/router/schema.spec.ts
import { describe, it, expect } from "vitest";
import { RouterPlanSchema, StepSchema } from "../../src/router/schema.js";

describe("RouterPlanSchema", () => {
  it("accepts a valid single-step plan", () => {
    const p = { steps: [{ action: "query", q: "x" }], confidence: 0.9 };
    expect(() => RouterPlanSchema.parse(p)).not.toThrow();
  });
  it("rejects empty steps", () => {
    expect(() =>
      RouterPlanSchema.parse({ steps: [], confidence: 1 }),
    ).toThrow();
  });
  it("rejects confidence out of range", () => {
    expect(() =>
      RouterPlanSchema.parse({
        steps: [{ action: "query", q: "x" }],
        confidence: 1.5,
      }),
    ).toThrow();
  });
  it("accepts clarify step", () => {
    const p = {
      steps: [
        {
          action: "clarify",
          question: "which?",
          options: ["query", "telemetry"],
        },
      ],
      confidence: 0.4,
    };
    expect(() => RouterPlanSchema.parse(p)).not.toThrow();
  });
  it("caps steps at 8", () => {
    const many = Array.from({ length: 9 }, () => ({ action: "query", q: "x" }));
    expect(() =>
      RouterPlanSchema.parse({ steps: many, confidence: 0.9 }),
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test (fails)**

Run: `pnpm --filter @interview/cli test schema`
Expected: FAIL.

- [ ] **Step 3: Implement schema**

```ts
// packages/cli/src/router/schema.ts
import { z } from "zod";

export const StepSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("query"), q: z.string().min(1) }),
  z.object({ action: z.literal("telemetry"), satId: z.string().min(1) }),
  z.object({
    action: z.literal("logs"),
    level: z.enum(["debug", "info", "warn", "error"]).optional(),
    service: z.string().optional(),
    sinceMs: z.number().int().positive().optional(),
  }),
  z.object({ action: z.literal("graph"), entity: z.string().min(1) }),
  z.object({ action: z.literal("accept"), suggestionId: z.string().min(1) }),
  z.object({ action: z.literal("explain"), findingId: z.string().min(1) }),
  z.object({
    action: z.literal("clarify"),
    question: z.string().min(1),
    options: z
      .array(
        z.enum(["query", "telemetry", "logs", "graph", "accept", "explain"]),
      )
      .min(2),
  }),
]);

export type Step = z.infer<typeof StepSchema>;

export const RouterPlanSchema = z.object({
  steps: z.array(StepSchema).min(1).max(8),
  confidence: z.number().min(0).max(1),
});

export type RouterPlan = z.infer<typeof RouterPlanSchema>;
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @interview/cli test schema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/router/schema.ts packages/cli/tests/router/schema.spec.ts
git commit -m "feat(cli): RouterPlan Zod schema with clarify discriminant"
```

---

## Task 7: Interpreter cortex skill + adapter

**Files:**

- Create: `packages/thalamus/src/cortices/skills/interpreter.md`
- Create: `packages/cli/src/router/interpreter.ts`
- Create: `packages/cli/tests/router/interpreter.spec.ts`

- [ ] **Step 1: Write the skill prompt**

```markdown
<!-- packages/thalamus/src/cortices/skills/interpreter.md -->

# interpreter

You are the SSA CLI router. Convert the operator's input into a structured `RouterPlan`.

## Input

- `input`: free-text user message
- `recentTurns`: array of {role, content, actionsTaken?} from conversation
- `availableEntityIds`: list of ids the operator has seen this session

## Output (strict JSON matching RouterPlanSchema)

- `steps[]`: 1–8 actions to dispatch in order
- `confidence`: 0..1 — set < 0.6 when you would want to ask

## Actions

- `query(q)` — full research cycle, free-text goal
- `telemetry(satId)` — fetch telemetry for a known satellite id (NORAD or catalog)
- `logs(level?, service?)` — tail recent logs
- `graph(entity)` — show research-graph neighbourhood
- `accept(suggestionId)` — accept a sweep suggestion
- `explain(findingId)` — show provenance tree
- `clarify(question, options)` — when ambiguous, PREFER THIS over guessing

## Rules

1. Deterministic output. Temperature = 0.
2. If input matches multiple actions (e.g. "starlink-3099" could be query, telemetry, or graph) → emit `clarify`.
3. Multi-step requests ("explain finding 42 and accept it") → two ordered steps.
4. If operator references an id you haven't seen → emit `clarify` listing candidates.
5. Never invent ids; only use ids from `availableEntityIds` or explicitly in `input`.
```

- [ ] **Step 2: Write the interpreter adapter test**

```ts
// packages/cli/tests/router/interpreter.spec.ts
import { describe, it, expect, vi } from "vitest";
import { interpret } from "../../src/router/interpreter.js";

const fakeNano = (response: unknown) => ({
  call: vi
    .fn()
    .mockResolvedValue({ content: JSON.stringify(response), costUsd: 0.001 }),
});

describe("interpret()", () => {
  it("parses a well-formed router plan", async () => {
    const nano = fakeNano({
      steps: [{ action: "query", q: "hello" }],
      confidence: 0.9,
    });
    const r = await interpret(
      { input: "hello world", recentTurns: [], availableEntityIds: [] },
      nano,
    );
    expect(r.plan.steps[0]).toMatchObject({ action: "query", q: "hello" });
    expect(r.costUsd).toBe(0.001);
  });

  it("throws on malformed JSON", async () => {
    const nano = {
      call: vi.fn().mockResolvedValue({ content: "not json", costUsd: 0 }),
    };
    await expect(
      interpret({ input: "x", recentTurns: [], availableEntityIds: [] }, nano),
    ).rejects.toThrow(/JSON|parse/i);
  });

  it("throws on schema violation", async () => {
    const nano = fakeNano({ steps: [], confidence: 0.9 });
    await expect(
      interpret({ input: "x", recentTurns: [], availableEntityIds: [] }, nano),
    ).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run test (fails)**

Run: `pnpm --filter @interview/cli test interpreter`
Expected: FAIL.

- [ ] **Step 4: Implement interpreter**

```ts
// packages/cli/src/router/interpreter.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import { RouterPlanSchema, type RouterPlan } from "./schema.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(
  __dirname,
  "../../../thalamus/src/cortices/skills/interpreter.md",
);

export interface NanoCaller {
  call: (args: {
    system: string;
    user: string;
    temperature: number;
    responseFormat: "json";
  }) => Promise<{ content: string; costUsd: number }>;
}

export interface InterpretInput {
  input: string;
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  availableEntityIds: string[];
}

export async function interpret(
  input: InterpretInput,
  nano: NanoCaller,
): Promise<{ plan: RouterPlan; costUsd: number }> {
  const system = readFileSync(SKILL_PATH, "utf8");
  const user = JSON.stringify({
    input: input.input,
    recentTurns: input.recentTurns.slice(-10),
    availableEntityIds: input.availableEntityIds.slice(0, 100),
  });
  const res = await nano.call({
    system,
    user,
    temperature: 0,
    responseFormat: "json",
  });
  const parsed = JSON.parse(res.content);
  const plan = RouterPlanSchema.parse(parsed);
  return { plan, costUsd: res.costUsd };
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @interview/cli test interpreter`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/thalamus/src/cortices/skills/interpreter.md \
        packages/cli/src/router/interpreter.ts \
        packages/cli/tests/router/interpreter.spec.ts
git commit -m "feat(cli,thalamus): interpreter cortex skill + adapter"
```

---

## Task 8: Conversation buffer + tokens

**Files:**

- Create: `packages/cli/src/memory/tokens.ts`
- Create: `packages/cli/src/memory/buffer.ts`
- Create: `packages/cli/tests/memory/tokens.spec.ts`
- Create: `packages/cli/tests/memory/buffer.spec.ts`

- [ ] **Step 1: Write failing tests**

```ts
// packages/cli/tests/memory/tokens.spec.ts
import { describe, it, expect } from "vitest";
import { countTokens } from "../../src/memory/tokens.js";
describe("countTokens", () => {
  it("returns positive int for non-empty string", () => {
    expect(countTokens("hello world")).toBeGreaterThan(0);
  });
  it("zero for empty", () => {
    expect(countTokens("")).toBe(0);
  });
});
```

```ts
// packages/cli/tests/memory/buffer.spec.ts
import { describe, it, expect } from "vitest";
import { ConversationBuffer } from "../../src/memory/buffer.js";

describe("ConversationBuffer", () => {
  it("appends and returns turns in order", () => {
    const b = new ConversationBuffer({ maxTokens: 10_000 });
    b.append({ role: "user", content: "hi" });
    b.append({ role: "assistant", content: "hello" });
    expect(b.turns()).toHaveLength(2);
  });
  it("reports totalTokens", () => {
    const b = new ConversationBuffer({ maxTokens: 10_000 });
    b.append({ role: "user", content: "hello world" });
    expect(b.totalTokens()).toBeGreaterThan(0);
  });
  it("overThreshold true once totalTokens > maxTokens", () => {
    const b = new ConversationBuffer({ maxTokens: 1 });
    b.append({ role: "user", content: "hello world, this is long" });
    expect(b.overThreshold()).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests (fail)**

Run: `pnpm --filter @interview/cli test memory`
Expected: FAIL.

- [ ] **Step 3: Implement tokens.ts**

```ts
// packages/cli/src/memory/tokens.ts
import { getEncoding } from "js-tiktoken";
const enc = getEncoding("cl100k_base");
export function countTokens(s: string): number {
  if (!s) return 0;
  return enc.encode(s).length;
}
```

- [ ] **Step 4: Implement buffer.ts**

```ts
// packages/cli/src/memory/buffer.ts
import { countTokens } from "./tokens.js";

export interface Turn {
  role: "user" | "assistant" | "tool";
  content: string;
  toolCall?: { action: string; args: Record<string, unknown> };
  toolResult?: unknown;
  ts?: number;
}

export class ConversationBuffer {
  private readonly maxTokens: number;
  private readonly list: Turn[] = [];
  private tokenCache = 0;

  constructor(opts: { maxTokens: number }) {
    this.maxTokens = opts.maxTokens;
  }
  append(t: Turn): void {
    const stamped = { ...t, ts: t.ts ?? Date.now() };
    this.list.push(stamped);
    this.tokenCache += countTokens(t.content);
  }
  turns(): readonly Turn[] {
    return this.list;
  }
  totalTokens(): number {
    return this.tokenCache;
  }
  overThreshold(): boolean {
    return this.tokenCache > this.maxTokens;
  }
  replayWindow(): readonly Turn[] {
    return this.list;
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @interview/cli test memory`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/memory/ packages/cli/tests/memory/tokens.spec.ts packages/cli/tests/memory/buffer.spec.ts
git commit -m "feat(cli): conversation buffer + tiktoken counter"
```

---

## Task 9: Memory palace adapter (sim_agent_memory)

**Files:**

- Create: `packages/cli/src/memory/palace.ts`
- Create: `packages/cli/tests/memory/palace.spec.ts`

- [ ] **Step 1: Inspect existing sim_agent_memory service**

Run: `rg -l 'sim_agent_memory|simAgentMemory' packages/`

- [ ] **Step 2: Write the failing test (mocked repo)**

```ts
// packages/cli/tests/memory/palace.spec.ts
import { describe, it, expect, vi } from "vitest";
import { MemoryPalace } from "../../src/memory/palace.js";

describe("MemoryPalace", () => {
  it("writes turns with scope=cli_session", async () => {
    const repo = {
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      insert: vi.fn().mockResolvedValue(undefined),
      similaritySearch: vi.fn().mockResolvedValue([]),
    };
    const p = new MemoryPalace(repo, { sessionId: "s1" });
    await p.remember({ role: "user", content: "hello" });
    expect(repo.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "cli_session",
        sessionId: "s1",
        content: "hello",
      }),
    );
  });
  it("recall delegates to similaritySearch with sessionId filter", async () => {
    const repo = {
      embed: vi.fn().mockResolvedValue(new Array(1536).fill(0)),
      insert: vi.fn(),
      similaritySearch: vi
        .fn()
        .mockResolvedValue([{ content: "earlier turn", score: 0.9 }]),
    };
    const p = new MemoryPalace(repo, { sessionId: "s1" });
    const r = await p.recall("query text", 5);
    expect(repo.similaritySearch).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: "cli_session",
        sessionId: "s1",
        k: 5,
      }),
    );
    expect(r).toEqual([{ content: "earlier turn", score: 0.9 }]);
  });
});
```

- [ ] **Step 3: Run (fail)**

Run: `pnpm --filter @interview/cli test palace`
Expected: FAIL.

- [ ] **Step 4: Implement palace**

```ts
// packages/cli/src/memory/palace.ts
import type { Turn } from "./buffer.js";

export interface SimMemoryRepo {
  embed(text: string): Promise<number[]>;
  insert(row: {
    scope: string;
    sessionId: string;
    content: string;
    embedding: number[];
    role: string;
    ts: number;
  }): Promise<void>;
  similaritySearch(q: {
    scope: string;
    sessionId: string;
    text: string;
    k: number;
    embedding?: number[];
  }): Promise<Array<{ content: string; score: number }>>;
}

export class MemoryPalace {
  constructor(
    private readonly repo: SimMemoryRepo,
    private readonly opts: { sessionId: string },
  ) {}
  async remember(t: Turn): Promise<void> {
    const embedding = await this.repo.embed(t.content);
    await this.repo.insert({
      scope: "cli_session",
      sessionId: this.opts.sessionId,
      content: t.content,
      embedding,
      role: t.role,
      ts: t.ts ?? Date.now(),
    });
  }
  async recall(
    queryText: string,
    k = 8,
  ): Promise<Array<{ content: string; score: number }>> {
    const embedding = await this.repo.embed(queryText);
    return this.repo.similaritySearch({
      scope: "cli_session",
      sessionId: this.opts.sessionId,
      text: queryText,
      k,
      embedding,
    });
  }
}
```

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @interview/cli test palace`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/memory/palace.ts packages/cli/tests/memory/palace.spec.ts
git commit -m "feat(cli): MemoryPalace adapter over sim_agent_memory"
```

---

## Task 10: Cost meter utility

**Files:**

- Create: `packages/cli/src/util/costMeter.ts`
- Create: `packages/cli/tests/util/costMeter.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect } from "vitest";
import { CostMeter } from "../../src/util/costMeter.js";

describe("CostMeter", () => {
  it("accumulates per-turn and session", () => {
    const m = new CostMeter();
    m.beginTurn();
    m.add(0.01);
    m.add(0.02);
    expect(m.currentTurn()).toBeCloseTo(0.03);
    m.endTurn();
    expect(m.session()).toBeCloseTo(0.03);
    m.beginTurn();
    m.add(0.005);
    expect(m.session()).toBeCloseTo(0.035);
    expect(m.currentTurn()).toBeCloseTo(0.005);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm --filter @interview/cli test costMeter`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/util/costMeter.ts
export class CostMeter {
  private turn = 0;
  private total = 0;
  beginTurn(): void {
    this.turn = 0;
  }
  endTurn(): void {
    /* totals already kept live via add() */
  }
  add(usd: number): void {
    this.turn += usd;
    this.total += usd;
  }
  currentTurn(): number {
    return this.turn;
  }
  session(): number {
    return this.total;
  }
}
```

- [ ] **Step 4: Run (pass)** — `pnpm --filter @interview/cli test costMeter`

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/util/costMeter.ts packages/cli/tests/util/costMeter.spec.ts
git commit -m "feat(cli): cost meter utility"
```

---

## Task 11: ETA store with persistence

**Files:**

- Create: `packages/cli/src/util/etaStore.ts`
- Create: `packages/cli/tests/util/etaStore.spec.ts`

- [ ] **Step 1: Write failing test**

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EtaStore } from "../../src/util/etaStore.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "eta-"));
});

describe("EtaStore", () => {
  it("returns 'estimating' when no samples", () => {
    const s = new EtaStore(join(dir, "eta.json"));
    expect(s.estimate("cortex", "conjunction-analysis")).toEqual({
      status: "estimating",
    });
  });
  it("computes p50/p95 after samples", () => {
    const s = new EtaStore(join(dir, "eta.json"));
    for (const d of [1000, 2000, 3000, 4000, 5000]) s.record("cortex", "x", d);
    const e = s.estimate("cortex", "x") as {
      status: "known";
      p50Ms: number;
      p95Ms: number;
    };
    expect(e.status).toBe("known");
    expect(e.p50Ms).toBe(3000);
    expect(e.p95Ms).toBeGreaterThanOrEqual(4000);
  });
  it("persists across instances", () => {
    const p = join(dir, "eta.json");
    const a = new EtaStore(p);
    a.record("cortex", "x", 1000);
    a.flush();
    const b = new EtaStore(p);
    expect(b.estimate("cortex", "x").status).toBe("estimating-soon"); // < min-samples path
  });
});
```

- [ ] **Step 2: Run (fail)** — `pnpm --filter @interview/cli test etaStore`

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/util/etaStore.ts
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_WINDOW = 20;
const MIN_SAMPLES = 3;

type Key = `${string}:${string}`;
interface Persisted {
  [key: string]: number[];
}

export type Estimate =
  | { status: "estimating" }
  | { status: "estimating-soon"; samples: number }
  | { status: "known"; p50Ms: number; p95Ms: number; samples: number };

export class EtaStore {
  private readonly data: Map<Key, number[]> = new Map();
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Persisted;
      for (const [k, v] of Object.entries(raw)) this.data.set(k as Key, v);
    }
  }
  record(kind: string, subject: string, durationMs: number): void {
    const key: Key = `${kind}:${subject}`;
    const arr = this.data.get(key) ?? [];
    arr.push(durationMs);
    if (arr.length > MAX_WINDOW) arr.shift();
    this.data.set(key, arr);
  }
  estimate(kind: string, subject: string): Estimate {
    const arr = this.data.get(`${kind}:${subject}`);
    if (!arr || arr.length === 0) return { status: "estimating" };
    if (arr.length < MIN_SAMPLES)
      return { status: "estimating-soon", samples: arr.length };
    const sorted = [...arr].sort((a, b) => a - b);
    const p = (q: number) =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      status: "known",
      p50Ms: p(0.5),
      p95Ms: p(0.95),
      samples: arr.length,
    };
  }
  flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.data)));
  }
}
```

- [ ] **Step 4: Run (pass)**
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): ETA rolling store with persistence"`

---

## Task 12: Source-class colors utility

**Files:**

- Create: `packages/cli/src/util/colors.ts`

- [ ] **Step 1: Implement (trivial — no test)**

```ts
// packages/cli/src/util/colors.ts
import pc from "picocolors";
export type SourceClass = "FIELD" | "OSINT" | "SIM";
export const colorFor = (c: SourceClass): ((s: string) => string) => {
  switch (c) {
    case "FIELD":
      return pc.green;
    case "OSINT":
      return pc.yellow;
    case "SIM":
      return pc.gray;
  }
};
export const bar = (level: number): string => {
  const chars = "▁▂▃▄▅▆▇█";
  const idx = Math.max(
    0,
    Math.min(chars.length - 1, Math.round(level * (chars.length - 1))),
  );
  return chars[idx];
};
```

- [ ] **Step 2: Commit** — `git commit -m "feat(cli): source-class color palette + sparkline helper"`

---

## Task 13: Adapters — thalamus / telemetry / resolution / why / graph / logs

Each adapter is a thin wrapper over an existing service or a small helper. Implement and test in one commit per adapter.

**Files (all new):**

- `packages/cli/src/adapters/{thalamus,telemetry,logs,graph,resolution,why}.ts`
- `packages/cli/tests/adapters/{thalamus,telemetry,logs,graph,resolution,why}.spec.ts`

### 13a — thalamus

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect, vi } from "vitest";
import { runCycleAdapter } from "../../src/adapters/thalamus.js";
describe("runCycleAdapter", () => {
  it("calls thalamus.runCycle with query and returns findings + cost", async () => {
    const svc = {
      runCycle: vi
        .fn()
        .mockResolvedValue({ findings: [{ id: "F1" }], costUsd: 0.05 }),
    };
    const r = await runCycleAdapter(svc, { query: "q", cycleId: "c1" });
    expect(svc.runCycle).toHaveBeenCalledWith({ query: "q", cycleId: "c1" });
    expect(r.findings).toHaveLength(1);
    expect(r.costUsd).toBe(0.05);
  });
});
```

- [ ] **Step 2: Implement**

```ts
// packages/cli/src/adapters/thalamus.ts
export interface ThalamusService {
  runCycle(q: {
    query: string;
    cycleId: string;
  }): Promise<{ findings: unknown[]; costUsd: number }>;
}
export async function runCycleAdapter(
  svc: ThalamusService,
  q: { query: string; cycleId: string },
) {
  return svc.runCycle(q);
}
```

- [ ] **Step 3: Commit** — `git commit -m "feat(cli): thalamus adapter"`

### 13b — telemetry

- [ ] Write test asserting `startTelemetrySwarm({ satelliteId })` is called with string id.
- [ ] Implement `startTelemetryAdapter(svc, { satId })`.
- [ ] Commit.

### 13c — logs (pino ring buffer)

- [ ] **Step 1: Write test**

```ts
import { describe, it, expect } from "vitest";
import { PinoRingBuffer } from "../../src/util/pinoRingBuffer.js";
import { LogsAdapter } from "../../src/adapters/logs.js";
describe("LogsAdapter", () => {
  it("returns events filtered by level and service within sinceMs", () => {
    const ring = new PinoRingBuffer(100);
    const now = Date.now();
    ring.push({ time: now - 5_000, level: 30, service: "thalamus", msg: "a" });
    ring.push({ time: now - 1_000, level: 40, service: "sweep", msg: "b" });
    const a = new LogsAdapter(ring);
    expect(a.tail({ sinceMs: 10_000 })).toHaveLength(2);
    expect(a.tail({ sinceMs: 2_000 })).toHaveLength(1);
    expect(a.tail({ service: "sweep" })).toHaveLength(1);
    expect(a.tail({ level: "warn" })).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement `PinoRingBuffer` and `LogsAdapter`**

```ts
// packages/cli/src/util/pinoRingBuffer.ts
export interface LogEvent {
  time: number;
  level: number;
  service?: string;
  msg: string;
  [k: string]: unknown;
}
export class PinoRingBuffer {
  private buf: LogEvent[] = [];
  constructor(private readonly cap: number) {}
  push(e: LogEvent): void {
    this.buf.push(e);
    if (this.buf.length > this.cap) this.buf.shift();
  }
  snapshot(): readonly LogEvent[] {
    return this.buf;
  }
}
```

```ts
// packages/cli/src/adapters/logs.ts
import type { PinoRingBuffer, LogEvent } from "../util/pinoRingBuffer.js";
const LEVEL_MAP = { debug: 20, info: 30, warn: 40, error: 50 } as const;
export class LogsAdapter {
  constructor(private readonly ring: PinoRingBuffer) {}
  tail(q: {
    level?: keyof typeof LEVEL_MAP;
    service?: string;
    sinceMs?: number;
  }): LogEvent[] {
    const min = q.level ? LEVEL_MAP[q.level] : 0;
    const cutoff = q.sinceMs ? Date.now() - q.sinceMs : 0;
    return this.ring
      .snapshot()
      .filter(
        (e) =>
          e.level >= min &&
          (!q.service || e.service === q.service) &&
          e.time >= cutoff,
      );
  }
}
```

- [ ] **Step 3: Commit** — `git commit -m "feat(cli): logs adapter + pino ring buffer"`

### 13d — graph

- [ ] **Step 1: Test**: mock a repo that returns `research_edge` rows; assert `neighbourhood(entity, depth=2)` returns a tree with nodes grouped by depth.
- [ ] **Step 2: Implement** BFS over `research_edge` up to depth 2, capped at 50 nodes.
- [ ] **Step 3: Commit**.

### 13e — resolution

- [ ] **Step 1: Test**: mock `sweepResolutionService.resolve(suggestionId)`, assert audit row carries `source: "cli"`.
- [ ] **Step 2: Implement** `acceptAdapter(svc, { suggestionId, actorId: "cli:local" })`.
- [ ] **Step 3: Commit**.

### 13f — why (provenance)

- [ ] **Step 1: Test**: from a mocked KG, assert the provenance tree includes `finding → edges → source_items` and preserves `sha256` skill ids as leaves.
- [ ] **Step 2: Implement** `buildWhyTree(repo, { findingId })` returning a recursive `WhyNode` shape.
- [ ] **Step 3: Commit**.

---

## Task 14: Dispatch loop

**Files:**

- Create: `packages/cli/src/router/dispatch.ts`
- Create: `packages/cli/tests/router/dispatch.spec.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect, vi } from "vitest";
import { dispatch } from "../../src/router/dispatch.js";
describe("dispatch()", () => {
  it("routes query step to thalamus adapter", async () => {
    const adapters = {
      thalamus: {
        runCycle: vi.fn().mockResolvedValue({ findings: [], costUsd: 0 }),
      },
      telemetry: { start: vi.fn() },
      logs: { tail: vi.fn() },
      graph: { neighbourhood: vi.fn() },
      resolution: { accept: vi.fn() },
      why: { build: vi.fn() },
    } as never;
    const r = await dispatch(
      { action: "query", q: "hi" },
      { adapters, cycleId: "c1" },
    );
    expect(r.kind).toBe("briefing");
    expect(adapters.thalamus.runCycle).toHaveBeenCalledWith({
      query: "hi",
      cycleId: "c1",
    });
  });
  it("returns kind=clarify for clarify step", async () => {
    const r = await dispatch(
      {
        action: "clarify",
        question: "which?",
        options: ["query", "telemetry"],
      },
      { adapters: {} as never, cycleId: "c1" },
    );
    expect(r.kind).toBe("clarify");
  });
});
```

- [ ] **Step 2: Run (fail)**

- [ ] **Step 3: Implement**

```ts
// packages/cli/src/router/dispatch.ts
import type { Step } from "./schema.js";

export type DispatchResult =
  | { kind: "briefing"; findings: unknown[]; costUsd: number }
  | { kind: "telemetry"; satId: string; distribution: unknown }
  | { kind: "logs"; events: unknown[] }
  | { kind: "graph"; tree: unknown }
  | { kind: "resolution"; suggestionId: string; ok: boolean; delta: unknown }
  | { kind: "why"; tree: unknown }
  | { kind: "clarify"; question: string; options: string[] };

export interface Adapters {
  thalamus: {
    runCycle: (q: {
      query: string;
      cycleId: string;
    }) => Promise<{ findings: unknown[]; costUsd: number }>;
  };
  telemetry: {
    start: (q: { satId: string }) => Promise<{ distribution: unknown }>;
  };
  logs: {
    tail: (q: {
      level?: "debug" | "info" | "warn" | "error";
      service?: string;
      sinceMs?: number;
    }) => unknown[];
  };
  graph: { neighbourhood: (entity: string) => Promise<unknown> };
  resolution: {
    accept: (suggestionId: string) => Promise<{ ok: boolean; delta: unknown }>;
  };
  why: { build: (findingId: string) => Promise<unknown> };
}

export async function dispatch(
  step: Step,
  ctx: { adapters: Adapters; cycleId: string },
): Promise<DispatchResult> {
  switch (step.action) {
    case "query": {
      const { findings, costUsd } = await ctx.adapters.thalamus.runCycle({
        query: step.q,
        cycleId: ctx.cycleId,
      });
      return { kind: "briefing", findings, costUsd };
    }
    case "telemetry": {
      const { distribution } = await ctx.adapters.telemetry.start({
        satId: step.satId,
      });
      return { kind: "telemetry", satId: step.satId, distribution };
    }
    case "logs":
      return {
        kind: "logs",
        events: ctx.adapters.logs.tail({
          level: step.level,
          service: step.service,
          sinceMs: step.sinceMs,
        }),
      };
    case "graph":
      return {
        kind: "graph",
        tree: await ctx.adapters.graph.neighbourhood(step.entity),
      };
    case "accept": {
      const { ok, delta } = await ctx.adapters.resolution.accept(
        step.suggestionId,
      );
      return { kind: "resolution", suggestionId: step.suggestionId, ok, delta };
    }
    case "explain":
      return {
        kind: "why",
        tree: await ctx.adapters.why.build(step.findingId),
      };
    case "clarify":
      return {
        kind: "clarify",
        question: step.question,
        options: step.options,
      };
  }
}
```

- [ ] **Step 4: Run tests (pass)** — `pnpm --filter @interview/cli test dispatch`
- [ ] **Step 5: Commit** — `git commit -m "feat(cli): dispatch loop for router steps"`

---

## Task 15: AnimatedEmoji Ink component

**Files:**

- Create: `packages/cli/src/components/AnimatedEmoji.tsx`
- Create: `packages/cli/tests/components/AnimatedEmoji.spec.tsx`

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { AnimatedEmoji } from "../../src/components/AnimatedEmoji.js";
import { STEP_REGISTRY } from "@interview/shared";

describe("AnimatedEmoji", () => {
  it("renders terminal emoji when phase=done", () => {
    const { lastFrame } = render(<AnimatedEmoji step="cortex" phase="done" />);
    expect(lastFrame()).toContain(STEP_REGISTRY.cortex.terminal);
  });
  it("renders first frame when phase=start and tick=0", () => {
    const { lastFrame } = render(
      <AnimatedEmoji step="cortex" phase="start" _tickOverride={0} />,
    );
    expect(lastFrame()).toContain(STEP_REGISTRY.cortex.frames[0]);
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// packages/cli/src/components/AnimatedEmoji.tsx
import React, { useEffect, useState } from "react";
import { Text } from "ink";
import {
  STEP_REGISTRY,
  type StepName,
  type StepPhase,
} from "@interview/shared";

interface Props {
  step: StepName;
  phase: StepPhase;
  _tickOverride?: number;
}

export function AnimatedEmoji({
  step,
  phase,
  _tickOverride,
}: Props): React.JSX.Element {
  const [tick, setTick] = useState(_tickOverride ?? 0);
  useEffect(() => {
    if (_tickOverride !== undefined) return;
    if (phase !== "start") return;
    const id = setInterval(() => setTick((t) => t + 1), 166); // ~6fps
    return () => clearInterval(id);
  }, [phase, _tickOverride]);

  const entry = STEP_REGISTRY[step];
  if (!entry) return <Text>❔</Text>;
  if (phase === "done") return <Text>{entry.terminal}</Text>;
  if (phase === "error") return <Text>{entry.error ?? entry.terminal}</Text>;
  if (entry.instantaneous || entry.frames.length === 0)
    return <Text>{entry.terminal}</Text>;
  return <Text>{entry.frames[tick % entry.frames.length]}</Text>;
}
```

- [ ] **Step 3: Run + commit**

---

## Task 16: SatelliteLoader component with ETA

**Files:**

- Create: `packages/cli/src/components/SatelliteLoader.tsx`
- Create: `packages/cli/tests/components/SatelliteLoader.spec.tsx`

- [ ] **Step 1: Test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { SatelliteLoader } from "../../src/components/SatelliteLoader.js";

describe("SatelliteLoader", () => {
  it("renders subtitle with cortex name and estimating when no ETA", () => {
    const { lastFrame } = render(
      <SatelliteLoader
        subject="conjunction-analysis"
        kind="cortex"
        etaEstimate={{ status: "estimating" }}
        elapsedMs={200}
        costUsd={0.001}
      />,
    );
    expect(lastFrame()).toContain("conjunction-analysis");
    expect(lastFrame()).toContain("estimating");
  });
  it("renders remaining time when elapsed < p50", () => {
    const { lastFrame } = render(
      <SatelliteLoader
        subject="x"
        kind="cortex"
        etaEstimate={{
          status: "known",
          p50Ms: 5000,
          p95Ms: 10000,
          samples: 10,
        }}
        elapsedMs={2000}
        costUsd={0.01}
      />,
    );
    expect(lastFrame()).toMatch(/~ 3s remaining/);
  });
  it("renders 'slower than usual' past p50", () => {
    const { lastFrame } = render(
      <SatelliteLoader
        subject="x"
        kind="cortex"
        etaEstimate={{
          status: "known",
          p50Ms: 5000,
          p95Ms: 10000,
          samples: 10,
        }}
        elapsedMs={7000}
        costUsd={0.01}
      />,
    );
    expect(lastFrame()).toContain("slower than usual");
  });
});
```

- [ ] **Step 2: Implement**

```tsx
// packages/cli/src/components/SatelliteLoader.tsx
import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import pc from "picocolors";
import type { Estimate } from "../util/etaStore.js";

const FRAMES = [
  [
    "     .·°·.   ",
    "    ·     ·  ",
    "   ·   ●   · ",
    "    · ─┼─ ·  ",
    "     ·─┴─·   ",
  ],
  [
    "     ·°·.·   ",
    "    ·     .  ",
    "   ·   ●   · ",
    "    · ─┼─ .  ",
    "     .─┴─·   ",
  ],
  [
    "     .·.°·   ",
    "    .     .  ",
    "   ·   ●   · ",
    "    . ─┼─ ·  ",
    "     ·─┴─.   ",
  ],
];

interface Props {
  kind: string;
  subject: string;
  etaEstimate: Estimate;
  elapsedMs: number;
  costUsd: number;
  _frameOverride?: number;
}

export function SatelliteLoader(props: Props): React.JSX.Element {
  const [frame, setFrame] = useState(props._frameOverride ?? 0);
  useEffect(() => {
    if (props._frameOverride !== undefined) return;
    const id = setInterval(() => setFrame((f) => f + 1), 100);
    return () => clearInterval(id);
  }, [props._frameOverride]);

  const sprite = FRAMES[frame % FRAMES.length];
  const subtitle = renderSubtitle(props);

  return (
    <Box flexDirection="column">
      {sprite.map((line, i) => (
        <Text key={i}>{line}</Text>
      ))}
      <Text>{subtitle}</Text>
    </Box>
  );
}

function renderSubtitle(p: Props): string {
  const head = `running: ${p.subject}`;
  const cost = `$${p.costUsd.toFixed(3)} so far`;
  const eta = formatEta(p.etaEstimate, p.elapsedMs);
  return `${head}  ${eta}  ·  ${cost}`;
}

function formatEta(e: Estimate, elapsed: number): string {
  if (e.status === "estimating") return pc.gray("~ estimating…");
  if (e.status === "estimating-soon")
    return pc.gray(`~ estimating (${e.samples} samples)…`);
  const remaining = Math.max(0, Math.round((e.p50Ms - elapsed) / 1000));
  if (elapsed < e.p50Ms) return pc.green(`~ ${remaining}s remaining`);
  if (elapsed < e.p95Ms)
    return pc.yellow(
      `~ ${Math.max(0, Math.round((e.p95Ms - elapsed) / 1000))}s remaining, slower than usual`,
    );
  return pc.red(`running long — p95 was ${Math.round(e.p95Ms / 1000)}s`);
}
```

- [ ] **Step 3: Run + commit** — `git commit -m "feat(cli): SatelliteLoader with ETA and per-cortex subtitle"`

---

## Task 17: Ink app shell — Prompt, StatusFooter, ScrollView, App root

**Files:**

- Create: `packages/cli/src/components/Prompt.tsx`
- Create: `packages/cli/src/components/StatusFooter.tsx`
- Create: `packages/cli/src/components/ScrollView.tsx`
- Create: `packages/cli/src/app.tsx`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: Prompt component (text input + hint)**

```tsx
// packages/cli/src/components/Prompt.tsx
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";
interface Props {
  onSubmit: (s: string) => void;
  busy: boolean;
}
export function Prompt({ onSubmit, busy }: Props): React.JSX.Element {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (busy) return;
    if (key.return) {
      onSubmit(value);
      setValue("");
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!key.ctrl && !key.meta) setValue((v) => v + input);
  });
  return (
    <Box>
      <Text color="cyan">{busy ? "… " : "› "}</Text>
      <Text>{value}</Text>
    </Box>
  );
}
```

- [ ] **Step 2: StatusFooter**

```tsx
// packages/cli/src/components/StatusFooter.tsx
import React from "react";
import { Box, Text } from "ink";
interface Props {
  sessionId: string;
  tokens: number;
  maxTokens: number;
  costUsd: number;
  lastAction?: string;
  lastMs?: number;
}
export function StatusFooter(p: Props): React.JSX.Element {
  const last = p.lastAction
    ? ` · last: ${p.lastAction} (${((p.lastMs ?? 0) / 1000).toFixed(1)}s)`
    : "";
  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
    >
      <Text dimColor>
        session {p.sessionId.slice(0, 4)} · tokens{" "}
        {(p.tokens / 1000).toFixed(1)}k/{(p.maxTokens / 1000).toFixed(0)}k ·
        cost ${p.costUsd.toFixed(3)}
        {last}
      </Text>
    </Box>
  );
}
```

- [ ] **Step 3: ScrollView (windowed)** — renders only last N items; no wrap-around.

```tsx
// packages/cli/src/components/ScrollView.tsx
import React from "react";
import { Box } from "ink";
interface Props {
  children: React.ReactNode;
}
export function ScrollView({ children }: Props): React.JSX.Element {
  return (
    <Box flexDirection="column" flexGrow={1}>
      {children}
    </Box>
  );
}
```

- [ ] **Step 4: App root — wires state, router, renderers**

```tsx
// packages/cli/src/app.tsx
import React, { useState, useCallback } from "react";
import { Box } from "ink";
import { Prompt } from "./components/Prompt.js";
import { StatusFooter } from "./components/StatusFooter.js";
import { ScrollView } from "./components/ScrollView.js";
import { SatelliteLoader } from "./components/SatelliteLoader.js";
import { ConversationBuffer } from "./memory/buffer.js";
import { CostMeter } from "./util/costMeter.js";
import { parseExplicitCommand } from "./router/parser.js";
import { dispatch, type DispatchResult } from "./router/dispatch.js";
import type { Adapters } from "./router/dispatch.js";
import type { Estimate } from "./util/etaStore.js";
import { randomUUID } from "node:crypto";
// renderer imports resolved in Task 18

export interface AppProps {
  adapters: Adapters;
  interpret: (
    input: string,
    turns: readonly unknown[],
  ) => Promise<{
    plan: import("./router/schema.js").RouterPlan;
    costUsd: number;
  }>;
  etaEstimate: (kind: string, subject: string) => Estimate;
  etaRecord: (kind: string, subject: string, ms: number) => void;
}

export function App(p: AppProps): React.JSX.Element {
  const [sessionId] = useState(() => randomUUID());
  const [buffer] = useState(
    () => new ConversationBuffer({ maxTokens: 200_000 }),
  );
  const [cost] = useState(() => new CostMeter());
  const [busy, setBusy] = useState<null | {
    kind: string;
    subject: string;
    start: number;
  }>(null);
  const [results, setResults] = useState<DispatchResult[]>([]);
  const [lastAction, setLastAction] = useState<
    { name: string; ms: number } | undefined
  >();

  const onSubmit = useCallback(
    async (input: string) => {
      if (!input.trim()) return;
      buffer.append({ role: "user", content: input });
      cost.beginTurn();
      const explicit = parseExplicitCommand(input);
      const plan = explicit ?? (await p.interpret(input, buffer.turns())).plan;
      const cycleId = randomUUID();
      for (const step of plan.steps) {
        const started = Date.now();
        setBusy({ kind: "cortex", subject: step.action, start: started });
        const r = await dispatch(step, { adapters: p.adapters, cycleId });
        const ms = Date.now() - started;
        p.etaRecord("cortex", step.action, ms);
        if (r.kind === "briefing") cost.add(r.costUsd);
        setResults((arr) => [...arr, r]);
        setLastAction({ name: step.action, ms });
      }
      setBusy(null);
      cost.endTurn();
    },
    [buffer, cost, p],
  );

  return (
    <Box flexDirection="column" height="100%">
      <ScrollView>{/* renderers wired in Task 18 */}</ScrollView>
      {busy && (
        <SatelliteLoader
          kind={busy.kind}
          subject={busy.subject}
          etaEstimate={p.etaEstimate(busy.kind, busy.subject)}
          elapsedMs={Date.now() - busy.start}
          costUsd={cost.currentTurn()}
        />
      )}
      <Prompt onSubmit={onSubmit} busy={!!busy} />
      <StatusFooter
        sessionId={sessionId}
        tokens={buffer.totalTokens()}
        maxTokens={200_000}
        costUsd={cost.session()}
        lastAction={lastAction?.name}
        lastMs={lastAction?.ms}
      />
    </Box>
  );
}
```

- [ ] **Step 5: Replace placeholder `index.ts`**

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
import React from "react";
import { render } from "ink";
import { App } from "./app.js";
// adapter wiring omitted — next task provides a boot module.
console.error("boot module pending — see Task 19");
```

- [ ] **Step 6: Commit** — `git commit -m "feat(cli): Ink app shell — Prompt, StatusFooter, ScrollView, App root"`

---

## Task 18: Renderers (briefing, telemetry, logTail, graphTree, whyTree, clarify)

**Files:**

- Create: `packages/cli/src/renderers/{briefing,telemetry,logTail,graphTree,whyTree,clarify}.tsx`
- Create: `packages/cli/tests/renderers/{briefing,logTail}.spec.tsx`

Implement each renderer in its own commit. Below is the full briefing renderer; the rest follow the same pattern.

- [ ] **Step 1: Briefing test**

```tsx
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { BriefingRenderer } from "../../src/renderers/briefing.js";

describe("BriefingRenderer", () => {
  it("renders executive summary + bullets with source-class colored tags", () => {
    const findings = [
      {
        id: "F1",
        summary: "Risky conj",
        sourceClass: "FIELD",
        confidence: 0.9,
        evidenceRefs: ["S1"],
      },
      {
        id: "F2",
        summary: "Media hint",
        sourceClass: "OSINT",
        confidence: 0.4,
        evidenceRefs: ["S2"],
      },
    ];
    const { lastFrame } = render(
      <BriefingRenderer
        executiveSummary="Two candidates flagged."
        findings={findings}
        recommendedActions={["accept F1"]}
        followUpPrompts={["why F1?"]}
      />,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("Two candidates flagged.");
    expect(f).toContain("F1");
    expect(f).toContain("FIELD");
    expect(f).toContain("OSINT");
  });
});
```

- [ ] **Step 2: Briefing implementation**

```tsx
// packages/cli/src/renderers/briefing.tsx
import React from "react";
import { Box, Text } from "ink";
import { colorFor, bar, type SourceClass } from "../util/colors.js";

interface Finding {
  id: string;
  summary: string;
  sourceClass: SourceClass;
  confidence: number;
  evidenceRefs: string[];
}
export interface BriefingProps {
  executiveSummary: string;
  findings: Finding[];
  recommendedActions: string[];
  followUpPrompts: string[];
}

export function BriefingRenderer(p: BriefingProps): React.JSX.Element {
  return (
    <Box flexDirection="column" marginY={1}>
      <Box
        borderStyle="single"
        borderLeft
        borderTop={false}
        borderBottom={false}
        borderRight={false}
        paddingLeft={1}
      >
        <Text dimColor>{p.executiveSummary}</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {p.findings.map((f) => {
          const tint = colorFor(f.sourceClass);
          return (
            <Box key={f.id}>
              <Text>{tint("●")} </Text>
              <Text bold>{f.id}</Text>
              <Text> {tint(f.sourceClass)} </Text>
              <Text>{tint(bar(f.confidence))} </Text>
              <Text>{f.summary}</Text>
              <Text dimColor> ({f.evidenceRefs.join(", ")})</Text>
            </Box>
          );
        })}
      </Box>
      {p.recommendedActions.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text color="cyan">Recommended actions:</Text>
          {p.recommendedActions.map((a, i) => (
            <Text key={i}> → {a}</Text>
          ))}
        </Box>
      )}
      {p.followUpPrompts.length > 0 && (
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>Try next:</Text>
          {p.followUpPrompts.map((q, i) => (
            <Text key={i} dimColor>
              {" "}
              • {q}
            </Text>
          ))}
        </Box>
      )}
    </Box>
  );
}
```

- [ ] **Step 3: telemetry, logTail, graphTree, whyTree, clarify** — follow same pattern.
  - `TelemetryRenderer`: 14 scalars as horizontal bars grouped by subsystem.
  - `LogTailRenderer`: for each event, render `<AnimatedEmoji step={e.step} phase={e.phase} />` + service badge + msg. Groups consecutive by `cycleId` / `swarmId`.
  - `GraphTreeRenderer`: entity at top, neighbours indented by depth.
  - `WhyTreeRenderer`: ASCII tree `├── edge ─→ source_item (sha256:abcd…)`.
  - `ClarifyRenderer`: question + numbered options; selection handled in App.

- [ ] **Step 4: Wire renderers in `App.tsx` ScrollView** — map `results` to the appropriate renderer by `r.kind`.

- [ ] **Step 5: Commit per renderer** — `git commit -m "feat(cli): renderer <name>"`.

---

## Task 19: analyst_briefing cortex skill + adapter wiring

**Files:**

- Create: `packages/thalamus/src/cortices/skills/analyst-briefing.md`
- Modify: `packages/cli/src/adapters/thalamus.ts` to call analyst_briefing after `runCycle`.

- [ ] **Step 1: Skill prompt**

```markdown
<!-- packages/thalamus/src/cortices/skills/analyst-briefing.md -->

# analyst_briefing

You synthesize a research cycle's findings into a reviewer-readable briefing.

## Input (JSON)

- `query`: original user input
- `findings[]`: { id, summary, sourceClass, confidence, evidenceRefs[] }
- `sourceItems[]`: { id, url?, kind, title, sha256 }

## Output (strict JSON)

- `executiveSummary`: ≤ 3 short lines
- `findings[]`: copy of input findings, possibly re-ordered by priority
- `recommendedActions[]`: imperatives tied to specific ids ("accept F12", "explain F9")
- `followUpPrompts[]`: ≤ 3 next-turn questions the operator might ask

## Rules

1. Do not invent findings. Only reference ids present in input.
2. Confidence bands respect SPEC-TH-040: FIELD-corroborated wins over OSINT.
3. Temperature = 0.
```

- [ ] **Step 2: Extend thalamus adapter**

Wrap `runCycle` to also produce `{ briefing, findings }` — call the skill via `nanoCaller`, pass through schema validation.

- [ ] **Step 3: Commit** — `git commit -m "feat(cli,thalamus): analyst_briefing skill + briefing output on runCycle"`

---

## Task 20: Boot module — wire everything

**Files:**

- Create: `packages/cli/src/boot.ts`
- Modify: `packages/cli/src/index.ts`

- [ ] **Step 1: boot.ts**

```ts
// packages/cli/src/boot.ts
import React from "react";
import { render } from "ink";
import { homedir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import { App } from "./app.js";
import { EtaStore } from "./util/etaStore.js";
import { PinoRingBuffer } from "./util/pinoRingBuffer.js";
import { LogsAdapter } from "./adapters/logs.js";
import { interpret } from "./router/interpreter.js";
// import the real thalamus/sweep container bootstrap:
import { bootThalamus } from "@interview/thalamus"; // existing export
import { bootSweep } from "@interview/sweep"; // existing export

export async function main(): Promise<void> {
  const eta = new EtaStore(join(homedir(), ".cache/ssa-cli/eta.json"));
  process.on("exit", () => eta.flush());

  const ring = new PinoRingBuffer(1_000);
  const streamTransport = {
    write: (s: string) => {
      try {
        ring.push(JSON.parse(s));
      } catch {
        /* non-json lines ignored */
      }
    },
  };
  const logger = pino({ level: "info" }, streamTransport);

  const thalamus = await bootThalamus({ logger });
  const sweep = await bootSweep({ logger });

  const adapters = {
    thalamus: { runCycle: thalamus.service.runCycle.bind(thalamus.service) },
    telemetry: {
      start: (q: { satId: string }) =>
        sweep.startTelemetrySwarm({ satelliteId: q.satId }),
    },
    logs: new LogsAdapter(ring),
    graph: {
      neighbourhood: thalamus.researchGraph.neighbourhood.bind(
        thalamus.researchGraph,
      ),
    },
    resolution: { accept: sweep.resolution.accept.bind(sweep.resolution) },
    why: {
      build: (findingId: string) =>
        thalamus.researchGraph.provenance(findingId),
    },
  };

  render(
    React.createElement(App, {
      adapters,
      interpret: (input, turns) =>
        interpret(
          { input, recentTurns: turns as never, availableEntityIds: [] },
          thalamus.nano,
        ),
      etaEstimate: (k, s) => eta.estimate(k, s),
      etaRecord: (k, s, ms) => eta.record(k, s, ms),
    }),
  );
}
```

- [ ] **Step 2: index.ts drives boot**

```ts
// packages/cli/src/index.ts
#!/usr/bin/env node
import { main } from "./boot.js";
main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 3: Manual smoke test**

```bash
pnpm -r typecheck
pnpm run ssa
# inside REPL:
# /help
# /telemetry 25544
# /quit
```

Expected: REPL boots ≤ 3 s, accepts commands, quits cleanly.

- [ ] **Step 4: Commit** — `git commit -m "feat(cli): boot wiring — real adapters + REPL entrypoint"`

---

## Task 21: E2E happy-path test

**Files:**

- Create: `packages/cli/tests/e2e/repl.spec.ts`

- [ ] **Step 1: Test**

```ts
import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { App } from "../../src/app.js";

describe("REPL e2e", () => {
  it("slash command → briefing render → accept", async () => {
    const adapters = {
      thalamus: {
        runCycle: async () => ({
          findings: [
            {
              id: "F1",
              summary: "Risky",
              sourceClass: "FIELD",
              confidence: 0.9,
              evidenceRefs: ["S1"],
            },
          ],
          costUsd: 0.02,
        }),
      },
      telemetry: { start: async () => ({ distribution: {} }) },
      logs: { tail: () => [] },
      graph: { neighbourhood: async () => ({}) },
      resolution: {
        accept: async () => ({ ok: true, delta: { findingId: "F1" } }),
      },
      why: { build: async () => ({}) },
    };
    const { stdin, lastFrame } = render(
      React.createElement(App, {
        adapters,
        interpret: async () => ({
          plan: { steps: [], confidence: 0 },
          costUsd: 0,
        }),
        etaEstimate: () => ({ status: "estimating" as const }),
        etaRecord: () => {},
      }),
    );
    stdin.write("/query risk\n");
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain("F1");
    stdin.write("/accept F1\n");
    await new Promise((r) => setTimeout(r, 50));
    expect(lastFrame()).toContain("accept");
  });
});
```

- [ ] **Step 2: Run — expect PASS**
- [ ] **Step 3: Commit** — `git commit -m "test(cli): e2e REPL happy path"`

---

## Task 22: Finalise — update TODO, README, CHANGELOG

**Files:**

- Modify: `TODO.md`
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Mark P1 items checked in TODO.md** (entry points per §Priority 1).
- [ ] **Step 2: Add README section** — "Run the SSA console" with `pnpm install && pnpm run ssa`, short command cheatsheet.
- [ ] **Step 3: CHANGELOG entry** — summarise packages added, cortex skills added, retrofits.
- [ ] **Step 4: Final typecheck + tests**

```bash
pnpm -r typecheck
pnpm -r test
```

Expected: green.

- [ ] **Step 5: Commit** — `git commit -m "docs(cli): TODO/README/CHANGELOG updates for conversational REPL"`

---

## Self-review notes

- **Spec coverage**: every §3 component mapped to a task (app→17, router→5/6/7/14, adapters→13, memory→8/9, renderers→18, loader→16, emoji→15, cortex skills→7/19, tests→throughout).
- **Ordering**: foundations (stepLog, parser, schema, adapters) land before app shell. Renderers wired after App root.
- **TDD discipline**: every non-trivial task starts with a failing test; purely-presentational helpers (colors) are allowed to skip tests, documented inline.
- **Frequent commits**: 22 tasks, 30+ commits total.
- **Known follow-ups (explicit non-goals per spec §10)**: no streaming, no web UI, no auth — deferred.
