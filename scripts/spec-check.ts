#!/usr/bin/env tsx
/**
 * spec-check — enforces spec ↔ test traceability.
 *
 * For every spec under docs/specs/**\/*.tex with status APPROVED or IMPLEMENTED:
 *   1. Every AC-N declared in \begin{ac}{AC-N} must appear in the Traceability table.
 *   2. Every Traceability row must point to an existing test file.
 *   3. The test file must contain a test whose name matches the row.
 *
 * Exits non-zero on any violation. Used by .githooks/pre-commit.
 *
 * Status DRAFT and REVIEW are ignored — specs in progress don't block commits.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

type Spec = {
  file: string;
  id: string;
  status: string;
  acs: string[];
  traceability: Array<{ ac: string; testFile: string; testName: string }>;
};

const ROOT = process.cwd();
const ENFORCED_STATUSES = new Set(["APPROVED", "IMPLEMENTED"]);

function listSpecFiles(): string[] {
  const out = execSync("find docs/specs -name '*.tex' -not -name 'preamble.tex' -not -name 'template.tex'", {
    cwd: ROOT,
    encoding: "utf8",
  });
  return out.trim().split("\n").filter(Boolean);
}

function parseSpec(file: string): Spec {
  const abs = resolve(ROOT, file);
  const src = readFileSync(abs, "utf8");

  const id = src.match(/\\specID\{([^}]+)\}/)?.[1] ?? "";
  const status = src.match(/\\specStatus\{([^}]+)\}/)?.[1] ?? "DRAFT";

  const acs: string[] = [];
  const acRe = /\\begin\{ac\}\{(AC-\d+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = acRe.exec(src)) !== null) acs.push(m[1]);

  const traceability: Spec["traceability"] = [];
  const tracRe = /(AC-\d+)\s*&\s*\\texttt\{([^}]+)\}\s*&\s*\\texttt\{([^}]+)\}/g;
  while ((m = tracRe.exec(src)) !== null) {
    traceability.push({ ac: m[1], testFile: m[2], testName: m[3] });
  }

  return { file, id, status, acs, traceability };
}

type Violation = { spec: string; ac?: string; kind: string; detail: string };

function checkSpec(spec: Spec): Violation[] {
  if (!ENFORCED_STATUSES.has(spec.status)) return [];

  const v: Violation[] = [];
  const tracAcs = new Set(spec.traceability.map((t) => t.ac));

  for (const ac of spec.acs) {
    if (!tracAcs.has(ac)) {
      v.push({ spec: spec.id, ac, kind: "MISSING_TRACE", detail: `AC ${ac} is not listed in Traceability table` });
    }
  }

  for (const t of spec.traceability) {
    if (!spec.acs.includes(t.ac)) {
      v.push({ spec: spec.id, ac: t.ac, kind: "PHANTOM_TRACE", detail: `Traceability lists ${t.ac} but no such AC is declared` });
      continue;
    }
    const testAbs = resolve(ROOT, t.testFile);
    let testSrc: string;
    try {
      testSrc = readFileSync(testAbs, "utf8");
    } catch {
      v.push({ spec: spec.id, ac: t.ac, kind: "TEST_FILE_MISSING", detail: `Test file not found: ${t.testFile}` });
      continue;
    }
    if (!testSrc.includes(t.testName)) {
      v.push({
        spec: spec.id,
        ac: t.ac,
        kind: "TEST_NAME_MISSING",
        detail: `Test name "${t.testName}" not found in ${t.testFile}`,
      });
    }
  }

  return v;
}

function main() {
  const files = listSpecFiles();
  const specs = files.map(parseSpec);

  const enforced = specs.filter((s) => ENFORCED_STATUSES.has(s.status));
  const draft = specs.filter((s) => !ENFORCED_STATUSES.has(s.status));

  const violations = specs.flatMap(checkSpec);

  console.log(`\n  spec-check — ${specs.length} specs, ${enforced.length} enforced (APPROVED|IMPLEMENTED), ${draft.length} skipped (DRAFT|REVIEW)\n`);

  if (enforced.length === 0) {
    console.log("  No enforced specs yet. Mark a spec \\specStatus{APPROVED} to start enforcement.\n");
    return;
  }

  for (const s of enforced) {
    const vs = violations.filter((v) => v.spec === s.id);
    const icon = vs.length === 0 ? "✓" : "✗";
    console.log(`  ${icon} ${s.id} [${s.status}] — ${s.acs.length} AC, ${s.traceability.length} traced${vs.length ? `, ${vs.length} violation(s)` : ""}`);
    for (const v of vs) {
      console.log(`      └─ ${v.kind}${v.ac ? ` (${v.ac})` : ""}: ${v.detail}`);
    }
  }

  if (violations.length > 0) {
    console.error(`\n  ✗ ${violations.length} violation(s) — commit blocked.\n`);
    console.error(`  Fix: make sure every AC in an APPROVED/IMPLEMENTED spec has a row in the Traceability table,`);
    console.error(`  and that the referenced test file + test name actually exist.\n`);
    process.exit(1);
  }

  console.log(`\n  ✓ all enforced specs traced to passing tests\n`);
}

main();
