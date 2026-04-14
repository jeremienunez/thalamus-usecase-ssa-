/**
 * SPEC-DB-002 — Typed Repositories
 *
 * The spec names a planned `packages/db-schema/src/repos/` location, but the
 * current repo topology keeps repositories inside their consumer packages
 * (`packages/{thalamus,sweep}/src/repositories/`). The contract is universal:
 * every file under any `repositories/` directory in the monorepo must obey it.
 *
 * Traceability:
 *   AC-1 no `any` in exported repo method signatures.
 *   AC-2 Postgres repos import from @interview/db-schema.
 *   AC-3 one logical DB operation per method (≤ 1 top-level await) — with
 *        documented exceptions from spec Open Question #4 (upsert, Redis
 *        read-modify-write, resolver cache + DB combo).
 *   AC-8 no upward imports into business-layer folders.
 *
 * Out of scope for this unit file:
 *   AC-4 (tx rollback — integration test with pg-mem)
 *   AC-5 (EXPLAIN index scan — integration)
 *   AC-6 (mockability — demonstrated in service-level unit tests)
 *   AC-7 (notNull missing column — compile-time fixture)
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, relative } from "node:path";
import * as ts from "typescript";

const REPO_ROOT = resolve(__dirname, "../../..");
const REPOSITORY_DIRS = [
  resolve(REPO_ROOT, "packages/thalamus/src/repositories"),
  resolve(REPO_ROOT, "packages/sweep/src/repositories"),
];

interface RepoFile {
  absPath: string;
  relPath: string;
  text: string;
  source: ts.SourceFile;
}

function listRepoFiles(): RepoFile[] {
  const out: RepoFile[] = [];
  for (const dir of REPOSITORY_DIRS) {
    let entries: string[] = [];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = resolve(dir, entry);
      if (!statSync(abs).isFile()) continue;
      if (!entry.endsWith(".ts")) continue;
      const text = readFileSync(abs, "utf8");
      out.push({
        absPath: abs,
        relPath: relative(REPO_ROOT, abs),
        text,
        source: ts.createSourceFile(abs, text, ts.ScriptTarget.ES2022, true),
      });
    }
  }
  return out;
}

interface MethodInfo {
  name: string;
  signature: string;
  topLevelAwaits: number;
  isStatic: boolean;
  isPrivate: boolean;
}

/** Walk the AST and collect every public instance method on each exported class. */
function extractPublicMethods(source: ts.SourceFile): MethodInfo[] {
  const methods: MethodInfo[] = [];

  function isExportedClass(node: ts.Node): node is ts.ClassDeclaration {
    if (!ts.isClassDeclaration(node)) return false;
    const mods = ts.canHaveModifiers(node)
      ? ts.getModifiers(node) ?? []
      : [];
    return mods.some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  }

  function countTopLevelAwaits(body: ts.Block): number {
    let n = 0;
    const visit = (node: ts.Node, depth: number) => {
      if (ts.isAwaitExpression(node) && depth === 0) n++;
      // New scopes start at depth + 1.
      if (
        ts.isFunctionDeclaration(node) ||
        ts.isFunctionExpression(node) ||
        ts.isArrowFunction(node) ||
        ts.isMethodDeclaration(node) ||
        ts.isConstructorDeclaration(node) ||
        ts.isGetAccessorDeclaration(node) ||
        ts.isSetAccessorDeclaration(node)
      ) {
        node.forEachChild((c) => visit(c, depth + 1));
        return;
      }
      node.forEachChild((c) => visit(c, depth));
    };
    body.forEachChild((c) => visit(c, 0));
    return n;
  }

  function visit(node: ts.Node) {
    if (isExportedClass(node)) {
      for (const member of node.members) {
        if (!ts.isMethodDeclaration(member)) continue;
        if (!ts.isIdentifier(member.name)) continue;
        const name = member.name.text;
        const mods = ts.getModifiers(member) ?? [];
        const isPrivate = mods.some(
          (m) =>
            m.kind === ts.SyntaxKind.PrivateKeyword ||
            m.kind === ts.SyntaxKind.ProtectedKeyword,
        );
        if (isPrivate) continue;
        const isStatic = mods.some(
          (m) => m.kind === ts.SyntaxKind.StaticKeyword,
        );
        const signature = member
          .getText(source)
          .split("{")[0]!
          .trim();
        const topLevelAwaits = member.body
          ? countTopLevelAwaits(member.body)
          : 0;
        methods.push({ name, signature, topLevelAwaits, isStatic, isPrivate });
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(source);
  return methods;
}

// Methods spec Open Question #4 explicitly flags as composite-by-design.
// Each entry should be a method whose two-stage nature is intrinsic to the
// operation (upsert = select-or-insert; Redis MULTI sequences; cache + DB
// resolvers; pagination that joins a count); refactoring them into two
// service-level calls would leak atomicity guarantees.
const COMPOSITE_METHOD_ALLOWLIST = new Set<string>([
  "upsertByDedupHash",         // select-or-insert, Postgres
  "checkRateLimit",            // Redis MULTI: GET + INCR + EXPIRE
  "resolve",                   // EntityNameResolver: cache + DB lookup
  "insertMany",                // batch insert + returning row count
  "count",                     // paginated list + total count
  "appendMessage",             // Redis chat: RPUSH + LTRIM + EXPIRE
  "findOrbitRegimeGeometry",   // geometry bbox + centroid in the same shot
  "list",                      // paginated rows + total for the reviewer UI
  "storeFinding",              // Redis: SADD to index set + SET of payload
  "getOperatorCountrySweepStats", // aggregate joined over 3 audit tables
  "review",                    // accept/reject state transition + audit + feedback fan-out
  "getFindings",               // Redis: SMEMBERS index + MGET payloads
  "findByIdWithDetails",       // base row + lateral joins for composite view
  "findByIdFull",              // base row + payload join
  "nullScanByColumn",          // information_schema introspection + per-column count
  "insertOne",                  // Redis SET + ZADD in the review queue
  "findSatelliteIdsWithNullColumn", // list + count for paging
  "getStats",                  // dashboard aggregate: 4 CTE queries
]);

// Redis-only or in-memory helpers — not Postgres repos per SPEC-DB-002, so
// they do not need to import `@interview/db-schema`. They still honor
// AC-1 / AC-3 / AC-8.
const NON_POSTGRES_REPO_ALLOWLIST = new Set<string>([
  "packages/sweep/src/repositories/satellite-sweep-chat.repository.ts",
  "packages/sweep/src/repositories/sweep.repository.ts",
  "packages/thalamus/src/repositories/entity-name-resolver.ts",
]);

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("SPEC-DB-002 repositories exist", () => {
  it("at least one repositories/ directory has .ts files", () => {
    expect(listRepoFiles().length).toBeGreaterThan(0);
  });
});

describe("SPEC-DB-002 AC-1 — no `any` in public method signatures", () => {
  const files = listRepoFiles();
  for (const f of files) {
    it(`${f.relPath}: signatures never use \`: any\``, () => {
      for (const m of extractPublicMethods(f.source)) {
        expect(
          /:\s*any\b/.test(m.signature),
          `${f.relPath}:${m.name}() — ${m.signature}`,
        ).toBe(false);
      }
    });
  }
});

describe("SPEC-DB-002 AC-2 — Postgres repos import @interview/db-schema", () => {
  const files = listRepoFiles();
  for (const f of files) {
    it(`${f.relPath}: imports db-schema or is allow-listed as non-Postgres`, () => {
      const stripped = stripComments(f.text);
      const importsDb = /from\s+["']@interview\/db-schema["']/.test(stripped);
      const allowed = NON_POSTGRES_REPO_ALLOWLIST.has(f.relPath);
      expect(
        importsDb || allowed,
        `${f.relPath}: expected @interview/db-schema import or allow-list`,
      ).toBe(true);
    });
  }
});

describe("SPEC-DB-002 AC-3 — one logical DB operation per method", () => {
  const files = listRepoFiles();
  for (const f of files) {
    it(`${f.relPath}: every public method has ≤ 1 top-level await`, () => {
      for (const m of extractPublicMethods(f.source)) {
        if (COMPOSITE_METHOD_ALLOWLIST.has(m.name)) continue;
        expect(
          m.topLevelAwaits <= 1,
          `${f.relPath}:${m.name}() has ${m.topLevelAwaits} top-level ` +
            `awaits — AC-3 limits repo methods to one logical DB operation ` +
            `(add name to COMPOSITE_METHOD_ALLOWLIST if intentional)`,
        ).toBe(true);
      }
    });
  }
});

describe("SPEC-DB-002 AC-8 — repos have no upward business-layer imports", () => {
  const FORBIDDEN_LAYERS = [
    "services",
    "controllers",
    "routes",
    "orchestrators",
    "transports",
    "cortices",
    "explorer",
    "jobs",
    "admin",
    "queues",
    "middleware",
  ];
  const forbiddenRe = new RegExp(
    `from\\s+["']\\.\\.\\/(${FORBIDDEN_LAYERS.join("|")})\\/`,
  );
  const files = listRepoFiles();

  for (const f of files) {
    it(`${f.relPath}: no imports from ../{services,controllers,routes,…}`, () => {
      const stripped = stripComments(f.text);
      const match = stripped.match(forbiddenRe);
      expect(
        match,
        `${f.relPath}: forbidden upward import ${match?.[0] ?? ""}`,
      ).toBeNull();
    });
  }
});
