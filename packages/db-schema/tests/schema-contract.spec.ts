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
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getTableColumns, getTableName } from "drizzle-orm";

import * as schemaBarrel from "../src/schema";
import * as rootBarrel from "../src";

import { user } from "../src/schema/user";
import { article } from "../src/schema/article";
import {
  researchCycle,
  researchFinding,
  researchEdge,
} from "../src/schema/research";
import {
  satellite,
  satellitePayload,
  operatorCountry,
  payload,
  platformClass,
  orbitRegime,
  operator,
} from "../src/schema/satellite";
import { explorationLog } from "../src/schema/exploration";

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
    expect(user.email.notNull).toBe(true);
    expect(user.role.notNull).toBe(true);
    expect(user.tier.notNull).toBe(true);
    expect(user.name.notNull).toBe(false);
  });

  it("article.slug / title / status non-nullable; content nullable", () => {
    expect(article.slug.notNull).toBe(true);
    expect(article.title.notNull).toBe(true);
    expect(article.status.notNull).toBe(true);
    expect(article.content.notNull).toBe(false);
  });

  it("researchCycle trigger/status/counters are required and completedAt stays nullable", () => {
    expect(researchCycle.triggerType.notNull).toBe(true);
    expect(researchCycle.status.notNull).toBe(true);
    expect(researchCycle.findingsCount.notNull).toBe(true);
    expect(researchCycle.startedAt.notNull).toBe(true);
    expect(researchCycle.completedAt.notNull).toBe(false);
  });

  it("researchFinding origin/cortex/body fields are required and optional scoring fields stay nullable", () => {
    expect(researchFinding.researchCycleId.notNull).toBe(true);
    expect(researchFinding.cortex.notNull).toBe(true);
    expect(researchFinding.findingType.notNull).toBe(true);
    expect(researchFinding.title.notNull).toBe(true);
    expect(researchFinding.summary.notNull).toBe(true);
    expect(researchFinding.evidence.notNull).toBe(true);
    expect(researchFinding.confidence.notNull).toBe(true);
    expect(researchFinding.impactScore.notNull).toBe(false);
  });

  it("satellite.name / slug non-nullable; nullable FKs stay nullable", () => {
    expect(satellite.name.notNull).toBe(true);
    expect(satellite.slug.notNull).toBe(true);
    expect(satellite.operatorId.notNull).toBe(false);
    expect(satellite.launchYear.notNull).toBe(false);
  });

  it("satellitePayload join keys non-nullable", () => {
    expect(satellitePayload.satelliteId.notNull).toBe(true);
    expect(satellitePayload.satelliteId.dataType).toBe("bigint");
    expect(satellitePayload.payloadId.notNull).toBe(true);
    expect(satellitePayload.payloadId.dataType).toBe("bigint");
    expect(satellitePayload.role.notNull).toBe(false);
  });

  it("explorationLog query fields and counters are required while qualityScore stays nullable", () => {
    expect(explorationLog.query.notNull).toBe(true);
    expect(explorationLog.queryType.notNull).toBe(true);
    expect(explorationLog.urlsCrawled.notNull).toBe(true);
    expect(explorationLog.itemsInjected.notNull).toBe(true);
    expect(explorationLog.itemsPromoted.notNull).toBe(true);
    expect(explorationLog.qualityScore.notNull).toBe(false);
  });
});

// ─── AC-4: FK types match referenced PK types ─────────────────────

describe("SPEC-DB-001 AC-4 — FK types match referenced PK types", () => {
  it("all primary keys are bigint", () => {
    expect(user.id.dataType).toBe("bigint");
    expect(article.id.dataType).toBe("bigint");
    expect(researchCycle.id.dataType).toBe("bigint");
    expect(researchFinding.id.dataType).toBe("bigint");
    expect(satellite.id.dataType).toBe("bigint");
    expect(payload.id.dataType).toBe("bigint");
    expect(operatorCountry.id.dataType).toBe("bigint");
  });

  it("article.authorId → user.id both bigint", () => {
    expect(article.authorId.dataType).toBe("bigint");
    expect(user.id.dataType).toBe("bigint");
  });

  it("researchFinding.researchCycleId → researchCycle.id both bigint", () => {
    expect(researchFinding.researchCycleId.dataType).toBe("bigint");
    expect(researchCycle.id.dataType).toBe("bigint");
  });

  it("satellite FKs → respective PKs all bigint", () => {
    expect(satellite.operatorId.dataType).toBe("bigint");
    expect(satellite.operatorCountryId.dataType).toBe("bigint");
    expect(satellite.platformClassId.dataType).toBe("bigint");
  });

  it("satellitePayload join keys bigint, notNull", () => {
    expect(satellitePayload.satelliteId.dataType).toBe("bigint");
    expect(satellitePayload.satelliteId.notNull).toBe(true);
    expect(satellitePayload.payloadId.dataType).toBe("bigint");
    expect(satellitePayload.payloadId.notNull).toBe(true);
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
    // ITU filing raw payload (Phase 3f)
    "raw",
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
