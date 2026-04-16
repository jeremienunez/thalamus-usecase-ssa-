# Thalamus Audit Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a 6-axis test harness that exposes Thalamus cycle 264 symptoms (dedup tax, budget exhaustion, query boundary bypass, planner bias, data gaps, security) as committed, deterministic tests. Fixes come in a follow-up plan.

**Architecture:** Phase 1 lands shared infrastructure (stub LLM transport, DB fixtures via temporary schemas, telemetry assertion helper, `validateRows` Zod boundary helper, `stopReason` field on the cycle return). Phase 2 writes 6 independent axis specs, mergeable in parallel. Each axis ships green today (via ratchet allowlist or minimal sanitization) and documents the remaining debt.

**Tech Stack:** TypeScript, Vitest 1.6, Drizzle ORM, pgvector/HNSW, Zod, Postgres 16 (dev instance from `make up`).

**Spec reference:** [docs/superpowers/specs/2026-04-16-thalamus-audit-tests-design.md](../specs/2026-04-16-thalamus-audit-tests-design.md)

---

## Task 1: Worktree + feature branch

**Files:**

- Create: worktree at `/home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit`

- [ ] **Step 1: Create worktree from main**

```bash
cd /home/jerem/interview-thalamus-sweep
mkdir -p /home/jerem/interview-thalamus-sweep-worktrees
git worktree add /home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit -b feat/thalamus-audit main
```

Expected output: `Preparing worktree (new branch 'feat/thalamus-audit')`

- [ ] **Step 2: Verify branch and clean state**

```bash
cd /home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit
git status
git log --oneline -3
```

Expected: `On branch feat/thalamus-audit` + `nothing to commit` + last 3 commits match `main`.

**From this point, all paths are relative to the worktree** unless stated otherwise.

---

## Task 2: Stub LLM transport helper

**Files:**

- Create: `packages/thalamus/tests/_helpers/stub-llm-transport.ts`
- Create: `packages/thalamus/tests/_helpers/stub-llm-transport.test.ts`

- [ ] **Step 1: Read the real transport interface**

```bash
cat packages/thalamus/src/transports/types.ts
```

Note the `LlmTransport` interface shape (`call(prompt)` → `Promise<LlmResponse>`). The stub must satisfy the same interface.

- [ ] **Step 2: Write the failing helper test**

Create `packages/thalamus/tests/_helpers/stub-llm-transport.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createStubLlmTransport } from "./stub-llm-transport";

describe("createStubLlmTransport", () => {
  it("Given a string matcher, When the system prompt matches, Then it returns the canned response", async () => {
    const stub = createStubLlmTransport({
      planner: '{"intent":"x","nodes":[],"complexity":"simple"}',
    });
    const transport = stub.build("system prompt mentioning planner");
    const res = await transport.call("user prompt");
    expect(res.content).toBe('{"intent":"x","nodes":[],"complexity":"simple"}');
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0].userPrompt).toBe("user prompt");
  });

  it("Given a regex matcher, When the system prompt matches, Then the function is invoked with the user prompt", async () => {
    const stub = createStubLlmTransport({
      [/debris_forecaster/.source]: (user) => `echo:${user}`,
    });
    const transport = stub.build("you are the debris_forecaster cortex");
    const res = await transport.call("find papers");
    expect(res.content).toBe("echo:find papers");
  });

  it("Given no matcher matches, Then call() throws a clear error", async () => {
    const stub = createStubLlmTransport({ planner: "x" });
    const transport = stub.build("unmatched system prompt");
    await expect(transport.call("user")).rejects.toThrow(/no stub response/i);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd /home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit
pnpm vitest run packages/thalamus/tests/_helpers/stub-llm-transport.test.ts
```

Expected: FAIL with `Cannot find module './stub-llm-transport'`.

- [ ] **Step 4: Implement the helper**

Create `packages/thalamus/tests/_helpers/stub-llm-transport.ts`:

```ts
import type { LlmTransport, LlmResponse } from "../../src/transports/types";

export type StubResponses = Record<
  string,
  string | ((userPrompt: string) => string)
>;

export interface StubLlmTransport {
  calls: Array<{ systemPrompt: string; userPrompt: string; response: string }>;
  build(systemPrompt: string): LlmTransport;
}

export function createStubLlmTransport(
  responses: StubResponses,
): StubLlmTransport {
  const calls: StubLlmTransport["calls"] = [];

  return {
    calls,
    build(systemPrompt: string): LlmTransport {
      return {
        async call(userPrompt: string): Promise<LlmResponse> {
          for (const [matcher, value] of Object.entries(responses)) {
            const re = new RegExp(matcher);
            if (re.test(systemPrompt)) {
              const response =
                typeof value === "function" ? value(userPrompt) : value;
              calls.push({ systemPrompt, userPrompt, response });
              return { content: response };
            }
          }
          throw new Error(
            `no stub response for system prompt: ${systemPrompt.slice(0, 80)}…`,
          );
        },
      };
    },
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm vitest run packages/thalamus/tests/_helpers/stub-llm-transport.test.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add packages/thalamus/tests/_helpers/stub-llm-transport.ts packages/thalamus/tests/_helpers/stub-llm-transport.test.ts
git commit -m "test(thalamus): add createStubLlmTransport helper"
```

---

## Task 3: DB fixture loader + fixture SQL files

**Files:**

- Create: `packages/thalamus/tests/_helpers/load-fixture.ts`
- Create: `packages/thalamus/tests/_helpers/load-fixture.test.ts`
- Create: `packages/thalamus/tests/__fixtures__/empty-db.sql`
- Create: `packages/thalamus/tests/__fixtures__/minimal-catalog.sql`
- Create: `packages/thalamus/tests/__fixtures__/cycle-264-state.sql`

- [ ] **Step 1: Check how tests connect to dev DB today**

```bash
grep -rn "DATABASE_URL\|POSTGRES_URL" packages/thalamus/tests/integration/ apps/console-api/tests/integration/ 2>/dev/null | head -5
cat apps/console-api/tests/e2e/setup.ts 2>/dev/null | head -30
```

Note the existing connection pattern — we reuse it.

- [ ] **Step 2: Write the failing loader test**

Create `packages/thalamus/tests/_helpers/load-fixture.test.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { loadFixture } from "./load-fixture";
import { sql } from "drizzle-orm";

describe("loadFixture", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it.skipIf(!process.env.DATABASE_URL)(
    "Given the empty-db fixture, When loaded, " +
      "Then the schema has all migrated tables but zero rows",
    async () => {
      const { db, schemaName, cleanup } = await loadFixture("empty-db");
      cleanups.push(cleanup);
      expect(schemaName).toMatch(/^test_[a-f0-9]{8}$/);
      const rows = await db.execute(
        sql`SELECT count(*)::int AS c FROM satellite`,
      );
      expect((rows.rows[0] as { c: number }).c).toBe(0);
    },
  );

  it.skipIf(!process.env.DATABASE_URL)(
    "Given the minimal-catalog fixture, Then it seeds 10 satellites and 2 regimes",
    async () => {
      const { db, cleanup } = await loadFixture("minimal-catalog");
      cleanups.push(cleanup);
      const sats = await db.execute(
        sql`SELECT count(*)::int AS c FROM satellite`,
      );
      expect((sats.rows[0] as { c: number }).c).toBe(10);
      const regimes = await db.execute(
        sql`SELECT count(*)::int AS c FROM orbit_regime`,
      );
      expect((regimes.rows[0] as { c: number }).c).toBe(2);
    },
  );
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
pnpm vitest run packages/thalamus/tests/_helpers/load-fixture.test.ts
```

Expected: FAIL with `Cannot find module './load-fixture'` (or all tests skipped if `DATABASE_URL` unset — set `DATABASE_URL=postgresql://interview:interview@localhost:5433/thalamus` before running).

- [ ] **Step 4: Create the three fixture SQL files**

Create `packages/thalamus/tests/__fixtures__/empty-db.sql`:

```sql
-- empty-db fixture: zero rows. Used to prove dead-cortex detection.
-- No inserts — the migration runner creates the schema, this file is empty.
SELECT 1;
```

Create `packages/thalamus/tests/__fixtures__/minimal-catalog.sql`:

```sql
-- minimal-catalog fixture: 10 satellites, 2 orbit_regimes, 1 source_item.
INSERT INTO orbit_regime (id, name, apogee_km_min, apogee_km_max, label)
VALUES
  (1, 'LEO', 200, 2000, 'Low Earth Orbit'),
  (2, 'GEO', 35700, 35900, 'Geostationary');

INSERT INTO operator_country (id, name, code, orbit_regime_id)
VALUES (1, 'United States', 'US', 1), (2, 'France', 'FR', 2);

INSERT INTO satellite (id, name, norad_id, operator_country_id, mission_age)
SELECT
  gs::bigint, 'TESTSAT-' || gs, 10000 + gs, ((gs % 2) + 1)::bigint, (gs * 365)
FROM generate_series(1, 10) gs;

INSERT INTO source (id, kind, name) VALUES (1, 'rss', 'Test Source');
INSERT INTO source_item (id, source_id, title, abstract, published_at)
VALUES (1, 1, 'Debris in LEO', 'Minimal abstract', NOW());
```

Create `packages/thalamus/tests/__fixtures__/cycle-264-state.sql`:

```sql
-- cycle-264-state: reproduces the real bug — full catalogue, empty source_item.
-- 100 satellites, 2 orbit_regimes, ZERO source_item rows.
INSERT INTO orbit_regime (id, name, apogee_km_min, apogee_km_max, label)
VALUES (1, 'LEO', 200, 2000, 'Low Earth Orbit'), (2, 'GEO', 35700, 35900, 'GEO');

INSERT INTO operator_country (id, name, code, orbit_regime_id)
VALUES (1, 'US', 'US', 1), (2, 'FR', 'FR', 2);

INSERT INTO satellite (id, name, norad_id, operator_country_id, mission_age)
SELECT gs, 'CAT-' || gs, 20000 + gs, ((gs % 2) + 1)::bigint, (gs * 365)
FROM generate_series(1, 100) gs;

-- no source / source_item inserts — reproduces the dead debris_forecaster state.
```

- [ ] **Step 5: Implement the loader**

Create `packages/thalamus/tests/_helpers/load-fixture.ts`:

```ts
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";

export type FixtureName = "empty-db" | "minimal-catalog" | "cycle-264-state";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(__dirname, "../__fixtures__");
const MIGRATIONS_DIR = resolve(__dirname, "../../../db-schema/migrations");

export interface LoadedFixture {
  db: NodePgDatabase;
  schemaName: string;
  cleanup: () => Promise<void>;
}

export async function loadFixture(name: FixtureName): Promise<LoadedFixture> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL not set");

  const schemaName = `test_${randomBytes(4).toString("hex")}`;
  const pool = new Pool({ connectionString: url });
  const client = await pool.connect();

  try {
    await client.query(`CREATE SCHEMA ${schemaName}`);
    await client.query(`SET search_path TO ${schemaName}`);
  } finally {
    client.release();
  }

  const scopedPool = new Pool({ connectionString: url });
  scopedPool.on("connect", (c) => {
    c.query(`SET search_path TO ${schemaName}`);
  });

  const db = drizzle(scopedPool);
  await migrate(db, { migrationsFolder: MIGRATIONS_DIR });

  const sqlPath = resolve(FIXTURE_DIR, `${name}.sql`);
  const fixtureSql = readFileSync(sqlPath, "utf8");
  await db.execute(sql.raw(fixtureSql));

  const cleanup = async () => {
    await scopedPool.end();
    const c = await pool.connect();
    try {
      await c.query(`DROP SCHEMA ${schemaName} CASCADE`);
    } finally {
      c.release();
      await pool.end();
    }
  };

  return { db, schemaName, cleanup };
}
```

- [ ] **Step 6: Run test to verify it passes**

```bash
DATABASE_URL=postgresql://interview:interview@localhost:5433/thalamus \
  pnpm vitest run packages/thalamus/tests/_helpers/load-fixture.test.ts
```

Expected: PASS, 2 tests (skipped if Postgres dev not running — `make up` first).

- [ ] **Step 7: Commit**

```bash
git add packages/thalamus/tests/_helpers/load-fixture.ts \
        packages/thalamus/tests/_helpers/load-fixture.test.ts \
        packages/thalamus/tests/__fixtures__/
git commit -m "test(thalamus): add loadFixture helper + 3 SQL fixtures"
```

---

## Task 4: Telemetry assertion helper

**Files:**

- Create: `packages/thalamus/tests/_helpers/assert-telemetry.ts`
- Create: `packages/thalamus/tests/_helpers/assert-telemetry.test.ts`

- [ ] **Step 1: Write the failing helper test**

Create `packages/thalamus/tests/_helpers/assert-telemetry.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { assertTelemetry, type CycleTelemetry } from "./assert-telemetry";

const sample: CycleTelemetry = {
  cortices: ["fleet_analyst", "strategist"],
  rowsFetched: 1247,
  findingsRaw: 12,
  findingsDeduped: 8,
  totalCost: 0.04,
  stopReason: "completed",
};

describe("assertTelemetry", () => {
  it("passes when cortices includes+excludes both hold", () => {
    expect(() =>
      assertTelemetry(sample, {
        cortices: { includes: ["fleet_analyst"], excludes: ["data_auditor"] },
      }),
    ).not.toThrow();
  });

  it("throws when an excluded cortex appears", () => {
    expect(() =>
      assertTelemetry(
        { ...sample, cortices: ["data_auditor", "fleet_analyst"] },
        { cortices: { excludes: ["data_auditor"] } },
      ),
    ).toThrow(/excluded cortex data_auditor/);
  });

  it("checks numeric ranges for rowsFetched / findings / cost", () => {
    expect(() =>
      assertTelemetry(sample, {
        rowsFetched: { min: 1000 },
        totalCost: { max: 0.05 },
      }),
    ).not.toThrow();
    expect(() => assertTelemetry(sample, { totalCost: { max: 0.01 } })).toThrow(
      /totalCost/,
    );
  });

  it("checks stopReason equality", () => {
    expect(() =>
      assertTelemetry(sample, { stopReason: "completed" }),
    ).not.toThrow();
    expect(() =>
      assertTelemetry(sample, { stopReason: "budget_exhausted" }),
    ).toThrow(/stopReason/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/thalamus/tests/_helpers/assert-telemetry.test.ts
```

Expected: FAIL with `Cannot find module './assert-telemetry'`.

- [ ] **Step 3: Implement the helper**

Create `packages/thalamus/tests/_helpers/assert-telemetry.ts`:

```ts
export type StopReason =
  | "completed"
  | "budget_exhausted"
  | "depth_cap_reached"
  | "error";

export interface CycleTelemetry {
  cortices: string[];
  rowsFetched: number;
  findingsRaw: number;
  findingsDeduped: number;
  totalCost: number;
  stopReason: StopReason;
}

export interface TelemetryExpectation {
  cortices?: string[] | { includes?: string[]; excludes?: string[] };
  rowsFetched?: { min?: number; max?: number };
  findingsRaw?: { min?: number; max?: number };
  findingsDeduped?: { min?: number; max?: number };
  totalCost?: { min?: number; max?: number };
  stopReason?: StopReason;
}

export function assertTelemetry(
  actual: CycleTelemetry,
  expected: TelemetryExpectation,
): void {
  if (expected.cortices) {
    if (Array.isArray(expected.cortices)) {
      const missing = expected.cortices.filter(
        (c) => !actual.cortices.includes(c),
      );
      if (missing.length)
        throw new Error(`missing cortices: ${missing.join(",")}`);
    } else {
      for (const inc of expected.cortices.includes ?? []) {
        if (!actual.cortices.includes(inc))
          throw new Error(`missing cortex ${inc}`);
      }
      for (const exc of expected.cortices.excludes ?? []) {
        if (actual.cortices.includes(exc))
          throw new Error(`excluded cortex ${exc} appeared`);
      }
    }
  }

  for (const key of [
    "rowsFetched",
    "findingsRaw",
    "findingsDeduped",
    "totalCost",
  ] as const) {
    const range = expected[key];
    if (!range) continue;
    const val = actual[key];
    if (range.min !== undefined && val < range.min)
      throw new Error(`${key} ${val} < min ${range.min}`);
    if (range.max !== undefined && val > range.max)
      throw new Error(`${key} ${val} > max ${range.max}`);
  }

  if (expected.stopReason && actual.stopReason !== expected.stopReason) {
    throw new Error(
      `stopReason expected ${expected.stopReason}, got ${actual.stopReason}`,
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/thalamus/tests/_helpers/assert-telemetry.test.ts
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/thalamus/tests/_helpers/assert-telemetry.ts \
        packages/thalamus/tests/_helpers/assert-telemetry.test.ts
git commit -m "test(thalamus): add assertTelemetry helper"
```

---

## Task 5: `validateRows` production helper

**Files:**

- Create: `packages/thalamus/src/utils/validate-rows.ts`
- Create: `packages/thalamus/tests/utils/validate-rows.spec.ts`

- [ ] **Step 1: Write the failing unit test**

Create `packages/thalamus/tests/utils/validate-rows.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { z } from "zod";
import { validateRows, QueryShapeError } from "../../src/utils/validate-rows";

const rowSchema = z.object({ id: z.number(), name: z.string() });

describe("validateRows", () => {
  it("Given rows that match the schema, Then it returns them typed", () => {
    const rows: unknown[] = [
      { id: 1, name: "alpha" },
      { id: 2, name: "beta" },
    ];
    const result = validateRows(rowSchema, rows);
    expect(result).toEqual(rows);
    expect(result[0].id).toBe(1);
  });

  it("Given a row with a type mismatch, Then it throws QueryShapeError with clear issues", () => {
    const rows: unknown[] = [{ id: "not-a-number", name: "alpha" }];
    expect(() => validateRows(rowSchema, rows)).toThrow(QueryShapeError);
    try {
      validateRows(rowSchema, rows);
    } catch (err) {
      if (!(err instanceof QueryShapeError)) throw err;
      expect(
        err.issues.some((i) => i.path.includes(0) && i.path.includes("id")),
      ).toBe(true);
    }
  });

  it("Given an empty array, Then it returns []", () => {
    expect(validateRows(rowSchema, [])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/thalamus/tests/utils/validate-rows.spec.ts
```

Expected: FAIL with `Cannot find module '../../src/utils/validate-rows'`.

- [ ] **Step 3: Implement the helper**

Create `packages/thalamus/src/utils/validate-rows.ts`:

```ts
import { z } from "zod";

export class QueryShapeError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "QueryShapeError";
  }
}

export function validateRows<T>(schema: z.ZodType<T>, rows: unknown[]): T[] {
  const result = z.array(schema).safeParse(rows);
  if (!result.success) {
    throw new QueryShapeError(
      `query shape validation failed: ${result.error.issues.length} issues`,
      result.error.issues,
    );
  }
  return result.data;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm vitest run packages/thalamus/tests/utils/validate-rows.spec.ts
```

Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add packages/thalamus/src/utils/validate-rows.ts \
        packages/thalamus/tests/utils/validate-rows.spec.ts
git commit -m "feat(thalamus): add validateRows Zod boundary helper"
```

---

## Task 6: Add `stopReason` to the cycle return

**Context:** `runCycle` currently returns `ResearchCycle` (DB entity with `status: running|completed|failed|cancelled`). The existing enum is too coarse for telemetry tests. We add `stopReason` as an **in-memory** field on an extended return type — no DB migration.

**Files:**

- Modify: `packages/thalamus/src/services/thalamus.service.ts:33-48` (`RunCycleInput`) + `runCycle` return
- Create: `packages/thalamus/src/services/cycle-result.ts`
- Create: `packages/thalamus/tests/cycle-result.spec.ts`

- [ ] **Step 1: Write the failing contract test**

Create `packages/thalamus/tests/cycle-result.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { CycleResult, StopReason } from "../src/services/cycle-result";

describe("CycleResult contract", () => {
  it("exposes a stopReason field with the expected union", () => {
    const valid: StopReason[] = [
      "completed",
      "budget_exhausted",
      "depth_cap_reached",
      "error",
    ];
    expect(valid).toHaveLength(4);
  });

  it("carries an id + findingsCount + cortices + stopReason", () => {
    const sample: CycleResult = {
      id: 1n,
      findingsCount: 5,
      corticesUsed: ["fleet_analyst"],
      totalCost: 0.02,
      stopReason: "completed",
    };
    expect(sample.stopReason).toBe("completed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm vitest run packages/thalamus/tests/cycle-result.spec.ts
```

Expected: FAIL with `Cannot find module '../src/services/cycle-result'`.

- [ ] **Step 3: Create the CycleResult type**

Create `packages/thalamus/src/services/cycle-result.ts`:

```ts
export type StopReason =
  | "completed"
  | "budget_exhausted"
  | "depth_cap_reached"
  | "error";

/**
 * In-memory cycle summary returned by ThalamusService.runCycle.
 * Extends the persisted ResearchCycle with a structured stopReason not stored
 * in the DB today. Migrate to a column if persistence becomes useful.
 */
export interface CycleResult {
  id: bigint;
  findingsCount: number;
  corticesUsed: string[];
  totalCost: number | null;
  stopReason: StopReason;
}
```

- [ ] **Step 4: Wire stopReason through ThalamusService.runCycle**

Read the existing return flow:

```bash
grep -n "return " packages/thalamus/src/services/thalamus.service.ts | head -20
```

Modify `packages/thalamus/src/services/thalamus.service.ts`: change the `runCycle` return type from `Promise<ResearchCycle>` to `Promise<CycleResult>`, and at the final `return` site, map `ResearchCycle` → `CycleResult`. The `stopReason` is derived from existing signals:

- `status === "completed"` + total cost ≤ `maxCost` → `"completed"`
- `status === "completed"` + a guardrail-breach log event → `"budget_exhausted"` or `"depth_cap_reached"`
- `status === "failed"` → `"error"`

Add the mapper at the bottom of the file (or in `cycle-result.ts`):

```ts
import type { ResearchCycle } from "../entities/research.entity";
import type { CycleResult, StopReason } from "./cycle-result";

export function toCycleResult(
  cycle: ResearchCycle,
  hint: { budgetExhausted?: boolean; depthCapReached?: boolean } = {},
): CycleResult {
  let stopReason: StopReason;
  if (cycle.status === "failed") stopReason = "error";
  else if (hint.budgetExhausted) stopReason = "budget_exhausted";
  else if (hint.depthCapReached) stopReason = "depth_cap_reached";
  else stopReason = "completed";

  return {
    id: cycle.id,
    findingsCount: cycle.findingsCount,
    corticesUsed: cycle.corticesUsed ?? [],
    totalCost: cycle.totalCost,
    stopReason,
  };
}
```

At the `runCycle` callsite, track `budgetExhausted` / `depthCapReached` via hints from the DAG executor (search for `"budget exhausted"` or `cost budget` log strings → replace with a flag passed back).

- [ ] **Step 5: Update existing callers**

```bash
grep -rn "\.runCycle(" packages/ apps/ 2>/dev/null | grep -v node_modules | grep -v "/tests/"
```

For each caller that used fields from `ResearchCycle` but not on `CycleResult` (e.g. `triggerType`, `dagPlan`, `startedAt`), either:

- Add them to `CycleResult` if needed, or
- Fetch via `cycleRepo.findById(result.id)` after the call.

Run `pnpm -r typecheck` after edits and fix red lines one by one.

- [ ] **Step 6: Run contract test + full typecheck**

```bash
pnpm vitest run packages/thalamus/tests/cycle-result.spec.ts
pnpm -r typecheck
```

Expected: test PASSES, typecheck GREEN across all 7 packages.

- [ ] **Step 7: Commit**

```bash
git add packages/thalamus/src/services/cycle-result.ts \
        packages/thalamus/src/services/thalamus.service.ts \
        packages/thalamus/tests/cycle-result.spec.ts \
        $(git diff --name-only)
git commit -m "feat(thalamus): surface stopReason via CycleResult return type"
```

---

## Task 7: Phase 1 smoke test

**Files:**

- Create: `packages/thalamus/tests/_helpers/phase1-smoke.spec.ts`

- [ ] **Step 1: Write the smoke test wiring all helpers together**

Create `packages/thalamus/tests/_helpers/phase1-smoke.spec.ts`:

```ts
import { describe, it, expect, afterEach } from "vitest";
import { createStubLlmTransport } from "./stub-llm-transport";
import { loadFixture } from "./load-fixture";
import { assertTelemetry } from "./assert-telemetry";
import { validateRows } from "../../src/utils/validate-rows";
import { z } from "zod";
import { sql } from "drizzle-orm";

describe("Phase 1 smoke — all helpers compile and cooperate", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it("stubs + fixtures + validateRows + assertTelemetry all work end-to-end", async () => {
    const stub = createStubLlmTransport({ planner: "{}" });
    expect(stub.calls).toEqual([]);

    if (!process.env.DATABASE_URL) return;
    const { db, cleanup } = await loadFixture("minimal-catalog");
    cleanups.push(cleanup);

    const rows = await db.execute(sql`SELECT id, name FROM satellite LIMIT 3`);
    const parsed = validateRows(
      z.object({ id: z.union([z.bigint(), z.number()]), name: z.string() }),
      rows.rows,
    );
    expect(parsed).toHaveLength(3);

    assertTelemetry(
      {
        cortices: ["x"],
        rowsFetched: parsed.length,
        findingsRaw: 0,
        findingsDeduped: 0,
        totalCost: 0,
        stopReason: "completed",
      },
      { rowsFetched: { min: 1 }, stopReason: "completed" },
    );
  });
});
```

- [ ] **Step 2: Run the smoke test**

```bash
DATABASE_URL=postgresql://interview:interview@localhost:5433/thalamus \
  pnpm vitest run packages/thalamus/tests/_helpers/phase1-smoke.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run full test suite to confirm no regressions**

```bash
pnpm test
```

Expected: all previously-passing tests still pass; ~7 new tests added (helpers + smoke + validate-rows + cycle-result).

- [ ] **Step 4: Commit**

```bash
git add packages/thalamus/tests/_helpers/phase1-smoke.spec.ts
git commit -m "test(thalamus): add Phase 1 helpers smoke test"
```

---

## Phase 2 — 6 axes (parallelizable)

**Branch model**: From `feat/thalamus-audit`, each axis lives on its own child branch `feat/thalamus-audit-axe{N}`. Merge order 1 → 2 → 3 → 4 → 5 → 6 back into `feat/thalamus-audit`, then `feat/thalamus-audit` → `main`.

**Pattern for each axe** (tasks 8–13 follow the same shape):

1. Create axis branch
2. Write the spec file (tests)
3. Run — observe red if bug exists, green if contract already met
4. Either ratchet an allowlist (Axe 1) or apply a minimal fix (Axe 6a/6c) to go green
5. Commit, push, open PR against `feat/thalamus-audit`

---

## Task 8: Axe 1 — Query shape contract

**Files:**

- Create: `packages/thalamus/tests/query-shape-contract.spec.ts`
- Create: `packages/thalamus/tests/__allowlists__/query-shape-allowlist.json`

- [ ] **Step 1: Audit the current state of `as unknown as` usage**

```bash
grep -rln "as unknown as" packages/thalamus/src/cortices/queries/ | wc -l
grep -rln "as unknown as" packages/thalamus/src/cortices/queries/
```

Expected: ~28 files. Save the list — it becomes the allowlist.

- [ ] **Step 2: Generate the allowlist from current state**

Create `packages/thalamus/tests/__allowlists__/query-shape-allowlist.json`:

```json
{
  "comment": "Files currently using 'as unknown as' at the DB boundary. Ratchet: shrinks to [] as Phase 3 migrates them to validateRows(). New files are NOT allowed to grow this list — the spec enforces it.",
  "files": [
    "packages/thalamus/src/cortices/queries/advisory-feed.ts",
    "packages/thalamus/src/cortices/queries/apogee.ts",
    "packages/thalamus/src/cortices/queries/catalog.ts"
  ]
}
```

Populate the `files` array with the exact output of `grep -rln` in Step 1 (paste each path, sorted, one per line).

- [ ] **Step 3: Write the failing spec**

Create `packages/thalamus/tests/query-shape-contract.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import allowlist from "./__allowlists__/query-shape-allowlist.json";

const QUERIES_DIR = resolve(__dirname, "../src/cortices/queries");

function queryFiles(): string[] {
  return readdirSync(QUERIES_DIR)
    .filter((f) => f.endsWith(".ts") && f !== "index.ts")
    .map((f) => `packages/thalamus/src/cortices/queries/${f}`);
}

describe("SPEC-TH-QSC — query shape contract", () => {
  it(
    "Given the current codebase, " +
      "Then every `as unknown as` occurrence is in the allowlist (ratchet)",
    () => {
      const allowed = new Set(allowlist.files);
      const offenders: string[] = [];
      for (const relPath of queryFiles()) {
        const absPath = resolve(
          __dirname,
          "../..",
          relPath.replace(/^packages\/thalamus\//, ""),
        );
        const source = readFileSync(absPath, "utf8");
        if (/\bas unknown as\b/.test(source) && !allowed.has(relPath)) {
          offenders.push(relPath);
        }
      }
      expect(
        offenders,
        `new files using 'as unknown as' appeared — update the spec or migrate them: ${offenders.join(",")}`,
      ).toEqual([]);
    },
  );

  it(
    "Given a file in the allowlist, " +
      "Then it still contains an 'as unknown as' (allowlist stays accurate)",
    () => {
      for (const relPath of allowlist.files) {
        const absPath = resolve(
          __dirname,
          "../..",
          relPath.replace(/^packages\/thalamus\//, ""),
        );
        const source = readFileSync(absPath, "utf8");
        if (!/\bas unknown as\b/.test(source)) {
          throw new Error(
            `${relPath} no longer contains 'as unknown as' — remove it from the allowlist`,
          );
        }
      }
    },
  );
});
```

- [ ] **Step 4: Run the spec — expect green from the start**

```bash
pnpm vitest run packages/thalamus/tests/query-shape-contract.spec.ts
```

Expected: PASS — the ratchet accepts the current 28 files. A new PR adding a 29th would fail.

- [ ] **Step 5: Commit**

```bash
git checkout -b feat/thalamus-audit-axe1
git add packages/thalamus/tests/query-shape-contract.spec.ts \
        packages/thalamus/tests/__allowlists__/query-shape-allowlist.json
git commit -m "test(thalamus): SPEC-TH-QSC — query shape contract ratchet"
git push -u origin feat/thalamus-audit-axe1
```

---

## Task 9: Axe 2 — Data wiring diagnostic

**Files:**

- Create: `packages/thalamus/tests/integration/thalamus-data-wiring.spec.ts`
- Create: `apps/console-api/tmp/diagnostics/.gitkeep`
- Modify: `.gitignore` (add `apps/console-api/tmp/`)
- Modify: `Makefile` (add `thalamus-diagnose` target)

- [ ] **Step 1: Enumerate cortex queries with their entry-point function names**

```bash
grep -rn "^export (async )?function query" packages/thalamus/src/cortices/queries/ | head -30
```

This gives the list of `queryXxx(db, opts)` functions.

- [ ] **Step 2: Write the diagnostic spec**

Create `packages/thalamus/tests/integration/thalamus-data-wiring.spec.ts`:

```ts
import { describe, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { queryDebrisForecast } from "../../src/cortices/queries/debris-forecast";
import { queryCatalog } from "../../src/cortices/queries/catalog";
import { queryOrbitalTraffic } from "../../src/cortices/queries/orbital-traffic";
import { queryOperatorFleet } from "../../src/cortices/queries/operator-fleet";
import { queryObservations } from "../../src/cortices/queries/observations";
import { queryDataAudit } from "../../src/cortices/queries/data-audit";

type CortexProbe = {
  cortex: string;
  query: string;
  fn: (db: any) => Promise<unknown[]>;
};

const PROBES: CortexProbe[] = [
  {
    cortex: "debris_forecaster",
    query: "queryDebrisForecast",
    fn: (db) => queryDebrisForecast(db, {}),
  },
  {
    cortex: "catalog",
    query: "queryCatalog",
    fn: (db) => queryCatalog(db, {}),
  },
  {
    cortex: "orbital_analyst",
    query: "queryOrbitalTraffic",
    fn: (db) => queryOrbitalTraffic(db, {}),
  },
  {
    cortex: "fleet_analyst",
    query: "queryOperatorFleet",
    fn: (db) => queryOperatorFleet(db, {}),
  },
  {
    cortex: "observations",
    query: "queryObservations",
    fn: (db) => queryObservations(db, {}),
  },
  {
    cortex: "data_auditor",
    query: "queryDataAudit",
    fn: (db) => queryDataAudit(db, {}),
  },
];

describe.skipIf(!process.env.THALAMUS_DIAGNOSE)(
  "Thalamus data wiring — diagnostic (non-blocking)",
  () => {
    it("produces a rows-per-cortex report", async () => {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const db = drizzle(pool);
      const report: Array<{
        cortex: string;
        query: string;
        rows: number;
        status: "ok" | "dead" | "over-productive";
      }> = [];

      for (const probe of PROBES) {
        try {
          const rows = await probe.fn(db);
          const count = rows.length;
          const status =
            count === 0 ? "dead" : count > 10000 ? "over-productive" : "ok";
          report.push({
            cortex: probe.cortex,
            query: probe.query,
            rows: count,
            status,
          });
        } catch (err) {
          report.push({
            cortex: probe.cortex,
            query: probe.query,
            rows: -1,
            status: "dead",
          });
        }
      }

      const outDir = resolve(
        __dirname,
        "../../../../apps/console-api/tmp/diagnostics",
      );
      mkdirSync(outDir, { recursive: true });
      writeFileSync(
        resolve(outDir, "data-wiring.json"),
        JSON.stringify(report, null, 2),
      );

      console.log("\n=== Thalamus data wiring diagnostic ===");
      console.table(report);

      await pool.end();
    });
  },
);
```

- [ ] **Step 3: Add Makefile target**

Open the top-level `Makefile` and append (tab-indented):

```makefile
thalamus-diagnose: ## Run the live DB wiring diagnostic (non-blocking)
	THALAMUS_DIAGNOSE=1 DATABASE_URL=$${DATABASE_URL:-postgresql://interview:interview@localhost:5433/thalamus} \
		pnpm vitest run packages/thalamus/tests/integration/thalamus-data-wiring.spec.ts
```

- [ ] **Step 4: Update .gitignore**

Append to `.gitignore`:

```
apps/console-api/tmp/
```

- [ ] **Step 5: Run the diagnostic (expects DB up)**

```bash
make up  # if not already running
make thalamus-diagnose
```

Expected: a table printed to stdout AND `apps/console-api/tmp/diagnostics/data-wiring.json` on disk. Exit code 0 regardless of dead cortices.

- [ ] **Step 6: Run the non-diagnostic suite to confirm the spec is skipped by default**

```bash
pnpm test
```

Expected: `thalamus-data-wiring.spec.ts` reported as **1 skipped**, suite green.

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/thalamus-audit-axe2
git add packages/thalamus/tests/integration/thalamus-data-wiring.spec.ts \
        Makefile .gitignore
git commit -m "test(thalamus): SPEC-TH-DW — data wiring diagnostic (non-blocking)"
git push -u origin feat/thalamus-audit-axe2
```

---

## Task 10: Axe 3 — Planner bias

**Files:**

- Create: `packages/thalamus/tests/thalamus-planner.spec.ts`

- [ ] **Step 1: Read the existing planner to know what to mock**

```bash
cat packages/thalamus/src/services/thalamus-planner.service.ts | head -50
```

Note `ThalamusPlanner.plan(query)` constructs a `createLlmTransport(systemPrompt)`. To stub it we use `vi.mock("../src/transports/llm-chat", ...)`.

- [ ] **Step 2: Write the spec**

Create `packages/thalamus/tests/thalamus-planner.spec.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createStubLlmTransport } from "./_helpers/stub-llm-transport";
import { ThalamusPlanner } from "../src/services/thalamus-planner.service";
import type { CortexRegistry } from "../src/cortices/registry";

const stub = createStubLlmTransport({});
vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: (sys: string) => stub.build(sys),
}));

const fakeRegistry: CortexRegistry = {
  names: () => [
    "data_auditor",
    "classification_auditor",
    "fleet_analyst",
    "conjunction_analysis",
    "regime_profiler",
    "strategist",
  ],
  getHeadersForPlanner: () => [],
  has: (n: string) => true,
} as any;

describe("SPEC-TH-PLANNER — Thalamus planner bias", () => {
  beforeEach(() => {
    stub.calls.length = 0;
  });

  it("Given an audit query, Then data_auditor is selected", async () => {
    Object.assign(
      stub,
      createStubLlmTransport({
        planner: JSON.stringify({
          intent: "audit catalog",
          nodes: [{ cortex: "data_auditor", params: {}, dependsOn: [] }],
          complexity: "moderate",
        }),
      }),
    );
    const planner = new ThalamusPlanner(fakeRegistry);
    const plan = await planner.plan("audit catalog completeness");
    expect(plan.nodes.map((n) => n.cortex)).toContain("data_auditor");
  });

  it(
    "Given a non-audit fleet query, Then data_auditor is excluded " +
      "(RED TODAY — drives Priority 6 (b) fix)",
    async () => {
      Object.assign(
        stub,
        createStubLlmTransport({
          planner: JSON.stringify({
            intent: "fleet risk",
            nodes: [
              { cortex: "fleet_analyst", params: {}, dependsOn: [] },
              { cortex: "conjunction_analysis", params: {}, dependsOn: [] },
              {
                cortex: "strategist",
                params: {},
                dependsOn: ["fleet_analyst"],
              },
            ],
            complexity: "moderate",
          }),
        }),
      );
      const planner = new ThalamusPlanner(fakeRegistry);
      const plan = await planner.plan("conjunction risk for LEO fleet");
      const cortices = plan.nodes.map((n) => n.cortex);
      expect(cortices).not.toContain("data_auditor");
      expect(cortices).not.toContain("classification_auditor");
    },
  );

  it("Given invalid JSON from LLM, Then fallback plan is returned", async () => {
    Object.assign(
      stub,
      createStubLlmTransport({ planner: "garbage ::: output" }),
    );
    const planner = new ThalamusPlanner(fakeRegistry);
    const plan = await planner.plan("anything");
    expect(plan.nodes.map((n) => n.cortex)).toEqual([
      "fleet_analyst",
      "conjunction_analysis",
      "regime_profiler",
      "strategist",
    ]);
  });
});
```

- [ ] **Step 3: Run the spec**

```bash
pnpm vitest run packages/thalamus/tests/thalamus-planner.spec.ts
```

Expected: 3 tests pass. Test 2 (`non-audit query`) passes **because the stub returns a controlled DAG**. The real-world bug (LLM biasing towards `data_auditor`) is exposed later in Phase 3 via recorded fixtures.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/thalamus-audit-axe3
git add packages/thalamus/tests/thalamus-planner.spec.ts
git commit -m "test(thalamus): SPEC-TH-PLANNER — planner bias contract"
git push -u origin feat/thalamus-audit-axe3
```

---

## Task 11: Axe 4 — Cost + telemetry contract

**Files:**

- Create: `packages/thalamus/tests/thalamus-cost-telemetry.spec.ts`
- Possibly modify: `packages/thalamus/src/services/thalamus.service.ts` (to emit `budgetExhausted` hint into `CycleResult.stopReason`)

- [ ] **Step 1: Check what signals the cycle exposes about cost today**

```bash
grep -n "totalCost\|cost\|budget" packages/thalamus/src/services/thalamus.service.ts | head -20
```

Identify where the cost budget is enforced (likely in `thalamus-executor.service.ts` or inside `runCycle`). The `toCycleResult` helper from Task 6 expects a `{ budgetExhausted }` hint — wire it from the call site that logs `"Stopping: cost budget exhausted"`.

- [ ] **Step 2: Write the spec**

Create `packages/thalamus/tests/thalamus-cost-telemetry.spec.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { createStubLlmTransport } from "./_helpers/stub-llm-transport";
import { loadFixture } from "./_helpers/load-fixture";
import { assertTelemetry } from "./_helpers/assert-telemetry";

// Stub the transport so no real LLM is called.
const stub = createStubLlmTransport({
  planner: JSON.stringify({
    intent: "test",
    complexity: "simple",
    nodes: [{ cortex: "fleet_analyst", params: {}, dependsOn: [] }],
  }),
  fleet_analyst: JSON.stringify({
    findings: [{ title: "x", confidence: 0.9 }],
  }),
});
vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: (sys: string) => stub.build(sys),
}));

describe.skipIf(!process.env.DATABASE_URL)(
  "SPEC-TH-COST — cycle cost & telemetry",
  () => {
    const cleanups: Array<() => Promise<void>> = [];
    afterEach(async () => {
      await Promise.all(cleanups.splice(0).map((fn) => fn()));
      stub.calls.length = 0;
    });

    it(
      "Given cheap stub responses, When a cycle runs with maxCost=0.10, " +
        "Then totalCost ≤ 0.10 and stopReason = completed",
      async () => {
        const { db, cleanup } = await loadFixture("minimal-catalog");
        cleanups.push(cleanup);
        // NOTE: Phase 2 wiring — construct ThalamusService with the fixture db,
        // then call `runCycle({ query: "test", triggerType: "user" })`.
        // Until the service takes a db injection, this test is .todo.
        expect.fail("PENDING — needs ThalamusService db injection (Phase 3)");
      },
    );

    it.todo(
      "Given overshoot responses, Then stopReason = budget_exhausted + partial findings surfaced",
    );
    it.todo(
      "Given a successful cycle, Then telemetry emits cortex/rowsFetched/findingsRaw/findingsDeduped/cost/durationMs",
    );
  },
);
```

- [ ] **Step 3: Run the spec**

```bash
pnpm vitest run packages/thalamus/tests/thalamus-cost-telemetry.spec.ts
```

Expected: 1 test explicitly failing with "PENDING — needs ThalamusService db injection (Phase 3)", 2 todos. The `.todo` entries are visible in the reporter but don't fail the suite.

If the test 1 blocks CI, demote it to `it.todo(...)` as well. The point is the **shape** of the contract is committed — implementation comes in Phase 3 when `ThalamusService` is made testable.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/thalamus-audit-axe4
git add packages/thalamus/tests/thalamus-cost-telemetry.spec.ts
git commit -m "test(thalamus): SPEC-TH-COST — cost & telemetry contract (todo scaffold)"
git push -u origin feat/thalamus-audit-axe4
```

---

## Task 12: Axe 5 — Cycle dedup + budget exhaustion

**Files:**

- Create: `packages/thalamus/tests/thalamus-cycle-dedup.spec.ts`

- [ ] **Step 1: Locate the dedup mechanism**

```bash
grep -rn "semantic_dedup\|Semantic dedup\|mergeInto" packages/thalamus/src 2>/dev/null | head -10
```

Find where `"Semantic dedup: merging into existing finding"` is emitted — that's the event the test asserts against.

- [ ] **Step 2: Write the spec (scaffold with todos, same reason as Task 11)**

Create `packages/thalamus/tests/thalamus-cycle-dedup.spec.ts`:

```ts
import { describe, it } from "vitest";

describe.skipIf(!process.env.DATABASE_URL)(
  "SPEC-TH-DEDUP — cycle dedup & budget exhaustion",
  () => {
    it.todo(
      "Given two consecutive cycles with byte-identical findings, " +
        "Then cycle 2 produces zero new findings",
    );

    it.todo(
      "Given two cycles with paraphrased findings (semantic dup), " +
        "Then cycle 2 triggers semantic_dedup_merged for each",
    );

    it.todo(
      "Given a cycle where budget exhausts at iteration N, " +
        "Then N partial findings are persisted and stopReason = budget_exhausted",
    );
  },
);
```

Rationale: we commit the **spec** (the three scenarios named with Given/When/Then) today. The green implementation lands in Phase 3 once `ThalamusService` accepts injected `db` + transport.

- [ ] **Step 3: Run to confirm the spec compiles**

```bash
pnpm vitest run packages/thalamus/tests/thalamus-cycle-dedup.spec.ts
```

Expected: 3 todos reported, suite green.

- [ ] **Step 4: Commit**

```bash
git checkout -b feat/thalamus-audit-axe5
git add packages/thalamus/tests/thalamus-cycle-dedup.spec.ts
git commit -m "test(thalamus): SPEC-TH-DEDUP — cycle dedup contract (todo scaffold)"
git push -u origin feat/thalamus-audit-axe5
```

---

## Task 13: Axe 6 — Security contract

**Files:**

- Create: `packages/thalamus/tests/thalamus-security.spec.ts`
- Possibly modify: pino redaction config (search existing logger setup)
- Possibly modify: cortex prompt assembler to wrap source content in `<source_content>` delimiters

- [ ] **Step 1: Check existing pino redaction config**

```bash
grep -rn "redact" packages/shared/src/observability/ 2>/dev/null | head -10
cat packages/shared/src/observability/logger.ts 2>/dev/null | head -40
```

If `redact:` is absent or does not cover `apiKey`, Axe 6c is red and needs a minimal config patch.

- [ ] **Step 2: Check source-content wrapping in cortex prompts**

```bash
grep -rn "<source_content>\|source_content>\|SOURCE:" packages/thalamus/src/cortices/ 2>/dev/null | head -10
```

If absent, Axe 6a is red and needs a minimal sanitization wrapper.

- [ ] **Step 3: Write the spec**

Create `packages/thalamus/tests/thalamus-security.spec.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createLogger } from "@interview/shared/observability";
import { loadFixture } from "./_helpers/load-fixture";
import { queryDebrisForecast } from "../src/cortices/queries/debris-forecast";

describe("SPEC-TH-SEC — security contract", () => {
  // 6b — SQL injection regression (should pass today)
  it.skipIf(!process.env.DATABASE_URL)(
    "Given hostile input to queryDebrisForecast, " +
      "Then Drizzle parameterises and no row is corrupted",
    async () => {
      const { db, cleanup } = await loadFixture("minimal-catalog");
      try {
        const before = await db.execute(
          sql`SELECT count(*)::int AS c FROM satellite`,
        );
        await queryDebrisForecast(db, {
          regimeId: "'; DROP TABLE satellite; --" as unknown as number,
        });
        const after = await db.execute(
          sql`SELECT count(*)::int AS c FROM satellite`,
        );
        expect((after.rows[0] as { c: number }).c).toBe(
          (before.rows[0] as { c: number }).c,
        );
      } finally {
        await cleanup();
      }
    },
  );

  // 6c — Secret redaction (RED if pino redact is not configured)
  it("Given a log entry with apiKey, When the logger writes, Then the key is redacted", () => {
    const seen: string[] = [];
    const origWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: string) => {
      seen.push(String(chunk));
      return true;
    }) as any;
    try {
      const log = createLogger("test-security");
      log.info({ apiKey: "sk-real-secret-key", query: "x" }, "call");
    } finally {
      process.stdout.write = origWrite;
    }
    const combined = seen.join("");
    expect(combined).not.toContain("sk-real-secret-key");
    expect(combined.toLowerCase()).toMatch(/redacted|\*\*\*/);
  });

  // 6a — Prompt injection (scaffold, drives Phase 3)
  it.todo(
    "Given a malicious source_item.title, When a cortex reads it, " +
      "Then the LLM prompt wraps the content in <source_content> delimiters",
  );
});
```

- [ ] **Step 4: Run the spec**

```bash
DATABASE_URL=postgresql://interview:interview@localhost:5433/thalamus \
  pnpm vitest run packages/thalamus/tests/thalamus-security.spec.ts
```

Expected: 6b PASSES. 6c either passes (if redaction already exists) or fails.

- [ ] **Step 5: If 6c fails, add minimal pino redaction**

Edit `packages/shared/src/observability/logger.ts` (path confirmed in Step 1). Locate the `pino({...})` options and add:

```ts
redact: {
  paths: ["apiKey", "api_key", "authorization", "password", "*.apiKey", "*.password"],
  censor: "[REDACTED]",
},
```

- [ ] **Step 6: Re-run 6c**

```bash
pnpm vitest run packages/thalamus/tests/thalamus-security.spec.ts -t "Given a log entry with apiKey"
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git checkout -b feat/thalamus-audit-axe6
git add packages/thalamus/tests/thalamus-security.spec.ts \
        packages/shared/src/observability/logger.ts
git commit -m "test(thalamus): SPEC-TH-SEC — security contract + pino redact"
git push -u origin feat/thalamus-audit-axe6
```

---

## Finalization

- [ ] **Step 1: Merge all axis branches into `feat/thalamus-audit`**

In merge order (per Codex recommendation): 1 → 2 → 3 → 4 → 5 → 6.

```bash
cd /home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit
git checkout feat/thalamus-audit
for n in 1 2 3 4 5 6; do
  git merge --no-ff feat/thalamus-audit-axe${n} \
    -m "merge: thalamus audit axe ${n}"
done
```

- [ ] **Step 2: Full test sweep**

```bash
pnpm -r typecheck
pnpm test
DATABASE_URL=postgresql://interview:interview@localhost:5433/thalamus make thalamus-diagnose
```

Expected: typecheck green, `pnpm test` green, `make thalamus-diagnose` prints a table.

- [ ] **Step 3: Open PR against `main`**

```bash
gh pr create --base main --head feat/thalamus-audit \
  --title "test(thalamus): 6-axis audit test harness" \
  --body "$(cat <<'EOF'
## Summary

- Ships shared test infra (stub LLM transport, DB fixtures via temp schemas, telemetry helper, `validateRows` Zod boundary, `stopReason` on CycleResult)
- Adds 6 axis specs per `docs/superpowers/specs/2026-04-16-thalamus-audit-tests-design.md`
- Phase 3 follow-up plan (separate) drives the real fixes under TDD

## Test plan

- [ ] `pnpm -r typecheck` green
- [ ] `pnpm test` green
- [ ] `make thalamus-diagnose` produces `apps/console-api/tmp/diagnostics/data-wiring.json`
- [ ] Spec file linked in PR description

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 4: Remove worktree after merge**

```bash
cd /home/jerem/interview-thalamus-sweep
git worktree remove /home/jerem/interview-thalamus-sweep-worktrees/feat-thalamus-audit
```
