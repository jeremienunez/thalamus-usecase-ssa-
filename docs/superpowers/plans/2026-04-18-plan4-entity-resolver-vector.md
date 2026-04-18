# Plan 4 — Vector EntityResolver: implicit FKs resolved by cosine, not alias tables

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. **Depends on Plan 1 merged** (SSA pack location at `apps/console-api/src/agent/ssa/`).

**Goal:** Eliminate the schema debt around implicit FKs (`launch.operator_name`, `fragmentation_event.parent_operator_country`, `itu_filing.operator_name`, …) by resolving them at ingest time via **cosine similarity over voyage-4-large embeddings of the catalogue**. Reuse the existing infra (`VoyageEmbedder`, `halfvec(2048)`, HNSW) — no new embedding stack. Output: clean nullable FKs (`operator_id`, `operator_country_id`, `orbit_regime_id`) on the 3 external feeds, with confidence + method audit columns and the raw text preserved.

**Architectural principle:** The resolver is a **port** (`EntityResolverPort`) consumed by ingesters. The **SSA implementation** (which knows what catalogue to vectorise and how to compose the search text) lives in the SSA pack at `apps/console-api/src/agent/ssa/entity-resolver/`. Kernel stays agnostic. Same strangler-fig as Plan 1.

**Why vector and not alias tables:**

- Auto-tolerant to naming drift (`"Rocket Lab"` ≡ `"Rocket Lab USA, Inc."` ≡ `"RKLB"`) — no Levenshtein heuristic.
- Multilingual / abbreviation aware out of the box (`"RU"` ≡ `"Russia"` ≡ `"Россия"`) — voyage-4-large knows.
- Top-K natural for **consortia ITU** (`"SpaceRISE consortium (Eutelsat, SES, Hispasat)"` → 3 operator_ids).
- Reuses the existing voyage-4-large + HNSW infra already serving 33 560 satellites at 99.99 % coverage.
- No alias table to maintain over time.

**Reference:** Schema audit in [docs/specs/2026-04-17-db-schema.md](../../specs/2026-04-17-db-schema.md) (Schema-debt section).

**Risk gates (run between every task):**

- `pnpm -r typecheck` clean
- `cd packages/sweep && pnpm exec vitest run tests/e2e/swarm-uc3.e2e.spec.ts` (UC3 E2E green)
- `cd packages/sweep && pnpm exec vitest run tests/arch-guard-package.spec.ts` (Plan 1 arch-guard stays green)
- Console-api unit tests green

**Branch:** `feat/entity-resolver-vector` (off `main` after Plan 1 merge).

---

## Decisions confirmed upfront

1. **Catalogue tables vectorised:** `operator`, `operator_country`, `orbit_regime` only. Not `payload` / `satellite_bus` / `platform_class` (no implicit FK demand on these today).
2. **Embedding column type:** `halfvec(2048)` voyage-4-large, **identical schema to `satellite.embedding`** so we can reuse the same Drizzle wrapper (`packages/db-schema/src/schema/_vector.ts`) and HNSW index pattern.
3. **Catalogue search-text composition:** static fields per table — `operator: name + slug + COALESCE(ground_station)`, `operator_country: name + slug + COALESCE(doctrine.summary)`, `orbit_regime: name + altitude_band`. No external knowledge baked in (codes added later if needed via Phase 5).
4. **Resolver lives in SSA pack** (`apps/console-api/src/agent/ssa/entity-resolver/`), **not in thalamus**. Thalamus only exposes the `VoyageEmbedder` it already exposes today.
5. **Confidence threshold:** **`0.80` default** for auto-resolve (FK populated). **`0.65–0.80` window** → suggestion logged in `sweep_audit` for human review with top-3 candidates. **`< 0.65`** → FK stays NULL, raw text preserved, no audit row (signal too weak).
6. **Schema is additive.** New columns are nullable; old text columns kept for audit. Zero data migration risk.
7. **Cache layer:** SHA-256 of normalised input text → resolver result, cached in Redis under `resolver:cache:<entity>:<hash>` with **24h TTL**. Same launch re-ingested doesn't re-embed.
8. **Cold-start safety:** if catalogue rows have `embedding IS NULL`, the resolver returns `{id: null, method: "skipped", reason: "catalogue not embedded"}` — ingest proceeds with raw text only. The container exposes a `/health/resolver` check that confirms catalogue coverage > 95 %.
9. **ITU consortia:** new junction table `itu_filing_operator(filing_id FK, operator_id FK, confidence real)` populated by **top-K (K=5) above threshold**, not by single best match. Out of scope for Phase 1; lands in Phase 5.
10. **No re-resolution job in Plan 4.** Old NULL FKs stay NULL until a follow-up plan. Document this in CHANGELOG as known follow-up.

---

## Reuse map — what already exists

| Capability needed                                     | Already in repo                                                                                                                       | New work                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| Embed query string (voyage-4-lite, ~$0.0000003)       | `VoyageEmbedder.embedQuery` ([thalamus/src/utils/voyage-embedder.ts:38](../../../packages/thalamus/src/utils/voyage-embedder.ts#L38)) | zero                                  |
| Embed catalogue documents (voyage-4-large, batch 128) | `VoyageEmbedder.embedDocuments` (same file, line 91)                                                                                  | zero                                  |
| `halfvec(2048)` Drizzle column type                   | `packages/db-schema/src/schema/_vector.ts`                                                                                            | zero — copy the satellite pattern     |
| HNSW cosine index                                     | satellite.embedding `satellite_embedding_hnsw`                                                                                        | repeat 3× via raw migration SQL       |
| Backfill seed-script pattern                          | `packages/db-schema/src/seed/embed-catalog.ts`                                                                                        | extend with operator/country/regime   |
| Sweep audit row for sub-threshold review              | `SweepAuditRepository.insertEnrichmentSuccess` + sweep_audit.category/severity                                                        | add a `resolution-ambiguous` category |
| Redis cache primitives                                | already wired via `IORedis` in container                                                                                              | thin SET/GET wrapper                  |

## New files to create

```
packages/thalamus/src/ports/
  entity-resolver.port.ts                  # interface, generic, kernel-level

apps/console-api/src/agent/ssa/entity-resolver/
  catalogue-text.ssa.ts                    # search-text composers per entity
  vector-entity-resolver.ts                # implementation (cosine + cache + audit)
  resolver-cache.ts                        # Redis SHA-256 cache wrapper
  index.ts                                 # barrel

packages/db-schema/migrations/
  NNNN_catalogue_embeddings.sql            # ADD COLUMN embedding halfvec(2048) ×3 + HNSW ×3
  NNNN_external_feed_fks.sql               # ADD COLUMN operator_id (+ confidence + method) ×3 feeds

packages/db-schema/src/seed/
  embed-catalogue-resolver.ts              # backfill operator/country/regime embeddings
```

## Files to modify

```
packages/db-schema/src/schema/{operator,operator-country,orbit-regime}.ts   # add embedding column
packages/db-schema/src/schema/{launch,fragmentation-event,itu-filing}.ts    # add resolver FK + audit cols
apps/console-api/src/container.ts                                            # construct + inject resolver
apps/console-api/src/agent/ssa/sweep/ingesters/launch-manifest-fetcher.ts    # call resolver
apps/console-api/src/agent/ssa/sweep/ingesters/fragmentation-events-fetcher.ts # call resolver
apps/console-api/src/agent/ssa/sweep/ingesters/itu-filings-fetcher.ts        # call resolver
```

---

# Phase 0 — Port + arch-guard widening (zero runtime change)

## Task 0.1 — Define `EntityResolverPort` in thalamus

**Files:**

- Create: `packages/thalamus/src/ports/entity-resolver.port.ts`
- Modify: `packages/thalamus/src/index.ts` (export port)

```ts
// packages/thalamus/src/ports/entity-resolver.port.ts

/**
 * Generic entity-resolver port. Implementations decide:
 * - which catalogue entities they know about (entity name → table)
 * - how to compose the search text from a raw input
 * - the confidence thresholds and ambiguity policy
 *
 * Kernel-level, no SSA knowledge.
 */
export type ResolutionMethod = "vector" | "exact" | "manual" | "skipped";

export interface ResolveRequest {
  /** Logical entity name, e.g. "operator", "operator_country", "orbit_regime". */
  entity: string;
  /** Free-form text from an external feed (operator name, ISO code, regime label, etc.). */
  text: string;
  /** Optional context the resolver may use (e.g. country to disambiguate an operator). */
  context?: Record<string, string>;
}

export interface ResolveCandidate {
  id: string; // bigint serialized as string
  name: string;
  confidence: number; // cosine [0, 1]
}

export interface ResolveResult {
  /** null when no candidate cleared the auto-resolve threshold. */
  id: string | null;
  confidence: number;
  method: ResolutionMethod;
  /** Top-K when ambiguous (resolver decides K); empty for unambiguous wins. */
  candidates: ResolveCandidate[];
  /** Free-form note for audit row when method !== "vector". */
  reason?: string;
}

export interface EntityResolverPort {
  resolve(req: ResolveRequest): Promise<ResolveResult>;
  /** Bulk variant; implementations may batch the embedding call. */
  resolveMany(reqs: ResolveRequest[]): Promise<ResolveResult[]>;
  /** Health check: returns coverage ratio per known entity. */
  health(): Promise<Record<string, { embedded: number; total: number }>>;
}
```

- [ ] **0.1.1** Create the port file with the exact interface above.
- [ ] **0.1.2** Add `export * from "./ports/entity-resolver.port"` to `packages/thalamus/src/index.ts`.
- [ ] **0.1.3** Typecheck: `cd packages/thalamus && pnpm exec tsc --noEmit`.
- [ ] **0.1.4** Commit: `feat(thalamus): EntityResolverPort interface (no impl)`

## Task 0.2 — Arch-guard for resolver pack

**Files:**

- Create: `apps/console-api/tests/unit/agent/ssa/entity-resolver/arch-guard.spec.ts`

```ts
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";

describe("entity-resolver SSA pack stays self-contained", () => {
  it("ssa/entity-resolver/ has no import from packages/sweep", () => {
    const grep = execSync(
      `grep -rn "@interview/sweep" apps/console-api/src/agent/ssa/entity-resolver/ || true`,
      { encoding: "utf-8" },
    );
    expect(grep).toBe("");
  });

  it("ssa/entity-resolver/ uses VoyageEmbedder via @interview/thalamus only", () => {
    const grep = execSync(
      `grep -rn "from .*voyage-embedder" apps/console-api/src/agent/ssa/entity-resolver/ || true`,
      { encoding: "utf-8" },
    );
    expect(grep).toBe(""); // must import via thalamus index, not deep path
  });
});
```

- [ ] **0.2.1** Create the test (RED initially because the dir doesn't exist).
- [ ] **0.2.2** Skip-tag it (`it.skip`) until Phase 2 lands the impl; un-skip in Task 2.4.
- [ ] **0.2.3** Commit: `test(ssa/entity-resolver): arch-guard skeleton`

---

# Phase 1 — Catalogue migrations + backfill (no runtime change)

## Task 1.1 — Add `embedding halfvec(2048)` column to 3 catalogue tables

**Files:**

- Modify: `packages/db-schema/src/schema/operator.ts` (or wherever `operator` is defined — `grep -rn "pgTable\(.operator." packages/db-schema/src/schema/`)
- Modify: `packages/db-schema/src/schema/operator-country.ts`
- Modify: `packages/db-schema/src/schema/orbit-regime.ts` (likely consolidated; verify)

Mirror the satellite pattern (find it via `grep -n embedding packages/db-schema/src/schema/satellite.ts`):

```ts
// in each table definition, add:
import { halfvec } from "./_vector";
// …
embedding: halfvec("embedding", { dimensions: 2048 }),
embeddingModel: text("embedding_model"),
embeddedAt: timestamp("embedded_at", { withTimezone: true }),
```

- [ ] **1.1.1** Add the 3 columns to each schema file.
- [ ] **1.1.2** Generate migration: `cd packages/db-schema && pnpm drizzle-kit generate`.
- [ ] **1.1.3** Inspect generated SQL — should be 3× `ALTER TABLE … ADD COLUMN embedding halfvec(2048)` plus 2 metadata columns each.
- [ ] **1.1.4** Append the HNSW index DDL **manually** to the migration (Drizzle doesn't generate vector indexes):

```sql
CREATE INDEX IF NOT EXISTS operator_embedding_hnsw
  ON operator USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS operator_country_embedding_hnsw
  ON operator_country USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX IF NOT EXISTS orbit_regime_embedding_hnsw
  ON orbit_regime USING hnsw (embedding halfvec_cosine_ops) WITH (m = 16, ef_construction = 64);
```

- [ ] **1.1.5** Apply: `pnpm drizzle-kit migrate` against the dev DB.
- [ ] **1.1.6** Verify: `docker exec thalamus-postgres psql -U thalamus -d thalamus -c "\d operator"` shows the new columns + index.
- [ ] **1.1.7** Commit: `feat(db-schema): add halfvec(2048) embedding to operator/country/orbit_regime + HNSW indexes`

## Task 1.2 — Catalogue backfill seed script

**Files:**

- Create: `packages/db-schema/src/seed/embed-catalogue-resolver.ts`

Read [packages/db-schema/src/seed/embed-catalog.ts](../../../packages/db-schema/src/seed/embed-catalog.ts) for the pattern. Adapt:

```ts
// embed-catalogue-resolver.ts
import { sql } from "drizzle-orm";
import { VoyageEmbedder } from "@interview/thalamus";
import { db } from "./_client"; // or however the seed scripts get db

const embedder = new VoyageEmbedder();

interface Row {
  id: bigint;
  text: string;
}

async function backfillEntity(
  table: "operator" | "operator_country" | "orbit_regime",
  composeText: (row: Record<string, unknown>) => string,
) {
  const rows = await db.execute(sql`
    SELECT * FROM ${sql.identifier(table)}
    WHERE embedding IS NULL
  `);

  const texts = rows.map((r) => composeText(r as Record<string, unknown>));
  const ids = rows.map((r) => (r as { id: bigint }).id);

  // Batch via VoyageEmbedder.embedDocuments (handles 128-batching internally)
  const vectors = await embedder.embedDocuments(texts);

  for (let i = 0; i < ids.length; i++) {
    if (!vectors[i]) continue;
    await db.execute(sql`
      UPDATE ${sql.identifier(table)}
      SET embedding = ${sql.raw(`'[${vectors[i]!.join(",")}]'::halfvec`)},
          embedding_model = 'voyage-4-large',
          embedded_at = NOW()
      WHERE id = ${ids[i]}
    `);
  }

  console.log(
    `[${table}] embedded ${vectors.filter(Boolean).length}/${ids.length}`,
  );
}

await backfillEntity("operator", (r) =>
  [r.name, r.slug, r.ground_station].filter(Boolean).join(" "),
);
await backfillEntity("operator_country", (r) => {
  const doctrineSummary = (r.doctrine as Record<string, unknown> | null)
    ?.summary;
  return [r.name, r.slug, doctrineSummary].filter(Boolean).join(" ");
});
await backfillEntity("orbit_regime", (r) =>
  [r.name, r.altitude_band].filter(Boolean).join(" "),
);
```

- [ ] **1.2.1** Write the script.
- [ ] **1.2.2** Add an entry in `packages/db-schema/package.json`'s scripts: `"seed:embed-resolver": "tsx src/seed/embed-catalogue-resolver.ts"`.
- [ ] **1.2.3** Dry-run with `VOYAGE_API_KEY` set: `pnpm seed:embed-resolver`. Expect ~5k operators, ~250 countries, ~6 regimes embedded. Cost: well under $0.10.
- [ ] **1.2.4** Verify: `SELECT COUNT(*) FILTER (WHERE embedding IS NOT NULL), COUNT(*) FROM operator;` → ratio > 95 %.
- [ ] **1.2.5** Commit: `feat(db-schema): seed script to backfill catalogue embeddings (operator/country/regime)`

---

# Phase 2 — `VectorEntityResolver` SSA implementation

## Task 2.1 — `catalogue-text.ssa.ts` — search-text composers

**Files:**

- Create: `apps/console-api/src/agent/ssa/entity-resolver/catalogue-text.ssa.ts`

```ts
/**
 * Per-entity composers — turn a raw external-feed string + optional context
 * into the text we embed for cosine search. Mirrors the doc-side composition
 * used by Phase 1's backfill seed (so query and document live in the same
 * embedding subspace).
 */
export type EntityName = "operator" | "operator_country" | "orbit_regime";

export function composeQueryText(
  entity: EntityName,
  text: string,
  context?: Record<string, string>,
): string {
  const trimmed = text.trim();
  switch (entity) {
    case "operator":
      // optional country boost: "Rocket Lab USA" ranks higher with country=US
      return context?.country
        ? `${trimmed} ${context.country}`.trim()
        : trimmed;
    case "operator_country":
      // raw ISO2 codes ("RU", "FR") are well represented in voyage-4-large
      return trimmed;
    case "orbit_regime":
      // "GEO" / "LEO" / "GTO" all known to the model; no augmentation needed
      return trimmed;
  }
}
```

- [ ] **2.1.1** Write the file.
- [ ] **2.1.2** Unit test: assert each branch returns the expected string.
- [ ] **2.1.3** Commit: `feat(ssa/entity-resolver): query-text composers per entity`

## Task 2.2 — `resolver-cache.ts` — Redis SHA-256 cache

**Files:**

- Create: `apps/console-api/src/agent/ssa/entity-resolver/resolver-cache.ts`

```ts
import type IORedis from "ioredis";
import { createHash } from "node:crypto";
import type { ResolveResult } from "@interview/thalamus";

const TTL_SECONDS = 24 * 3600;

export class ResolverCache {
  constructor(private readonly redis: IORedis) {}

  private key(entity: string, normalisedText: string): string {
    const hash = createHash("sha256")
      .update(normalisedText)
      .digest("hex")
      .slice(0, 16);
    return `resolver:cache:${entity}:${hash}`;
  }

  async get(entity: string, text: string): Promise<ResolveResult | null> {
    const raw = await this.redis.get(
      this.key(entity, text.toLowerCase().trim()),
    );
    return raw ? (JSON.parse(raw) as ResolveResult) : null;
  }

  async set(
    entity: string,
    text: string,
    result: ResolveResult,
  ): Promise<void> {
    await this.redis.set(
      this.key(entity, text.toLowerCase().trim()),
      JSON.stringify(result),
      "EX",
      TTL_SECONDS,
    );
  }
}
```

- [ ] **2.2.1** Write file.
- [ ] **2.2.2** Unit test with `ioredis-mock`: set / get / TTL respected.
- [ ] **2.2.3** Commit: `feat(ssa/entity-resolver): Redis SHA-256 cache for resolver results (24h TTL)`

## Task 2.3 — `vector-entity-resolver.ts` — main implementation

**Files:**

- Create: `apps/console-api/src/agent/ssa/entity-resolver/vector-entity-resolver.ts`

```ts
import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import type {
  EntityResolverPort,
  ResolveRequest,
  ResolveResult,
  ResolveCandidate,
} from "@interview/thalamus";
import { VoyageEmbedder } from "@interview/thalamus";
import type { SweepAuditRepository } from "../../../repositories/sweep-audit.repository";
import { composeQueryText, type EntityName } from "./catalogue-text.ssa";
import { ResolverCache } from "./resolver-cache";

const ENTITY_TABLE: Record<EntityName, string> = {
  operator: "operator",
  operator_country: "operator_country",
  orbit_regime: "orbit_regime",
};

export interface VectorEntityResolverOpts {
  db: Database;
  embedder: VoyageEmbedder;
  cache: ResolverCache;
  sweepAudit: SweepAuditRepository;
  thresholds?: {
    autoResolve: number; // default 0.80
    ambiguous: number; // default 0.65
  };
  topK?: number; // default 5
}

export class VectorEntityResolver implements EntityResolverPort {
  private readonly auto: number;
  private readonly ambiguous: number;
  private readonly topK: number;

  constructor(private readonly opts: VectorEntityResolverOpts) {
    this.auto = opts.thresholds?.autoResolve ?? 0.8;
    this.ambiguous = opts.thresholds?.ambiguous ?? 0.65;
    this.topK = opts.topK ?? 5;
  }

  async resolve(req: ResolveRequest): Promise<ResolveResult> {
    const entity = req.entity as EntityName;
    if (!(entity in ENTITY_TABLE)) {
      return {
        id: null,
        confidence: 0,
        method: "skipped",
        candidates: [],
        reason: `unknown entity ${req.entity}`,
      };
    }

    const cached = await this.opts.cache.get(entity, req.text);
    if (cached) return cached;

    const queryText = composeQueryText(entity, req.text, req.context);
    const vector = await this.opts.embedder.embedQuery(queryText);
    if (!vector) {
      return {
        id: null,
        confidence: 0,
        method: "skipped",
        candidates: [],
        reason: "embedder unavailable",
      };
    }

    const table = ENTITY_TABLE[entity];
    const rows = await this.opts.db.execute<{
      id: string;
      name: string;
      distance: number;
    }>(sql`
      SELECT id::text, name, embedding <=> ${sql.raw(`'[${vector.join(",")}]'::halfvec`)} AS distance
      FROM ${sql.identifier(table)}
      WHERE embedding IS NOT NULL
      ORDER BY distance ASC
      LIMIT ${this.topK}
    `);

    const candidates: ResolveCandidate[] = rows.map((r) => ({
      id: r.id,
      name: r.name,
      confidence: 1 - Number(r.distance), // cosine distance → similarity
    }));

    const best = candidates[0];
    let result: ResolveResult;

    if (!best) {
      result = {
        id: null,
        confidence: 0,
        method: "skipped",
        candidates: [],
        reason: "catalogue empty",
      };
    } else if (best.confidence >= this.auto) {
      result = {
        id: best.id,
        confidence: best.confidence,
        method: "vector",
        candidates: [],
      };
    } else if (best.confidence >= this.ambiguous) {
      result = {
        id: null,
        confidence: best.confidence,
        method: "manual",
        candidates,
      };
      // surface for human review
      await this.opts.sweepAudit.insertEnrichmentSuccess({
        suggestionId: `resolver-${entity}-${Date.now()}`,
        operatorCountryName: req.text,
        title: `Ambiguous ${entity} resolution: "${req.text}"`,
        description: `Top candidates: ${candidates.map((c) => `${c.name} (${c.confidence.toFixed(2)})`).join(", ")}`,
        suggestedAction: "manual",
        affectedSatellites: 0,
        webEvidence: null,
        resolutionPayload: {
          kind: "resolver_ambiguous",
          entity,
          text: req.text,
          candidates,
        },
      });
    } else {
      result = {
        id: null,
        confidence: best.confidence,
        method: "skipped",
        candidates: [],
        reason: "below ambiguous threshold",
      };
    }

    await this.opts.cache.set(entity, req.text, result);
    return result;
  }

  async resolveMany(reqs: ResolveRequest[]): Promise<ResolveResult[]> {
    // Naive sequential for now; optimisation = batch embed + single SQL via UNNEST.
    return Promise.all(reqs.map((r) => this.resolve(r)));
  }

  async health(): Promise<Record<string, { embedded: number; total: number }>> {
    const out: Record<string, { embedded: number; total: number }> = {};
    for (const [entity, table] of Object.entries(ENTITY_TABLE)) {
      const [{ embedded, total }] = await this.opts.db.execute<{
        embedded: number;
        total: number;
      }>(sql`
        SELECT
          COUNT(*) FILTER (WHERE embedding IS NOT NULL)::int AS embedded,
          COUNT(*)::int AS total
        FROM ${sql.identifier(table)}
      `);
      out[entity] = { embedded, total };
    }
    return out;
  }
}
```

- [ ] **2.3.1** Write the file.
- [ ] **2.3.2** Unit tests (mock `embedder` + `db.execute` + `cache`):
  - confidence ≥ 0.80 → `method: "vector"`, FK populated, no audit row
  - 0.65 ≤ confidence < 0.80 → `method: "manual"`, FK NULL, audit row inserted with top-K
  - confidence < 0.65 → `method: "skipped"`, FK NULL, no audit row
  - cache hit short-circuits the embedder call
  - embedder returns null → graceful `method: "skipped"`
- [ ] **2.3.3** Commit: `feat(ssa/entity-resolver): VectorEntityResolver (cosine + cache + audit)`

## Task 2.4 — Barrel + un-skip arch-guard

**Files:**

- Create: `apps/console-api/src/agent/ssa/entity-resolver/index.ts`
- Modify: `apps/console-api/tests/unit/agent/ssa/entity-resolver/arch-guard.spec.ts` (remove `.skip`)

```ts
// index.ts
export { VectorEntityResolver } from "./vector-entity-resolver";
export type { VectorEntityResolverOpts } from "./vector-entity-resolver";
export { ResolverCache } from "./resolver-cache";
export { composeQueryText } from "./catalogue-text.ssa";
export type { EntityName } from "./catalogue-text.ssa";
```

- [ ] **2.4.1** Write barrel.
- [ ] **2.4.2** Un-skip arch-guard, run, expect green.
- [ ] **2.4.3** Commit: `feat(ssa/entity-resolver): pack barrel + arch-guard green`

---

# Phase 3 — Migrations for FK columns + wire into 3 ingesters

## Task 3.1 — Add resolver FK columns to 3 external-feed tables

**Files:**

- Modify: `packages/db-schema/src/schema/launch.ts`
- Modify: `packages/db-schema/src/schema/fragmentation-event.ts`
- Modify: `packages/db-schema/src/schema/itu-filing.ts`

Per table, add:

```ts
operatorId: bigint("operator_id", { mode: "bigint" })
  .references(() => operator.id),
operatorIdConfidence: real("operator_id_confidence"),
operatorIdMethod: text("operator_id_method"),  // 'vector'|'exact'|'manual'|'skipped'

operatorCountryId: bigint("operator_country_id", { mode: "bigint" })
  .references(() => operatorCountry.id),
operatorCountryIdConfidence: real("operator_country_id_confidence"),
operatorCountryIdMethod: text("operator_country_id_method"),
```

For `launch` and `fragmentation_event` only, add the orbit regime FK too:

```ts
orbitRegimeId: bigint("orbit_regime_id", { mode: "bigint" })
  .references(() => orbitRegime.id),
orbitRegimeIdConfidence: real("orbit_regime_id_confidence"),
orbitRegimeIdMethod: text("orbit_regime_id_method"),
```

**ITU operator is n-n** → skip `operator_id` on `itu_filing` here; Phase 5 handles the junction table.

- [ ] **3.1.1** Add columns to the 3 schemas.
- [ ] **3.1.2** Generate migration: `pnpm drizzle-kit generate`.
- [ ] **3.1.3** Apply: `pnpm drizzle-kit migrate`.
- [ ] **3.1.4** Verify: `\d launch` shows the 9 new columns (3 entities × 3 cols).
- [ ] **3.1.5** Commit: `feat(db-schema): add resolver FK + audit columns to launch/fragmentation/itu`

## Task 3.2 — Wire resolver into console-api container

**Files:**

- Modify: `apps/console-api/src/container.ts`

```ts
import * as Resolver from "./agent/ssa/entity-resolver";
import { VoyageEmbedder } from "@interview/thalamus";

const embedder = new VoyageEmbedder();
const resolverCache = new Resolver.ResolverCache(redis);
const entityResolver = new Resolver.VectorEntityResolver({
  db,
  embedder,
  cache: resolverCache,
  sweepAudit: sweepAuditRepo,
});

// expose to ingesters via the SSA pack's runtime context
const ssaRuntime = {
  // existing fields...
  entityResolver,
};
```

The ingesters in `apps/console-api/src/agent/ssa/sweep/ingesters/` (post-Plan 1) receive the runtime context via the `IngestionRunContext` port. Plan 1's port has `db`, `redis`, `logger` — we extend that port:

- [ ] **3.2.1** Edit `packages/sweep/src/ports/ingestion-registry.port.ts` to add an optional `extras?: Record<string, unknown>` field on `IngestionRunContext`. Optional keeps Plan 1 callers compiling.
- [ ] **3.2.2** Container passes `extras: { entityResolver }` to the registry.
- [ ] **3.2.3** Health check: at boot, log `entityResolver.health()` to confirm > 95 % coverage. If < 50 %, refuse to boot (catalogue clearly not embedded).
- [ ] **3.2.4** Commit: `feat: wire VectorEntityResolver in console-api container; ingestion ctx carries resolver`

## Task 3.3 — Plug resolver into `launch-manifest-fetcher.ts`

**Files:**

- Modify: `apps/console-api/src/agent/ssa/sweep/ingesters/launch-manifest-fetcher.ts`

After the existing parse step where `operatorName`, `operatorCountry`, `orbitName` are extracted from the upstream payload, before the INSERT:

```ts
const resolver = ctx.extras?.entityResolver as EntityResolverPort | undefined;

let operatorId: string | null = null;
let operatorIdConfidence: number | null = null;
let operatorIdMethod: string | null = null;

if (resolver && parsed.operatorName) {
  const r = await resolver.resolve({
    entity: "operator",
    text: parsed.operatorName,
    context: parsed.operatorCountry
      ? { country: parsed.operatorCountry }
      : undefined,
  });
  operatorId = r.id;
  operatorIdConfidence = r.confidence;
  operatorIdMethod = r.method;
}

// Repeat for operator_country (no context) and orbit_regime (no context).
// Insert into launch with both raw text columns AND the new FK columns.
```

- [ ] **3.3.1** Wrap the resolver calls in a single `Promise.all` for parallelism (3 calls per row).
- [ ] **3.3.2** Pass the resolved fields into the existing INSERT statement.
- [ ] **3.3.3** Unit test the fetcher with a mocked resolver returning known IDs; assert INSERT receives them.
- [ ] **3.3.4** Commit: `feat(ssa/launch-manifest): resolve operator + country + regime via VectorEntityResolver`

## Task 3.4 — Plug into `fragmentation-events-fetcher.ts`

Same shape as Task 3.3 but for `parent_operator_country`, `regime_name`. No `operator_name` field on this table.

- [ ] **3.4.1** Add 2 resolver calls (country + regime).
- [ ] **3.4.2** Map results into the INSERT.
- [ ] **3.4.3** Unit test.
- [ ] **3.4.4** Commit: `feat(ssa/fragmentation): resolve operator_country + orbit_regime via VectorEntityResolver`

## Task 3.5 — Plug into `itu-filings-fetcher.ts` (single-operator only)

Phase 5 will handle consortia via top-K + junction table. For Phase 3, only resolve `operatorCountry` (single ISO2 code).

- [ ] **3.5.1** Add 1 resolver call (country only).
- [ ] **3.5.2** Map into INSERT. Skip the `operatorName` field for now (TODO: junction in Phase 5).
- [ ] **3.5.3** Unit test.
- [ ] **3.5.4** Commit: `feat(ssa/itu-filings): resolve operator_country via VectorEntityResolver (operator junction deferred to Phase 5)`

---

# Phase 4 — Drops cosmétiques (zero-risk wins)

## Task 4.1 — Drop `sweep_audit.operator_country_name` (mirror)

**Files:**

- Migration `NNNN_drop_sweep_audit_country_name.sql`: `ALTER TABLE sweep_audit DROP COLUMN operator_country_name;`
- Modify all callers to read via JOIN on `operator_country_id` instead.

- [ ] **4.1.1** `grep -rn "operator_country_name" apps packages` — list call sites.
- [ ] **4.1.2** Replace each read with a JOIN or service-layer lookup.
- [ ] **4.1.3** Generate + apply migration.
- [ ] **4.1.4** Commit: `refactor(db): drop sweep_audit.operator_country_name (mirror of FK)`

## Task 4.2 — Drop `tle_history.norad_id` (mirror of satellite_id)

Same pattern.

- [ ] **4.2.1** Find callers; rewrite via `JOIN satellite ON tle_history.satellite_id = satellite.id`.
- [ ] **4.2.2** Migration + apply.
- [ ] **4.2.3** Commit: `refactor(db): drop tle_history.norad_id (mirror of satellite_id)`

## Task 4.3 — Add soft FK on `fragmentation_event.parent_norad_id`

```sql
ALTER TABLE satellite ADD CONSTRAINT satellite_norad_id_unique UNIQUE (norad_id);
ALTER TABLE fragmentation_event
  ADD CONSTRAINT fragmentation_event_parent_norad_id_fkey
  FOREIGN KEY (parent_norad_id) REFERENCES satellite(norad_id);
```

NULL stays allowed — historical orphan fragmentations remain ingestible.

- [ ] **4.3.1** Verify no current rows would violate: `SELECT COUNT(*) FROM fragmentation_event WHERE parent_norad_id IS NOT NULL AND parent_norad_id NOT IN (SELECT norad_id FROM satellite WHERE norad_id IS NOT NULL);`. If > 0, NULL them out first (with audit log).
- [ ] **4.3.2** Migration + apply.
- [ ] **4.3.3** Commit: `feat(db): soft FK fragmentation_event.parent_norad_id → satellite.norad_id`

---

# Phase 5 — ITU consortia via top-K + junction (stretch)

> Skip if pressed for time; document as known follow-up in CHANGELOG.

## Task 5.1 — Junction table

```sql
CREATE TABLE itu_filing_operator (
  itu_filing_id bigint NOT NULL REFERENCES itu_filing(id) ON DELETE CASCADE,
  operator_id   bigint NOT NULL REFERENCES operator(id),
  confidence    real,
  method        text,
  PRIMARY KEY (itu_filing_id, operator_id)
);
```

- [ ] **5.1.1** Schema + migration.
- [ ] **5.1.2** Commit: `feat(db): itu_filing_operator junction table`

## Task 5.2 — Top-K resolver call in itu-filings-fetcher

- Pre-process `operatorName` text: split on `,` and on regex `consortium \((.+)\)` → list of candidate names.
- For each candidate, call `resolver.resolve({entity: "operator", text})`.
- Insert one row per resolved candidate (≥ ambiguous threshold) into `itu_filing_operator`.

- [ ] **5.2.1** Implement consortium splitter with unit tests on real strings (`"SpaceRISE consortium (Eutelsat, SES, Hispasat)"`, `"Eutelsat / OneWeb"`, …).
- [ ] **5.2.2** Wire into fetcher.
- [ ] **5.2.3** Commit: `feat(ssa/itu-filings): consortium splitter + per-operator junction inserts`

---

# Phase 6 — Telemetry + arch-guard + CHANGELOG

## Task 6.1 — Resolver telemetry counters

Wrap each `resolve()` call with a counter under `entity-resolver.{entity}.{method}` (using the existing logger or whatever metric stack is already in `packages/shared/observability`).

- [ ] **6.1.1** Add metrics.
- [ ] **6.1.2** Sample boot output should show counts per entity per method.
- [ ] **6.1.3** Commit: `feat(ssa/entity-resolver): per-entity per-method telemetry counters`

## Task 6.2 — Arch-guard re-run + CHANGELOG + TODO

```bash
cd packages/sweep && pnpm exec vitest run tests/arch-guard-package.spec.ts  # Plan 1 still green
cd apps/console-api && pnpm exec vitest run tests/unit/agent/ssa/entity-resolver/  # Plan 4 green
```

CHANGELOG entry:

```md
### Refactor — Vector EntityResolver (Plan 4)

- Eliminated implicit FK debt on `launch`, `fragmentation_event`, `itu_filing`
  by resolving operator/operator_country/orbit_regime references at ingest time
  via cosine similarity over voyage-4-large embeddings of the catalogue.
- New port: `EntityResolverPort` in `@interview/thalamus`. SSA implementation
  `VectorEntityResolver` lives in `apps/console-api/src/agent/ssa/entity-resolver/`.
- Catalogue tables (`operator`, `operator_country`, `orbit_regime`) now carry
  `embedding halfvec(2048)` + HNSW indexes, mirroring the satellite pattern.
- 3 external-feed tables get `<entity>_id` (nullable FK) + `_confidence` + `_method`
  audit columns. Raw text preserved for audit trail.
- Confidence thresholds: ≥0.80 auto-resolve, 0.65–0.80 surfaced via sweep_audit
  for human review with top-3 candidates, <0.65 silently skipped.
- 24h Redis SHA-256 cache short-circuits repeated ingest of the same string.
- Cosmetic drops: `sweep_audit.operator_country_name`, `tle_history.norad_id`
  (both mirrors of existing FKs). Soft FK added on `fragmentation_event.parent_norad_id`.
- Known follow-ups (NOT in Plan 4): re-resolution background job for old NULL FKs,
  catalogue iso_code/code columns for exact-match short-circuit before vector call.
```

TODO update: mark Plan 4 done, list the two follow-ups under "post-interview hardening".

- [ ] **6.2.1** CHANGELOG + TODO.
- [ ] **6.2.2** Commit: `docs: record Plan 4 (vector entity resolver) completion`

---

# Self-review checklist

- [x] Reuses existing `VoyageEmbedder` — no new embedding stack
- [x] Mirrors `satellite.embedding` halfvec(2048) + HNSW pattern — no new infra
- [x] Port in thalamus, impl in SSA pack — respects Plan 1's boundaries
- [x] Schema additive — every new column nullable, raw text preserved
- [x] Confidence tiers (auto / ambiguous / skip) prevent silent FK pollution
- [x] Sub-threshold matches surface in `sweep_audit` for human review (existing infra)
- [x] Cache layer prevents re-embedding repeated text (Redis 24h TTL)
- [x] Cold-start guard (catalogue coverage check at container boot)
- [x] Embedder unavailable → graceful skip, no crash
- [x] Plan 1 arch-guard stays green (no SSA leakage into kernel)
- [x] No re-resolution job here — explicit follow-up in CHANGELOG
- [x] ITU consortia handled by Phase 5 (stretch) — not required for core win

# Spec coverage

| Schema-debt audit item                                               | Task                 |
| -------------------------------------------------------------------- | -------------------- |
| `launch.operator_name` → operator.id (vector resolved)               | 3.1, 3.3             |
| `launch.operator_country` → operator_country.id                      | 3.1, 3.3             |
| `launch.orbit_name` → orbit_regime.id                                | 3.1, 3.3             |
| `fragmentation_event.parent_operator_country` → operator_country.id  | 3.1, 3.4             |
| `fragmentation_event.regime_name` → orbit_regime.id                  | 3.1, 3.4             |
| `fragmentation_event.parent_norad_id` → satellite.norad_id (soft FK) | 4.3                  |
| `itu_filing.operator_country` → operator_country.id                  | 3.1, 3.5             |
| `itu_filing.operator_name` → operator.id (n-n consortia)             | 5.1, 5.2             |
| `sweep_audit.operator_country_name` (mirror, drop)                   | 4.1                  |
| `tle_history.norad_id` (mirror, drop)                                | 4.2                  |
| Catalogue iso_code / code columns                                    | DEFERRED (CHANGELOG) |
| Re-resolution job for legacy NULL FKs                                | DEFERRED (CHANGELOG) |

# Estimated effort

| Phase                   | Time             |
| ----------------------- | ---------------- |
| 0                       | 15 min           |
| 1                       | 30 min           |
| 2                       | 45 min           |
| 3                       | 45 min           |
| 4                       | 15 min           |
| 5                       | 30 min (stretch) |
| 6                       | 15 min           |
| **Core (0–4 + 6)**      | **~2h45**        |
| **Full (with Phase 5)** | **~3h15**        |

Single afternoon if Plan 1 has merged. Phase 5 splittable.
