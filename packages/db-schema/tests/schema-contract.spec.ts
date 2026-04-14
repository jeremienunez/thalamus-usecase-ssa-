/**
 * SPEC-DB-001 — Schema Contract
 *
 * Traceability:
 *   AC-2 every table file is re-exported from schema/index.ts AND src/index.ts
 *   AC-3 notNull columns map to non-nullable / non-optional $inferSelect fields
 *   AC-4 foreign keys match referenced pk types (compile-time + runtime ref)
 *   AC-6 schema sources contain zero unjustified `: any`; `jsonb(` only in
 *        documented payload columns
 *
 * Out of scope for this unit file:
 *   AC-1 (pnpm typecheck — covered by `pnpm -C packages/db-schema typecheck` in CI)
 *   AC-5 (index scan via EXPLAIN — lives in tests/integration/indexes.int.spec.ts with pg-mem)
 */
import { describe, it, expect, expectTypeOf } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";

import * as schemaBarrel from "../src/schema";
import * as rootBarrel from "../src";

import { user, type User } from "../src/schema/user";
import { article, type Article } from "../src/schema/article";
import {
  researchCycle,
  researchFinding,
  researchEdge,
  type ResearchCycle,
  type ResearchFinding,
} from "../src/schema/research";
import {
  satellite,
  satellitePayload,
  operatorCountry,
  payload,
  platformClass,
  orbitRegime,
  operator,
  type Satellite,
  type Payload,
  type OperatorCountry,
} from "../src/schema/satellite";
import { explorationLog, type ExplorationLog } from "../src/schema/exploration";

const SCHEMA_DIR = resolve(__dirname, "../src/schema");

/** Files starting with `_` are helpers (custom column types, etc.) — not table modules. */
function listTableFiles(): string[] {
  return readdirSync(SCHEMA_DIR).filter(
    (f) => f.endsWith(".ts") && f !== "index.ts" && !f.startsWith("_"),
  );
}

function readSources(files: string[]): Array<{ file: string; text: string }> {
  return files.map((f) => ({
    file: f,
    text: readFileSync(resolve(SCHEMA_DIR, f), "utf8"),
  }));
}

// ─── AC-2: export parity ────────────────────────────────────────────

describe("SPEC-DB-001 AC-2 — every table file is re-exported", () => {
  const schemaFiles = listTableFiles();

  it("schema/ directory is non-empty", () => {
    expect(schemaFiles.length).toBeGreaterThan(0);
  });

  for (const file of schemaFiles) {
    it(`${file} tables are re-exported from schema/index.ts and src/index.ts`, () => {
      const src = readFileSync(resolve(SCHEMA_DIR, file), "utf8");
      const tableExports = [
        ...src.matchAll(/export const (\w+) = pgTable\(/g),
      ].map((m) => m[1]!);
      expect(
        tableExports.length,
        `${file} defines a table module but declares no pgTable exports`,
      ).toBeGreaterThan(0);
      for (const name of tableExports) {
        expect(
          schemaBarrel,
          `schema/index.ts missing export '${name}' (declared in ${file})`,
        ).toHaveProperty(name);
        expect(
          rootBarrel,
          `src/index.ts missing export '${name}' (declared in ${file})`,
        ).toHaveProperty(name);
      }
    });
  }

  it("core SSA tables are discoverable via the root barrel", () => {
    for (const name of [
      "satellite",
      "operator",
      "operatorCountry",
      "payload",
      "orbitRegime",
      "platformClass",
      "satelliteBus",
      "satellitePayload",
    ]) {
      expect(rootBarrel).toHaveProperty(name);
    }
  });

  it("legacy wine names are NOT re-exported (shim removed)", () => {
    for (const name of [
      "wine",
      "grape",
      "appellation",
      "region",
      "wineGender",
      "wineGrape",
    ]) {
      expect(rootBarrel).not.toHaveProperty(name);
    }
  });
});

// ─── AC-3: notNull → non-nullable in $inferSelect ──────────────────

describe("SPEC-DB-001 AC-3 — notNull columns are non-nullable in $inferSelect", () => {
  it("user.email / role / tier non-nullable; name nullable", () => {
    expectTypeOf<User["email"]>().toEqualTypeOf<string>();
    expectTypeOf<User["role"]>().toEqualTypeOf<string>();
    expectTypeOf<User["tier"]>().toEqualTypeOf<string>();
    expectTypeOf<User["name"]>().toEqualTypeOf<string | null>();
  });

  it("article.slug / title / status non-nullable; content nullable", () => {
    expectTypeOf<Article["slug"]>().toEqualTypeOf<string>();
    expectTypeOf<Article["title"]>().toEqualTypeOf<string>();
    expectTypeOf<Article["status"]>().toEqualTypeOf<string>();
    expectTypeOf<Article["content"]>().toEqualTypeOf<string | null>();
  });

  it("researchCycle.status + timestamps non-nullable; goal nullable", () => {
    expectTypeOf<ResearchCycle["status"]>().toEqualTypeOf<string>();
    expectTypeOf<ResearchCycle["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<ResearchCycle["updatedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<ResearchCycle["goal"]>().toEqualTypeOf<string | null>();
  });

  it("researchFinding.cortex/entityType/entityName/findingType non-nullable", () => {
    expectTypeOf<ResearchFinding["cortex"]>().toEqualTypeOf<string>();
    expectTypeOf<ResearchFinding["entityType"]>().toEqualTypeOf<string>();
    expectTypeOf<ResearchFinding["entityName"]>().toEqualTypeOf<string>();
    expectTypeOf<ResearchFinding["findingType"]>().toEqualTypeOf<string>();
    expectTypeOf<ResearchFinding["confidence"]>().toEqualTypeOf<
      number | null
    >();
    expectTypeOf<ResearchFinding["cycleId"]>().toEqualTypeOf<bigint | null>();
  });

  it("satellite.name / slug non-nullable; nullable FKs stay nullable", () => {
    expectTypeOf<Satellite["name"]>().toEqualTypeOf<string>();
    expectTypeOf<Satellite["slug"]>().toEqualTypeOf<string>();
    expectTypeOf<Satellite["operatorId"]>().toEqualTypeOf<bigint | null>();
    expectTypeOf<Satellite["launchYear"]>().toEqualTypeOf<number | null>();
  });

  it("satellitePayload join keys non-nullable", () => {
    type SP = typeof satellitePayload.$inferSelect;
    expectTypeOf<SP["satelliteId"]>().toEqualTypeOf<bigint>();
    expectTypeOf<SP["payloadId"]>().toEqualTypeOf<bigint>();
    expectTypeOf<SP["role"]>().toEqualTypeOf<string | null>();
  });

  it("explorationLog.topic + status non-nullable", () => {
    expectTypeOf<ExplorationLog["topic"]>().toEqualTypeOf<string>();
    expectTypeOf<ExplorationLog["status"]>().toEqualTypeOf<string>();
  });
});

// ─── AC-4: FK types match referenced PK types ─────────────────────

describe("SPEC-DB-001 AC-4 — FK types match referenced PK types", () => {
  it("all primary keys are bigint", () => {
    expectTypeOf<User["id"]>().toEqualTypeOf<bigint>();
    expectTypeOf<Article["id"]>().toEqualTypeOf<bigint>();
    expectTypeOf<ResearchCycle["id"]>().toEqualTypeOf<bigint>();
    expectTypeOf<ResearchFinding["id"]>().toEqualTypeOf<bigint>();
    expectTypeOf<Satellite["id"]>().toEqualTypeOf<bigint>();
    expectTypeOf<Payload["id"]>().toEqualTypeOf<bigint>();
    expectTypeOf<OperatorCountry["id"]>().toEqualTypeOf<bigint>();
  });

  it("article.authorId → user.id both bigint", () => {
    expectTypeOf<Article["authorId"]>().toEqualTypeOf<bigint | null>();
    expectTypeOf<User["id"]>().toEqualTypeOf<bigint>();
  });

  it("researchFinding.cycleId → researchCycle.id both bigint", () => {
    expectTypeOf<ResearchFinding["cycleId"]>().toEqualTypeOf<bigint | null>();
    expectTypeOf<ResearchCycle["id"]>().toEqualTypeOf<bigint>();
  });

  it("satellite FKs → respective PKs all bigint", () => {
    expectTypeOf<Satellite["operatorId"]>().toEqualTypeOf<bigint | null>();
    expectTypeOf<Satellite["operatorCountryId"]>().toEqualTypeOf<
      bigint | null
    >();
    expectTypeOf<Satellite["platformClassId"]>().toEqualTypeOf<bigint | null>();
  });

  it("satellitePayload join keys bigint, notNull", () => {
    type SP = typeof satellitePayload.$inferSelect;
    expectTypeOf<SP["satelliteId"]>().toEqualTypeOf<bigint>();
    expectTypeOf<SP["payloadId"]>().toEqualTypeOf<bigint>();
  });

  it("every FK declaration in source points at a `.id` column", () => {
    const refRe = /\.references\(\s*\([^)]*\)\s*(?::[^=]+)?=>\s*(\w+)\.(\w+)\s*\)/g;
    for (const { file, text } of readSources(listTableFiles())) {
      for (const m of text.matchAll(refRe)) {
        const column = m[2]!;
        expect(
          column,
          `${file}: FK references '${m[1]}.${column}' instead of '.id'`,
        ).toBe("id");
      }
    }
  });
});

// ─── AC-6: no unjustified `: any`; jsonb columns in allow-list ────

describe("SPEC-DB-001 AC-6 — schema hygiene", () => {
  const sources = readSources(listTableFiles());

  it("no `: any` annotation in schema source (except documented Drizzle self-ref workaround)", () => {
    // Strip comments first.
    // Allowed justified patterns:
    //   `(): any => <tableName>.id` — Drizzle circular-reference workaround
    //     for self-joins (e.g. satellite.satelliteBusId → satelliteBus) where
    //     the referenced table is defined later in the same file.
    const allowedSelfRef = /\(\s*\)\s*:\s*any\s*=>\s*\w+\.id/g;
    const anyRe = /:\s*any\b/g;

    for (const { file, text } of sources) {
      const stripped = text
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      const withoutAllowed = stripped.replace(allowedSelfRef, "");
      const matches = [...withoutAllowed.matchAll(anyRe)];
      expect(
        matches.length,
        `${file}: ${matches.length} unjustified \`: any\` annotation(s) — ` +
          `only \`(): any => Table.id\` self-reference workaround is allowed by AC-6`,
      ).toBe(0);
    }
  });

  // Allow-list of columns that legitimately use jsonb. Any new jsonb column
  // must be added here explicitly — forces a review moment.
  const JSONB_ALLOWLIST = new Set([
    // generic
    "metadata",
    "raw_metadata",
    "context",
    "descriptions",
    // research
    "plan",
    "result",
    "content",
    "embedding",
    "dag_plan",
    "evidence",
    "bus_context",
    "reflexion_notes",
    // exploration
    "exploration_meta",
    // satellite cluster
    "doctrine",
    "bounds",
    "centroid",
    "geometry",
    "technical_profile",
    "profile_metadata",
    "telemetry_summary",
    "payloads",
    // sweep
    "resolution_payload",
    "resolution_errors",
    // sim (MiroFish-inspired multi-agent simulation)
    "base_seed",
    "perturbations",
    "config",
    "seed_applied",
    "perturbation",
    "goals",
    "constraints",
    "action",
  ]);

  it("every jsonb column is in the documented allow-list", () => {
    const jsonbRe = /jsonb\("([a-z_0-9]+)"\)/g;
    const found: Array<{ file: string; column: string }> = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(jsonbRe)) {
        found.push({ file, column: m[1]! });
      }
    }
    expect(found.length).toBeGreaterThan(0);
    const offenders = found.filter(({ column }) => !JSONB_ALLOWLIST.has(column));
    expect(
      offenders,
      `jsonb columns not in allow-list (add to AC-6 with justification): ${offenders
        .map((o) => `${o.file}:${o.column}`)
        .join(", ")}`,
    ).toEqual([]);
  });
});

// ─── Drizzle runtime sanity — AC-2 cross-check ────────────────────

describe("SPEC-DB-001 Drizzle runtime sanity", () => {
  const cases: Array<{ name: string; table: any }> = [
    { name: "user", table: user },
    { name: "article", table: article },
    { name: "research_cycle", table: researchCycle },
    { name: "research_finding", table: researchFinding },
    { name: "research_edge", table: researchEdge },
    { name: "exploration_log", table: explorationLog },
    { name: "satellite", table: satellite },
    { name: "operator", table: operator },
    { name: "operator_country", table: operatorCountry },
    { name: "payload", table: payload },
    { name: "platform_class", table: platformClass },
    { name: "orbit_regime", table: orbitRegime },
    { name: "satellite_payload", table: satellitePayload },
  ];

  for (const { name, table } of cases) {
    it(`${name} resolves via Drizzle (getTableName + getTableColumns)`, () => {
      expect(getTableName(table)).toBe(name);
      const cols = getTableColumns(table);
      expect(Object.keys(cols).length).toBeGreaterThan(0);
    });
  }
});
