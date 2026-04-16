# REPL SSE Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the blocking `POST /api/repl/chat` with a Server-Sent-Events stream that pushes `classified`, `cycle.start`, `step`, `finding`, `chat.complete`, `summary.complete`, `done`, and `error` events in real time. The REPL panel then shows a live loader (current step + trail + elapsed) during the 50s Thalamus cycle instead of a static "planning…" badge, and renders findings as they land.

**Architecture:** `ReplChatService.handle()` becomes an `async *handleStream()` generator. Thalamus step events reach the generator through an `AsyncLocalStorage`-based context (`stepContextStore`) that `stepLog` in `@interview/shared/observability` reads on every call — no changes to `ThalamusService` internals, no manual cycleId plumbing. A new SSE controller copies the proven pattern from `packages/sweep/src/controllers/satellite-sweep-chat.controller.ts` (Fastify `reply.raw.writeHead` + `for await … reply.raw.write`). Frontend replaces `fetch` + JSON with `fetch` + `ReadableStream` SSE parser; the `ReplPanel` Turn state gains phase/steps/findings/summary fields populated incrementally.

**Tech Stack:** Node `AsyncLocalStorage` (built-in), Fastify `reply.raw`, browser `fetch` + `ReadableStream.getReader()`, Vitest, React 18. No new runtime deps.

---

## File Structure

### New files

- `packages/shared/src/observability/step-context.ts` — `AsyncLocalStorage<StepContext>` store.
- `packages/shared/tests/step-context.spec.ts` — verifies `stepLog` inside `stepContextStore.run` forwards events to the callback.
- `packages/shared/src/types/repl-stream.ts` — `ReplStreamEvent` union type shared between backend and frontend.
- `apps/console/src/lib/repl-stream.ts` — browser SSE parser `postTurnStream(input, sessionId, onEvent)`.
- `apps/console/src/components/CycleLoader.tsx` — renders current step + completed-steps trail + elapsed ms during `run_cycle` phase.

### Modified files

- `packages/shared/src/observability/step-logger.ts` — `stepLog` reads `stepContextStore.getStore()` and calls `ctx.onStep(event)` if present.
- `packages/shared/src/observability/index.ts` — re-exports `stepContextStore`, `StepContext`.
- `apps/console-api/src/services/repl-chat.service.ts` — replaces `handle(input)` with `async *handleStream(input): AsyncGenerator<ReplStreamEvent>`; adds `findingRepo` dep.
- `apps/console-api/src/controllers/repl.controller.ts` — replaces `replChatController` with SSE-producing `replChatStreamController`.
- `apps/console-api/src/routes/repl.routes.ts` — route `POST /api/repl/chat` now served by SSE controller.
- `apps/console-api/tests/unit/services/repl-chat.service.test.ts` — rewrite for the generator.
- `apps/console/src/lib/repl.ts` — `postTurn` delegates to `postTurnStream` for the chat path; keeps `/api/repl/turn` path unchanged.
- `apps/console/src/components/ReplPanel.tsx` — `Turn` state gains `phase`, `currentStep`, `steps[]`, `findings[]`, `chatText`, `summaryText`; `TurnView` renders `<CycleLoader>` during `phase === "cycle-running"` and final content on `done`.

### Unchanged (do not touch)

- `packages/thalamus/src/services/thalamus.service.ts` — the ALS hook in `stepLog` is transparent.
- `apps/console-api/src/routes/cycles.routes.ts` and `CycleRunnerService` — orthogonal to REPL chat.
- `apps/console-api/src/services/repl-turn.service.ts` and the `/api/repl/turn` slash-command path.
- Any other controller/service.

---

## Task 1: StepContext (AsyncLocalStorage hook)

**Files:**

- Create: `packages/shared/src/observability/step-context.ts`
- Create: `packages/shared/tests/step-context.spec.ts`
- Modify: `packages/shared/src/observability/step-logger.ts`
- Modify: `packages/shared/src/observability/index.ts`

- [ ] **Step 1.1: Write the failing test**

Create `packages/shared/tests/step-context.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import pino from "pino";
import { stepLog } from "../src/observability/step-logger";
import {
  stepContextStore,
  type StepContext,
} from "../src/observability/step-context";

describe("stepContextStore", () => {
  it("forwards stepLog events to the callback when inside run()", async () => {
    const events: unknown[] = [];
    const ctx: StepContext = { onStep: (e) => events.push(e) };
    const logger = pino({ level: "silent" });

    await stepContextStore.run(ctx, async () => {
      stepLog(logger, "cycle", "start", { cycleId: "cyc:1" });
      await Promise.resolve();
      stepLog(logger, "planner", "done");
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({
      step: "cycle",
      phase: "start",
      cycleId: "cyc:1",
    });
    expect(events[1]).toMatchObject({ step: "planner", phase: "done" });
  });

  it("does not forward when no context is active", () => {
    const logger = pino({ level: "silent" });
    // Should not throw and should not call any callback (there is none).
    expect(() => stepLog(logger, "cortex", "start")).not.toThrow();
  });
});
```

- [ ] **Step 1.2: Run test to verify it fails**

Run: `pnpm --filter @interview/shared test step-context`
Expected: FAIL — `stepContextStore` / `step-context` module not found.

- [ ] **Step 1.3: Create the ALS store**

Create `packages/shared/src/observability/step-context.ts`:

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import type { StepEvent } from "./step-logger";

export interface StepContext {
  onStep: (event: StepEvent) => void;
}

/**
 * ALS store threaded through any async work that wants to observe step
 * events without changing call sites of `stepLog`. Consumers do:
 *   stepContextStore.run({ onStep }, async () => await workThatEmitsSteps());
 */
export const stepContextStore = new AsyncLocalStorage<StepContext>();
```

- [ ] **Step 1.4: Patch `stepLog` to forward to the context**

Modify `packages/shared/src/observability/step-logger.ts`. Add an import and a forwarding call right after `logger.info(event);` in both the known-step and unknown-step branches:

```ts
// add at top
import { stepContextStore } from "./step-context";
```

Inside `stepLog`, after each `logger.info(event);` line, add:

```ts
const ctx = stepContextStore.getStore();
if (ctx) ctx.onStep(event);
```

- [ ] **Step 1.5: Re-export from barrel**

Modify `packages/shared/src/observability/index.ts` — add:

```ts
export { stepContextStore, type StepContext } from "./step-context";
```

- [ ] **Step 1.6: Run test to verify it passes**

Run: `pnpm --filter @interview/shared test step-context`
Expected: PASS (2 tests).

- [ ] **Step 1.7: Commit**

```bash
git add packages/shared/src/observability/step-context.ts \
        packages/shared/src/observability/step-logger.ts \
        packages/shared/src/observability/index.ts \
        packages/shared/tests/step-context.spec.ts
git commit -m "feat(shared): stepContextStore ALS hook for step-event observation"
```

---

## Task 2: Shared ReplStreamEvent type

**Files:**

- Create: `packages/shared/src/types/repl-stream.ts`
- Modify: `packages/shared/src/index.ts` (if it re-exports `types/`; otherwise skip)

- [ ] **Step 2.1: Create the shared type**

Create `packages/shared/src/types/repl-stream.ts`:

```ts
import type { StepName, StepPhase } from "../observability/step-logger";

export type ReplStreamEvent =
  | {
      event: "classified";
      data: { action: "chat" | "run_cycle"; query?: string };
    }
  | { event: "chat.complete"; data: { text: string; provider: string } }
  | { event: "cycle.start"; data: { cycleId: string; query: string } }
  | {
      event: "step";
      data: {
        step: StepName | "unknown";
        phase: StepPhase;
        terminal: string;
        elapsedMs: number;
        extra?: Record<string, unknown>;
      };
    }
  | {
      event: "finding";
      data: {
        id: string;
        title: string;
        summary: string | null;
        cortex: string | null;
        urgency: string | null;
        confidence: number;
      };
    }
  | { event: "summary.complete"; data: { text: string; provider: string } }
  | {
      event: "done";
      data: {
        provider: string;
        costUsd: number;
        tookMs: number;
        findingsCount: number;
      };
    }
  | { event: "error"; data: { message: string } };

export type ReplStreamEventType = ReplStreamEvent["event"];
```

- [ ] **Step 2.2: Re-export from shared root (if applicable)**

Check `packages/shared/src/index.ts`. If it has a `types` re-export line, add:

```ts
export type { ReplStreamEvent, ReplStreamEventType } from "./types/repl-stream";
```

If the barrel does not aggregate `types/`, leave it — consumers will import from `@interview/shared/types/repl-stream` directly.

- [ ] **Step 2.3: Typecheck**

Run: `pnpm --filter @interview/shared typecheck`
Expected: PASS.

- [ ] **Step 2.4: Commit**

```bash
git add packages/shared/src/types/repl-stream.ts packages/shared/src/index.ts
git commit -m "feat(shared): ReplStreamEvent discriminated union"
```

---

## Task 3: Refactor ReplChatService to async generator — chat branch

**Files:**

- Modify: `apps/console-api/src/services/repl-chat.service.ts`
- Modify: `apps/console-api/src/container.ts`
- Modify: `apps/console-api/tests/unit/services/repl-chat.service.test.ts`

- [ ] **Step 3.1: Rewrite the existing test for the chat intent**

Replace the body of `apps/console-api/tests/unit/services/repl-chat.service.test.ts`. We define a single top-level `vi.mock` for `@interview/thalamus` whose behaviour is steered by module-scoped variables — both Task 3 and Task 4 tests share this one mock, no `vi.doMock` / dynamic-import trickery.

Prompt discriminators (matched by the mock; verified against `apps/console-api/src/prompts/repl-chat.prompt.ts`):

- Classifier system prompt contains `"intent router"`.
- Summariser system prompt contains `"briefing writer"`.
- Chat system prompt contains `"mission-operator assistant"` (default fallback).

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplStreamEvent } from "@interview/shared/types/repl-stream";

// Module-scoped steerable mock outputs — each test overwrites in beforeEach.
let classifierContent = JSON.stringify({ action: "chat" });
let summariserContent = "summary";
let chatContent = "chat-reply";

vi.mock("@interview/thalamus", async () => {
  const actual = await vi.importActual<typeof import("@interview/thalamus")>(
    "@interview/thalamus",
  );
  return {
    ...actual,
    createLlmTransportWithMode: (sys: string) => ({
      call: async (_input: string) => {
        if (sys.includes("intent router"))
          return { content: classifierContent, provider: "kimi" };
        if (sys.includes("briefing writer"))
          return { content: summariserContent, provider: "kimi" };
        return { content: chatContent, provider: "kimi" };
      },
    }),
  };
});

// Import AFTER vi.mock so the mocked transport is bound.
import { ReplChatService } from "../../../src/services/repl-chat.service";

async function drain(
  gen: AsyncGenerator<ReplStreamEvent>,
): Promise<ReplStreamEvent[]> {
  const out: ReplStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe("ReplChatService.handleStream — chat branch", () => {
  beforeEach(() => {
    classifierContent = JSON.stringify({ action: "chat" });
    summariserContent = "summary";
    chatContent = "echo:bonjour";
  });

  it("emits classified → chat.complete → done when classifier routes to chat", async () => {
    const svc = new ReplChatService({
      thalamusService: { runCycle: vi.fn() as never },
      findingRepo: { findByCycleId: vi.fn() as never },
    });

    const events = await drain(svc.handleStream("bonjour"));
    const types = events.map((e) => e.event);
    expect(types).toEqual(["classified", "chat.complete", "done"]);

    const [classified, chat, done] = events;
    expect(classified).toMatchObject({
      event: "classified",
      data: { action: "chat" },
    });
    expect(chat).toMatchObject({
      event: "chat.complete",
      data: { text: "echo:bonjour", provider: "kimi" },
    });
    expect(done).toMatchObject({ event: "done", data: { findingsCount: 0 } });
    expect(
      (done as { data: { tookMs: number } }).data.tookMs,
    ).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 3.2: Run test to verify it fails**

Run: `pnpm --filter @interview/console-api test repl-chat.service`
Expected: FAIL — `handleStream` does not exist.

- [ ] **Step 3.3: Rewrite the service (chat branch only; run_cycle branch in Task 4)**

Replace `apps/console-api/src/services/repl-chat.service.ts` with:

```ts
import { createLlmTransportWithMode } from "@interview/thalamus";
import type { ReplStreamEvent } from "@interview/shared/types/repl-stream";
import {
  CONSOLE_CHAT_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT,
  summariserPrompt,
} from "../prompts/repl-chat.prompt";

const TRIGGER_USER = "user" as const;

export interface ThalamusChatDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      triggerType: never;
      triggerSource: string;
    }): Promise<{ id: bigint | string }>;
  };
  findingRepo: {
    findByCycleId(id: bigint | string): Promise<
      Array<{
        id: bigint | string;
        title?: string;
        summary?: string;
        cortex?: string;
        urgency?: string;
        confidence?: number | null;
      }>
    >;
  };
}

export class ReplChatService {
  constructor(private readonly deps: ThalamusChatDep) {}

  async *handleStream(input: string): AsyncGenerator<ReplStreamEvent> {
    const t0 = Date.now();

    // --- classify ---
    const classifier = createLlmTransportWithMode(CLASSIFIER_SYSTEM_PROMPT);
    const routed = await classifier.call(input);
    let intent: { action: "chat" } | { action: "run_cycle"; query: string };
    try {
      const m = routed.content.match(/\{[\s\S]*\}/);
      intent = m ? JSON.parse(m[0]) : { action: "chat" };
    } catch {
      intent = { action: "chat" };
    }

    yield {
      event: "classified",
      data:
        intent.action === "run_cycle"
          ? { action: "run_cycle", query: intent.query }
          : { action: "chat" },
    };

    if (intent.action === "chat") {
      const chat = createLlmTransportWithMode(CONSOLE_CHAT_SYSTEM_PROMPT);
      const response = await chat.call(input);
      yield {
        event: "chat.complete",
        data: { text: response.content, provider: response.provider },
      };
      yield {
        event: "done",
        data: {
          provider: response.provider,
          costUsd: 0,
          tookMs: Date.now() - t0,
          findingsCount: 0,
        },
      };
      return;
    }

    // run_cycle branch implemented in Task 4
    yield {
      event: "error",
      data: { message: "run_cycle branch not yet implemented" },
    };
  }
}
```

- [ ] **Step 3.4: Update container to inject findingRepo**

Modify `apps/console-api/src/container.ts` line 95. The thalamus container already exposes `findingRepo` alongside `thalamusService`, so the object-literal dep is already in scope. Confirm the constructor call still matches — `new ReplChatService(thalamus)` works because `thalamus` is `{ thalamusService, findingRepo, … }` and TS structural typing picks up both. No edit required here **unless** a TS error surfaces. If so, make it explicit:

```ts
const replChat = new ReplChatService({
  thalamusService: thalamus.thalamusService,
  findingRepo: thalamus.findingRepo,
});
```

- [ ] **Step 3.5: Run test to verify it passes**

Run: `pnpm --filter @interview/console-api test repl-chat.service`
Expected: PASS.

- [ ] **Step 3.6: Commit**

```bash
git add apps/console-api/src/services/repl-chat.service.ts \
        apps/console-api/src/container.ts \
        apps/console-api/tests/unit/services/repl-chat.service.test.ts
git commit -m "refactor(console-api): repl chat service as async generator (chat branch)"
```

---

## Task 4: Generator — run_cycle branch with step-event interleaving

**Files:**

- Modify: `apps/console-api/src/services/repl-chat.service.ts`
- Modify: `apps/console-api/tests/unit/services/repl-chat.service.test.ts`

- [ ] **Step 4.1: Add the failing test for run_cycle branch**

Append to `apps/console-api/tests/unit/services/repl-chat.service.test.ts` (reuses the same top-level `vi.mock` + steerable variables introduced in Task 3):

```ts
import { stepLog } from "@interview/shared/observability";

describe("ReplChatService.handleStream — run_cycle branch", () => {
  beforeEach(() => {
    classifierContent = JSON.stringify({
      action: "run_cycle",
      query: "conjonctions",
    });
    summariserContent = "n=1 finding resume";
    chatContent = "chat unused";
  });

  it("emits classified → cycle.start → step* → finding* → summary.complete → done", async () => {
    // runCycle emits step events — because ReplChatService wraps this call in
    // stepContextStore.run, those events reach the generator via the ALS hook.
    const runCycle = vi.fn(async () => {
      const logger = { info: () => {} } as unknown as Parameters<
        typeof stepLog
      >[0];
      stepLog(logger, "cycle", "start", { cycleId: "cyc:42" });
      await Promise.resolve();
      stepLog(logger, "planner", "start");
      stepLog(logger, "planner", "done");
      stepLog(logger, "cortex", "done", { cortex: "catalog" });
      return { id: "cyc:42" };
    });

    const svc = new ReplChatService({
      thalamusService: { runCycle },
      findingRepo: {
        findByCycleId: async () => [
          {
            id: "f:1",
            title: "Conjonction serrée",
            cortex: "catalog",
            urgency: "medium",
            confidence: 0.82,
          },
        ],
      },
    });

    const events = await drain(svc.handleStream("scan conjonctions"));
    const types = events.map((e) => e.event);
    expect(types[0]).toBe("classified");
    expect(types[1]).toBe("cycle.start");
    expect(types.filter((t) => t === "step").length).toBeGreaterThanOrEqual(3);
    expect(types.filter((t) => t === "finding").length).toBe(1);
    expect(types.at(-2)).toBe("summary.complete");
    expect(types.at(-1)).toBe("done");

    expect(runCycle).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 4.2: Run test to verify it fails**

Run: `pnpm --filter @interview/console-api test repl-chat.service`
Expected: FAIL — `error` event emitted, no `cycle.start` / `step` / `finding`.

- [ ] **Step 4.3: Implement the run_cycle branch**

First, add `stepContextStore` to the top-of-file imports of `apps/console-api/src/services/repl-chat.service.ts`:

```ts
import { stepContextStore } from "@interview/shared/observability";
```

Then replace the placeholder section (`// run_cycle branch implemented in Task 4` … through the next `yield { event: "error" … }`) in the same file with:

```ts
    // --- run_cycle ---
    const query = intent.query;
    const cycleId = `cyc:${Date.now().toString(36)}`;
    yield { event: "cycle.start", data: { cycleId, query } };

    // Queue-based interleaving: runCycle runs inside stepContextStore.run so
    // stepLog calls push into `pending`. We alternate between draining the
    // queue and waiting for either a new step or the cycle to finish.
    type StepData = Extract<ReplStreamEvent, { event: "step" }>["data"];
    const pending: StepData[] = [];
    let waiter: (() => void) | null = null;
    const wake = (): void => {
      const w = waiter;
      waiter = null;
      if (w) w();
    };
    const t1 = Date.now();
    const onStep: (e: { step: string; phase: string; terminal: string } & Record<string, unknown>) => void = (e) => {
      pending.push({
        step: e.step as StepData["step"],
        phase: e.phase as StepData["phase"],
        terminal: e.terminal,
        elapsedMs: Date.now() - t1,
        extra: e,
      });
      wake();
    };

    let cycleDone = false;
    let cycleErr: Error | null = null;
    let cycleResultId: string | bigint = cycleId;

    const cycleP = stepContextStore
      .run({ onStep }, () =>
        this.deps.thalamusService.runCycle({
          query,
          triggerType: TRIGGER_USER as unknown as never,
          triggerSource: "console-chat",
        }),
      )
      .then((r) => { cycleResultId = r.id; })
      .catch((err: unknown) => { cycleErr = err instanceof Error ? err : new Error(String(err)); })
      .finally(() => { cycleDone = true; wake(); });

    while (!cycleDone || pending.length > 0) {
      if (pending.length > 0) {
        yield { event: "step", data: pending.shift()! };
        continue;
      }
      if (cycleDone) break;
      await new Promise<void>((resolve) => { waiter = resolve; });
    }
    await cycleP;

    if (cycleErr) {
      yield { event: "error", data: { message: cycleErr.message } };
      yield { event: "done", data: { provider: "kimi", costUsd: 0, tookMs: Date.now() - t0, findingsCount: 0 } };
      return;
    }

    const findings = await this.deps.findingRepo.findByCycleId(cycleResultId);
    const top = findings.slice(0, 8);
    for (const f of top) {
      yield {
        event: "finding",
        data: {
          id: String(f.id),
          title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
          summary: f.summary?.slice(0, 300) ?? null,
          cortex: f.cortex ?? null,
          urgency: f.urgency ?? null,
          confidence: Number(f.confidence ?? 0),
        },
      };
    }

    const summariser = createLlmTransportWithMode(summariserPrompt(input));
    const payload = JSON.stringify(
      {
        cycleId: String(cycleResultId),
        findings: top.map((f) => ({
          id: String(f.id),
          title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
          cortex: f.cortex,
          urgency: f.urgency,
          confidence: Number(f.confidence ?? 0),
        })),
      },
      null,
      2,
    );
    const summary = await summariser.call(payload);
    yield {
      event: "summary.complete",
      data: { text: summary.content, provider: summary.provider },
    };

    yield {
      event: "done",
      data: {
        provider: summary.provider,
        costUsd: 0,
        tookMs: Date.now() - t0,
        findingsCount: findings.length,
      },
    };
```

Also add at the top of the file (if not already):

```ts
const TRIGGER_USER = "user" as const;
```

(It already exists in the Task 3 version — leave it.)

- [ ] **Step 4.4: Run test to verify it passes**

Run: `pnpm --filter @interview/console-api test repl-chat.service`
Expected: PASS (both suites — chat branch + run_cycle branch).

- [ ] **Step 4.5: Commit**

```bash
git add apps/console-api/src/services/repl-chat.service.ts \
        apps/console-api/tests/unit/services/repl-chat.service.test.ts
git commit -m "feat(console-api): stream thalamus step events + findings in repl chat"
```

---

## Task 5: SSE controller + route

**Files:**

- Modify: `apps/console-api/src/controllers/repl.controller.ts`
- Modify: `apps/console-api/src/routes/repl.routes.ts`

- [ ] **Step 5.1: Replace the chat controller with an SSE variant**

Modify `apps/console-api/src/controllers/repl.controller.ts`. Replace the `replChatController` export with:

```ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { ReplChatBodySchema, ReplTurnBodySchema } from "../schemas";

export function replChatStreamController(service: ReplChatService) {
  return async (
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ) => {
    const body = parseOrReply(req.body, ReplChatBodySchema, reply);
    if (body === null) return;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const evt of service.handleStream(body.input)) {
        reply.raw.write(
          `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message })}\n\n`);
    } finally {
      reply.raw.end();
    }
  };
}

export function replTurnController(service: ReplTurnService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReplTurnBodySchema, reply);
    if (body === null) return;
    return service.handle(body.input, body.sessionId);
  });
}
```

Delete the old `replChatController` export.

- [ ] **Step 5.2: Update the route registration**

Modify `apps/console-api/src/routes/repl.routes.ts`:

```ts
import type { FastifyInstance } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import {
  replChatStreamController,
  replTurnController,
} from "../controllers/repl.controller";

export function registerReplRoutes(
  app: FastifyInstance,
  chat: ReplChatService,
  turn: ReplTurnService,
): void {
  app.post<{ Body: { input: string } }>(
    "/api/repl/chat",
    replChatStreamController(chat),
  );
  app.post<{ Body: { input: string; sessionId: string } }>(
    "/api/repl/turn",
    replTurnController(turn),
  );
}
```

- [ ] **Step 5.3: Update controller test (if it referenced replChatController)**

Check `apps/console-api/tests/unit/controllers/repl.controller.test.ts` — if it tested `replChatController`, delete that test block (the SSE controller is integration-tested via the service, and its logic is a thin adapter).

Run: `pnpm --filter @interview/console-api test repl.controller`
Expected: PASS (remaining tests for turn controller).

- [ ] **Step 5.4: Typecheck the whole app**

Run: `pnpm --filter @interview/console-api typecheck`
Expected: PASS.

- [ ] **Step 5.5: Commit**

```bash
git add apps/console-api/src/controllers/repl.controller.ts \
        apps/console-api/src/routes/repl.routes.ts \
        apps/console-api/tests/unit/controllers/repl.controller.test.ts
git commit -m "feat(console-api): SSE controller for /api/repl/chat"
```

---

## Task 6: Client SSE parser

**Files:**

- Create: `apps/console/src/lib/repl-stream.ts`
- Modify: `apps/console/src/lib/repl.ts`

- [ ] **Step 6.1: Write the SSE parser**

Create `apps/console/src/lib/repl-stream.ts`:

```ts
import type { ReplStreamEvent } from "@interview/shared/types/repl-stream";

export type StreamHandler = (evt: ReplStreamEvent) => void;

/**
 * POST JSON, parse the SSE stream, invoke `onEvent` for each message.
 * Returns when the server closes the connection (after `done` or `error`).
 */
export async function postChatStream(
  input: string,
  onEvent: StreamHandler,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/repl/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "text/event-stream",
    },
    body: JSON.stringify({ input }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // SSE messages are separated by a blank line ("\n\n").
    let sep: number;
    while ((sep = buf.indexOf("\n\n")) !== -1) {
      const raw = buf.slice(0, sep);
      buf = buf.slice(sep + 2);
      const parsed = parseSseMessage(raw);
      if (parsed) onEvent(parsed);
    }
  }
}

function parseSseMessage(raw: string): ReplStreamEvent | null {
  let event = "";
  let data = "";
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!event || !data) return null;
  try {
    return { event, data: JSON.parse(data) } as ReplStreamEvent;
  } catch {
    return null;
  }
}
```

- [ ] **Step 6.2: Re-route the `postTurn` chat path**

Modify `apps/console/src/lib/repl.ts`. The current `postTurn` function has a chat path that does a single `fetch` and returns a `TurnResponse`. We keep `postTurn` for slash-commands (`/api/repl/turn`) but remove the chat path — callers of the chat path will use `postChatStream` instead.

Replace the body of `postTurn`:

```ts
export async function postTurn(
  input: string,
  sessionId: string,
): Promise<TurnResponse> {
  if (!looksLikeCommand(input)) {
    throw new Error(
      "postTurn is for slash-commands only; use postChatStream for free-text",
    );
  }
  const res = await fetch("/api/repl/turn", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input, sessionId }),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (await res.json()) as TurnResponse;
}
```

Leave `looksLikeCommand` and all the `DispatchResult` types in place (they are still used by `/api/repl/turn` renderers).

- [ ] **Step 6.3: Typecheck**

Run: `pnpm --filter @interview/console typecheck`
Expected: PASS.

- [ ] **Step 6.4: Commit**

```bash
git add apps/console/src/lib/repl-stream.ts apps/console/src/lib/repl.ts
git commit -m "feat(console): SSE parser for repl chat stream"
```

---

## Task 7: CycleLoader component

**Files:**

- Create: `apps/console/src/components/CycleLoader.tsx`

- [ ] **Step 7.1: Write the component**

Create `apps/console/src/components/CycleLoader.tsx`:

```tsx
import { clsx } from "clsx";
import { AnimatedStepBadge } from "./AnimatedStepBadge";
import type { StepName } from "../lib/steps";

export type CycleStep = {
  name: StepName | "unknown";
  phase: "start" | "done" | "error";
  terminal: string;
  elapsedMs: number;
};

export function CycleLoader(props: {
  cycleId: string;
  current?: CycleStep;
  trail: CycleStep[];
  elapsedMs: number;
}) {
  const { cycleId, current, trail, elapsedMs } = props;
  return (
    <div className="border-l-2 border-cyan pl-3">
      <div className="mono text-caption text-cyan">
        ▶ cycle <span className="text-primary">{cycleId}</span>
        <span className="ml-2 text-dim">
          · {(elapsedMs / 1000).toFixed(1)}s
        </span>
      </div>
      <div className="mt-1 flex flex-col gap-0.5">
        {trail.map((s, i) => (
          <div key={i} className="mono text-caption">
            <span className="text-cold">{s.terminal}</span>
            <span className="ml-2 text-muted">{s.name}</span>
            <span className="ml-2 text-dim">
              ({(s.elapsedMs / 1000).toFixed(1)}s)
            </span>
          </div>
        ))}
        {current && (
          <div className="mono text-caption">
            <AnimatedStepBadge
              step={current.name as StepName}
              phase="progress"
            />
            <span
              className={clsx(
                "ml-2",
                current.phase === "error" ? "text-hot" : "text-primary",
              )}
            >
              {current.name}
            </span>
            <span className="ml-2 text-dim">…</span>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 7.2: Typecheck**

Run: `pnpm --filter @interview/console typecheck`
Expected: PASS.

- [ ] **Step 7.3: Commit**

```bash
git add apps/console/src/components/CycleLoader.tsx
git commit -m "feat(console): CycleLoader component for live thalamus progress"
```

---

## Task 8: Integrate streaming into ReplPanel

**Files:**

- Modify: `apps/console/src/components/ReplPanel.tsx`

- [ ] **Step 8.1: Extend the Turn type and state machine**

At the top of `apps/console/src/components/ReplPanel.tsx`, replace the `Turn` type with:

```ts
import type { ReplStreamEvent } from "@interview/shared/types/repl-stream";
import { postChatStream } from "../lib/repl-stream";
import { CycleLoader, type CycleStep } from "./CycleLoader";

export type TurnPhase =
  | "classifying"
  | "chatting"
  | "cycle-running"
  | "done"
  | "error";

export type Turn = {
  id: string;
  input: string;
  phase: TurnPhase;
  // slash-command path (unchanged)
  response?: TurnResponse;
  error?: string;
  // chat/streaming path
  cycleId?: string;
  startedAt: number;
  currentStep?: CycleStep;
  steps: CycleStep[];
  findings: Array<Extract<ReplStreamEvent, { event: "finding" }>["data"]>;
  chatText: string;
  summaryText: string;
  provider?: string;
  tookMs?: number;
};
```

- [ ] **Step 8.2: Rewrite `sendTurn` to branch on chat vs slash-command**

Replace the `sendTurn` callback body. Keep the slash-command branch calling `postTurn`; add a streaming branch for free-text:

```ts
const sendTurn = useCallback((input: string) => {
  const trimmed = input.trim();
  if (!trimmed) return;
  const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const startedAt = Date.now();
  const base: Turn = {
    id,
    input: trimmed,
    phase: "classifying",
    startedAt,
    steps: [],
    findings: [],
    chatText: "",
    summaryText: "",
  };
  setTurns((t) => [...t, base]);
  setOpen(true);
  setBusy(true);

  const isCommand =
    trimmed.startsWith("/") ||
    /^\s*(query|telemetry|logs|graph|accept|explain|pc|why|tlm|tail)\b/i.test(
      trimmed,
    );

  if (isCommand) {
    postTurn(trimmed, sessionIdRef.current)
      .then((response) => {
        setTurns((t) =>
          t.map((x) =>
            x.id === id
              ? { ...x, phase: "done", response, tookMs: response.tookMs }
              : x,
          ),
        );
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setTurns((t) =>
          t.map((x) =>
            x.id === id ? { ...x, phase: "error", error: msg } : x,
          ),
        );
      })
      .finally(() => setBusy(false));
    return;
  }

  const patch = (fn: (t: Turn) => Turn): void => {
    setTurns((ts) => ts.map((x) => (x.id === id ? fn(x) : x)));
  };

  postChatStream(trimmed, (evt) => {
    switch (evt.event) {
      case "classified":
        patch((t) => ({
          ...t,
          phase: evt.data.action === "chat" ? "chatting" : "cycle-running",
        }));
        break;
      case "cycle.start":
        patch((t) => ({ ...t, cycleId: evt.data.cycleId }));
        break;
      case "step": {
        const cs: CycleStep = {
          name: evt.data.step,
          phase: evt.data.phase,
          terminal: evt.data.terminal,
          elapsedMs: evt.data.elapsedMs,
        };
        patch((t) => {
          // "start" marks a new in-flight step; "done"/"error" pushes into trail.
          if (cs.phase === "start") return { ...t, currentStep: cs };
          const cleared =
            t.currentStep?.name === cs.name ? undefined : t.currentStep;
          return { ...t, currentStep: cleared, steps: [...t.steps, cs] };
        });
        break;
      }
      case "finding":
        patch((t) => ({ ...t, findings: [...t.findings, evt.data] }));
        break;
      case "chat.complete":
        patch((t) => ({
          ...t,
          chatText: evt.data.text,
          provider: evt.data.provider,
        }));
        break;
      case "summary.complete":
        patch((t) => ({
          ...t,
          summaryText: evt.data.text,
          provider: evt.data.provider,
        }));
        break;
      case "done":
        patch((t) => ({
          ...t,
          phase: "done",
          provider: evt.data.provider,
          tookMs: evt.data.tookMs,
        }));
        break;
      case "error":
        patch((t) => ({ ...t, phase: "error", error: evt.data.message }));
        break;
    }
  })
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      patch((t) => ({ ...t, phase: "error", error: msg }));
    })
    .finally(() => setBusy(false));
}, []);
```

- [ ] **Step 8.3: Rewrite TurnView to use the new state**

Replace `TurnView`:

```tsx
function TurnView({
  turn,
  onFollowUp,
}: {
  turn: Turn;
  onFollowUp: (input: string) => void;
}) {
  const elapsed = Date.now() - turn.startedAt;
  return (
    <div className="mb-3 border-l border-hairline pl-3">
      <div className="mono mb-1 text-caption text-cyan">
        &gt; <span className="text-primary">{turn.input}</span>
      </div>

      {turn.phase === "classifying" && (
        <div className="mono text-caption text-muted">
          <AnimatedStepBadge step="planner" phase="progress" /> classifying…
        </div>
      )}

      {turn.phase === "chatting" && (
        <div className="mono text-caption text-muted">
          <AnimatedStepBadge step="nano.call" phase="progress" /> chat…
        </div>
      )}

      {turn.phase === "cycle-running" && (
        <CycleLoader
          cycleId={turn.cycleId ?? "…"}
          current={turn.currentStep}
          trail={turn.steps}
          elapsedMs={elapsed}
        />
      )}

      {turn.phase === "error" && (
        <div className="mono text-caption text-hot">error: {turn.error}</div>
      )}

      {/* finalised content */}
      {turn.phase === "done" && turn.response && (
        <div className="flex flex-col gap-2">
          {turn.response.results.map((r, i) => (
            <ResultView key={i} result={r} onFollowUp={onFollowUp} />
          ))}
          <div className="mono text-caption text-dim">
            cost=${turn.response.costUsd.toFixed(4)} · {turn.response.tookMs}ms
          </div>
        </div>
      )}

      {turn.phase === "done" && !turn.response && (
        <div className="flex flex-col gap-2">
          {turn.chatText && (
            <div className="border-l-2 border-cyan pl-3">
              <div className="whitespace-pre-wrap text-body text-primary">
                {turn.chatText}
              </div>
              <div className="mt-1 mono text-caption text-dim">
                assistant · {turn.provider}
              </div>
            </div>
          )}
          {turn.findings.length > 0 && (
            <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
              <div className="mono text-caption text-muted">
                findings · {turn.findings.length}
              </div>
              {turn.findings.map((f) => (
                <div
                  key={f.id}
                  className="mono flex items-center gap-2 text-caption"
                >
                  <span className="text-primary">{f.id}</span>
                  <span className="text-muted">{f.title}</span>
                  {f.cortex && <span className="text-dim">[{f.cortex}]</span>}
                </div>
              ))}
            </div>
          )}
          {turn.summaryText && (
            <div className="border-l-2 border-cold pl-3">
              <div className="whitespace-pre-wrap text-body text-primary">
                {turn.summaryText}
              </div>
            </div>
          )}
          {turn.tookMs != null && (
            <div className="mono text-caption text-dim">
              {turn.provider ? `${turn.provider} · ` : ""}
              {turn.tookMs}ms
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 8.4: Typecheck**

Run: `pnpm --filter @interview/console typecheck`
Expected: PASS.

- [ ] **Step 8.5: Manual smoke test**

Run:

```bash
pnpm --filter @interview/console-api dev &   # starts on :4000
pnpm --filter @interview/console dev         # starts on :5173
```

In the browser, open the REPL and type:

1. `hello` → should show `classifying… → chat… → done` with assistant reply.
2. `give me the riskiest conjunctions` → should route to `run_cycle`, show the `CycleLoader` with step trail appearing live, then findings + summary at the end.

Expected: loader visibly updates every ~100-500ms with new step events; no 50s silence.

- [ ] **Step 8.6: Commit**

```bash
git add apps/console/src/components/ReplPanel.tsx
git commit -m "feat(console): live cycle loader in REPL panel via SSE"
```

---

## Task 9: Self-review & integration verification

- [ ] **Step 9.1: Full typecheck across affected workspaces**

```bash
pnpm --filter @interview/shared typecheck
pnpm --filter @interview/console-api typecheck
pnpm --filter @interview/console typecheck
```

Expected: all PASS.

- [ ] **Step 9.2: Full test run for affected workspaces**

```bash
pnpm --filter @interview/shared test
pnpm --filter @interview/console-api test
```

Expected: all PASS.

- [ ] **Step 9.3: Review the diff**

```bash
git log --oneline main..HEAD
git diff main -- packages/shared apps/console-api apps/console
```

Check: no leftover `console.log`, no `TODO`, no accidental renames in unrelated files.

- [ ] **Step 9.4: Final commit (only if self-review requires fixes)**

If no fixes needed, skip. Otherwise:

```bash
git add <files>
git commit -m "chore: address self-review findings"
```

---

## Self-review notes

- The ALS approach depends on `AsyncLocalStorage` propagating through every await/Promise in `ThalamusService.runCycle`. If any code path uses `setImmediate`, `setTimeout`, or worker threads, ALS is preserved across `setImmediate`/`setTimeout` by default in Node ≥14 (they use async_hooks) but **not** across worker threads. Our Thalamus pipeline runs in a single Node process — fine.
- `postChatStream` never calls `abort()`; if the REPL panel is closed mid-cycle the fetch keeps running server-side. Acceptable for demo; add `AbortController` in a follow-up if it becomes visible.
- We deliberately do **not** stream the `summary` content token-by-token — `createLlmTransportWithMode().call()` returns a complete string. Streaming the summariser would require a new transport method and is out of scope here.
- Persistence of cycle state (e.g., resuming a stream after REPL close/reopen) is out of scope. Closing the panel drops the stream.
