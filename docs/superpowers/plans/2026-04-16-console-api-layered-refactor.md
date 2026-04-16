# console-api Layered Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose `apps/console-api/src/server.ts` (2001L, monolithic) into a 5-layer Fastify backend (routes → controllers → services → repositories → types) with `utils/` for server-only helpers and `prompts/` for LLM prompts, keeping all endpoints and integration tests green.

**Architecture:**

- **5 layers** per the user's spec: `routes/` (URL patterns), `controllers/` (thin req/reply adapters), `services/` (business logic), `repositories/` (SQL), `types/` (server-only types).
- **Rule for reuse:** anything that does not share semantics with the console frontend stays in `apps/console-api/src/utils/`. DTOs and derivation helpers consumed by both server and console go to `packages/shared/src/ssa/` (extends the existing pattern from `conjunction-view.ts`).
- **LLM prompts** live in `apps/console-api/src/prompts/` (one file per functional cortex — mission-research, repl-chat, autonomy-queries), following the thalamus "prompt-per-cortex" convention.
- **No behavior change.** All HTTP contracts and DB side-effects preserved. The 4 existing integration specs (`conjunctions`, `enrichment-findings`, `knn-propagation`, `sweep-mission`) stay green throughout.

**Tech Stack:** Fastify 5, drizzle-orm (pg), ioredis, zod (for shared DTO schemas), vitest (integration via ephemeral server on port 0).

---

## Target file layout

```
apps/console-api/src/
  server.ts                        # boot + container composition only (~60L)
  container.ts                     # db, redis, thalamus, sweep builders
  repl.ts                          # UNCHANGED (separate REPL engine)
  fixtures.ts                      # UNCHANGED (legacy demo fixtures)

  types/
    regime.types.ts                # Regime (re-export from shared)
    mission.types.ts               # MissionTask, MissionState, NanoResult, CycleKind, CycleRun
    autonomy.types.ts              # AutonomyAction, AutonomyTick, AutonomyState
    reflexion.types.ts             # ReflexionBody + row shapes
    knn.types.ts                   # KnnPropagateBody + stats
    finding.types.ts               # FindingStatusDto mapping union

  utils/
    async-handler.ts               # fastify async wrapper + normalised error reply
    regime.ts                      # normaliseRegime, regimeFromMeanMotion, smaFromMeanMotion (thin re-export of shared)
    classification.ts              # classificationTier
    finding-status.ts              # mapFindingStatus, toDbStatus, parseFindingId
    fabrication-detector.ts        # detectFabrication + FABRICATION_TOKENS
    field-constraints.ts           # MISSION_WRITABLE_COLUMNS, FIELD_RANGE, UNIT_MISMATCHES, inRange, unitMismatch
    sql-field.ts                   # fieldSqlFor(field) guarded tagged helper

  prompts/
    mission-research.prompt.ts     # MISSION_SYSTEM_PROMPT + MISSION_RESPONSE_FORMAT
    repl-chat.prompt.ts            # CONSOLE_CHAT_SYSTEM_PROMPT + CLASSIFIER_SYSTEM_PROMPT + summariser
    autonomy-queries.prompt.ts     # THALAMUS_QUERIES rotation

  repositories/
    satellite.repository.ts        # list + by-id + field update
    conjunction.repository.ts      # list with minPc
    kg.repository.ts               # nodes composition (sats/ops/regimes/findings) + edges
    finding.repository.ts          # list + by-id + update status
    research-edge.repository.ts    # by-finding-ids + insert
    enrichment-cycle.repository.ts # get-or-create catalog-enrichment cycle
    sweep-audit.repository.ts      # insert audit row
    reflexion.repository.ts        # target, coplane, belt, mil-lineage SQL
    stats.repository.ts            # count aggregates + by-status/cortex

  services/
    satellite-view.service.ts      # rows → SatelliteView[] + regime filter
    conjunction-view.service.ts    # rows → ConjunctionView[] (uses deriveCovarianceQuality/action)
    kg-view.service.ts             # compose KG nodes + edges
    finding-view.service.ts        # rows → FindingView (+ edge lookup)
    nano-research.service.ts       # singleNanoVote + votesAgree
    mission.service.ts             # mission tick + runMissionTask + applySatelliteFieldUpdate
    knn-propagation.service.ts     # KNN propagate loop + consensus
    reflexion.service.ts           # emit rule + finding + edges
    enrichment-finding.service.ts  # emit research_finding + edges + redis feedback
    autonomy.service.ts            # tick loop + rotation state
    cycle-runner.service.ts        # runThalamus + runFish + history
    repl-chat.service.ts           # classifier + dispatch + summarise
    stats.service.ts               # /api/stats aggregation

  controllers/
    health.controller.ts
    satellites.controller.ts
    conjunctions.controller.ts
    kg.controller.ts
    findings.controller.ts
    sweep-suggestions.controller.ts
    sweep-mission.controller.ts
    reflexion.controller.ts
    knn-propagation.controller.ts
    autonomy.controller.ts
    cycles.controller.ts
    stats.controller.ts
    repl.controller.ts

  routes/
    health.routes.ts
    satellites.routes.ts
    conjunctions.routes.ts
    kg.routes.ts
    findings.routes.ts
    sweep.routes.ts                # suggestions + mission
    reflexion.routes.ts
    knn-propagation.routes.ts
    autonomy.routes.ts
    cycles.routes.ts
    stats.routes.ts
    repl.routes.ts
    index.ts                       # registerRoutes(app, deps)
```

Client-shared schemas added to `packages/shared/src/ssa/`:

- `satellite-view.ts` (SatelliteView, regimeFromMeanMotion, smaFromMeanMotion, classificationTier derivation — these four belong to shared because the console already reimplements them)
- `finding-view.ts` (FindingView + FindingStatus enum)
- `kg-view.ts` (KgNode + KgEdge + EntityClass)

---

## Execution discipline

Every task is TDD:

1. Write failing test (unit for pure helpers, integration re-run for routing changes).
2. Run test; confirm expected failure.
3. Extract/implement minimal code.
4. Run test; confirm pass.
5. Commit.

**Green bar at every checkpoint:**

- `cd apps/console-api && pnpm exec vitest run --reporter=dot`
- `cd apps/console-api && pnpm typecheck`

If either breaks, STOP and fix before proceeding.

---

## Phase 0 — Shared DTO scaffolding (unblocks everything else)

### Task 0.1: Extend `packages/shared/src/ssa/` with satellite/finding/kg views

**Files:**

- Create: `packages/shared/src/ssa/satellite-view.ts`
- Create: `packages/shared/src/ssa/finding-view.ts`
- Create: `packages/shared/src/ssa/kg-view.ts`
- Create: `packages/shared/src/ssa/index.ts`
- Modify: `packages/shared/src/index.ts` — re-export `./ssa`
- Test: `packages/shared/src/ssa/satellite-view.test.ts`

- [ ] **Step 1: Write failing test for `regimeFromMeanMotion` + `smaFromMeanMotion`**

```ts
// packages/shared/src/ssa/satellite-view.test.ts
import { describe, it, expect } from "vitest";
import {
  regimeFromMeanMotion,
  smaFromMeanMotion,
  classificationTier,
} from "./satellite-view";

describe("regimeFromMeanMotion", () => {
  it.each([
    [null, "LEO"],
    [15.5, "LEO"],
    [10.9, "HEO"],
    [4.9, "MEO"],
    [1.0, "GEO"],
  ])("mm=%s → %s", (mm, regime) => {
    expect(regimeFromMeanMotion(mm)).toBe(regime);
  });
});

describe("smaFromMeanMotion", () => {
  it("mm=15.5 ≈ 6773 km (ISS-ish)", () => {
    expect(smaFromMeanMotion(15.5)).toBeCloseTo(6773, 0);
  });
  it("mm=1.0027 ≈ 42164 km (GEO)", () => {
    expect(smaFromMeanMotion(1.0027)).toBeCloseTo(42164, -1);
  });
});

describe("classificationTier", () => {
  it.each([
    [null, "unclassified"],
    ["standard", "unclassified"],
    ["restricted access", "restricted"],
    ["sensitive payload", "sensitive"],
  ])("raw=%s → %s", (raw, tier) => {
    expect(classificationTier(raw)).toBe(tier);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd packages/shared && pnpm exec vitest run src/ssa/satellite-view.test.ts
```

Expected: FAIL with `Cannot find module './satellite-view'`.

- [ ] **Step 3: Implement `satellite-view.ts`**

```ts
// packages/shared/src/ssa/satellite-view.ts
import { z } from "zod";
import { RegimeSchema, type Regime } from "./conjunction-view";

export const ClassificationTierSchema = z.enum([
  "unclassified",
  "sensitive",
  "restricted",
]);
export type ClassificationTier = z.infer<typeof ClassificationTierSchema>;

export const SatelliteViewSchema = z.object({
  id: z.number(),
  name: z.string(),
  noradId: z.number(),
  regime: RegimeSchema,
  operator: z.string(),
  country: z.string(),
  inclinationDeg: z.number(),
  semiMajorAxisKm: z.number(),
  eccentricity: z.number(),
  raanDeg: z.number(),
  argPerigeeDeg: z.number(),
  meanAnomalyDeg: z.number(),
  meanMotionRevPerDay: z.number(),
  epoch: z.string(),
  massKg: z.number(),
  classificationTier: ClassificationTierSchema,
  opacityScore: z.number().nullable(),
});
export type SatelliteView = z.infer<typeof SatelliteViewSchema>;

export function normaliseRegime(raw: string | null | undefined): Regime {
  if (!raw) return "LEO";
  const r = raw.toLowerCase();
  if (r.includes("geo")) return "GEO";
  if (r.includes("meo")) return "MEO";
  if (r.includes("heo") || r.includes("hi")) return "HEO";
  return "LEO";
}

export function regimeFromMeanMotion(mm: number | null | undefined): Regime {
  if (mm == null) return "LEO";
  if (mm < 1.1) return "GEO";
  if (mm < 5) return "MEO";
  if (mm < 11) return "HEO";
  return "LEO";
}

export function smaFromMeanMotion(mm: number): number {
  // Kepler: a = ∛( μ · (T/2π)² ), T in seconds, μ = 398600.4418 km³/s²
  const period = 86400 / mm;
  return Math.pow(398600.4418 * Math.pow(period / (2 * Math.PI), 2), 1 / 3);
}

export function classificationTier(raw: string | null): ClassificationTier {
  if (!raw) return "unclassified";
  const r = raw.toLowerCase();
  if (r.includes("restrict") || r.includes("classif")) return "restricted";
  if (r.includes("sensit") || r.includes("limit")) return "sensitive";
  return "unclassified";
}
```

- [ ] **Step 4: Implement `finding-view.ts`**

```ts
// packages/shared/src/ssa/finding-view.ts
import { z } from "zod";

export const FindingStatusSchema = z.enum([
  "pending",
  "accepted",
  "rejected",
  "in-review",
]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

export const FindingEvidenceSchema = z.object({
  kind: z.enum(["osint", "field", "derived"]),
  uri: z.string(),
  snippet: z.string(),
});
export type FindingEvidence = z.infer<typeof FindingEvidenceSchema>;

export const FindingViewSchema = z.object({
  id: z.string(),
  title: z.string(),
  summary: z.string(),
  cortex: z.string(),
  status: FindingStatusSchema,
  priority: z.number(),
  createdAt: z.string(),
  linkedEntityIds: z.array(z.string()),
  evidence: z.array(FindingEvidenceSchema),
});
export type FindingView = z.infer<typeof FindingViewSchema>;
```

- [ ] **Step 5: Implement `kg-view.ts`**

```ts
// packages/shared/src/ssa/kg-view.ts
import { z } from "zod";

export const KgEntityClassSchema = z.enum([
  "Satellite",
  "Operator",
  "OrbitRegime",
  "Payload",
]);
export type KgEntityClass = z.infer<typeof KgEntityClassSchema>;

export const KgNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  class: KgEntityClassSchema,
  degree: z.number(),
  x: z.number(),
  y: z.number(),
  cortex: z.string(),
});
export type KgNode = z.infer<typeof KgNodeSchema>;

export const KgEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relation: z.string(),
});
export type KgEdge = z.infer<typeof KgEdgeSchema>;
```

- [ ] **Step 6: Implement `ssa/index.ts` and re-export from shared root**

```ts
// packages/shared/src/ssa/index.ts
export * from "./conjunction-view";
export * from "./satellite-view";
export * from "./finding-view";
export * from "./kg-view";
```

Add to `packages/shared/src/index.ts` at the bottom: `export * from "./ssa";` (if not already there).

- [ ] **Step 7: Run test to verify it passes**

```bash
cd packages/shared && pnpm exec vitest run src/ssa/satellite-view.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/ssa packages/shared/src/index.ts
git commit -m "feat(shared): extract SatelliteView/FindingView/KgView DTOs + derivation helpers"
```

---

## Phase 1 — Utils (server-only helpers)

### Task 1.1: Extract `utils/classification.ts`, `utils/regime.ts`, `utils/finding-status.ts`

**Files:**

- Create: `apps/console-api/src/utils/regime.ts`
- Create: `apps/console-api/src/utils/classification.ts`
- Create: `apps/console-api/src/utils/finding-status.ts`
- Create: `apps/console-api/src/utils/finding-status.test.ts`

- [ ] **Step 1: Write failing test for `finding-status.ts`**

```ts
// apps/console-api/src/utils/finding-status.test.ts
import { describe, it, expect } from "vitest";
import { mapFindingStatus, toDbStatus, parseFindingId } from "./finding-status";

describe("mapFindingStatus", () => {
  it.each([
    ["archived", "accepted"],
    ["invalidated", "rejected"],
    ["active", "pending"],
    ["unknown", "in-review"],
  ])("db=%s → dto=%s", (db, dto) => {
    expect(mapFindingStatus(db)).toBe(dto);
  });
});

describe("toDbStatus", () => {
  it.each([
    ["accepted", "archived"],
    ["rejected", "invalidated"],
    ["pending", "active"],
    ["in-review", "active"],
  ])("dto=%s → db=%s", (dto, db) => {
    expect(toDbStatus(dto)).toBe(db);
  });
});

describe("parseFindingId", () => {
  it("strips f: prefix", () => expect(parseFindingId("f:42")).toBe(42n));
  it("accepts raw digits", () => expect(parseFindingId("17")).toBe(17n));
  it("rejects non-numeric", () => expect(parseFindingId("abc")).toBeNull());
  it("rejects empty", () => expect(parseFindingId("")).toBeNull());
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/finding-status.test.ts
```

Expected: FAIL with `Cannot find module './finding-status'`.

- [ ] **Step 3: Implement `utils/finding-status.ts`**

```ts
// apps/console-api/src/utils/finding-status.ts
import type { FindingStatus } from "@interview/shared";

export function mapFindingStatus(s: string): FindingStatus {
  const l = s.toLowerCase();
  if (l === "archived") return "accepted";
  if (l === "invalidated") return "rejected";
  if (l === "active") return "pending";
  return "in-review";
}

export function toDbStatus(s: string): "active" | "archived" | "invalidated" {
  if (s === "accepted") return "archived";
  if (s === "rejected") return "invalidated";
  return "active";
}

export function parseFindingId(raw: string): bigint | null {
  const s = raw.startsWith("f:") ? raw.slice(2) : raw;
  if (!/^\d+$/.test(s)) return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement `utils/regime.ts` + `utils/classification.ts` (thin re-exports of shared)**

```ts
// apps/console-api/src/utils/regime.ts
export {
  normaliseRegime,
  regimeFromMeanMotion,
  smaFromMeanMotion,
  type Regime,
} from "@interview/shared";
```

```ts
// apps/console-api/src/utils/classification.ts
export { classificationTier, type ClassificationTier } from "@interview/shared";
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/finding-status.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/console-api/src/utils
git commit -m "refactor(console-api): extract classification/regime/finding-status to utils"
```

---

### Task 1.2: Extract `utils/fabrication-detector.ts`

**Files:**

- Create: `apps/console-api/src/utils/fabrication-detector.ts`
- Create: `apps/console-api/src/utils/fabrication-detector.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/console-api/src/utils/fabrication-detector.test.ts
import { describe, it, expect } from "vitest";
import { detectFabrication } from "./fabrication-detector";

describe("detectFabrication", () => {
  it("flags hedging tokens", () => {
    expect(detectFabrication("value is approximately 500 kg")).toBe(
      "approximately",
    );
    expect(detectFabrication("typically around 1200 W")).toBe("typically");
    expect(detectFabrication("not available")).toBe("not available");
  });
  it("returns null for clean text", () => {
    expect(detectFabrication("Mass is 872 kg per NASA press kit")).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/fabrication-detector.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `utils/fabrication-detector.ts`**

Move lines 766-794 of [apps/console-api/src/server.ts](../../../apps/console-api/src/server.ts#L766-L794) verbatim:

```ts
// apps/console-api/src/utils/fabrication-detector.ts
const FABRICATION_TOKENS = [
  /\btypical(ly)?\b/i,
  /\bapprox(imately)?\b/i,
  /\babout\b/i,
  /\baround\b/i,
  /\broughly\b/i,
  /\bestimate[ds]?\b/i,
  /\bvarious\b/i,
  /\busually\b/i,
  /\bgeneral(ly)?\b/i,
  /\bcommon(ly)?\b/i,
  /\bmost\s+of\b/i,
  /\bN\/A\b/i,
  /\bunknown\b/i,
  /\bnot\s+specified\b/i,
  /\bnot\s+available\b/i,
  /\bvariable\b/i,
  /\bdepends?\b/i,
  /\branges?\s+from\b/i,
  /\bvaries\b/i,
];

export function detectFabrication(text: string): string | null {
  for (const re of FABRICATION_TOKENS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
```

- [ ] **Step 4: Run to verify passes**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/fabrication-detector.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console-api/src/utils/fabrication-detector.ts apps/console-api/src/utils/fabrication-detector.test.ts
git commit -m "refactor(console-api): extract fabrication-detector to utils"
```

---

### Task 1.3: Extract `utils/field-constraints.ts`

**Files:**

- Create: `apps/console-api/src/utils/field-constraints.ts`
- Create: `apps/console-api/src/utils/field-constraints.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/console-api/src/utils/field-constraints.test.ts
import { describe, it, expect } from "vitest";
import {
  MISSION_WRITABLE_COLUMNS,
  inRange,
  unitMismatch,
} from "./field-constraints";

describe("MISSION_WRITABLE_COLUMNS", () => {
  it("contains exactly 5 writable fields", () => {
    expect(Object.keys(MISSION_WRITABLE_COLUMNS).sort()).toEqual([
      "launch_year",
      "lifetime",
      "mass_kg",
      "power",
      "variant",
    ]);
  });
});

describe("inRange", () => {
  it("launch_year accepts 1957–2035", () => {
    expect(inRange("launch_year", 1957)).toBe(true);
    expect(inRange("launch_year", 2035)).toBe(true);
    expect(inRange("launch_year", 1850)).toBe(false);
  });
  it("mass_kg rejects negative", () =>
    expect(inRange("mass_kg", -5)).toBe(false));
  it("unknown field passes through", () =>
    expect(inRange("anything", 42)).toBe(true));
});

describe("unitMismatch", () => {
  it("lifetime rejects days/months", () => {
    expect(unitMismatch("lifetime", "months")).toBe(true);
    expect(unitMismatch("lifetime", "years")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/field-constraints.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `utils/field-constraints.ts`**

Move lines 925-960 of server.ts verbatim:

```ts
// apps/console-api/src/utils/field-constraints.ts
export const MISSION_WRITABLE_COLUMNS: Record<string, "numeric" | "text"> = {
  lifetime: "numeric",
  power: "numeric",
  variant: "text",
  mass_kg: "numeric",
  launch_year: "numeric",
};

export const FIELD_RANGE: Record<string, { min: number; max: number }> = {
  lifetime: { min: 0.1, max: 50 },
  power: { min: 0.1, max: 30_000 },
  mass_kg: { min: 0.1, max: 30_000 },
  launch_year: { min: 1957, max: 2035 },
};

export function inRange(field: string, value: number): boolean {
  const r = FIELD_RANGE[field];
  if (!r) return true;
  return value >= r.min && value <= r.max;
}

const UNIT_MISMATCHES: Record<string, RegExp> = {
  lifetime: /\b(hour|day|month|minute|second|week)s?\b/i,
  launch_year: /\b(BC|month|day)\b/i,
};

export function unitMismatch(field: string, unit: string): boolean {
  const re = UNIT_MISMATCHES[field];
  return re ? re.test(unit) : false;
}
```

- [ ] **Step 4: Run to verify passes**; then **Step 5: Commit**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/field-constraints.test.ts
git add apps/console-api/src/utils/field-constraints.ts apps/console-api/src/utils/field-constraints.test.ts
git commit -m "refactor(console-api): extract field-constraints to utils"
```

---

### Task 1.4: Extract `utils/sql-field.ts`

**Files:**

- Create: `apps/console-api/src/utils/sql-field.ts`

The `fieldSqlFor` helper guards the 5-way sql`variant|lifetime|power|mass_kg|launch_year` switch currently repeated in KNN propagate + mission update.

- [ ] **Step 1: Create helper (no separate unit test — exercised by integration specs)**

```ts
// apps/console-api/src/utils/sql-field.ts
import { sql, type SQL } from "drizzle-orm";

/** Guard: only the 5 whitelisted MISSION_WRITABLE_COLUMNS are ever interpolated. */
export function fieldSqlFor(field: string): SQL {
  switch (field) {
    case "variant":
      return sql`variant`;
    case "lifetime":
      return sql`lifetime`;
    case "power":
      return sql`power`;
    case "mass_kg":
      return sql`mass_kg`;
    case "launch_year":
      return sql`launch_year`;
    default:
      throw new Error(`fieldSqlFor: unsupported field '${field}'`);
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/console-api/src/utils/sql-field.ts
git commit -m "refactor(console-api): add sql-field whitelist helper"
```

---

### Task 1.5: Add `utils/async-handler.ts`

**Files:**

- Create: `apps/console-api/src/utils/async-handler.ts`
- Create: `apps/console-api/src/utils/async-handler.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// apps/console-api/src/utils/async-handler.test.ts
import { describe, it, expect } from "vitest";
import Fastify from "fastify";
import { asyncHandler } from "./async-handler";

describe("asyncHandler", () => {
  it("passes through successful result as JSON", async () => {
    const app = Fastify();
    app.get(
      "/ok",
      asyncHandler(async () => ({ hello: "world" })),
    );
    const res = await app.inject({ method: "GET", url: "/ok" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hello: "world" });
    await app.close();
  });

  it("maps thrown Error to 500 with message", async () => {
    const app = Fastify({ logger: false });
    app.get(
      "/boom",
      asyncHandler(async () => {
        throw new Error("kaboom");
      }),
    );
    const res = await app.inject({ method: "GET", url: "/boom" });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toMatchObject({ error: "kaboom" });
    await app.close();
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/async-handler.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `utils/async-handler.ts`**

```ts
// apps/console-api/src/utils/async-handler.ts
import type { FastifyReply, FastifyRequest, RouteHandler } from "fastify";

export type Handler<Req extends FastifyRequest = FastifyRequest> = (
  req: Req,
  reply: FastifyReply,
) => Promise<unknown>;

/**
 * Wraps a controller fn so any thrown error is returned as {error} JSON at
 * status 500 (or the error's own `.statusCode` if set), without propagating
 * into Fastify's default HTML error path.
 */
export function asyncHandler<Req extends FastifyRequest = FastifyRequest>(
  fn: Handler<Req>,
): RouteHandler {
  return (async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await fn(req as Req, reply);
      if (!reply.sent) return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { statusCode?: number })?.statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : 500;
      req.log.error({ err: msg, url: req.url }, "controller error");
      return reply.code(code).send({ error: msg });
    }
  }) as RouteHandler;
}
```

- [ ] **Step 4: Run to verify passes**

```bash
cd apps/console-api && pnpm exec vitest run src/utils/async-handler.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console-api/src/utils/async-handler.ts apps/console-api/src/utils/async-handler.test.ts
git commit -m "feat(console-api): add asyncHandler wrapper with error normalisation"
```

---

## Phase 2 — Types

### Task 2.1: Create `types/` directory with all server-only type files

**Files:**

- Create: `apps/console-api/src/types/mission.types.ts`
- Create: `apps/console-api/src/types/autonomy.types.ts`
- Create: `apps/console-api/src/types/reflexion.types.ts`
- Create: `apps/console-api/src/types/knn.types.ts`
- Create: `apps/console-api/src/types/cycle.types.ts`
- Create: `apps/console-api/src/types/index.ts`

(No tests — types only. TS compiler is the spec.)

- [ ] **Step 1: Create `mission.types.ts`** (extract from server.ts lines 686-805):

```ts
// apps/console-api/src/types/mission.types.ts
export type MissionTask = {
  suggestionId: string;
  satelliteId: string;
  satelliteName: string;
  noradId: number | null;
  field: string;
  operatorCountry: string;
  status: "pending" | "researching" | "filled" | "unobtainable" | "error";
  value: string | number | null;
  confidence: number;
  source: string | null;
  error?: string;
  startedAt?: string;
  completedAt?: string;
};

export type MissionState = {
  running: boolean;
  startedAt: string | null;
  tasks: MissionTask[];
  completedCount: number;
  filledCount: number;
  unobtainableCount: number;
  errorCount: number;
  cursor: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
};

export type NanoResult = {
  ok: boolean;
  value: string | number | null;
  confidence: number;
  source: string;
  unit: string;
  reason: string;
};
```

- [ ] **Step 2: Create `autonomy.types.ts`** (extract from server.ts lines 556-600):

```ts
// apps/console-api/src/types/autonomy.types.ts
export type AutonomyAction = "thalamus" | "sweep-nullscan" | "fish-swarm";

export type AutonomyTick = {
  id: string;
  action: AutonomyAction;
  queryOrMode: string;
  startedAt: string;
  completedAt: string;
  emitted: number;
  error?: string;
};

export type AutonomyState = {
  running: boolean;
  intervalMs: number;
  tickCount: number;
  currentTick: AutonomyTick | null;
  history: AutonomyTick[];
  startedAt: string | null;
  rotationIdx: number;
  queryIdx: number;
  timer: NodeJS.Timeout | null;
  busy: boolean;
};
```

- [ ] **Step 3: Create `cycle.types.ts`** (extract from server.ts lines 542-553):

```ts
// apps/console-api/src/types/cycle.types.ts
export type CycleKind = "thalamus" | "fish" | "both";

export type CycleRun = {
  id: string;
  kind: CycleKind;
  startedAt: string;
  completedAt: string;
  findingsEmitted: number;
  cortices: string[];
  error?: string;
};
```

- [ ] **Step 4: Create `reflexion.types.ts`**

```ts
// apps/console-api/src/types/reflexion.types.ts
export type ReflexionBody = {
  noradId: number;
  dIncMax?: number;
  dRaanMax?: number;
  dMmMax?: number;
};
```

- [ ] **Step 5: Create `knn.types.ts`**

```ts
// apps/console-api/src/types/knn.types.ts
export type KnnPropagateBody = {
  field?: string;
  k?: number;
  minSim?: number;
  limit?: number;
  dryRun?: boolean;
};
```

- [ ] **Step 6: Create `types/index.ts`**

```ts
// apps/console-api/src/types/index.ts
export * from "./mission.types";
export * from "./autonomy.types";
export * from "./cycle.types";
export * from "./reflexion.types";
export * from "./knn.types";
```

- [ ] **Step 7: Typecheck**

```bash
cd apps/console-api && pnpm typecheck
```

Expected: PASS (types not yet consumed, but compile clean).

- [ ] **Step 8: Commit**

```bash
git add apps/console-api/src/types
git commit -m "refactor(console-api): extract server-only types to types/"
```

---

## Phase 3 — Prompts

### Task 3.1: Hoist LLM prompts to `prompts/`

**Files:**

- Create: `apps/console-api/src/prompts/mission-research.prompt.ts`
- Create: `apps/console-api/src/prompts/repl-chat.prompt.ts`
- Create: `apps/console-api/src/prompts/autonomy-queries.prompt.ts`
- Create: `apps/console-api/src/prompts/index.ts`

- [ ] **Step 1: Create `mission-research.prompt.ts`** (move server.ts lines 728-762):

```ts
// apps/console-api/src/prompts/mission-research.prompt.ts
export const MISSION_SYSTEM_PROMPT = `You are an SSA catalog researcher using gpt-5.4-nano with web search.
You receive ONE specific satellite (by name and NORAD id) and ONE field to fill.
Find the authoritative value for THAT satellite on a public page.

Return STRICT JSON only:
{"value": <number|string|null>, "unit": "<unit or empty>", "confidence": <0.0–1.0>, "source": "<canonical URL>"}

HARD RULES:
1. "source" MUST be a full https:// URL of the page carrying the value (Wikipedia,
   n2yo.com, gunter's space page, eoPortal, NASA/ESA mission page, operator press kit).
2. "value" MUST be the EXACT figure from that page.
3. NEVER hedge with: typical, approximately, about, around, roughly, estimated,
   various, usually, generally, commonly, unknown, not specified, not available,
   variable, depends, ranges from.
4. If the page gives a range, take the median and cap confidence ≤ 0.7.
5. If no page states the value for this specific satellite, return
   {"value": null, "confidence": 0, "source": "<what you searched>"}.
6. Never invent URLs. If you did not actually open the page, confidence = 0.`;

export const MISSION_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "sweep_fill",
  strict: true,
  schema: {
    type: "object",
    properties: {
      value: { type: ["number", "string", "null"] },
      unit: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      source: { type: "string", pattern: "^https://[^\\s]+$|^$" },
    },
    required: ["value", "unit", "confidence", "source"],
    additionalProperties: false,
  },
} as const;
```

- [ ] **Step 2: Create `repl-chat.prompt.ts`** (move server.ts lines 1872-1881 + 1931-1935):

```ts
// apps/console-api/src/prompts/repl-chat.prompt.ts
export const CONSOLE_CHAT_SYSTEM_PROMPT = `You are the SSA mission-operator assistant in the Thalamus + Sweep web console.
You chat with a non-technical reviewer. Keep answers under 120 words, in the reviewer's language.
You CAN explain: catalog contents, conjunction concepts, sim-fish swarms, confidence bands (FIELD/OSINT/SIM), findings.
If the reviewer asks to RUN something (research cycle, detect anomalies, analyze a satellite), say you are dispatching it and name the query you are about to run.
Never invent satellite numbers or Pc values — only cite numbers that appear in the findings bundle attached to this prompt, if any.`;

export const CLASSIFIER_SYSTEM_PROMPT = `You are a router. Read the user's message and output STRICT JSON with one of:
{"action":"chat"}                                   — pure conversation, no data needed
{"action":"run_cycle","query":"<refined query>"}    — user wants a Thalamus research cycle: detect / analyze / find / audit / investigate / screen / run / lance / détecte / analyse
Output JSON only, no prose.`;

export function summariserPrompt(userQuery: string): string {
  return `You are an SSA briefing writer. The user asked: "${userQuery}"
A Thalamus research cycle just ran. Summarize the findings below in <150 words, in the user's language.
For each finding worth flagging, cite its id (#id) and the satellite name(s) linked to it.
If findings is empty, say so and suggest one concrete narrower follow-up.
Never invent numbers.`;
}
```

- [ ] **Step 3: Create `autonomy-queries.prompt.ts`** (move server.ts lines 567-574):

```ts
// apps/console-api/src/prompts/autonomy-queries.prompt.ts
export const THALAMUS_QUERIES = [
  "Detect suspicious orbital behaviour — maneuvers, regime breakouts, missing telemetry",
  "Audit conjunction risk across the fleet — top Pc events and their operators",
  "Find catalog anomalies — mass, launch year, platform class gaps worth prioritising",
  "Correlate OSINT advisory feeds with current fleet — any flagged operators",
  "Surface high-opacity objects — low-confidence classifications needing follow-up",
  "Cross-check recent sim-fish suggestions with Thalamus findings — contradictions?",
] as const;
```

- [ ] **Step 4: Create `prompts/index.ts`**

```ts
// apps/console-api/src/prompts/index.ts
export * from "./mission-research.prompt";
export * from "./repl-chat.prompt";
export * from "./autonomy-queries.prompt";
```

- [ ] **Step 5: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/prompts
git commit -m "refactor(console-api): hoist LLM prompts to prompts/ directory"
```

---

## Phase 4 — Repositories (one per entity)

**Pattern:** each repo exports a class or namespace with methods that take only the primitives it needs (not Fastify). Constructor receives `db: NodePgDatabase<typeof schema>` and (where needed) `redis: Redis`.

### Task 4.1: `repositories/satellite.repository.ts`

**Files:**

- Create: `apps/console-api/src/repositories/satellite.repository.ts`
- Create: `apps/console-api/src/repositories/satellite.repository.test.ts`

- [ ] **Step 1: Write failing integration test** (uses live DB — same model as existing specs)

```ts
// apps/console-api/src/repositories/satellite.repository.test.ts
import { describe, it, expect, beforeAll } from "vitest";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@interview/db-schema";
import { SatelliteRepository } from "./satellite.repository";

describe("SatelliteRepository.listWithOrbital", () => {
  let repo: SatelliteRepository;
  beforeAll(() => {
    const url =
      process.env.DATABASE_URL ??
      "postgres://thalamus:thalamus@localhost:5433/thalamus";
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<
      typeof schema
    >;
    repo = new SatelliteRepository(db);
  });

  it("returns rows that have raan in telemetry_summary", async () => {
    const rows = await repo.listWithOrbital(10);
    expect(Array.isArray(rows)).toBe(true);
    if (rows.length > 0) {
      expect(typeof rows[0]!.name).toBe("string");
      expect(rows[0]!.telemetry_summary).toBeDefined();
    }
  });

  it("honours limit", async () => {
    const rows = await repo.listWithOrbital(3);
    expect(rows.length).toBeLessThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Run to verify fails**

```bash
cd apps/console-api && pnpm exec vitest run src/repositories/satellite.repository.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `satellite.repository.ts`** (extract SQL from server.ts lines 101-130, 1086-1091, 982-992):

```ts
// apps/console-api/src/repositories/satellite.repository.ts
import { sql, type SQL } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import { fieldSqlFor } from "../utils/sql-field";

export type SatelliteOrbitalRow = {
  id: string;
  name: string;
  norad_id: number | null;
  operator: string | null;
  operator_country: string | null;
  launch_year: number | null;
  mass_kg: number | null;
  classification_tier: string | null;
  opacity_score: string | null;
  telemetry_summary: Record<string, unknown> | null;
};

export type SatelliteNameRow = {
  id: string;
  name: string;
  norad_id: string | null;
};

export class SatelliteRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listWithOrbital(limit: number): Promise<SatelliteOrbitalRow[]> {
    const rows = await this.db.execute<SatelliteOrbitalRow>(sql`
      SELECT
        s.id::text                                       AS id,
        s.name,
        NULLIF(s.telemetry_summary->>'noradId','')::int  AS norad_id,
        op.name                                          AS operator,
        oc.name                                          AS operator_country,
        s.launch_year,
        s.mass_kg,
        s.classification_tier,
        s.opacity_score::text,
        s.telemetry_summary
      FROM satellite s
      LEFT JOIN operator op          ON op.id = s.operator_id
      LEFT JOIN operator_country oc  ON oc.id = s.operator_country_id
      WHERE s.telemetry_summary ? 'raan'
      ORDER BY s.id
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async findPayloadNamesByIds(ids: string[]): Promise<SatelliteNameRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<SatelliteNameRow>(sql`
      SELECT id::text, name, norad_id::text
      FROM satellite
      WHERE id = ANY(${sql`ARRAY[${sql.join(
        ids.map((i) => sql`${BigInt(i)}`),
        sql`, `,
      )}]::bigint[]`})
        AND object_class = 'payload'
    `);
    return rows.rows;
  }

  /** Writes a whitelisted field on a satellite row. Field must be in MISSION_WRITABLE_COLUMNS. */
  async updateField(
    satelliteId: string,
    field: string,
    value: string | number,
  ): Promise<void> {
    const col = fieldSqlFor(field);
    const satBigInt = BigInt(satelliteId);
    await this.db.execute(
      sql`UPDATE satellite SET ${col} = ${value} WHERE id = ${satBigInt}`,
    );
  }

  async listNullCandidatesForField(
    field: string,
    limit: number,
  ): Promise<{ id: string; name: string }[]> {
    const col = fieldSqlFor(field);
    const rows = await this.db.execute<{ id: string; name: string }>(sql`
      SELECT id::text, name
      FROM satellite
      WHERE object_class = 'payload'
        AND embedding IS NOT NULL
        AND ${col} IS NULL
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async knnNeighboursForField(
    targetId: string,
    field: string,
    k: number,
  ): Promise<
    Array<{ id: string; value: string | number | null; cos_distance: number }>
  > {
    const col = fieldSqlFor(field);
    const tid = BigInt(targetId);
    const rows = await this.db.execute<{
      id: string;
      value: string | number | null;
      cos_distance: number;
    }>(sql`
      SELECT
        s.id::text AS id,
        s.${col} AS value,
        (s.embedding <=> t.embedding)::float AS cos_distance
      FROM satellite s, (SELECT embedding FROM satellite WHERE id = ${tid}) t
      WHERE s.id != ${tid}
        AND s.object_class = 'payload'
        AND s.${col} IS NOT NULL
        AND s.embedding IS NOT NULL
      ORDER BY s.embedding <=> t.embedding
      LIMIT ${k}
    `);
    return rows.rows;
  }
}
```

- [ ] **Step 4: Run to verify passes**

```bash
cd apps/console-api && pnpm exec vitest run src/repositories/satellite.repository.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/console-api/src/repositories
git commit -m "refactor(console-api): extract SatelliteRepository with KNN + field-update methods"
```

---

### Task 4.2: `repositories/conjunction.repository.ts`

**Files:**

- Create: `apps/console-api/src/repositories/conjunction.repository.ts`

- [ ] **Step 1: Implement (no separate test — covered by `tests/conjunctions.spec.ts`)**

```ts
// apps/console-api/src/repositories/conjunction.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type ConjunctionRow = {
  id: string;
  primary_id: string;
  secondary_id: string;
  primary_name: string;
  secondary_name: string;
  primary_mm: number | null;
  epoch: Date | string;
  min_range_km: number;
  relative_velocity_kmps: number | null;
  probability_of_collision: number | null;
  combined_sigma_km: number | null;
  hard_body_radius_m: number | null;
  pc_method: string | null;
  computed_at: Date | string;
};

export class ConjunctionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async listAboveMinPc(minPc: number): Promise<ConjunctionRow[]> {
    const rows = await this.db.execute<ConjunctionRow>(sql`
      SELECT
        ce.id::text                                         AS id,
        ce.primary_satellite_id::text                       AS primary_id,
        ce.secondary_satellite_id::text                     AS secondary_id,
        sp.name                                             AS primary_name,
        ss.name                                             AS secondary_name,
        NULLIF(sp.telemetry_summary->>'meanMotion','')::float AS primary_mm,
        ce.epoch,
        ce.min_range_km,
        ce.relative_velocity_kmps,
        ce.probability_of_collision,
        ce.combined_sigma_km,
        ce.hard_body_radius_m,
        ce.pc_method,
        ce.computed_at
      FROM conjunction_event ce
      LEFT JOIN satellite sp ON sp.id = ce.primary_satellite_id
      LEFT JOIN satellite ss ON ss.id = ce.secondary_satellite_id
      WHERE COALESCE(ce.probability_of_collision, 0) >= ${minPc}
      ORDER BY ce.probability_of_collision DESC NULLS LAST
      LIMIT 500
    `);
    return rows.rows;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/repositories/conjunction.repository.ts
git commit -m "refactor(console-api): extract ConjunctionRepository"
```

---

### Task 4.3: `repositories/kg.repository.ts`

Extract server.ts lines 254-336 (nodes + edges queries).

**Files:**

- Create: `apps/console-api/src/repositories/kg.repository.ts`

- [ ] **Step 1: Implement**

```ts
// apps/console-api/src/repositories/kg.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type KgSatRow = { id: string; name: string };
export type KgOpRow = { id: string; name: string };
export type KgRegimeRow = { id: string; name: string };
export type KgFindingRow = { id: string; title: string; cortex: string };
export type KgEdgeRow = {
  id: string;
  finding_id: string;
  entity_type: string;
  entity_id: string;
  relation: string;
};

export class KgRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async loadNodeSources(): Promise<{
    sats: KgSatRow[];
    ops: KgOpRow[];
    regimes: KgRegimeRow[];
    findings: KgFindingRow[];
  }> {
    const [sats, ops, regimes, findings] = await Promise.all([
      this.db.execute<KgSatRow>(
        sql`SELECT id::text, name FROM satellite ORDER BY name LIMIT 120`,
      ),
      this.db.execute<KgOpRow>(
        sql`SELECT id::text, name FROM operator ORDER BY name`,
      ),
      this.db.execute<KgRegimeRow>(
        sql`SELECT id::text, name FROM orbit_regime ORDER BY name`,
      ),
      this.db.execute<KgFindingRow>(sql`
        SELECT id::text, title, cortex FROM research_finding
        ORDER BY created_at DESC LIMIT 80
      `),
    ]);
    return {
      sats: sats.rows,
      ops: ops.rows,
      regimes: regimes.rows,
      findings: findings.rows,
    };
  }

  async listRecentEdges(limit = 400): Promise<KgEdgeRow[]> {
    const rows = await this.db.execute<KgEdgeRow>(sql`
      SELECT id::text, finding_id::text, entity_type, entity_id::text, relation
      FROM research_edge ORDER BY id DESC LIMIT ${limit}
    `);
    return rows.rows;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/repositories/kg.repository.ts
git commit -m "refactor(console-api): extract KgRepository"
```

---

### Task 4.4: `repositories/finding.repository.ts` + `research-edge.repository.ts`

**Files:**

- Create: `apps/console-api/src/repositories/finding.repository.ts`
- Create: `apps/console-api/src/repositories/research-edge.repository.ts`

- [ ] **Step 1: Implement `finding.repository.ts`** (server.ts lines 342-360, 468-488, 528-533, 1315-1332, 1602-1620)

```ts
// apps/console-api/src/repositories/finding.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type FindingRow = {
  id: string;
  title: string;
  summary: string;
  cortex: string;
  status: string;
  confidence: number;
  created_at: Date | string;
  research_cycle_id: string;
};

export type FindingDetailRow = FindingRow & { evidence: unknown };

export type FindingInsertInput = {
  cycleId: bigint;
  cortex: string;
  findingType: string;
  urgency: string;
  title: string;
  summary: string;
  evidence: unknown;
  reasoning: string;
  confidence: number;
  impactScore: number;
};

export class FindingRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<FindingRow[]> {
    const { status, cortex } = filters;
    const rows = await this.db.execute<FindingRow>(sql`
      SELECT
        id::text, title, summary, cortex, status::text, confidence,
        created_at, research_cycle_id::text
      FROM research_finding
      WHERE ${status ? sql`status::text = ${status}` : sql`TRUE`}
        AND ${cortex ? sql`cortex::text = ${cortex}` : sql`TRUE`}
      ORDER BY created_at DESC
      LIMIT 300
    `);
    return rows.rows;
  }

  async findById(id: bigint): Promise<FindingDetailRow | null> {
    const rows = await this.db.execute<FindingDetailRow>(sql`
      SELECT id::text, title, summary, cortex, status::text, confidence, evidence, created_at,
             research_cycle_id::text
      FROM research_finding WHERE id = ${id}
    `);
    return rows.rows[0] ?? null;
  }

  async updateStatus(
    id: bigint,
    dbStatus: "active" | "archived" | "invalidated",
  ): Promise<boolean> {
    const updated = await this.db.execute<{ id: string }>(sql`
      UPDATE research_finding
      SET status = ${dbStatus}::finding_status, updated_at = NOW()
      WHERE id = ${id}
      RETURNING id::text
    `);
    return updated.rows.length > 0;
  }

  async insert(input: FindingInsertInput): Promise<bigint> {
    const created = await this.db.execute<{ id: string }>(sql`
      INSERT INTO research_finding
        (research_cycle_id, cortex, finding_type, status, urgency,
         title, summary, evidence, reasoning, confidence, impact_score)
      VALUES
        (${input.cycleId}::bigint,
         ${input.cortex}::cortex,
         ${input.findingType}::finding_type,
         'active'::finding_status,
         ${input.urgency}::urgency,
         ${input.title}::text,
         ${input.summary}::text,
         ${JSON.stringify(input.evidence)}::jsonb,
         ${input.reasoning}::text,
         ${input.confidence}::real,
         ${input.impactScore}::real)
      RETURNING id::text
    `);
    return BigInt(created.rows[0]!.id);
  }
}
```

- [ ] **Step 2: Implement `research-edge.repository.ts`**

```ts
// apps/console-api/src/repositories/research-edge.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type EdgeRow = {
  finding_id: string;
  entity_type: string;
  entity_id: string;
};

export type EdgeInsertInput = {
  findingId: bigint;
  entityType:
    | "satellite"
    | "operator"
    | "operator_country"
    | "payload"
    | "orbit_regime";
  entityId: bigint;
  relation:
    | "about"
    | "supports"
    | "contradicts"
    | "similar_to"
    | "derived_from";
  weight: number;
  context: unknown;
};

export class ResearchEdgeRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findByFindingIds(ids: string[]): Promise<EdgeRow[]> {
    if (ids.length === 0) return [];
    const rows = await this.db.execute<EdgeRow>(sql`
      SELECT finding_id::text, entity_type, entity_id::text
      FROM research_edge
      WHERE finding_id::text = ANY(${sql`ARRAY[${sql.join(
        ids.map((i) => sql`${i}`),
        sql`, `,
      )}]::text[]`})
    `);
    return rows.rows;
  }

  async findByFindingId(
    id: bigint,
    limit = 20,
  ): Promise<Array<{ entity_type: string; entity_id: string }>> {
    const rows = await this.db.execute<{
      entity_type: string;
      entity_id: string;
    }>(sql`
      SELECT entity_type, entity_id::text
      FROM research_edge WHERE finding_id = ${id}
      LIMIT ${limit}
    `);
    return rows.rows;
  }

  async insert(input: EdgeInsertInput): Promise<void> {
    await this.db.execute(sql`
      INSERT INTO research_edge (finding_id, entity_type, entity_id, relation, weight, context)
      VALUES (${input.findingId}::bigint, ${input.entityType}::entity_type, ${input.entityId}::bigint,
              ${input.relation}::relation, ${input.weight}::real, ${JSON.stringify(input.context)}::jsonb)
    `);
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/repositories/finding.repository.ts apps/console-api/src/repositories/research-edge.repository.ts
git commit -m "refactor(console-api): extract FindingRepository + ResearchEdgeRepository"
```

---

### Task 4.5: `enrichment-cycle.repository.ts` + `sweep-audit.repository.ts`

**Files:**

- Create: `apps/console-api/src/repositories/enrichment-cycle.repository.ts`
- Create: `apps/console-api/src/repositories/sweep-audit.repository.ts`

- [ ] **Step 1: Implement `enrichment-cycle.repository.ts`** (server.ts lines 1538-1558)

```ts
// apps/console-api/src/repositories/enrichment-cycle.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export class EnrichmentCycleRepository {
  private cachedId: bigint | null = null;

  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  /** Returns the single long-running catalog-enrichment cycle, creating it lazily. */
  async getOrCreate(): Promise<bigint> {
    if (this.cachedId != null) return this.cachedId;
    const existing = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM research_cycle
      WHERE trigger_source = 'catalog-enrichment'
      ORDER BY id DESC LIMIT 1
    `);
    if (existing.rows[0]) {
      this.cachedId = BigInt(existing.rows[0].id);
      return this.cachedId;
    }
    const created = await this.db.execute<{ id: string }>(sql`
      INSERT INTO research_cycle (trigger_type, trigger_source, status, findings_count)
      VALUES ('system'::cycle_trigger, 'catalog-enrichment', 'running'::cycle_status, 0)
      RETURNING id::text
    `);
    this.cachedId = BigInt(created.rows[0]!.id);
    return this.cachedId;
  }
}
```

- [ ] **Step 2: Implement `sweep-audit.repository.ts`** (server.ts lines 996-1016, 1682-1702)

```ts
// apps/console-api/src/repositories/sweep-audit.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type AuditInsertInput = {
  suggestionId: string;
  operatorCountryName: string;
  title: string;
  description: string;
  suggestedAction: string;
  affectedSatellites: number;
  webEvidence: string;
  resolutionPayload: unknown;
};

export class SweepAuditRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async insertEnrichmentSuccess(input: AuditInsertInput): Promise<void> {
    const payload = JSON.stringify(input.resolutionPayload);
    await this.db.execute(sql`
      INSERT INTO sweep_audit (
        suggestion_id, operator_country_name, category, severity,
        title, description, suggested_action, affected_satellites,
        web_evidence, accepted, resolution_status, resolution_payload, reviewed_at
      ) VALUES (
        ${input.suggestionId},
        ${input.operatorCountryName},
        'enrichment'::sweep_category,
        'info'::sweep_severity,
        ${input.title},
        ${input.description},
        ${input.suggestedAction},
        ${input.affectedSatellites},
        ${input.webEvidence},
        ${true},
        'success'::sweep_resolution_status,
        ${payload}::jsonb,
        NOW()
      )
    `);
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/repositories/enrichment-cycle.repository.ts apps/console-api/src/repositories/sweep-audit.repository.ts
git commit -m "refactor(console-api): extract EnrichmentCycleRepository + SweepAuditRepository"
```

---

### Task 4.6: `reflexion.repository.ts` + `stats.repository.ts`

**Files:**

- Create: `apps/console-api/src/repositories/reflexion.repository.ts`
- Create: `apps/console-api/src/repositories/stats.repository.ts`

- [ ] **Step 1: Implement `reflexion.repository.ts`** (extract all 4 queries from server.ts lines 1164-1276)

```ts
// apps/console-api/src/repositories/reflexion.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type ReflexionTarget = {
  id: string;
  name: string;
  object_class: string | null;
  operator_country: string | null;
  classification_tier: string | null;
  platform_name: string | null;
  inc: number | null;
  raan: number | null;
  mm: number | null;
  ma: number | null;
  apogee: number | null;
  perigee: number | null;
};

export type CoplaneRow = {
  id: string;
  norad_id: string;
  name: string;
  operator_country: string | null;
  tier: string | null;
  object_class: string | null;
  platform: string | null;
  d_inc: number;
  d_raan: number;
  lag_min: number;
};

export type BeltRow = {
  country: string | null;
  tier: string | null;
  object_class: string | null;
  n: string;
};

export type MilRow = {
  id: string;
  norad_id: string;
  name: string;
  country: string | null;
  tier: string | null;
  d_inc: number;
};

export class ReflexionRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findTarget(norad: number): Promise<ReflexionTarget | null> {
    const rows = await this.db.execute<ReflexionTarget>(sql`
      SELECT
        s.id::text AS id,
        s.name,
        s.object_class::text AS object_class,
        oc.name AS operator_country,
        s.classification_tier,
        pc.name AS platform_name,
        (s.telemetry_summary->>'inclination')::float AS inc,
        (s.telemetry_summary->>'raan')::float        AS raan,
        (s.telemetry_summary->>'meanMotion')::float  AS mm,
        (s.telemetry_summary->>'meanAnomaly')::float AS ma,
        (s.metadata->>'apogeeKm')::numeric::float    AS apogee,
        (s.metadata->>'perigeeKm')::numeric::float   AS perigee
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.norad_id = ${norad}
      LIMIT 1
    `);
    return rows.rows[0] ?? null;
  }

  async findStrictCoplane(
    norad: number,
    t: Pick<ReflexionTarget, "inc" | "raan" | "mm" | "ma">,
    dIncMax: number,
    dRaanMax: number,
    dMmMax: number,
  ): Promise<CoplaneRow[]> {
    const rows = await this.db.execute<CoplaneRow>(sql`
      SELECT
        s.id::text,
        s.norad_id::text,
        s.name,
        oc.name AS operator_country,
        s.classification_tier AS tier,
        s.object_class::text AS object_class,
        pc.name AS platform,
        abs((s.telemetry_summary->>'inclination')::float - ${t.inc})::float AS d_inc,
        abs((s.telemetry_summary->>'raan')::float        - ${t.raan})::float AS d_raan,
        ((((s.telemetry_summary->>'meanAnomaly')::float - ${t.ma ?? 0} + 720)::numeric % 360) / 360 * (1440.0/${t.mm}))::float AS lag_min
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      LEFT JOIN platform_class pc   ON pc.id = s.platform_class_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) < ${dIncMax}
        AND abs((s.telemetry_summary->>'raan')::float        - ${t.raan}) < ${dRaanMax}
        AND abs((s.telemetry_summary->>'meanMotion')::float  - ${t.mm})   < ${dMmMax}
      ORDER BY abs((s.telemetry_summary->>'inclination')::float - ${t.inc}) + abs((s.telemetry_summary->>'raan')::float - ${t.raan}) ASC
      LIMIT 30
    `);
    return rows.rows;
  }

  async findInclinationBelt(
    norad: number,
    inc: number,
    dIncMax: number,
  ): Promise<BeltRow[]> {
    const rows = await this.db.execute<BeltRow>(sql`
      SELECT
        oc.name AS country,
        s.classification_tier AS tier,
        s.object_class::text AS object_class,
        count(*)::text AS n
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${inc}) < ${dIncMax}
      GROUP BY oc.name, s.classification_tier, s.object_class
      ORDER BY count(*) DESC
    `);
    return rows.rows;
  }

  async findMilLineagePeers(
    norad: number,
    inc: number,
    dIncMax: number,
  ): Promise<MilRow[]> {
    const rows = await this.db.execute<MilRow>(sql`
      SELECT
        s.id::text,
        s.norad_id::text,
        s.name,
        oc.name AS country,
        s.classification_tier AS tier,
        abs((s.telemetry_summary->>'inclination')::float - ${inc})::float AS d_inc
      FROM satellite s
      LEFT JOIN operator_country oc ON oc.id = s.operator_country_id
      WHERE s.norad_id != ${norad}
        AND s.object_class = 'payload'
        AND abs((s.telemetry_summary->>'inclination')::float - ${inc}) < ${dIncMax}
        AND (
          s.name ILIKE 'YAOGAN%' OR s.name ILIKE 'USA %'   OR s.name ILIKE 'COSMOS%' OR
          s.name ILIKE 'SHIYAN%' OR s.name ILIKE 'NROL%'   OR s.name ILIKE 'LACROSSE%' OR
          s.name ILIKE 'TOPAZ%'  OR s.name ILIKE 'JANUS%'
        )
      ORDER BY d_inc ASC
      LIMIT 20
    `);
    return rows.rows;
  }
}
```

- [ ] **Step 2: Implement `stats.repository.ts`** (server.ts lines 1826-1856)

```ts
// apps/console-api/src/repositories/stats.repository.ts
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";

export type AggregateCounts = {
  satellites: number;
  conjunctions: number;
  findings: number;
  kg_edges: number;
  research_cycles: number;
};

export type GroupedCount = { key: string; count: number };

export class StatsRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async aggregates(): Promise<AggregateCounts> {
    const r = await this.db.execute<AggregateCounts>(sql`
      SELECT
        (SELECT count(*) FROM satellite)            AS satellites,
        (SELECT count(*) FROM conjunction_event)    AS conjunctions,
        (SELECT count(*) FROM research_finding)     AS findings,
        (SELECT count(*) FROM research_edge)        AS kg_edges,
        (SELECT count(*) FROM research_cycle)       AS research_cycles
    `);
    return r.rows[0]!;
  }

  async findingsByStatus(): Promise<Array<{ status: string; count: number }>> {
    const r = await this.db.execute<{ status: string; count: number }>(sql`
      SELECT status::text, count(*)::int FROM research_finding GROUP BY status
    `);
    return r.rows;
  }

  async findingsByCortex(): Promise<Array<{ cortex: string; count: number }>> {
    const r = await this.db.execute<{ cortex: string; count: number }>(sql`
      SELECT cortex::text, count(*)::int FROM research_finding GROUP BY cortex
    `);
    return r.rows;
  }
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/repositories/reflexion.repository.ts apps/console-api/src/repositories/stats.repository.ts
git commit -m "refactor(console-api): extract ReflexionRepository + StatsRepository"
```

---

## Phase 5 — Services (business logic)

### Task 5.1: `services/satellite-view.service.ts`

**Files:**

- Create: `apps/console-api/src/services/satellite-view.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 132-170)

```ts
// apps/console-api/src/services/satellite-view.service.ts
import type { SatelliteView, Regime } from "@interview/shared";
import {
  normaliseRegime,
  regimeFromMeanMotion,
  smaFromMeanMotion,
  classificationTier,
} from "@interview/shared";
import {
  SatelliteRepository,
  type SatelliteOrbitalRow,
} from "../repositories/satellite.repository";

export class SatelliteViewService {
  constructor(private readonly repo: SatelliteRepository) {}

  async list(opts: {
    limit: number;
    regime?: Regime;
  }): Promise<{ items: SatelliteView[]; total: number }> {
    const rows = await this.repo.listWithOrbital(opts.limit);
    const items = rows.map(toView);
    const filtered = opts.regime
      ? items.filter((s) => s.regime === opts.regime)
      : items;
    return { items: filtered, total: filtered.length };
  }
}

function toView(r: SatelliteOrbitalRow): SatelliteView {
  const ts = r.telemetry_summary ?? {};
  const mm = Number(ts.meanMotion ?? 15);
  const inc = Number(ts.inclination ?? 0);
  const ecc = Number(ts.eccentricity ?? 0);
  const regime =
    typeof ts.regime === "string"
      ? normaliseRegime(String(ts.regime))
      : regimeFromMeanMotion(mm);
  const opacityScore = r.opacity_score ? Number(r.opacity_score) : null;
  return {
    id: Number(r.id),
    name: r.name,
    noradId: r.norad_id ?? 0,
    regime,
    operator: r.operator ?? "Unknown",
    country: r.operator_country ?? "—",
    inclinationDeg: inc,
    semiMajorAxisKm: smaFromMeanMotion(mm),
    eccentricity: ecc,
    raanDeg: Number(ts.raan ?? 0),
    argPerigeeDeg: Number(ts.argPerigee ?? 0),
    meanAnomalyDeg: Number(ts.meanAnomaly ?? 0),
    meanMotionRevPerDay: mm,
    epoch: typeof ts.epoch === "string" ? ts.epoch : new Date().toISOString(),
    massKg: r.mass_kg ?? 0,
    classificationTier: classificationTier(r.classification_tier),
    opacityScore,
  };
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/satellite-view.service.ts
git commit -m "refactor(console-api): extract SatelliteViewService"
```

---

### Task 5.2: `services/conjunction-view.service.ts`

**Files:**

- Create: `apps/console-api/src/services/conjunction-view.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 216-250 — reuse shared `deriveCovarianceQuality` from `conjunction-view.ts`; add sibling `deriveAction` helper)

```ts
// apps/console-api/src/services/conjunction-view.service.ts
import type { ConjunctionView } from "@interview/shared";
import {
  deriveCovarianceQuality,
  regimeFromMeanMotion,
} from "@interview/shared";
import {
  ConjunctionRepository,
  type ConjunctionRow,
} from "../repositories/conjunction.repository";

function deriveAction(
  pc: number,
): "maneuver_candidate" | "monitor" | "no_action" {
  if (pc >= 1e-4) return "maneuver_candidate";
  if (pc >= 1e-6) return "monitor";
  return "no_action";
}

function toIso(v: Date | string): string {
  return v instanceof Date ? v.toISOString() : new Date(v).toISOString();
}

export class ConjunctionViewService {
  constructor(private readonly repo: ConjunctionRepository) {}

  async list(
    minPc: number,
  ): Promise<{ items: ConjunctionView[]; total: number }> {
    const rows = await this.repo.listAboveMinPc(minPc);
    const items = rows.map(toView);
    return { items, total: items.length };
  }
}

function toView(r: ConjunctionRow): ConjunctionView {
  const pc = r.probability_of_collision ?? 0;
  const sigma = r.combined_sigma_km ?? 10;
  return {
    id: Number(r.id),
    primaryId: Number(r.primary_id),
    secondaryId: Number(r.secondary_id),
    primaryName: r.primary_name ?? `sat-${r.primary_id}`,
    secondaryName: r.secondary_name ?? `sat-${r.secondary_id}`,
    regime: regimeFromMeanMotion(r.primary_mm),
    epoch: toIso(r.epoch),
    minRangeKm: r.min_range_km,
    relativeVelocityKmps: r.relative_velocity_kmps ?? 0,
    probabilityOfCollision: pc,
    combinedSigmaKm: sigma,
    hardBodyRadiusM: r.hard_body_radius_m ?? 20,
    pcMethod: r.pc_method ?? "foster-gaussian",
    computedAt: toIso(r.computed_at),
    covarianceQuality: deriveCovarianceQuality(sigma),
    action: deriveAction(pc),
  };
}
```

NOTE: If `deriveCovarianceQuality` is not yet exported from `@interview/shared`, add it to `packages/shared/src/ssa/conjunction-view.ts` (see the existing body at line 38 of that file — it already has `deriveCovarianceQuality`). Also add `deriveAction` there and export from both places if frontend needs it.

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/conjunction-view.service.ts
git commit -m "refactor(console-api): extract ConjunctionViewService"
```

---

### Task 5.3: `services/kg-view.service.ts`, `finding-view.service.ts`, `stats.service.ts`

Implement three services that compose repos into DTOs. Pattern is identical — I abbreviate for brevity, but each file must compile and each method must match the exact wire-format of server.ts.

**Files:**

- Create: `apps/console-api/src/services/kg-view.service.ts`
- Create: `apps/console-api/src/services/finding-view.service.ts`
- Create: `apps/console-api/src/services/stats.service.ts`

- [ ] **Step 1: Implement `kg-view.service.ts`** (server.ts lines 254-336)

```ts
// apps/console-api/src/services/kg-view.service.ts
import type { KgNode, KgEdge } from "@interview/shared";
import { KgRepository, type KgEdgeRow } from "../repositories/kg.repository";

export class KgViewService {
  constructor(private readonly repo: KgRepository) {}

  async listNodes(): Promise<{ items: KgNode[] }> {
    const { sats, ops, regimes, findings } = await this.repo.loadNodeSources();
    const items: KgNode[] = [
      ...regimes.map((r) => ({
        id: `regime:${r.name}`,
        label: r.name,
        class: "OrbitRegime" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: "—",
      })),
      ...ops.map((o) => ({
        id: `op:${o.name}`,
        label: o.name,
        class: "Operator" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: "—",
      })),
      ...sats.map((s) => ({
        id: `sat:${s.id}`,
        label: s.name,
        class: "Satellite" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: "catalog",
      })),
      ...findings.map((f) => ({
        id: `finding:${f.id}`,
        label: f.title.slice(0, 32),
        class: "Payload" as const,
        degree: 0,
        x: 0,
        y: 0,
        cortex: f.cortex,
      })),
    ];
    return { items };
  }

  async listEdges(): Promise<{ items: KgEdge[] }> {
    const rows = await this.repo.listRecentEdges();
    return { items: rows.map(toEdge) };
  }
}

function toEdge(e: KgEdgeRow): KgEdge {
  return {
    id: e.id,
    source: `finding:${e.finding_id}`,
    target:
      e.entity_type === "satellite"
        ? `sat:${e.entity_id}`
        : e.entity_type === "operator"
          ? `op:${e.entity_id}`
          : `${e.entity_type}:${e.entity_id}`,
    relation: e.relation,
  };
}
```

- [ ] **Step 2: Implement `finding-view.service.ts`** (server.ts lines 362-402, 488-514, 518-539)

```ts
// apps/console-api/src/services/finding-view.service.ts
import type { FindingView } from "@interview/shared";
import {
  mapFindingStatus,
  parseFindingId,
  toDbStatus,
} from "../utils/finding-status";
import {
  FindingRepository,
  type FindingRow,
  type FindingDetailRow,
} from "../repositories/finding.repository";
import { ResearchEdgeRepository } from "../repositories/research-edge.repository";

export class FindingViewService {
  constructor(
    private readonly findings: FindingRepository,
    private readonly edges: ResearchEdgeRepository,
  ) {}

  async list(filters: {
    status?: string;
    cortex?: string;
  }): Promise<{ items: FindingView[]; total: number }> {
    const rows = await this.findings.list(filters);
    const items: FindingView[] = rows.map(toListView);
    if (items.length > 0) {
      const ids = items.map((i) => i.id.slice(2));
      const edgeRows = await this.edges.findByFindingIds(ids);
      const edgeMap = new Map<string, string[]>();
      for (const e of edgeRows) {
        const key = `f:${e.finding_id}`;
        const linked = entityRef(e.entity_type, e.entity_id);
        if (!edgeMap.has(key)) edgeMap.set(key, []);
        edgeMap.get(key)!.push(linked);
      }
      for (const f of items) f.linkedEntityIds = edgeMap.get(f.id) ?? [];
    }
    return { items, total: items.length };
  }

  async findById(idRaw: string): Promise<FindingView | null | "invalid"> {
    const fid = parseFindingId(idRaw);
    if (fid === null) return "invalid";
    const row = await this.findings.findById(fid);
    if (!row) return null;
    const edgeRows = await this.edges.findByFindingId(fid, 20);
    return toDetailView(row, edgeRows);
  }

  async updateDecision(
    idRaw: string,
    decision: string,
  ): Promise<FindingView | null | "invalid"> {
    const fid = parseFindingId(idRaw);
    if (fid === null) return "invalid";
    if (!["accepted", "rejected", "pending", "in-review"].includes(decision))
      return "invalid";
    const ok = await this.findings.updateStatus(fid, toDbStatus(decision));
    if (!ok) return null;
    return this.findById(idRaw);
  }
}

function entityRef(type: string, id: string): string {
  if (type === "satellite") return `sat:${id}`;
  if (type === "operator") return `op:${id}`;
  return `${type}:${id}`;
}

function toListView(f: FindingRow): FindingView {
  return {
    id: `f:${f.id}`,
    title: f.title,
    summary: f.summary,
    cortex: f.cortex,
    status: mapFindingStatus(f.status),
    priority: Math.round(f.confidence * 100),
    createdAt: (f.created_at instanceof Date
      ? f.created_at
      : new Date(f.created_at)
    ).toISOString(),
    linkedEntityIds: [],
    evidence: [],
  };
}

function toDetailView(
  f: FindingDetailRow,
  edgeRows: Array<{ entity_type: string; entity_id: string }>,
): FindingView {
  const linkedEntityIds = edgeRows.map((e) =>
    entityRef(e.entity_type, e.entity_id),
  );
  const evidence = Array.isArray(f.evidence)
    ? (
        f.evidence as Array<{
          source?: string;
          data?: { url?: string; uri?: string; snippet?: string };
        }>
      ).map((e) => {
        const d = e.data ?? {};
        const src = String(e.source ?? "derived").toLowerCase();
        const kind =
          src === "field"
            ? ("field" as const)
            : src === "osint"
              ? ("osint" as const)
              : ("derived" as const);
        return { kind, uri: d.url ?? d.uri ?? "—", snippet: d.snippet ?? "" };
      })
    : [];
  return {
    id: `f:${f.id}`,
    title: f.title,
    summary: f.summary,
    cortex: f.cortex,
    status: mapFindingStatus(f.status),
    priority: Math.round(f.confidence * 100),
    createdAt: (f.created_at instanceof Date
      ? f.created_at
      : new Date(f.created_at)
    ).toISOString(),
    linkedEntityIds,
    evidence,
  };
}
```

- [ ] **Step 3: Implement `stats.service.ts`** (server.ts lines 1825-1868)

```ts
// apps/console-api/src/services/stats.service.ts
import { mapFindingStatus } from "../utils/finding-status";
import type { StatsRepository } from "../repositories/stats.repository";

export type StatsView = {
  satellites: number;
  conjunctions: number;
  kgNodes: number;
  kgEdges: number;
  findings: number;
  researchCycles: number;
  byStatus: Record<string, number>;
  byCortex: Record<string, number>;
};

export class StatsService {
  constructor(private readonly repo: StatsRepository) {}

  async snapshot(): Promise<StatsView> {
    const [agg, byStatusRaw, byCortex] = await Promise.all([
      this.repo.aggregates(),
      this.repo.findingsByStatus(),
      this.repo.findingsByCortex(),
    ]);

    const byStatusMapped = new Map<string, number>();
    for (const r of byStatusRaw) {
      const mapped = mapFindingStatus(r.status);
      byStatusMapped.set(
        mapped,
        (byStatusMapped.get(mapped) ?? 0) + Number(r.count),
      );
    }

    return {
      satellites: Number(agg.satellites),
      conjunctions: Number(agg.conjunctions),
      kgNodes: Number(agg.satellites) + Number(agg.findings),
      kgEdges: Number(agg.kg_edges),
      findings: Number(agg.findings),
      researchCycles: Number(agg.research_cycles),
      byStatus: Object.fromEntries(byStatusMapped),
      byCortex: Object.fromEntries(
        byCortex.map((r) => [r.cortex, Number(r.count)]),
      ),
    };
  }
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/kg-view.service.ts apps/console-api/src/services/finding-view.service.ts apps/console-api/src/services/stats.service.ts
git commit -m "refactor(console-api): extract KgViewService + FindingViewService + StatsService"
```

---

### Task 5.4: `services/enrichment-finding.service.ts`

**Files:**

- Create: `apps/console-api/src/services/enrichment-finding.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 1568-1655)

```ts
// apps/console-api/src/services/enrichment-finding.service.ts
import type Redis from "ioredis";
import type { EnrichmentCycleRepository } from "../repositories/enrichment-cycle.repository";
import type { FindingRepository } from "../repositories/finding.repository";
import type { ResearchEdgeRepository } from "../repositories/research-edge.repository";

export type EmitArgs = {
  kind: "knn" | "mission";
  satelliteId: string;
  field: string;
  value: string | number;
  confidence: number;
  source: string;
  neighbourIds?: string[];
  cosSim?: number;
};

export class EnrichmentFindingService {
  constructor(
    private readonly cycles: EnrichmentCycleRepository,
    private readonly findings: FindingRepository,
    private readonly edges: ResearchEdgeRepository,
    private readonly redis: Redis,
  ) {}

  async emit(args: EmitArgs): Promise<void> {
    const cycleId = await this.cycles.getOrCreate();
    const satBig = BigInt(args.satelliteId);
    const title = `${args.kind === "knn" ? "KNN" : "Mission"} fill · ${args.field}=${args.value}`;
    const summary =
      args.kind === "knn"
        ? `${args.field} propagated to satellite #${args.satelliteId} from ${args.neighbourIds?.length ?? 0} semantically similar payloads (cos_sim=${args.cosSim?.toFixed(3) ?? "?"}).`
        : `${args.field} written to satellite #${args.satelliteId} from web-search source (confidence=${args.confidence.toFixed(2)}).`;
    const evidence =
      args.kind === "knn"
        ? [
            {
              source: "knn",
              data: {
                field: args.field,
                value: args.value,
                cosSim: args.cosSim,
                neighbours: args.neighbourIds ?? [],
              },
              weight: args.confidence,
            },
          ]
        : [
            {
              source: "web",
              data: { field: args.field, value: args.value, url: args.source },
              weight: args.confidence,
            },
          ];
    const reasoning =
      args.kind === "knn"
        ? `Zero-LLM propagation: median consensus of K=${args.neighbourIds?.length ?? 0} nearest payloads in Voyage halfvec(2048) space.`
        : `Web-mission 2-vote corroboration: two independent nano calls agreed on this value from ${args.source}.`;

    const findingId = await this.findings.insert({
      cycleId,
      cortex: "data_auditor",
      findingType: "insight",
      urgency: "low",
      title,
      summary,
      evidence,
      reasoning,
      confidence: args.confidence,
      impactScore: 0.3,
    });

    await this.edges.insert({
      findingId,
      entityType: "satellite",
      entityId: satBig,
      relation: "about",
      weight: 1.0,
      context: { field: args.field, value: String(args.value) },
    });

    if (args.kind === "knn" && args.neighbourIds?.length) {
      for (const nid of args.neighbourIds.slice(0, 10)) {
        await this.edges.insert({
          findingId,
          entityType: "satellite",
          entityId: BigInt(nid),
          relation: "similar_to",
          weight: args.cosSim ?? 0.8,
          context: { role: "knn_neighbour", cosSim: args.cosSim ?? null },
        });
      }
    }

    await this.redis.lpush(
      "sweep:feedback",
      JSON.stringify({
        category: "enrichment",
        wasAccepted: true,
        reviewerNote: `${args.kind}-fill: ${args.field}=${args.value}`,
        operatorCountryName:
          args.kind === "knn" ? "knn-propagation" : "web-mission",
      }),
    );
    await this.redis.ltrim("sweep:feedback", 0, 199);
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/enrichment-finding.service.ts
git commit -m "refactor(console-api): extract EnrichmentFindingService"
```

---

### Task 5.5: `services/nano-research.service.ts`

**Files:**

- Create: `apps/console-api/src/services/nano-research.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 816-875)

```ts
// apps/console-api/src/services/nano-research.service.ts
import { BAS_NIVEAU_LOGIT_BIAS, callNanoWithMode } from "@interview/thalamus";
import {
  MISSION_SYSTEM_PROMPT,
  MISSION_RESPONSE_FORMAT,
} from "../prompts/mission-research.prompt";
import { detectFabrication } from "../utils/fabrication-detector";
import { unitMismatch } from "../utils/field-constraints";
import type { MissionTask, NanoResult } from "../types";

const failed = (reason: string): NanoResult => ({
  ok: false,
  value: null,
  confidence: 0,
  source: "",
  unit: "",
  reason,
});

export class NanoResearchService {
  async singleVote(task: MissionTask, angle: string): Promise<NanoResult> {
    const noradPart = task.noradId ? ` (NORAD ${task.noradId})` : "";
    const userPrompt = `Satellite: ${task.satelliteName}${noradPart}, operated by ${task.operatorCountry}.
Field to fill: "${task.field}".
${angle}
Find the exact documented value for THIS specific satellite. JSON only. Cite the URL you opened.`;

    const nano = await callNanoWithMode({
      instructions: MISSION_SYSTEM_PROMPT,
      input: userPrompt,
      enableWebSearch: true,
      responseFormat: MISSION_RESPONSE_FORMAT,
      logitBias: BAS_NIVEAU_LOGIT_BIAS,
    });
    if (!nano.ok) return failed(nano.error ?? "nano call failed");

    const hedge = detectFabrication(nano.text);
    if (hedge) return failed(`hedging "${hedge}"`);

    const match = nano.text.match(/\{[\s\S]*\}/);
    if (!match) return failed("no JSON");
    let parsed: {
      value: string | number | null;
      unit?: string;
      confidence: number;
      source?: string;
    };
    try {
      parsed = JSON.parse(match[0]);
    } catch {
      return failed("invalid JSON");
    }

    const source = (parsed.source ?? "").trim();
    if (parsed.value === null) return failed("no value");
    if (parsed.confidence < 0.6)
      return failed(`low confidence ${parsed.confidence}`);
    if (!/^https:\/\/[^\s]+$/.test(source)) return failed("no https source");
    if (!nano.urls.some((u) => u.includes(new URL(source).host)))
      return failed("source not cited");
    if (unitMismatch(task.field, parsed.unit ?? ""))
      return failed(`unit "${parsed.unit}"`);

    return {
      ok: true,
      value: parsed.value,
      confidence: parsed.confidence,
      source,
      unit: parsed.unit ?? "",
      reason: "",
    };
  }

  votesAgree(a: string | number, b: string | number): boolean {
    if (typeof a === "number" && typeof b === "number") {
      const denom = Math.max(Math.abs(a), Math.abs(b), 1e-9);
      return Math.abs(a - b) / denom <= 0.1;
    }
    return String(a).trim().toLowerCase() === String(b).trim().toLowerCase();
  }

  summary(v: NanoResult): string {
    return v.ok ? "ok" : v.reason;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/nano-research.service.ts
git commit -m "refactor(console-api): extract NanoResearchService"
```

---

### Task 5.6: `services/mission.service.ts`

**Files:**

- Create: `apps/console-api/src/services/mission.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 877-1132)

```ts
// apps/console-api/src/services/mission.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { MissionState, MissionTask } from "../types";
import type { SatelliteRepository } from "../repositories/satellite.repository";
import type { SweepAuditRepository } from "../repositories/sweep-audit.repository";
import type { NanoResearchService } from "./nano-research.service";
import type { EnrichmentFindingService } from "./enrichment-finding.service";
import { MISSION_WRITABLE_COLUMNS, inRange } from "../utils/field-constraints";

const MAX_SATS_PER_SUGGESTION = 5;
const TICK_INTERVAL_MS = 1500;

type SweepListRow = {
  id: string;
  operatorCountryName: string | null;
  resolutionPayload: string | null;
};

export interface SweepListProvider {
  list(opts: {
    reviewed: boolean;
    limit: number;
  }): Promise<{ rows: SweepListRow[] }>;
}

export class MissionService {
  private state: MissionState = {
    running: false,
    startedAt: null,
    tasks: [],
    completedCount: 0,
    filledCount: 0,
    unobtainableCount: 0,
    errorCount: 0,
    cursor: 0,
    timer: null,
    busy: false,
  };

  constructor(
    private readonly satellites: SatelliteRepository,
    private readonly audit: SweepAuditRepository,
    private readonly nano: NanoResearchService,
    private readonly enrichment: EnrichmentFindingService,
    private readonly sweepRepo: SweepListProvider,
    private readonly logger: FastifyBaseLogger,
  ) {}

  publicState() {
    return {
      running: this.state.running,
      startedAt: this.state.startedAt,
      total: this.state.tasks.length,
      completed: this.state.completedCount,
      filled: this.state.filledCount,
      unobtainable: this.state.unobtainableCount,
      errors: this.state.errorCount,
      cursor: this.state.cursor,
      currentTask:
        this.state.running && this.state.cursor > 0
          ? this.state.tasks[this.state.cursor - 1]
          : null,
      recent: this.state.tasks
        .filter((t) => t.status !== "pending")
        .slice(-20)
        .reverse(),
    };
  }

  async start(opts: {
    maxSatsPerSuggestion?: number;
  }): Promise<{
    ok: true;
    alreadyRunning?: boolean;
    state: ReturnType<MissionService["publicState"]>;
  }> {
    if (this.state.running)
      return { ok: true, alreadyRunning: true, state: this.publicState() };
    const cap = Math.max(
      1,
      Math.min(20, opts.maxSatsPerSuggestion ?? MAX_SATS_PER_SUGGESTION),
    );
    const listing = await this.sweepRepo.list({ reviewed: false, limit: 300 });
    const tasks: MissionTask[] = [];

    for (const r of listing.rows) {
      if (!r.resolutionPayload) continue;
      if (
        !r.operatorCountryName ||
        r.operatorCountryName.toLowerCase().includes("unknown")
      )
        continue;
      try {
        const p = JSON.parse(r.resolutionPayload) as {
          actions?: Array<{
            kind?: string;
            field?: string;
            value?: unknown;
            satelliteIds?: string[];
          }>;
        };
        const action = p.actions?.[0];
        if (!action || action.kind !== "update_field" || !action.field)
          continue;
        if (!MISSION_WRITABLE_COLUMNS[action.field]) continue;
        if (action.value !== null && action.value !== undefined) continue;
        const satIds = (action.satelliteIds ?? []).slice(0, cap);
        if (satIds.length === 0) continue;
        const satRows = await this.satellites.findPayloadNamesByIds(satIds);
        for (const s of satRows) {
          tasks.push({
            suggestionId: r.id,
            satelliteId: s.id,
            satelliteName: s.name,
            noradId: s.norad_id ? Number(s.norad_id) : null,
            field: action.field,
            operatorCountry: r.operatorCountryName,
            status: "pending",
            value: null,
            confidence: 0,
            source: null,
          });
        }
      } catch {
        // skip malformed payload
      }
    }

    this.state = {
      running: true,
      startedAt: new Date().toISOString(),
      tasks,
      completedCount: 0,
      filledCount: 0,
      unobtainableCount: 0,
      errorCount: 0,
      cursor: 0,
      busy: false,
      timer: setInterval(() => {
        void this.tick();
      }, TICK_INTERVAL_MS),
    };
    void this.tick();
    return { ok: true, state: this.publicState() };
  }

  stop(): { ok: true; state: ReturnType<MissionService["publicState"]> } {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = null;
    this.state.running = false;
    return { ok: true, state: this.publicState() };
  }

  private async tick(): Promise<void> {
    if (this.state.busy || !this.state.running) return;
    if (this.state.cursor >= this.state.tasks.length) {
      this.state.running = false;
      if (this.state.timer) clearInterval(this.state.timer);
      this.state.timer = null;
      return;
    }
    this.state.busy = true;
    const task = this.state.tasks[this.state.cursor]!;
    this.state.cursor++;
    try {
      await this.runTask(task);
      this.state.completedCount++;
      if (task.status === "filled") this.state.filledCount++;
      else if (task.status === "unobtainable") this.state.unobtainableCount++;
      else if (task.status === "error") this.state.errorCount++;
    } finally {
      this.state.busy = false;
    }
  }

  private async runTask(task: MissionTask): Promise<void> {
    task.status = "researching";
    task.startedAt = new Date().toISOString();
    try {
      const vote1 = await this.nano.singleVote(
        task,
        "Check the operator's official documentation first.",
      );
      const vote2 = await this.nano.singleVote(
        task,
        "Check Wikipedia / eoPortal / Gunter's Space Page first.",
      );
      if (!vote1.ok || !vote2.ok) {
        task.status = "unobtainable";
        task.value = null;
        task.confidence = 0;
        task.source = vote1.ok ? vote1.source : vote2.ok ? vote2.source : null;
        task.error = `vote1=${this.nano.summary(vote1)}; vote2=${this.nano.summary(vote2)}`;
        task.completedAt = new Date().toISOString();
        return;
      }
      const v1 = vote1.value as string | number;
      const v2 = vote2.value as string | number;
      if (!this.nano.votesAgree(v1, v2)) {
        task.status = "unobtainable";
        task.value = null;
        task.confidence = 0;
        task.source = vote1.source;
        task.error = `votes disagree: ${v1} vs ${v2}`;
        task.completedAt = new Date().toISOString();
        return;
      }
      task.status = "filled";
      task.value = v1;
      task.confidence = Math.min(
        0.95,
        (vote1.confidence + vote2.confidence) / 2 + 0.15,
      );
      task.source = vote1.source;
      await this.applyFill(task.satelliteId, task.field, v1, task.source);
    } catch (err) {
      task.status = "error";
      task.error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { err: task.error, taskId: task.suggestionId },
        "mission task failed",
      );
    }
    task.completedAt = new Date().toISOString();
  }

  private async applyFill(
    satelliteId: string,
    field: string,
    value: string | number,
    source: string,
  ): Promise<void> {
    const kind = MISSION_WRITABLE_COLUMNS[field];
    if (!kind) return;
    const coerced =
      kind === "numeric"
        ? typeof value === "number"
          ? value
          : Number.parseFloat(String(value).replace(/[^\d.+-]/g, ""))
        : String(value);
    if (kind === "numeric" && !Number.isFinite(coerced as number)) return;
    if (kind === "numeric" && !inRange(field, coerced as number)) return;

    await this.satellites.updateField(satelliteId, field, coerced);
    await this.audit.insertEnrichmentSuccess({
      suggestionId: `mission:${satelliteId}:${field}`,
      operatorCountryName: "mission-fill",
      title: `Fill ${field}=${coerced} on satellite ${satelliteId}`,
      description: "",
      suggestedAction: `UPDATE satellite SET ${field}=${coerced}`,
      affectedSatellites: 1,
      webEvidence: source,
      resolutionPayload: { field, value: coerced, source },
    });
    await this.enrichment.emit({
      kind: "mission",
      satelliteId,
      field,
      value: coerced,
      confidence: 0.9,
      source,
    });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/mission.service.ts
git commit -m "refactor(console-api): extract MissionService"
```

---

### Task 5.7: `services/knn-propagation.service.ts`

**Files:**

- Create: `apps/console-api/src/services/knn-propagation.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 1406-1532 + 1657-1715)

```ts
// apps/console-api/src/services/knn-propagation.service.ts
import type { SatelliteRepository } from "../repositories/satellite.repository";
import type { SweepAuditRepository } from "../repositories/sweep-audit.repository";
import type { EnrichmentFindingService } from "./enrichment-finding.service";
import { MISSION_WRITABLE_COLUMNS, inRange } from "../utils/field-constraints";

export type PropagateInput = {
  field: string;
  k: number;
  minSim: number;
  limit: number;
  dryRun: boolean;
};

export type PropagateStats = {
  field: string;
  k: number;
  minSim: number;
  attempted: number;
  filled: number;
  disagree: number;
  tooFar: number;
  outOfRange: number;
  sampleFills: Array<{
    id: string;
    name: string;
    value: string | number;
    neighbourIds: string[];
    cosSim: number;
  }>;
};

export class KnnPropagationService {
  constructor(
    private readonly satellites: SatelliteRepository,
    private readonly audit: SweepAuditRepository,
    private readonly enrichment: EnrichmentFindingService,
  ) {}

  async propagate(input: PropagateInput): Promise<PropagateStats> {
    const kind = MISSION_WRITABLE_COLUMNS[input.field]!;
    const maxDist = 1 - input.minSim;
    const targets = await this.satellites.listNullCandidatesForField(
      input.field,
      input.limit,
    );

    const stats: PropagateStats = {
      field: input.field,
      k: input.k,
      minSim: input.minSim,
      attempted: 0,
      filled: 0,
      disagree: 0,
      tooFar: 0,
      outOfRange: 0,
      sampleFills: [],
    };

    for (const t of targets) {
      stats.attempted++;
      const neighbours = await this.satellites.knnNeighboursForField(
        t.id,
        input.field,
        input.k,
      );
      if (neighbours.length < 3) {
        stats.tooFar++;
        continue;
      }
      const nearest = neighbours[0]!;
      if (nearest.cos_distance > maxDist) {
        stats.tooFar++;
        continue;
      }

      const values: Array<string | number> = [];
      for (const n of neighbours) {
        if (n.value == null) continue;
        if (kind === "numeric") {
          const num =
            typeof n.value === "number"
              ? n.value
              : Number.parseFloat(String(n.value));
          if (!Number.isFinite(num) || !inRange(input.field, num)) {
            stats.outOfRange++;
            continue;
          }
          values.push(num);
        } else {
          values.push(String(n.value).trim().toLowerCase());
        }
      }
      if (values.length < 3) {
        stats.tooFar++;
        continue;
      }

      let consensus: string | number | null = null;
      if (kind === "numeric") {
        const nums = (values as number[]).slice().sort((a, b) => a - b);
        const median = nums[Math.floor(nums.length / 2)]!;
        const denom = Math.max(Math.abs(median), 1e-9);
        if (nums.every((v) => Math.abs(v - median) / denom <= 0.1))
          consensus = median;
      } else {
        const freq = new Map<string, number>();
        for (const v of values)
          freq.set(String(v), (freq.get(String(v)) ?? 0) + 1);
        let top: [string, number] | null = null;
        for (const [val, n] of freq) if (!top || n > top[1]) top = [val, n];
        if (top && top[1] / values.length >= 0.66) consensus = top[0];
      }

      if (consensus == null) {
        stats.disagree++;
        continue;
      }

      const cosSim = 1 - nearest.cos_distance;
      const neighbourIds = neighbours.map((n) => n.id);

      if (!input.dryRun) {
        await this.applyFill(
          t.id,
          input.field,
          consensus,
          neighbourIds,
          cosSim,
        );
      }
      stats.filled++;
      if (stats.sampleFills.length < 10) {
        stats.sampleFills.push({
          id: t.id,
          name: t.name,
          value: consensus,
          neighbourIds: neighbourIds.slice(0, 3),
          cosSim: Number(cosSim.toFixed(3)),
        });
      }
    }

    return stats;
  }

  private async applyFill(
    satelliteId: string,
    field: string,
    value: string | number,
    neighbourIds: string[],
    cosSim: number,
  ): Promise<void> {
    const kind = MISSION_WRITABLE_COLUMNS[field];
    const coerced = kind === "numeric" ? Number(value) : String(value);
    await this.satellites.updateField(satelliteId, field, coerced);

    const source = `knn_propagation:k=${neighbourIds.length},cosSim=${cosSim.toFixed(3)},neighbours=[${neighbourIds.slice(0, 5).join(",")}]`;
    await this.audit.insertEnrichmentSuccess({
      suggestionId: `knn:${satelliteId}:${field}`,
      operatorCountryName: "knn-propagation",
      title: `KNN-fill ${field}=${coerced} on satellite ${satelliteId}`,
      description: "",
      suggestedAction: `UPDATE satellite SET ${field}=${coerced} (knn)`,
      affectedSatellites: 1,
      webEvidence: source,
      resolutionPayload: {
        field,
        value: coerced,
        source,
        neighbourIds,
        cosSim,
      },
    });
    await this.enrichment.emit({
      kind: "knn",
      satelliteId,
      field,
      value: coerced,
      confidence: Math.max(0.5, Math.min(0.95, cosSim)),
      source,
      neighbourIds,
      cosSim,
    });
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/knn-propagation.service.ts
git commit -m "refactor(console-api): extract KnnPropagationService"
```

---

### Task 5.8: `services/reflexion.service.ts`

**Files:**

- Create: `apps/console-api/src/services/reflexion.service.ts`

- [ ] **Step 1: Implement** (server.ts lines 1154-1385)

```ts
// apps/console-api/src/services/reflexion.service.ts
import type { ReflexionBody } from "../types";
import type {
  ReflexionRepository,
  CoplaneRow,
  BeltRow,
  MilRow,
} from "../repositories/reflexion.repository";
import type { EnrichmentCycleRepository } from "../repositories/enrichment-cycle.repository";
import type { FindingRepository } from "../repositories/finding.repository";
import type { ResearchEdgeRepository } from "../repositories/research-edge.repository";

export type ReflexionResult = {
  target: {
    noradId: number;
    name: string;
    declared: {
      operator_country: string | null;
      classification_tier: string | null;
      object_class: string | null;
      platform: string | null;
    };
    orbital: {
      inclinationDeg: number;
      raanDeg: number;
      meanMotionRevPerDay: number;
      apogeeKm: number | null;
      perigeeKm: number | null;
    };
  };
  strictCoplane: Array<{
    noradId: number;
    name: string;
    country: string | null;
    tier: string | null;
    class: string | null;
    platform: string | null;
    dInc: number;
    dRaan: number;
    lagMin: number;
  }>;
  beltByCountry: Array<{
    country: string | null;
    tier: string | null;
    class: string | null;
    n: number;
  }>;
  milLineagePeers: Array<{
    noradId: number;
    name: string;
    country: string | null;
    tier: string | null;
    dInc: number;
  }>;
  findingId: string | null;
};

export class ReflexionService {
  constructor(
    private readonly repo: ReflexionRepository,
    private readonly cycles: EnrichmentCycleRepository,
    private readonly findings: FindingRepository,
    private readonly edges: ResearchEdgeRepository,
  ) {}

  async runPass(
    body: ReflexionBody,
  ): Promise<ReflexionResult | { error: string; code: 400 | 404 }> {
    const norad = Number(body.noradId);
    if (!Number.isFinite(norad))
      return { error: "noradId required (number)", code: 400 };
    const dIncMax = Math.max(0.01, Math.min(5, body.dIncMax ?? 0.3));
    const dRaanMax = Math.max(0.1, Math.min(20, body.dRaanMax ?? 5.0));
    const dMmMax = Math.max(0.001, Math.min(0.5, body.dMmMax ?? 0.05));

    const t = await this.repo.findTarget(norad);
    if (!t) return { error: "satellite not found", code: 404 };
    if (t.inc == null || t.raan == null || t.mm == null)
      return { error: "target missing orbital elements", code: 400 };

    const [strict, belt, mil] = await Promise.all([
      this.repo.findStrictCoplane(norad, t, dIncMax, dRaanMax, dMmMax),
      this.repo.findInclinationBelt(norad, t.inc, dIncMax),
      this.repo.findMilLineagePeers(norad, t.inc, dIncMax),
    ]);

    const declaredCountry = t.operator_country;
    const beltTop = belt.length > 0 ? belt[0]! : null;
    const mostCommonCountry = beltTop?.country ?? null;
    const divergentCountry = Boolean(
      mostCommonCountry &&
      declaredCountry &&
      mostCommonCountry !== declaredCountry,
    );
    const shouldEmit = mil.length > 0 || divergentCountry;

    let findingId: bigint | null = null;
    if (shouldEmit) {
      findingId = await this.emitFinding({
        t,
        norad,
        declaredCountry,
        strict,
        belt,
        mil,
        mostCommonCountry,
        dIncMax,
      });
    }

    return {
      target: {
        noradId: norad,
        name: t.name,
        declared: {
          operator_country: declaredCountry,
          classification_tier: t.classification_tier,
          object_class: t.object_class,
          platform: t.platform_name,
        },
        orbital: {
          inclinationDeg: t.inc,
          raanDeg: t.raan,
          meanMotionRevPerDay: t.mm,
          apogeeKm: t.apogee,
          perigeeKm: t.perigee,
        },
      },
      strictCoplane: strict.map((r) => ({
        noradId: Number(r.norad_id),
        name: r.name,
        country: r.operator_country,
        tier: r.tier,
        class: r.object_class,
        platform: r.platform,
        dInc: Number(r.d_inc.toFixed(3)),
        dRaan: Number(r.d_raan.toFixed(2)),
        lagMin: Number(r.lag_min.toFixed(1)),
      })),
      beltByCountry: belt.map((r) => ({
        country: r.country,
        tier: r.tier,
        class: r.object_class,
        n: Number(r.n),
      })),
      milLineagePeers: mil.map((m) => ({
        noradId: Number(m.norad_id),
        name: m.name,
        country: m.country,
        tier: m.tier,
        dInc: Number(m.d_inc.toFixed(3)),
      })),
      findingId: findingId ? String(findingId) : null,
    };
  }

  private async emitFinding(args: {
    t: Awaited<ReturnType<ReflexionRepository["findTarget"]>> & object;
    norad: number;
    declaredCountry: string | null;
    strict: CoplaneRow[];
    belt: BeltRow[];
    mil: MilRow[];
    mostCommonCountry: string | null;
    dIncMax: number;
  }): Promise<bigint> {
    const {
      t,
      norad,
      declaredCountry,
      strict,
      belt,
      mil,
      mostCommonCountry,
      dIncMax,
    } = args;
    const cycleId = await this.cycles.getOrCreate();
    const title =
      mil.length > 0
        ? `Orbital anomaly · ${t.name} shares inclination with ${mil.length} military-lineage peer(s)`
        : `Orbital anomaly · ${t.name} inclination-belt dominated by ${mostCommonCountry} (declared ${declaredCountry})`;
    const summary = [
      `Target ${t.name} (NORAD ${norad}) declared ${t.object_class ?? "?"} / ${t.classification_tier ?? "?"} / ${declaredCountry ?? "?"}.`,
      `Strict co-plane companions: ${strict.length}.`,
      `Inclination-belt peers at Δi<${dIncMax}°: ${belt.reduce((s, r) => s + Number(r.n), 0)}, top by country = ${belt
        .slice(0, 3)
        .map((r) => `${r.country ?? "?"}:${r.n}`)
        .join(", ")}.`,
      mil.length > 0
        ? `MIL-lineage name-matches in belt: ${mil
            .slice(0, 5)
            .map((m) => `${m.name} (${m.country}, Δi=${m.d_inc.toFixed(2)}°)`)
            .join("; ")}.`
        : "No explicit MIL-lineage name match.",
    ].join(" ");
    const evidence = [
      {
        source: "orbital_reflexion",
        data: {
          target: {
            noradId: norad,
            name: t.name,
            inc: t.inc,
            raan: t.raan,
            mm: t.mm,
            declared: {
              operator_country: declaredCountry,
              classification_tier: t.classification_tier,
              object_class: t.object_class,
              platform: t.platform_name,
            },
          },
          strictCoplane: strict
            .slice(0, 10)
            .map((r) => ({
              noradId: Number(r.norad_id),
              name: r.name,
              country: r.operator_country,
              platform: r.platform,
              dInc: Number(r.d_inc.toFixed(3)),
              dRaan: Number(r.d_raan.toFixed(2)),
              lagMin: Number(r.lag_min.toFixed(1)),
            })),
          beltByCountry: belt
            .slice(0, 10)
            .map((r) => ({
              country: r.country,
              tier: r.tier,
              class: r.object_class,
              n: Number(r.n),
            })),
          milLineagePeers: mil.map((m) => ({
            noradId: Number(m.norad_id),
            name: m.name,
            country: m.country,
            tier: m.tier,
            dInc: Number(m.d_inc.toFixed(3)),
          })),
        },
        weight: 0.9,
      },
    ];
    const urgency = mil.length >= 1 ? "high" : "medium";
    const reasoning =
      "Orbital fingerprint reflexion: SQL cross-tab on (inc, raan, meanMotion) against declared classification. No LLM. Provenance: every cited peer traced via similar_to edges.";

    const findingId = await this.findings.insert({
      cycleId,
      cortex: "classification_auditor",
      findingType: "anomaly",
      urgency,
      title,
      summary,
      evidence,
      reasoning,
      confidence: 0.8,
      impactScore: 0.7,
    });

    await this.edges.insert({
      findingId,
      entityType: "satellite",
      entityId: BigInt(t.id),
      relation: "about",
      weight: 1.0,
      context: {
        noradId: norad,
        declared: {
          operator_country: declaredCountry,
          tier: t.classification_tier,
          object_class: t.object_class,
        },
      },
    });
    for (const m of mil.slice(0, 10)) {
      await this.edges.insert({
        findingId,
        entityType: "satellite",
        entityId: BigInt(m.id),
        relation: "similar_to",
        weight: 0.9,
        context: { role: "mil_lineage_peer", dInc: Number(m.d_inc.toFixed(3)) },
      });
    }
    for (const r of strict.slice(0, 5)) {
      await this.edges.insert({
        findingId,
        entityType: "satellite",
        entityId: BigInt(r.id),
        relation: "similar_to",
        weight: 0.95,
        context: {
          role: "strict_coplane",
          dInc: Number(r.d_inc.toFixed(3)),
          dRaan: Number(r.d_raan.toFixed(2)),
          lagMin: Number(r.lag_min.toFixed(1)),
        },
      });
    }
    return findingId;
  }
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/reflexion.service.ts
git commit -m "refactor(console-api): extract ReflexionService"
```

---

### Task 5.9: `services/cycle-runner.service.ts` + `autonomy.service.ts` + `repl-chat.service.ts`

**Files:**

- Create: `apps/console-api/src/services/cycle-runner.service.ts`
- Create: `apps/console-api/src/services/autonomy.service.ts`
- Create: `apps/console-api/src/services/repl-chat.service.ts`

- [ ] **Step 1: Implement `cycle-runner.service.ts`** (server.ts lines 1749-1763 + 1765-1822)

```ts
// apps/console-api/src/services/cycle-runner.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { CycleKind, CycleRun } from "../types";

const TRIGGER_USER = "user" as const;

export interface ThalamusDep {
  thalamusService: {
    runCycle(args: {
      query: string;
      triggerType: never;
      triggerSource: string;
    }): Promise<{ findingsCount?: number | null }>;
  };
}
export interface SweepDep {
  nanoSweepService: {
    sweep(
      limit: number,
      mode: string,
    ): Promise<{ suggestionsStored?: number | null }>;
  };
}

export class CycleRunnerService {
  private history: CycleRun[] = [];

  constructor(
    private readonly thalamus: ThalamusDep,
    private readonly sweep: SweepDep,
    private readonly logger: FastifyBaseLogger,
  ) {}

  listHistory(): CycleRun[] {
    return this.history;
  }

  async runThalamus(query: string): Promise<number> {
    const cycle = await this.thalamus.thalamusService.runCycle({
      query,
      triggerType: TRIGGER_USER as unknown as never,
      triggerSource: "console-ui",
    });
    return cycle.findingsCount ?? 0;
  }

  async runFish(): Promise<number> {
    const result = await this.sweep.nanoSweepService.sweep(20, "nullScan");
    return result.suggestionsStored ?? 0;
  }

  async runBriefing(limit: number): Promise<number> {
    const r = await this.sweep.nanoSweepService.sweep(limit, "briefing");
    return r.suggestionsStored ?? 0;
  }

  async runUserCycle(
    kind: CycleKind,
    query: string,
  ): Promise<{ cycle: CycleRun } | { cycle: CycleRun; error: string }> {
    const startedAt = new Date().toISOString();
    const id = `cyc:${Date.now().toString(36)}`;
    try {
      let emitted = 0;
      const cortices: string[] = [];
      if (kind === "thalamus" || kind === "both") {
        emitted += await this.runThalamus(query);
        cortices.push("thalamus");
      }
      if (kind === "fish" || kind === "both") {
        emitted += await this.runFish();
        cortices.push("nano-sweep");
      }
      const run: CycleRun = {
        id,
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        findingsEmitted: emitted,
        cortices,
      };
      this.pushHistory(run);
      return { cycle: run };
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: errMsg, kind }, "cycle run failed");
      const run: CycleRun = {
        id,
        kind,
        startedAt,
        completedAt: new Date().toISOString(),
        findingsEmitted: 0,
        cortices: [],
        error: errMsg,
      };
      this.pushHistory(run);
      return { cycle: run, error: errMsg };
    }
  }

  private pushHistory(run: CycleRun): void {
    this.history.unshift(run);
    if (this.history.length > 20) this.history.pop();
  }
}
```

- [ ] **Step 2: Implement `autonomy.service.ts`** (server.ts lines 556-677)

```ts
// apps/console-api/src/services/autonomy.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { AutonomyAction, AutonomyState, AutonomyTick } from "../types";
import { THALAMUS_QUERIES } from "../prompts/autonomy-queries.prompt";
import type { CycleRunnerService } from "./cycle-runner.service";

const ROTATION: AutonomyAction[] = ["thalamus", "sweep-nullscan"];

export class AutonomyService {
  private state: AutonomyState = {
    running: false,
    intervalMs: 45_000,
    tickCount: 0,
    currentTick: null,
    history: [],
    startedAt: null,
    rotationIdx: 0,
    queryIdx: 0,
    timer: null,
    busy: false,
  };

  constructor(
    private readonly cycles: CycleRunnerService,
    private readonly logger: FastifyBaseLogger,
  ) {}

  publicState() {
    return {
      running: this.state.running,
      intervalMs: this.state.intervalMs,
      startedAt: this.state.startedAt,
      tickCount: this.state.tickCount,
      currentTick: this.state.currentTick,
      history: this.state.history.slice(0, 20),
      nextTickInMs:
        this.state.running && this.state.startedAt
          ? Math.max(
              0,
              this.state.intervalMs -
                ((Date.now() -
                  (this.state.history[0]
                    ? new Date(this.state.history[0].startedAt).getTime()
                    : Date.now())) %
                  this.state.intervalMs),
            )
          : null,
    };
  }

  start(intervalSec: number): {
    ok: true;
    alreadyRunning?: boolean;
    state: ReturnType<AutonomyService["publicState"]>;
  } {
    if (this.state.running)
      return { ok: true, alreadyRunning: true, state: this.publicState() };
    const sec = Math.max(15, Math.min(600, intervalSec));
    this.state.intervalMs = sec * 1000;
    this.state.running = true;
    this.state.startedAt = new Date().toISOString();
    this.state.timer = setInterval(() => {
      void this.tick();
    }, this.state.intervalMs);
    void this.tick();
    return { ok: true, state: this.publicState() };
  }

  stop(): { ok: true; state: ReturnType<AutonomyService["publicState"]> } {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = null;
    this.state.running = false;
    return { ok: true, state: this.publicState() };
  }

  private async tick(): Promise<void> {
    if (this.state.busy || !this.state.running) return;
    this.state.busy = true;
    const action = ROTATION[this.state.rotationIdx % ROTATION.length]!;
    this.state.rotationIdx++;
    const id = `a:${Date.now().toString(36)}`;
    const startedAt = new Date().toISOString();
    let queryOrMode = "";
    let emitted = 0;
    let error: string | undefined;

    try {
      if (action === "thalamus") {
        const q =
          THALAMUS_QUERIES[this.state.queryIdx % THALAMUS_QUERIES.length]!;
        this.state.queryIdx++;
        queryOrMode = q;
        this.state.currentTick = {
          id,
          action,
          queryOrMode,
          startedAt,
          completedAt: "",
          emitted: 0,
        };
        emitted = await this.cycles.runThalamus(q);
      } else if (action === "sweep-nullscan") {
        queryOrMode = "nullScan(20 operator-countries)";
        this.state.currentTick = {
          id,
          action,
          queryOrMode,
          startedAt,
          completedAt: "",
          emitted: 0,
        };
        emitted = await this.cycles.runFish();
      } else {
        queryOrMode = "briefing(5 operator-countries)";
        this.state.currentTick = {
          id,
          action,
          queryOrMode,
          startedAt,
          completedAt: "",
          emitted: 0,
        };
        emitted = await this.cycles.runBriefing(5);
      }
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      this.logger.error({ err: error, action }, "autonomy tick failed");
    }

    const tick: AutonomyTick = {
      id,
      action,
      queryOrMode,
      startedAt,
      completedAt: new Date().toISOString(),
      emitted,
      ...(error && { error }),
    };
    this.state.history.unshift(tick);
    if (this.state.history.length > 40) this.state.history.pop();
    this.state.currentTick = null;
    this.state.tickCount++;
    this.state.busy = false;
  }
}
```

- [ ] **Step 3: Implement `repl-chat.service.ts`** (server.ts lines 1883-1948)

```ts
// apps/console-api/src/services/repl-chat.service.ts
import { createLlmTransportWithMode } from "@interview/thalamus";
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
    findByCycleId(
      id: bigint | string,
    ): Promise<
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

export type ChatResponse = {
  kind: "chat";
  text: string;
  provider: string;
  tookMs: number;
};

export class ReplChatService {
  constructor(private readonly thalamus: ThalamusChatDep) {}

  async handle(input: string): Promise<ChatResponse> {
    const t0 = Date.now();
    const classifier = createLlmTransportWithMode(CLASSIFIER_SYSTEM_PROMPT);
    const routed = await classifier.call(input);
    let intent: { action: "chat" } | { action: "run_cycle"; query: string };
    try {
      const m = routed.content.match(/\{[\s\S]*\}/);
      intent = m ? JSON.parse(m[0]) : { action: "chat" };
    } catch {
      intent = { action: "chat" };
    }

    if (intent.action === "chat") {
      const transport = createLlmTransportWithMode(CONSOLE_CHAT_SYSTEM_PROMPT);
      const response = await transport.call(input);
      return {
        kind: "chat",
        text: response.content,
        provider: response.provider,
        tookMs: Date.now() - t0,
      };
    }

    const cycle = await this.thalamus.thalamusService.runCycle({
      query: intent.query,
      triggerType: TRIGGER_USER as unknown as never,
      triggerSource: "console-chat",
    });
    const findings = await this.thalamus.findingRepo.findByCycleId(cycle.id);
    const top = findings.slice(0, 8).map((f) => ({
      id: String(f.id),
      title: f.title ?? f.summary?.slice(0, 80) ?? "(no title)",
      summary: f.summary?.slice(0, 300) ?? null,
      cortex: f.cortex,
      urgency: f.urgency,
      confidence: Number(f.confidence ?? 0),
    }));
    const summariser = createLlmTransportWithMode(summariserPrompt(input));
    const payload = JSON.stringify(
      { cycleId: String(cycle.id), findings: top },
      null,
      2,
    );
    const summary = await summariser.call(payload);
    return {
      kind: "chat",
      text:
        `▶ dispatched Thalamus cycle (${findings.length} finding${findings.length === 1 ? "" : "s"})\n\n` +
        summary.content,
      provider: summary.provider,
      tookMs: Date.now() - t0,
    };
  }
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/services/cycle-runner.service.ts apps/console-api/src/services/autonomy.service.ts apps/console-api/src/services/repl-chat.service.ts
git commit -m "refactor(console-api): extract CycleRunnerService + AutonomyService + ReplChatService"
```

---

## Phase 6 — Controllers + Routes

**Pattern:** one controller + one routes file per feature. Controllers are thin — parse + validate inputs, delegate to service, map error unions to HTTP codes. Routes just mount.

### Task 6.1: health + satellites + conjunctions routes

**Files:**

- Create: `apps/console-api/src/controllers/health.controller.ts`
- Create: `apps/console-api/src/controllers/satellites.controller.ts`
- Create: `apps/console-api/src/controllers/conjunctions.controller.ts`
- Create: `apps/console-api/src/routes/health.routes.ts`
- Create: `apps/console-api/src/routes/satellites.routes.ts`
- Create: `apps/console-api/src/routes/conjunctions.routes.ts`

- [ ] **Step 1: Implement `health.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/health.controller.ts
import { asyncHandler } from "../utils/async-handler";

export const healthController = asyncHandler(async () => ({
  ok: true,
  ts: new Date().toISOString(),
}));
```

```ts
// apps/console-api/src/routes/health.routes.ts
import type { FastifyInstance } from "fastify";
import { healthController } from "../controllers/health.controller";

export function registerHealthRoutes(app: FastifyInstance): void {
  app.get("/health", healthController);
}
```

- [ ] **Step 2: Implement `satellites.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/satellites.controller.ts
import type { FastifyRequest } from "fastify";
import type { Regime } from "@interview/shared";
import type { SatelliteViewService } from "../services/satellite-view.service";
import { asyncHandler } from "../utils/async-handler";

export function satellitesController(service: SatelliteViewService) {
  return asyncHandler<
    FastifyRequest<{ Querystring: { regime?: string; limit?: string } }>
  >(async (req) => {
    const limit = Math.min(Number(req.query.limit ?? 2000), 5000);
    const regime = (req.query.regime as Regime | undefined) ?? undefined;
    return service.list({ limit, regime });
  });
}
```

```ts
// apps/console-api/src/routes/satellites.routes.ts
import type { FastifyInstance } from "fastify";
import type { SatelliteViewService } from "../services/satellite-view.service";
import { satellitesController } from "../controllers/satellites.controller";

export function registerSatelliteRoutes(
  app: FastifyInstance,
  service: SatelliteViewService,
): void {
  app.get<{ Querystring: { regime?: string; limit?: string } }>(
    "/api/satellites",
    satellitesController(service),
  );
}
```

- [ ] **Step 3: Implement `conjunctions.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/conjunctions.controller.ts
import type { FastifyRequest } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import { asyncHandler } from "../utils/async-handler";

export function conjunctionsController(service: ConjunctionViewService) {
  return asyncHandler<FastifyRequest<{ Querystring: { minPc?: string } }>>(
    async (req) => {
      const minPc = Number(req.query.minPc ?? 0);
      return service.list(minPc);
    },
  );
}
```

```ts
// apps/console-api/src/routes/conjunctions.routes.ts
import type { FastifyInstance } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import { conjunctionsController } from "../controllers/conjunctions.controller";

export function registerConjunctionRoutes(
  app: FastifyInstance,
  service: ConjunctionViewService,
): void {
  app.get<{ Querystring: { minPc?: string } }>(
    "/api/conjunctions",
    conjunctionsController(service),
  );
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/controllers apps/console-api/src/routes
git commit -m "refactor(console-api): add health + satellites + conjunctions controllers/routes"
```

---

### Task 6.2: kg + findings + stats routes

- [ ] **Step 1: Implement `kg.controller.ts` + `kg.routes.ts`**

```ts
// apps/console-api/src/controllers/kg.controller.ts
import type { KgViewService } from "../services/kg-view.service";
import { asyncHandler } from "../utils/async-handler";

export function kgNodesController(service: KgViewService) {
  return asyncHandler(() => service.listNodes());
}

export function kgEdgesController(service: KgViewService) {
  return asyncHandler(() => service.listEdges());
}
```

```ts
// apps/console-api/src/routes/kg.routes.ts
import type { FastifyInstance } from "fastify";
import type { KgViewService } from "../services/kg-view.service";
import {
  kgNodesController,
  kgEdgesController,
} from "../controllers/kg.controller";

export function registerKgRoutes(
  app: FastifyInstance,
  service: KgViewService,
): void {
  app.get("/api/kg/nodes", kgNodesController(service));
  app.get("/api/kg/edges", kgEdgesController(service));
}
```

- [ ] **Step 2: Implement `findings.controller.ts` + `findings.routes.ts`**

```ts
// apps/console-api/src/controllers/findings.controller.ts
import type { FastifyRequest } from "fastify";
import type { FindingViewService } from "../services/finding-view.service";
import { asyncHandler } from "../utils/async-handler";

export function findingsListController(service: FindingViewService) {
  return asyncHandler<
    FastifyRequest<{ Querystring: { status?: string; cortex?: string } }>
  >(async (req) => {
    return service.list(req.query);
  });
}

export function findingByIdController(service: FindingViewService) {
  return asyncHandler<FastifyRequest<{ Params: { id: string } }>>(
    async (req, reply) => {
      const out = await service.findById(req.params.id);
      if (out === "invalid")
        return reply.code(400).send({ error: "invalid id" });
      if (out === null) return reply.code(404).send({ error: "not found" });
      return out;
    },
  );
}

export function findingDecisionController(service: FindingViewService) {
  return asyncHandler<
    FastifyRequest<{
      Params: { id: string };
      Body: { decision: string; reason?: string };
    }>
  >(async (req, reply) => {
    const decision = req.body?.decision ?? "";
    const out = await service.updateDecision(req.params.id, decision);
    if (out === "invalid")
      return reply.code(400).send({ error: "invalid id or decision" });
    if (out === null) return reply.code(404).send({ error: "not found" });
    return { ok: true, finding: out };
  });
}
```

```ts
// apps/console-api/src/routes/findings.routes.ts
import type { FastifyInstance } from "fastify";
import type { FindingViewService } from "../services/finding-view.service";
import {
  findingsListController,
  findingByIdController,
  findingDecisionController,
} from "../controllers/findings.controller";

export function registerFindingsRoutes(
  app: FastifyInstance,
  service: FindingViewService,
): void {
  app.get<{ Querystring: { status?: string; cortex?: string } }>(
    "/api/findings",
    findingsListController(service),
  );
  app.get<{ Params: { id: string } }>(
    "/api/findings/:id",
    findingByIdController(service),
  );
  app.post<{
    Params: { id: string };
    Body: { decision: string; reason?: string };
  }>("/api/findings/:id/decision", findingDecisionController(service));
}
```

- [ ] **Step 3: Implement `stats.controller.ts` + `stats.routes.ts`**

```ts
// apps/console-api/src/controllers/stats.controller.ts
import type { StatsService } from "../services/stats.service";
import { asyncHandler } from "../utils/async-handler";

export function statsController(service: StatsService) {
  return asyncHandler(() => service.snapshot());
}
```

```ts
// apps/console-api/src/routes/stats.routes.ts
import type { FastifyInstance } from "fastify";
import type { StatsService } from "../services/stats.service";
import { statsController } from "../controllers/stats.controller";

export function registerStatsRoutes(
  app: FastifyInstance,
  service: StatsService,
): void {
  app.get("/api/stats", statsController(service));
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/controllers apps/console-api/src/routes
git commit -m "refactor(console-api): add kg + findings + stats controllers/routes"
```

---

### Task 6.3: sweep (suggestions + mission) routes

- [ ] **Step 1: Implement sweep controllers**

```ts
// apps/console-api/src/controllers/sweep-suggestions.controller.ts
import type { FastifyRequest } from "fastify";
import { asyncHandler } from "../utils/async-handler";

export interface SweepDeps {
  sweepRepo: {
    list(opts: { reviewed: boolean; limit: number }): Promise<{
      rows: Array<{
        id: string;
        title: string;
        description: string;
        suggestedAction: string;
        category: string;
        severity: string;
        operatorCountryName: string | null;
        affectedSatellites: number;
        createdAt: string;
        accepted: boolean;
        resolutionStatus: string;
        resolutionPayload: string | null;
      }>;
    }>;
    review(id: string, accept: boolean, reason?: string): Promise<boolean>;
  };
  resolutionService: { resolve(id: string): Promise<unknown> };
}

export function sweepSuggestionsListController(deps: SweepDeps) {
  return asyncHandler(async () => {
    const res = await deps.sweepRepo.list({ reviewed: false, limit: 100 });
    const items = res.rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      suggestedAction: r.suggestedAction,
      category: r.category,
      severity: r.severity,
      operatorCountryName: r.operatorCountryName,
      affectedSatellites: r.affectedSatellites,
      createdAt: r.createdAt,
      accepted: r.accepted,
      resolutionStatus: r.resolutionStatus,
      hasPayload: Boolean(r.resolutionPayload),
    }));
    return { items, total: items.length };
  });
}

export function sweepReviewController(deps: SweepDeps) {
  return asyncHandler<
    FastifyRequest<{
      Params: { id: string };
      Body: { accept: boolean; reason?: string };
    }>
  >(async (req, reply) => {
    const { id } = req.params;
    const { accept, reason } = req.body ?? { accept: false };
    const ok = await deps.sweepRepo.review(id, accept, reason);
    if (!ok) return reply.code(404).send({ error: "not found" });
    if (accept) {
      const resolution = await deps.resolutionService.resolve(id);
      return { ok: true, reviewed: true, resolution };
    }
    return { ok: true, reviewed: true, resolution: null };
  });
}
```

```ts
// apps/console-api/src/controllers/sweep-mission.controller.ts
import type { FastifyRequest } from "fastify";
import type { MissionService } from "../services/mission.service";
import { asyncHandler } from "../utils/async-handler";

export function missionStartController(service: MissionService) {
  return asyncHandler<
    FastifyRequest<{ Body: { maxSatsPerSuggestion?: number } }>
  >(async (req) => {
    return service.start({
      maxSatsPerSuggestion: req.body?.maxSatsPerSuggestion,
    });
  });
}

export function missionStopController(service: MissionService) {
  return asyncHandler(async () => service.stop());
}

export function missionStatusController(service: MissionService) {
  return asyncHandler(async () => service.publicState());
}
```

- [ ] **Step 2: Implement `sweep.routes.ts`**

```ts
// apps/console-api/src/routes/sweep.routes.ts
import type { FastifyInstance } from "fastify";
import type { MissionService } from "../services/mission.service";
import {
  sweepSuggestionsListController,
  sweepReviewController,
  type SweepDeps,
} from "../controllers/sweep-suggestions.controller";
import {
  missionStartController,
  missionStopController,
  missionStatusController,
} from "../controllers/sweep-mission.controller";

export function registerSweepRoutes(
  app: FastifyInstance,
  deps: SweepDeps,
  mission: MissionService,
): void {
  app.get("/api/sweep/suggestions", sweepSuggestionsListController(deps));
  app.post<{
    Params: { id: string };
    Body: { accept: boolean; reason?: string };
  }>("/api/sweep/suggestions/:id/review", sweepReviewController(deps));
  app.post<{ Body: { maxSatsPerSuggestion?: number } }>(
    "/api/sweep/mission/start",
    missionStartController(mission),
  );
  app.post("/api/sweep/mission/stop", missionStopController(mission));
  app.get("/api/sweep/mission/status", missionStatusController(mission));
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/controllers apps/console-api/src/routes
git commit -m "refactor(console-api): add sweep suggestions + mission controllers/routes"
```

---

### Task 6.4: reflexion + knn-propagation routes

- [ ] **Step 1: Implement `reflexion.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/reflexion.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import type { ReflexionBody } from "../types";
import { asyncHandler } from "../utils/async-handler";

export function reflexionController(service: ReflexionService) {
  return asyncHandler<FastifyRequest<{ Body: ReflexionBody }>>(
    async (req, reply) => {
      const result = await service.runPass(req.body);
      if ("error" in result)
        return reply.code(result.code).send({ error: result.error });
      return result;
    },
  );
}
```

```ts
// apps/console-api/src/routes/reflexion.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReflexionService } from "../services/reflexion.service";
import type { ReflexionBody } from "../types";
import { reflexionController } from "../controllers/reflexion.controller";

export function registerReflexionRoutes(
  app: FastifyInstance,
  service: ReflexionService,
): void {
  app.post<{ Body: ReflexionBody }>(
    "/api/sweep/reflexion-pass",
    reflexionController(service),
  );
}
```

- [ ] **Step 2: Implement `knn-propagation.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/knn-propagation.controller.ts
import type { FastifyRequest } from "fastify";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import type { KnnPropagateBody } from "../types";
import { MISSION_WRITABLE_COLUMNS } from "../utils/field-constraints";
import { asyncHandler } from "../utils/async-handler";

export function knnPropagateController(service: KnnPropagationService) {
  return asyncHandler<FastifyRequest<{ Body: KnnPropagateBody }>>(
    async (req, reply) => {
      const field = req.body?.field ?? "";
      if (!MISSION_WRITABLE_COLUMNS[field]) {
        return reply
          .code(400)
          .send({
            error: `field must be one of ${Object.keys(MISSION_WRITABLE_COLUMNS).join(", ")}`,
          });
      }
      const k = Math.max(3, Math.min(15, req.body?.k ?? 5));
      const minSim = Math.max(0.5, Math.min(0.99, req.body?.minSim ?? 0.8));
      const limit = Math.max(1, Math.min(2000, req.body?.limit ?? 500));
      const dryRun = req.body?.dryRun === true;
      return service.propagate({ field, k, minSim, limit, dryRun });
    },
  );
}
```

```ts
// apps/console-api/src/routes/knn-propagation.routes.ts
import type { FastifyInstance } from "fastify";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import type { KnnPropagateBody } from "../types";
import { knnPropagateController } from "../controllers/knn-propagation.controller";

export function registerKnnPropagationRoutes(
  app: FastifyInstance,
  service: KnnPropagationService,
): void {
  app.post<{ Body: KnnPropagateBody }>(
    "/api/sweep/mission/knn-propagate",
    knnPropagateController(service),
  );
}
```

- [ ] **Step 3: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/controllers apps/console-api/src/routes
git commit -m "refactor(console-api): add reflexion + knn-propagation controllers/routes"
```

---

### Task 6.5: autonomy + cycles + repl routes

- [ ] **Step 1: Implement `autonomy.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/autonomy.controller.ts
import type { FastifyRequest } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import { asyncHandler } from "../utils/async-handler";

export function autonomyStartController(service: AutonomyService) {
  return asyncHandler<FastifyRequest<{ Body: { intervalSec?: number } }>>(
    async (req) => {
      return service.start(Number(req.body?.intervalSec ?? 45));
    },
  );
}

export function autonomyStopController(service: AutonomyService) {
  return asyncHandler(async () => service.stop());
}

export function autonomyStatusController(service: AutonomyService) {
  return asyncHandler(async () => service.publicState());
}
```

```ts
// apps/console-api/src/routes/autonomy.routes.ts
import type { FastifyInstance } from "fastify";
import type { AutonomyService } from "../services/autonomy.service";
import {
  autonomyStartController,
  autonomyStopController,
  autonomyStatusController,
} from "../controllers/autonomy.controller";

export function registerAutonomyRoutes(
  app: FastifyInstance,
  service: AutonomyService,
): void {
  app.post<{ Body: { intervalSec?: number } }>(
    "/api/autonomy/start",
    autonomyStartController(service),
  );
  app.post("/api/autonomy/stop", autonomyStopController(service));
  app.get("/api/autonomy/status", autonomyStatusController(service));
}
```

- [ ] **Step 2: Implement `cycles.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/cycles.controller.ts
import type { FastifyRequest } from "fastify";
import type { CycleKind } from "../types";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import { asyncHandler } from "../utils/async-handler";

export function cycleRunController(service: CycleRunnerService) {
  return asyncHandler<
    FastifyRequest<{ Body: { kind?: CycleKind; query?: string } }>
  >(async (req, reply) => {
    const kind = req.body?.kind;
    if (kind !== "thalamus" && kind !== "fish" && kind !== "both") {
      return reply
        .code(400)
        .send({ error: "kind must be 'thalamus' | 'fish' | 'both'" });
    }
    const query =
      req.body?.query?.trim() ||
      "Current SSA situation — upcoming conjunctions, catalog anomalies, debris forecast";
    const result = await service.runUserCycle(kind, query);
    if ("error" in result) return reply.code(500).send(result);
    return result;
  });
}

export function cycleHistoryController(service: CycleRunnerService) {
  return asyncHandler(async () => ({ items: service.listHistory() }));
}
```

```ts
// apps/console-api/src/routes/cycles.routes.ts
import type { FastifyInstance } from "fastify";
import type { CycleKind } from "../types";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import {
  cycleRunController,
  cycleHistoryController,
} from "../controllers/cycles.controller";

export function registerCyclesRoutes(
  app: FastifyInstance,
  service: CycleRunnerService,
): void {
  app.post<{ Body: { kind?: CycleKind; query?: string } }>(
    "/api/cycles/run",
    cycleRunController(service),
  );
  app.get("/api/cycles", cycleHistoryController(service));
}
```

- [ ] **Step 3: Implement `repl.controller.ts` + routes**

```ts
// apps/console-api/src/controllers/repl.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import { runTurn } from "../repl";
import { asyncHandler } from "../utils/async-handler";

export function replChatController(service: ReplChatService) {
  return asyncHandler<FastifyRequest<{ Body: { input: string } }>>(
    async (req, reply) => {
      const { input } = req.body ?? ({} as { input: string });
      if (!input || typeof input !== "string")
        return reply.code(400).send({ error: "input required" });
      return service.handle(input);
    },
  );
}

export function replTurnController() {
  return asyncHandler<
    FastifyRequest<{ Body: { input: string; sessionId: string } }>
  >(async (req, reply) => {
    const { input, sessionId } =
      req.body ?? ({} as { input: string; sessionId: string });
    if (!input || typeof input !== "string")
      return reply.code(400).send({ error: "input required" });
    return runTurn(
      input,
      { satellites: [], kgNodes: [], kgEdges: [], findings: [] },
      sessionId ?? "anon",
    );
  });
}
```

```ts
// apps/console-api/src/routes/repl.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import {
  replChatController,
  replTurnController,
} from "../controllers/repl.controller";

export function registerReplRoutes(
  app: FastifyInstance,
  service: ReplChatService,
): void {
  app.post<{ Body: { input: string } }>(
    "/api/repl/chat",
    replChatController(service),
  );
  app.post<{ Body: { input: string; sessionId: string } }>(
    "/api/repl/turn",
    replTurnController(),
  );
}
```

- [ ] **Step 4: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/controllers apps/console-api/src/routes
git commit -m "refactor(console-api): add autonomy + cycles + repl controllers/routes"
```

---

### Task 6.6: `routes/index.ts` top-level registration

**Files:**

- Create: `apps/console-api/src/routes/index.ts`

- [ ] **Step 1: Implement**

```ts
// apps/console-api/src/routes/index.ts
import type { FastifyInstance } from "fastify";
import type { SatelliteViewService } from "../services/satellite-view.service";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import type { KgViewService } from "../services/kg-view.service";
import type { FindingViewService } from "../services/finding-view.service";
import type { StatsService } from "../services/stats.service";
import type { MissionService } from "../services/mission.service";
import type { ReflexionService } from "../services/reflexion.service";
import type { KnnPropagationService } from "../services/knn-propagation.service";
import type { AutonomyService } from "../services/autonomy.service";
import type { CycleRunnerService } from "../services/cycle-runner.service";
import type { ReplChatService } from "../services/repl-chat.service";
import type { SweepDeps } from "../controllers/sweep-suggestions.controller";

import { registerHealthRoutes } from "./health.routes";
import { registerSatelliteRoutes } from "./satellites.routes";
import { registerConjunctionRoutes } from "./conjunctions.routes";
import { registerKgRoutes } from "./kg.routes";
import { registerFindingsRoutes } from "./findings.routes";
import { registerStatsRoutes } from "./stats.routes";
import { registerSweepRoutes } from "./sweep.routes";
import { registerReflexionRoutes } from "./reflexion.routes";
import { registerKnnPropagationRoutes } from "./knn-propagation.routes";
import { registerAutonomyRoutes } from "./autonomy.routes";
import { registerCyclesRoutes } from "./cycles.routes";
import { registerReplRoutes } from "./repl.routes";

export type AppServices = {
  satelliteView: SatelliteViewService;
  conjunctionView: ConjunctionViewService;
  kgView: KgViewService;
  findingView: FindingViewService;
  stats: StatsService;
  mission: MissionService;
  reflexion: ReflexionService;
  knnPropagation: KnnPropagationService;
  autonomy: AutonomyService;
  cycles: CycleRunnerService;
  replChat: ReplChatService;
  sweepDeps: SweepDeps;
};

export function registerAllRoutes(app: FastifyInstance, s: AppServices): void {
  registerHealthRoutes(app);
  registerSatelliteRoutes(app, s.satelliteView);
  registerConjunctionRoutes(app, s.conjunctionView);
  registerKgRoutes(app, s.kgView);
  registerFindingsRoutes(app, s.findingView);
  registerStatsRoutes(app, s.stats);
  registerSweepRoutes(app, s.sweepDeps, s.mission);
  registerReflexionRoutes(app, s.reflexion);
  registerKnnPropagationRoutes(app, s.knnPropagation);
  registerAutonomyRoutes(app, s.autonomy);
  registerCyclesRoutes(app, s.cycles);
  registerReplRoutes(app, s.replChat);
}
```

- [ ] **Step 2: Typecheck + commit**

```bash
cd apps/console-api && pnpm typecheck
git add apps/console-api/src/routes/index.ts
git commit -m "refactor(console-api): add registerAllRoutes composition root"
```

---

## Phase 7 — Container + slim server.ts

### Task 7.1: `container.ts` — wire everything

**Files:**

- Create: `apps/console-api/src/container.ts`
- Modify: `apps/console-api/src/server.ts`

- [ ] **Step 1: Implement `container.ts`**

```ts
// apps/console-api/src/container.ts
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import * as schema from "@interview/db-schema";
import type { FastifyBaseLogger } from "fastify";
import { buildThalamusContainer } from "@interview/thalamus";
import { buildSweepContainer } from "@interview/sweep";

import { SatelliteRepository } from "./repositories/satellite.repository";
import { ConjunctionRepository } from "./repositories/conjunction.repository";
import { KgRepository } from "./repositories/kg.repository";
import { FindingRepository } from "./repositories/finding.repository";
import { ResearchEdgeRepository } from "./repositories/research-edge.repository";
import { EnrichmentCycleRepository } from "./repositories/enrichment-cycle.repository";
import { SweepAuditRepository } from "./repositories/sweep-audit.repository";
import { ReflexionRepository } from "./repositories/reflexion.repository";
import { StatsRepository } from "./repositories/stats.repository";

import { SatelliteViewService } from "./services/satellite-view.service";
import { ConjunctionViewService } from "./services/conjunction-view.service";
import { KgViewService } from "./services/kg-view.service";
import { FindingViewService } from "./services/finding-view.service";
import { StatsService } from "./services/stats.service";
import { NanoResearchService } from "./services/nano-research.service";
import { EnrichmentFindingService } from "./services/enrichment-finding.service";
import { MissionService } from "./services/mission.service";
import { KnnPropagationService } from "./services/knn-propagation.service";
import { ReflexionService } from "./services/reflexion.service";
import { CycleRunnerService } from "./services/cycle-runner.service";
import { AutonomyService } from "./services/autonomy.service";
import { ReplChatService } from "./services/repl-chat.service";

import type { AppServices } from "./routes";

export function buildContainer(logger: FastifyBaseLogger): {
  services: AppServices;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
} {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://thalamus:thalamus@localhost:5433/thalamus";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<
    typeof schema
  >;
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });

  const thalamus = buildThalamusContainer({ db });
  const sweep = buildSweepContainer({ db, redis });

  // repos
  const satelliteRepo = new SatelliteRepository(db);
  const conjunctionRepo = new ConjunctionRepository(db);
  const kgRepo = new KgRepository(db);
  const findingRepo = new FindingRepository(db);
  const edgeRepo = new ResearchEdgeRepository(db);
  const cycleRepo = new EnrichmentCycleRepository(db);
  const auditRepo = new SweepAuditRepository(db);
  const reflexionRepo = new ReflexionRepository(db);
  const statsRepo = new StatsRepository(db);

  // services
  const enrichmentFinding = new EnrichmentFindingService(
    cycleRepo,
    findingRepo,
    edgeRepo,
    redis,
  );
  const nanoResearch = new NanoResearchService();
  const missionService = new MissionService(
    satelliteRepo,
    auditRepo,
    nanoResearch,
    enrichmentFinding,
    sweep.sweepRepo,
    logger,
  );
  const cycleRunner = new CycleRunnerService(thalamus, sweep, logger);
  const autonomyService = new AutonomyService(cycleRunner, logger);
  const replChat = new ReplChatService(thalamus);

  const services: AppServices = {
    satelliteView: new SatelliteViewService(satelliteRepo),
    conjunctionView: new ConjunctionViewService(conjunctionRepo),
    kgView: new KgViewService(kgRepo),
    findingView: new FindingViewService(findingRepo, edgeRepo),
    stats: new StatsService(statsRepo),
    mission: missionService,
    reflexion: new ReflexionService(
      reflexionRepo,
      cycleRepo,
      findingRepo,
      edgeRepo,
    ),
    knnPropagation: new KnnPropagationService(
      satelliteRepo,
      auditRepo,
      enrichmentFinding,
    ),
    autonomy: autonomyService,
    cycles: cycleRunner,
    replChat,
    sweepDeps: {
      sweepRepo: sweep.sweepRepo,
      resolutionService: sweep.resolutionService,
    },
  };

  return {
    services,
    close: async () => {
      await pool.end();
      redis.disconnect();
    },
    info: {
      databaseUrl: databaseUrl.replace(/:\/\/[^@]+@/, "://***@"),
      redisUrl,
      cortices: thalamus.registry.size(),
    },
  };
}
```

- [ ] **Step 2: Replace `server.ts` with slim composition root**

```ts
// apps/console-api/src/server.ts
/**
 * console-api — thin Fastify layer over the live Postgres + Redis stack.
 *
 * Every endpoint is backed by real data. This file only wires Fastify +
 * container + routes + CORS; business logic lives in services/, SQL in
 * repositories/, HTTP glue in controllers/ + routes/.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { buildContainer } from "./container";
import { registerAllRoutes } from "./routes";

const app = Fastify({ logger: { level: "info" } });
const container = buildContainer(app.log);
app.log.info(container.info, "backend containers booted");
registerAllRoutes(app, container.services);

let corsRegistered = false;
async function ensureCors(): Promise<void> {
  if (corsRegistered) return;
  await app.register(cors, { origin: true });
  corsRegistered = true;
}

export { app };

export async function startServer(
  port: number = Number(process.env.PORT ?? 4000),
): Promise<{ app: typeof app; port: number; close: () => Promise<void> }> {
  await ensureCors();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  app.log.info(`console-api listening on :${boundPort}`);
  return {
    app,
    port: boundPort,
    close: async () => {
      await app.close();
      await container.close();
    },
  };
}

async function main(): Promise<void> {
  await startServer();
}

const isVitest =
  process.env.VITEST === "true" || process.env.NODE_ENV === "test";
if (!isVitest) {
  main().catch((err) => {
    app.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "boot failed",
    );
    process.exit(1);
  });
}
```

- [ ] **Step 3: Run typecheck + full test suite**

```bash
cd apps/console-api && pnpm typecheck
cd apps/console-api && pnpm exec vitest run --reporter=dot
```

Expected: typecheck PASS, all 4 integration specs PASS.

- [ ] **Step 4: Run the server manually, smoke-test a few endpoints**

```bash
cd apps/console-api && pnpm dev &
sleep 3
curl -s http://localhost:4000/health
curl -s 'http://localhost:4000/api/satellites?limit=3'
curl -s 'http://localhost:4000/api/conjunctions?minPc=0' | jq '.items[0]'
curl -s http://localhost:4000/api/stats
kill %1
```

Expected: all four return JSON bodies matching the shape they returned before the refactor.

- [ ] **Step 5: Commit**

```bash
git add apps/console-api/src/server.ts apps/console-api/src/container.ts
git commit -m "refactor(console-api): slim server.ts to composition root (≤60L)"
```

---

## Phase 8 — Cleanup & verification

### Task 8.1: Remove stale docs and update TODO

- [ ] **Step 1: Update `TODO.md`** — mark the `server.ts` split item complete and note the 5-layer architecture landing.

- [ ] **Step 2: Update `CHANGELOG.md`** — add an entry under current date.

```markdown
## 2026-04-16

### Changed

- `apps/console-api`: decomposed 2001-line `server.ts` into 5 layers (routes → controllers → services → repositories → types) with `utils/` (async-handler, field-constraints, fabrication-detector, finding-status, regime, classification, sql-field) and `prompts/` (mission-research, repl-chat, autonomy-queries). Zero HTTP-contract change; 4 integration specs still green.
- `packages/shared/src/ssa/`: added `SatelliteView`, `FindingView`, `KgView` schemas + regime/classification derivation helpers (moved from console-api). Parallels the existing `ConjunctionView` pattern.
```

- [ ] **Step 3: Commit docs**

```bash
git add TODO.md CHANGELOG.md
git commit -m "docs: record console-api 5-layer refactor + shared SSA DTOs"
```

### Task 8.2: Final verification

- [ ] **Step 1: Full workspace typecheck**

```bash
pnpm -r typecheck
```

Expected: PASS across all packages.

- [ ] **Step 2: Full workspace test run**

```bash
pnpm -r test
```

Expected: green. If any package fails, STOP and fix.

- [ ] **Step 3: Line-count check**

```bash
wc -l apps/console-api/src/server.ts apps/console-api/src/container.ts apps/console-api/src/repl.ts apps/console-api/src/fixtures.ts
```

Expected: `server.ts ≤ 60L` (down from 2001), `container.ts ≈ 100L`, `repl.ts` and `fixtures.ts` untouched.

- [ ] **Step 4: Final commit if any leftover changes**

```bash
git status
```

If clean, stop. Otherwise commit the last diff.

---

## Self-review (author checklist)

1. **Spec coverage** — every endpoint in the original `server.ts` has exactly one route file + controller + service path:
   - `GET /health` → health.controller
   - `GET /api/satellites` → satellites.controller → SatelliteViewService
   - `GET /api/conjunctions` → conjunctions.controller → ConjunctionViewService
   - `GET /api/kg/nodes` + `/api/kg/edges` → kg.controller → KgViewService
   - `GET /api/findings` + `:id` + `:id/decision` → findings.controller → FindingViewService
   - `GET /api/sweep/suggestions` + `:id/review` → sweep-suggestions.controller
   - `POST /api/sweep/mission/*` → sweep-mission.controller → MissionService
   - `POST /api/sweep/reflexion-pass` → reflexion.controller → ReflexionService
   - `POST /api/sweep/mission/knn-propagate` → knn-propagation.controller → KnnPropagationService
   - `POST /api/autonomy/*` → autonomy.controller → AutonomyService
   - `POST /api/cycles/run` + `GET /api/cycles` → cycles.controller → CycleRunnerService
   - `GET /api/stats` → stats.controller → StatsService
   - `POST /api/repl/chat` + `/api/repl/turn` → repl.controller → ReplChatService

2. **Placeholder scan** — no "TBD", no "similar to Task N", no unimplemented types.

3. **Type consistency** — `SatelliteView`, `ConjunctionView`, `FindingView`, `KgNode`, `KgEdge`, `Regime`, `ClassificationTier`, `FindingStatus` all imported from `@interview/shared`. `MissionTask`, `MissionState`, `NanoResult`, `AutonomyState`, `CycleRun`, `ReflexionBody`, `KnnPropagateBody` live in `apps/console-api/src/types/` — server-only.

4. **Rule check** — anything shared with the console frontend (DTOs, regime derivation, classification tier derivation, PC/covariance helpers) lives in `packages/shared/src/ssa/`. Everything else (nano-vote logic, fabrication regex, field whitelist, SQL helpers, async-handler wrapper) stays in `apps/console-api/src/utils/` per the user's rule.
