# Plan 3 — `packages/cli/` becomes a pure HTTP client

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans.

**Goal:** Finish the HTTP migration the CLI already started ([boot.ts:156-157](../../../packages/cli/src/boot.ts#L156-L157) "CLI doesn't run cycles in-process, it routes via console-api HTTP"). Drop `buildSweepContainer` + `buildThalamusContainer` from CLI; all SSA/thalamus/sweep calls become `fetch` to console-api. Result: CLI is Ink/React TUI + thin HTTP clients, nothing more.

**Assumes:** Plans 1 and 2 are merged (same branch `refactor/sim-agnostic`). `packages/sweep/src/index.ts` no longer re-exports `startTelemetrySwarm` (dropped in Plan 2 Task B.10) so `packages/cli/src/boot.ts:24` is broken — Plan 3 fixes it.

**Reuse map — what console-api already exposes**

| CLI adapter              | Target route                                      | Status                                                                                             |
| ------------------------ | ------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `thalamus.runCycle`      | `POST /api/cycles/start` (or existing equivalent) | **already HTTP** today                                                                             |
| `resolution.accept`      | `POST /api/sweep/suggestions/:id/review`          | **exists** ([sweep.routes.ts:25-30](../../../apps/console-api/src/routes/sweep.routes.ts#L25-L30)) |
| `interpret` (router LLM) | `POST /api/repl/turn`                             | **exists** ([repl.routes.ts:19](../../../apps/console-api/src/routes/repl.routes.ts#L19))          |
| `telemetry.start`        | `POST /api/sim/telemetry/start`                   | **NEW**                                                                                            |
| `pcEstimator.start`      | `POST /api/sim/pc/start`                          | **NEW**                                                                                            |
| `graph.neighbourhood`    | `GET /api/kg/graph/:id`                           | **NEW**                                                                                            |
| `why.build`              | `GET /api/why/:findingId`                         | **NEW**                                                                                            |
| `logs.tail`              | local pino ring buffer                            | stays local (UX concern, not business)                                                             |

**Only 4 new routes.** Plan 3 is smaller than it first looked.

**Branch:** continuation of `refactor/sim-agnostic`. Plan 3 MUST land with Plans 1+2 on the same merge to main (Plan 2 leaves CLI broken; Plan 3 fixes it).

**Risk gates (between every task):**

- Console-api unit + integration suites green
- Console-api server starts cleanly (`pnpm -C apps/console-api dev`)
- After Phase B: `pnpm -C packages/cli start` connects to a running console-api and executes at least one command end-to-end
- CLI arch-guard goes GREEN at the end

---

# Phase A — Add 4 new routes to console-api

## Task A.1 — `POST /api/sim/telemetry/start` + `POST /api/sim/pc/start`

**Files:**

- Create: `apps/console-api/src/controllers/sim.controller.ts`
- Create: `apps/console-api/src/routes/sim.routes.ts`
- Modify: `apps/console-api/src/routes/index.ts` (mount)
- Modify: `apps/console-api/src/container.ts` (expose startTelemetrySwarm / startPcEstimatorSwarm to controllers)
- Test: `apps/console-api/tests/unit/routes/sim.spec.ts`

**Reuse:** both launchers live in `apps/console-api/src/agent/ssa/sim/swarms/{telemetry,pc}.ts` after Plan 2 Task B.10. Controllers are thin wrappers.

```ts
// apps/console-api/src/controllers/sim.controller.ts
import { z } from "zod";
import type { FastifyRequest, FastifyReply } from "fastify";

const telemetryBody = z.object({
  satelliteId: z.number().int().positive(),
  fishCount: z.number().int().positive().max(30).optional(),
});
const pcBody = z.object({
  conjunctionEventId: z.number().int().positive(),
  fishCount: z.number().int().positive().max(30).optional(),
});

export function simTelemetryStartController(deps: {
  startTelemetrySwarm: (opts: {
    satelliteId: number;
    fishCount?: number;
  }) => Promise<{ swarmId: number; firstSimRunId: number }>;
}) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = telemetryBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(422).send({ error: parsed.error.flatten() });
    const result = await deps.startTelemetrySwarm(parsed.data);
    return reply.status(201).send(result);
  };
}

export function simPcStartController(deps: {
  startPcEstimatorSwarm: (opts: {
    conjunctionEventId: number;
    fishCount?: number;
  }) => Promise<{ swarmId: number; firstSimRunId: number }>;
}) {
  return async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = pcBody.safeParse(req.body);
    if (!parsed.success)
      return reply.status(422).send({ error: parsed.error.flatten() });
    const result = await deps.startPcEstimatorSwarm(parsed.data);
    return reply.status(201).send(result);
  };
}
```

```ts
// apps/console-api/src/routes/sim.routes.ts
import type { FastifyInstance } from "fastify";
import { simTelemetryStartController, simPcStartController } from "../controllers/sim.controller";

export function registerSimRoutes(
  app: FastifyInstance,
  deps: {
    startTelemetrySwarm: /* see above */;
    startPcEstimatorSwarm: /* see above */;
  },
): void {
  app.post("/api/sim/telemetry/start", simTelemetryStartController(deps));
  app.post("/api/sim/pc/start", simPcStartController(deps));
}
```

Mount in `routes/index.ts`. The container exposes:

```ts
// apps/console-api/src/container.ts additions
import { startTelemetrySwarm } from "./agent/ssa/sim/swarms/telemetry";
import { startPcEstimatorSwarm } from "./agent/ssa/sim/swarms/pc";

const simHttp = {
  startTelemetrySwarm: (opts) => startTelemetrySwarm({ /* sim deps from sweepC */, ...opts }),
  startPcEstimatorSwarm: (opts) => startPcEstimatorSwarm({ /* sim deps from sweepC */, ...opts }),
};
```

**Note:** `startPcEstimatorSwarm` is stubbed in Plan 2 Task B.10. This task UNSTUBS it — the CLI currently has `packages/cli/src/boot.ts:306-321` carrying the stub note "wire startPcEstimatorSwarm for live runs". Port the stub's intent into a real launcher in `agent/ssa/sim/swarms/pc.ts`: mirror the telemetry launcher pattern with `uc_pc_estimator` kind and `{conjunctionEventId}` → `baseSeed.pcEstimatorTarget`.

- [ ] **A.1.1** Write controllers + route + mount.
- [ ] **A.1.2** Unstub pc swarm launcher in `agent/ssa/sim/swarms/pc.ts`.
- [ ] **A.1.3** Tests: inject `buildApp()` helper, exercise both routes with fixture mode.
- [ ] **A.1.4** Commit: `feat(console-api): POST /api/sim/telemetry/start + /api/sim/pc/start`

## Task A.2 — `GET /api/kg/graph/:id` (neighbourhood)

**Files:**

- Modify: `apps/console-api/src/controllers/kg.controller.ts` (add `kgGraphController`)
- Modify: `apps/console-api/src/routes/kg.routes.ts` (add route)

**Reuse:** `KgViewService` already exists. Extend it with `getNeighbourhood(id: string, depth?: number)` if missing — the method reuses existing research-edge queries through `ResearchEdgeRepository` (console-api already has it).

```ts
// add to kg.controller.ts
const paramsSchema = z.object({ id: z.string() });
const querySchema = z.object({
  depth: z.coerce.number().int().min(1).max(5).default(2),
});

export function kgGraphController(service: KgViewService) {
  return async (req, reply) => {
    const { id } = paramsSchema.parse(req.params);
    const { depth } = querySchema.parse(req.query);
    const graph = await service.getNeighbourhood(id, depth);
    return reply.send(graph); // { nodes: [...], edges: [...] }
  };
}
```

Extend `kg.routes.ts`:

```ts
app.get("/api/kg/graph/:id", kgGraphController(service));
```

Port the body of `packages/cli/src/adapters/graph.ts` (37 lines of inline SQL over `research_edge`) into `KgViewService.getNeighbourhood`.

- [ ] **A.2.1** Extend `KgViewService` with `getNeighbourhood`.
- [ ] **A.2.2** Controller + route.
- [ ] **A.2.3** Unit test.
- [ ] **A.2.4** Commit: `feat(console-api): GET /api/kg/graph/:id neighbourhood query`

## Task A.3 — `GET /api/why/:findingId`

**Files:**

- Create: `apps/console-api/src/controllers/why.controller.ts`
- Create: `apps/console-api/src/routes/why.routes.ts`
- Create: `apps/console-api/src/services/why.service.ts` (if not already subsumed by FindingViewService)
- Modify: `apps/console-api/src/routes/index.ts`

**Reuse check:** `FindingViewService` exists. It likely already does read a finding + its evidence edges. If so, extend it with `buildWhyTrace(findingId)` instead of a new service. Port the body of `packages/cli/src/adapters/why.ts` (73 lines composing finding + edges + source items) into the service.

```ts
// apps/console-api/src/services/finding-view.service.ts — extend
async buildWhyTrace(findingId: string): Promise<WhyTrace> {
  // paste adapters/why.ts body, using:
  // - findingRepository.findById
  // - researchEdgeRepository.listForFinding
  // - sourceRepository.batchById
}

// WhyTrace type:
// {
//   finding: { id, title, summary, confidence, sourceClass },
//   edges: Array<{ sourceId, label, rationale }>,
//   sources: Array<{ id, title, url, publishedAt }>,
// }
```

```ts
// apps/console-api/src/controllers/why.controller.ts
const paramsSchema = z.object({ findingId: z.string() });
export function whyController(service: FindingViewService) {
  return async (req, reply) => {
    const { findingId } = paramsSchema.parse(req.params);
    const trace = await service.buildWhyTrace(findingId);
    return reply.send(trace);
  };
}
```

```ts
// apps/console-api/src/routes/why.routes.ts
export function registerWhyRoutes(
  app: FastifyInstance,
  service: FindingViewService,
): void {
  app.get("/api/why/:findingId", whyController(service));
}
```

- [ ] **A.3.1** Extend FindingViewService.
- [ ] **A.3.2** Controller + route + mount.
- [ ] **A.3.3** Test.
- [ ] **A.3.4** Commit: `feat(console-api): GET /api/why/:findingId`

---

# Phase B — CLI becomes fetch-only

## Task B.1 — `HttpClient` helper

**Files:**

- Create: `packages/cli/src/adapters/http.ts`
- Test: `packages/cli/tests/adapters/http.spec.ts`

```ts
// packages/cli/src/adapters/http.ts
const DEFAULT_BASE = process.env.CONSOLE_API_URL ?? "http://localhost:3001";

export interface HttpClientOpts {
  base?: string;
  signal?: AbortSignal;
}

export class HttpClient {
  constructor(private readonly opts: HttpClientOpts = {}) {}

  private get base() {
    return this.opts.base ?? DEFAULT_BASE;
  }

  async postJson<TReq, TRes>(path: string, body: TReq): Promise<TRes> {
    const res = await fetch(`${this.base}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: this.opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status, `POST ${path} → ${res.status}: ${text}`);
    }
    return (await res.json()) as TRes;
  }

  async getJson<TRes>(path: string): Promise<TRes> {
    const res = await fetch(`${this.base}${path}`, {
      signal: this.opts.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new HttpError(res.status, `GET ${path} → ${res.status}: ${text}`);
    }
    return (await res.json()) as TRes;
  }
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}
```

- [ ] **B.1.1** Create client + error class.
- [ ] **B.1.2** Tests: mock fetch, assert 2xx JSON parse, 4xx throws HttpError with status.
- [ ] **B.1.3** Commit: `feat(cli): HttpClient helper`

## Task B.2 — Rewrite 5 adapters as fetch clients

**Files:**

- Rewrite: `packages/cli/src/adapters/{telemetry,pcEstimator,resolution,graph,why}.ts`
- Untouched: `logs.ts` (local pino), `thalamus.ts` (already HTTP — verify)

### `telemetry.ts`

```ts
import type { HttpClient } from "./http";

export function telemetryAdapter(http: HttpClient) {
  return {
    start: async ({ satId }: { satId: number }) =>
      http.postJson<
        { satelliteId: number },
        { swarmId: number; firstSimRunId: number }
      >("/api/sim/telemetry/start", { satelliteId: satId }),
  };
}
```

### `pcEstimator.ts`

```ts
export function pcEstimatorAdapter(http: HttpClient) {
  return {
    start: async (args: { conjunctionEventId: number }) =>
      http.postJson("/api/sim/pc/start", args),
  };
}
```

### `resolution.ts`

```ts
export function resolutionAdapter(http: HttpClient) {
  return {
    accept: async (args: { suggestionId: string; reason?: string }) =>
      http.postJson(
        `/api/sweep/suggestions/${encodeURIComponent(args.suggestionId)}/review`,
        { accept: true, reason: args.reason },
      ),
    reject: async (args: { suggestionId: string; reason?: string }) =>
      http.postJson(
        `/api/sweep/suggestions/${encodeURIComponent(args.suggestionId)}/review`,
        { accept: false, reason: args.reason },
      ),
  };
}
```

### `graph.ts`

```ts
export function graphAdapter(http: HttpClient) {
  return {
    neighbourhood: async ({ id, depth = 2 }: { id: string; depth?: number }) =>
      http.getJson(`/api/kg/graph/${encodeURIComponent(id)}?depth=${depth}`),
  };
}
```

### `why.ts`

```ts
export function whyAdapter(http: HttpClient) {
  return {
    build: async ({ findingId }: { findingId: string }) =>
      http.getJson(`/api/why/${encodeURIComponent(findingId)}`),
  };
}
```

**Verify `thalamus.ts`** — it's 10 lines today; should already be a fetch. If not, bring it into the same pattern.

**Callers:** `packages/cli/src/router/dispatch.ts` calls `adapters.telemetry.start(...)`, etc. Response shapes must match current renderer expectations. If the HTTP route returns a richer payload than the in-process adapter used to, the renderer handles the extras gracefully OR we trim. Grep each renderer for the shape it reads; adjust adapter response typing if needed.

- [ ] **B.2.1** Rewrite 5 adapters.
- [ ] **B.2.2** Verify each renderer still compiles against the adapter's new return type.
- [ ] **B.2.3** Typecheck `packages/cli`.
- [ ] **B.2.4** Commit: `refactor(cli): adapters become fetch clients (telemetry, pc, resolution, graph, why)`

## Task B.3 — Migrate interpret to `POST /api/repl/turn`

**Files:**

- Modify: `packages/cli/src/router/interpreter.ts`

Current shape: `interpret(input, turns)` calls `nano.call({system, user, temperature, responseFormat})` directly, requiring the nano client wired in boot.ts.

New shape: delegate to the REPL turn endpoint.

```ts
// packages/cli/src/router/interpreter.ts
import type { HttpClient } from "../adapters/http";
import type { RouterPlan } from "./schema";

export async function interpret(
  http: HttpClient,
  input: string,
  turns: readonly unknown[],
  sessionId: string,
): Promise<{ plan: RouterPlan; costUsd: number }> {
  return http.postJson<
    { input: string; sessionId: string; turns?: unknown[] },
    { plan: RouterPlan; costUsd: number }
  >("/api/repl/turn", { input, sessionId, turns: [...turns] });
}
```

**Check console-api's `replTurnController`**: its current signature is `POST /api/repl/turn` with body `{input, sessionId}`. If it doesn't return `{plan, costUsd}`, extend `ReplTurnService` to produce a plan envelope compatible with the CLI's `RouterPlan` schema. That's a 5-10 line addition in the service.

If the REPL turn endpoint is stream-based (current naming suggests so — `replChatStreamController`), add a NEW endpoint `POST /api/repl/interpret` that returns a single JSON response. Plan 3 Task A (alternative): `POST /api/repl/interpret`.

**Decision:** check existing behavior in `replTurnController`. If it's stream-based, add `/api/repl/interpret` as a small new controller that calls the same planner logic synchronously.

- [ ] **B.3.1** Inspect current `/api/repl/turn` contract; add `/api/repl/interpret` if needed.
- [ ] **B.3.2** Rewire interpreter.ts.
- [ ] **B.3.3** App.tsx: pass `sessionId` to `interpret` (already state in App).
- [ ] **B.3.4** Commit: `refactor(cli): router interpret via POST /api/repl/interpret`

## Task B.4 — Slim `boot.ts`

**Files:**

- Rewrite: `packages/cli/src/boot.ts`

Target shape (~80 lines):

```ts
import React from "react";
import { render } from "ink";
import pino from "pino";
import { App } from "./app";
import { EtaStore } from "./util/etaStore";
import { PinoRingBuffer } from "./util/pinoRingBuffer";
import { HttpClient } from "./adapters/http";
import { thalamusAdapter } from "./adapters/thalamus";
import { telemetryAdapter } from "./adapters/telemetry";
import { pcEstimatorAdapter } from "./adapters/pcEstimator";
import { resolutionAdapter } from "./adapters/resolution";
import { graphAdapter } from "./adapters/graph";
import { whyAdapter } from "./adapters/why";
import { logsAdapter } from "./adapters/logs";
import { interpret } from "./router/interpreter";
import { randomUUID } from "node:crypto";

export async function main(): Promise<void> {
  const logBuffer = new PinoRingBuffer(1000);
  pino({ level: "info" }, logBuffer); // local ring buffer only
  const http = new HttpClient();
  const etaStore = new EtaStore();
  const sessionId = randomUUID();

  const adapters = {
    thalamus: thalamusAdapter(http),
    telemetry: telemetryAdapter(http),
    pcEstimator: pcEstimatorAdapter(http),
    resolution: resolutionAdapter(http),
    graph: graphAdapter(http),
    why: whyAdapter(http),
    logs: logsAdapter(logBuffer),
  };

  render(
    React.createElement(App, {
      adapters,
      interpret: (input, turns) => interpret(http, input, turns, sessionId),
      etaEstimate: (k, s) => etaStore.estimate(k, s),
      etaRecord: (k, s, ms) => etaStore.record(k, s, ms),
    }),
  );
}
```

Remove entirely:

- `import { Pool } from "pg"` + pool construction
- `import IORedis from "ioredis"` + redis construction
- `import { drizzle } from "drizzle-orm/node-postgres"` + db construction
- `import { CortexRegistry, buildThalamusContainer, callNanoWithMode } from "@interview/thalamus"`
- `import { buildSweepContainer, startTelemetrySwarm } from "@interview/sweep"`
- `import { researchCycle, researchFinding, researchEdge, sourceItem } from "@interview/db-schema"`
- `buildRealAdapters(ctx)` — entire function body (~250 lines) deleted

Tests that rely on `deps.wiring` injection (if any): they now inject `HttpClient` with a mock base URL or an in-memory fetch mock.

- [ ] **B.4.1** Rewrite boot.ts.
- [ ] **B.4.2** Grep removed symbols — confirm zero residual references inside `packages/cli/src/`.
- [ ] **B.4.3** `cd packages/cli && pnpm exec tsc --noEmit` → expect clean.
- [ ] **B.4.4** Smoke test:
  - Terminal 1: `cd apps/console-api && pnpm dev`
  - Terminal 2: `cd packages/cli && pnpm start`
  - In CLI: run `telemetry start satellite 42` — expect swarm launched, renderer shows status.
- [ ] **B.4.5** Commit: `refactor(cli): boot.ts is pure Ink + HTTP wiring (486 → ~80 lines)`

## Task B.5 — Drop runtime deps from `packages/cli/package.json`

**Files:**

- Modify: `packages/cli/package.json`
- Regenerate: `pnpm-lock.yaml`

Before/after dependencies:

```diff
  "dependencies": {
    "@interview/shared": "workspace:*",
-   "@interview/db-schema": "workspace:*",
-   "@interview/thalamus": "workspace:*",
-   "@interview/sweep": "workspace:*",
    "ink": "^4.4.1",
    "react": "^18.2.0",
    "picocolors": "^1.0.0",
    "zod": "^3.22.0",
    "pino": "^8.17.0",
    "js-tiktoken": "^1.0.10",
-   "pg": "^8.11.0",
-   "ioredis": "^5.3.0",
-   "drizzle-orm": "^0.30.0"
  },
  "devDependencies": {
-   "@types/pg": "^8.11.0",
    "@types/geojson": "^7946.0.16",
    ...
  }
```

- [ ] **B.5.1** Edit package.json.
- [ ] **B.5.2** `pnpm install` regenerates lock.
- [ ] **B.5.3** `pnpm -r typecheck && pnpm -r test`.
- [ ] **B.5.4** Commit: `chore(cli): drop runtime deps (@interview/sweep, thalamus, db-schema, drizzle, pg, ioredis)`

---

# Phase C — Arch-guards green + CHANGELOG

## Task C.1 — CLI arch-guard green

**Files:**

- Modify: `packages/cli/tests/arch-guard.spec.ts` (written in Plan 2 Task A.2 as placeholder)

Activate the spec:

```ts
describe("packages/cli/ is a pure HTTP client", () => {
  it("does not import @interview/sweep, @interview/thalamus, or @interview/db-schema", async () => {
    /* … */
  });
  it("does not import pg, ioredis, or drizzle-orm", async () => {
    /* … */
  });
  it("contains no raw SQL", async () => {
    const files = await walk(SRC);
    const violations: string[] = [];
    const re = /\bsql`|drizzle|execute\s*\(|\bFROM\s+\w+/i;
    for (const f of files) {
      if (re.test(await readFile(f, "utf8"))) violations.push(f);
    }
    expect(violations).toEqual([]);
  });
});
```

- [ ] **C.1.1** Run: `cd packages/cli && pnpm exec vitest run tests/arch-guard.spec.ts`. Expect GREEN.
- [ ] **C.1.2** Commit (if fixes needed): `test(cli): arch-guard green`

## Task C.2 — CHANGELOG + TODO

```md
### Refactor — CLI → HTTP client (Plan 3)

- `packages/cli/` is now a pure Ink/React TUI + HTTP client. `boot.ts` shrank
  from 486 → ~80 lines. Runtime dependencies dropped: @interview/sweep,
  @interview/thalamus, @interview/db-schema, drizzle-orm, pg, ioredis,
  @types/pg.
- 4 new console-api routes: POST /api/sim/telemetry/start, POST /api/sim/pc/start,
  GET /api/kg/graph/:id, GET /api/why/:findingId. Existing routes reused:
  POST /api/sweep/suggestions/:id/review, POST /api/repl/interpret.
- `startPcEstimatorSwarm` unstubbed (Plan 2 relocated it to
  apps/console-api/src/agent/ssa/sim/swarms/pc.ts; Plan 3 implements the body).
- CLI arch-guard (`packages/cli/tests/arch-guard.spec.ts`) prevents regression.
- Combined effect of Plans 1+2+3: kernel/app/presentation layering complete.
  packages/sweep/ is a generic sweep+sim engine. apps/console-api/ owns all
  SSA domain logic + HTTP surface. packages/cli/ owns UI + router.
```

- [ ] **C.2.1** Write CHANGELOG + tick TODO.
- [ ] **C.2.2** Commit: `docs: record Plan 3 (CLI → HTTP) + overall refactor completion`

---

# Integration test — the whole stack

## Task D.1 — End-to-end smoke after all three plans

- [ ] **D.1.1** Start console-api: `cd apps/console-api && pnpm dev`
- [ ] **D.1.2** Start CLI: `cd packages/cli && pnpm start`
- [ ] **D.1.3** Run 5 commands, verify outputs:
  - `thalamus cycle "satellite X"` → runCycle HTTP → findings render
  - `telemetry start 42` → /api/sim/telemetry/start → swarmId in renderer
  - `graph 1234` → /api/kg/graph/1234 → tree render
  - `why 5678` → /api/why/5678 → evidence tree
  - `accept 91011` → /api/sweep/suggestions/91011/review → success toast

If any flow fails at the HTTP layer, the CLI's `HttpError` surfaces status + body text — easier to debug than in-process stack traces.

- [ ] **D.1.4** Final commit if any route adjustment: `fix: end-to-end smoke adjustments`

---

# Merge strategy

Plans 1, 2, 3 land on the same branch `refactor/sim-agnostic`. The branch is merged to main only when all three are complete — intermediate commits leave CLI broken during Plan 2 and recover during Plan 3. Reviewers read the whole branch history in order, but only one merge to main.

Before merge:

- Arch-guards all green: sweep-package, sim, cli
- Full test suite: `pnpm -r typecheck && pnpm -r test`
- Manual smoke per Task D.1
- Rebase onto latest main, resolve any conflicts on per-file basis (most conflicts expected in `packages/sweep/src/index.ts` + `apps/console-api/src/container.ts`)

---

# Self-review

- [x] Reuse-first: only 4 NEW routes; 2 existing routes reused (sweep review, repl turn).
- [x] Interpreter reuse: leverages existing `ReplTurnService` — no new planner service.
- [x] Graph/Why reuse existing FindingViewService + KgViewService (extended with one method each).
- [x] Sim launchers reuse Plan 2's relocated files.
- [x] CLI arch-guard written in Plan 2 (as skip), activated here.
- [x] Risk gates: typecheck + smoke test + arch-guards.
- [x] Branch merge strategy accounts for CLI being broken between Plans 2 and 3.
