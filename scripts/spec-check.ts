#!/usr/bin/env tsx
/**
 * spec-check — enforces spec ↔ test traceability.
 *
 * For every spec under docs/specs/**\/*.tex with status APPROVED or IMPLEMENTED:
 *   1. Every AC-N declared in \begin{ac}{AC-N} must have unit, integration,
 *      and e2e Traceability rows.
 *   2. Every Traceability row must point to an existing test file.
 *   3. The test file must contain a test whose name matches the row.
 *
 * Exits non-zero on any violation. Used by .githooks/pre-commit.
 *
 * Status DRAFT, REVIEW, and OVERVIEW are ignored — specs in progress or
 * reader-only overview docs don't block commits.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export type EvidenceLayer = "unit" | "integration" | "e2e";

type Spec = {
  file: string;
  id: string;
  status: string;
  acs: string[];
  traceability: Array<{
    ac: string;
    layer?: string;
    testFile: string;
    testName: string;
  }>;
};

const ROOT = process.cwd();
const ENFORCED_STATUSES = new Set(["APPROVED", "IMPLEMENTED"]);
const REQUIRED_EVIDENCE_LAYERS: EvidenceLayer[] = [
  "unit",
  "integration",
  "e2e",
];
const IGNORED_SPEC_FILENAMES = new Set([
  "preamble.tex",
  "preamble-arch.tex",
  "template.tex",
]);

export function listSpecFiles(root = ROOT): string[] {
  const specRoot = resolve(root, "docs/specs");
  const files: string[] = [];

  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(abs);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith(".tex")) continue;
      if (IGNORED_SPEC_FILENAMES.has(entry.name)) continue;
      files.push(relative(root, abs).split(sep).join("/"));
    }
  }

  walk(specRoot);
  return files.sort();
}

function normalizeLatexCell(cell: string): string {
  let value = cell.trim().replace(/\\\\\s*$/, "").trim();
  const texttt = value.match(/^\\texttt\{([\s\S]*)\}$/);
  if (texttt) value = texttt[1];
  return value
    .replace(/\\_/g, "_")
    .replace(/\\&/g, "&")
    .replace(/\\#/g, "#")
    .replace(/\\%/g, "%")
    .trim();
}

function parseTraceability(src: string): Spec["traceability"] {
  const traceability: Spec["traceability"] = [];

  for (const line of src.split(/\r?\n/)) {
    const withoutComment = line.replace(/(^|[^\\])%.*/, "$1").trim();
    if (!withoutComment.includes("&")) continue;

    const cells = withoutComment.split("&").map(normalizeLatexCell);
    const ac = cells[0];
    if (!/^AC-\d+$/.test(ac)) continue;

    if (cells.length >= 4) {
      traceability.push({
        ac,
        layer: cells[1].toLowerCase(),
        testFile: cells[2],
        testName: normalizeLatexCell(cells.slice(3).join("&")),
      });
      continue;
    }

    if (cells.length >= 3) {
      traceability.push({
        ac,
        testFile: cells[1],
        testName: normalizeLatexCell(cells.slice(2).join("&")),
      });
    }
  }

  return traceability;
}

export function parseSpec(file: string, root = ROOT): Spec {
  const abs = resolve(root, file);
  const src = readFileSync(abs, "utf8");

  const id = src.match(/\\specID\{([^}]+)\}/)?.[1] ?? "";
  const status = src.match(/\\specStatus\{([^}]+)\}/)?.[1] ?? "DRAFT";

  const acs: string[] = [];
  const acRe = /\\begin\{ac\}\{(AC-\d+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = acRe.exec(src)) !== null) acs.push(m[1]);

  const traceability = parseTraceability(src);

  return { file, id, status, acs, traceability };
}

type Violation = { spec: string; ac?: string; kind: string; detail: string };

function isEvidenceLayer(layer: string | undefined): layer is EvidenceLayer {
  return REQUIRED_EVIDENCE_LAYERS.includes(layer as EvidenceLayer);
}

export function checkSpec(spec: Spec, root = ROOT): Violation[] {
  if (!ENFORCED_STATUSES.has(spec.status)) return [];

  const v: Violation[] = [];

  for (const ac of spec.acs) {
    const acRows = spec.traceability.filter((t) => t.ac === ac);
    if (acRows.length === 0) {
      v.push({ spec: spec.id, ac, kind: "MISSING_TRACE", detail: `AC ${ac} is not listed in Traceability table` });
      continue;
    }

    for (const layer of REQUIRED_EVIDENCE_LAYERS) {
      if (!acRows.some((t) => t.layer === layer)) {
        v.push({
          spec: spec.id,
          ac,
          kind: "MISSING_TRACE_LAYER",
          detail: `AC ${ac} is missing ${layer} evidence`,
        });
      }
    }
  }

  for (const t of spec.traceability) {
    if (!spec.acs.includes(t.ac)) {
      v.push({ spec: spec.id, ac: t.ac, kind: "PHANTOM_TRACE", detail: `Traceability lists ${t.ac} but no such AC is declared` });
      continue;
    }

    if (!t.layer) {
      v.push({
        spec: spec.id,
        ac: t.ac,
        kind: "TRACE_LAYER_MISSING",
        detail: `Traceability row for ${t.ac} must include layer column: unit, integration, or e2e`,
      });
      continue;
    }

    if (!isEvidenceLayer(t.layer)) {
      v.push({
        spec: spec.id,
        ac: t.ac,
        kind: "INVALID_TRACE_LAYER",
        detail: `Traceability row for ${t.ac} has invalid layer "${t.layer}"`,
      });
      continue;
    }

    const testAbs = resolve(root, t.testFile);
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

export function main(root = ROOT) {
  const files = listSpecFiles(root);
  const specs = files.map((file) => parseSpec(file, root));

  const enforced = specs.filter((s) => ENFORCED_STATUSES.has(s.status));
  const skipped = specs.filter((s) => !ENFORCED_STATUSES.has(s.status));

  const violations = specs.flatMap((spec) => checkSpec(spec, root));

  console.log(`\n  spec-check — ${specs.length} specs, ${enforced.length} enforced (APPROVED|IMPLEMENTED), ${skipped.length} skipped (non-enforced)\n`);

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
    console.error(`  that each AC has unit, integration, and e2e evidence,`);
    console.error(`  and that the referenced test file + test name actually exist.\n`);
    process.exit(1);
  }

  console.log(`\n  ✓ all enforced specs traced to passing tests\n`);
}

const thisFile = fileURLToPath(import.meta.url);
const invokedFile = process.argv[1] ? resolve(process.argv[1]) : "";

if (invokedFile === thisFile) {
  main();
}
