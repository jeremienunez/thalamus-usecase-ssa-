import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkSpec, listSpecFiles, parseSpec } from "../../../scripts/spec-check";

const roots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "spec-check-"));
  roots.push(root);
  return root;
}

function write(root: string, path: string, contents: string): void {
  const abs = join(root, path);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents);
}

function approvedSpec(rows: string): string {
  return [
    "\\specID{SPEC-X-001}",
    "\\specStatus{APPROVED}",
    "\\begin{document}",
    "\\begin{ac}{AC-1}",
    "First acceptance criterion.",
    "\\end{ac}",
    "\\section{Traceability}",
    "\\begin{tabular}{@{}llll@{}}",
    "AC & Layer & Test file & Test name \\\\",
    "\\midrule",
    rows,
    "\\bottomrule",
    "\\end{tabular}",
    "\\end{document}",
  ].join("\n");
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("spec-check", () => {
  it("lists specs while skipping LaTeX preambles and template files", () => {
    const root = tempRoot();
    write(root, "docs/specs/shared/foo.tex", "\\specID{SPEC-X}");
    write(root, "docs/specs/preamble.tex", "");
    write(root, "docs/specs/template.tex", "");
    write(root, "docs/specs/architecture/preamble-arch.tex", "");

    expect(listSpecFiles(root)).toEqual(["docs/specs/shared/foo.tex"]);
  });

  it("accepts enforced specs with unit, integration, and e2e evidence", () => {
    const root = tempRoot();
    write(
      root,
      "docs/specs/shared/foo.tex",
      approvedSpec(
        [
          "AC-1 & \\texttt{unit} & \\texttt{packages/foo/tests/unit.spec.ts} & \\texttt{unit covers AC-1} \\\\",
          "AC-1 & \\texttt{integration} & \\texttt{apps/console-api/tests/integration/foo.spec.ts} & \\texttt{integration covers AC-1} \\\\",
          "AC-1 & \\texttt{e2e} & \\texttt{apps/console-api/tests/e2e/foo.spec.ts} & \\texttt{e2e covers AC-1} \\\\",
        ].join("\n"),
      ),
    );
    write(root, "packages/foo/tests/unit.spec.ts", 'it("unit covers AC-1", () => {});');
    write(
      root,
      "apps/console-api/tests/integration/foo.spec.ts",
      'it("integration covers AC-1", () => {});',
    );
    write(root, "apps/console-api/tests/e2e/foo.spec.ts", 'it("e2e covers AC-1", () => {});');

    const spec = parseSpec("docs/specs/shared/foo.tex", root);

    expect(checkSpec(spec, root)).toEqual([]);
  });

  it("fails when an enforced AC is missing an evidence layer", () => {
    const root = tempRoot();
    write(
      root,
      "docs/specs/shared/foo.tex",
      approvedSpec(
        [
          "AC-1 & \\texttt{unit} & \\texttt{packages/foo/tests/unit.spec.ts} & \\texttt{unit covers AC-1} \\\\",
          "AC-1 & \\texttt{integration} & \\texttt{apps/console-api/tests/integration/foo.spec.ts} & \\texttt{integration covers AC-1} \\\\",
        ].join("\n"),
      ),
    );
    write(root, "packages/foo/tests/unit.spec.ts", 'it("unit covers AC-1", () => {});');
    write(
      root,
      "apps/console-api/tests/integration/foo.spec.ts",
      'it("integration covers AC-1", () => {});',
    );

    const spec = parseSpec("docs/specs/shared/foo.tex", root);

    expect(checkSpec(spec, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ac: "AC-1",
          kind: "MISSING_TRACE_LAYER",
          detail: "AC AC-1 is missing e2e evidence",
        }),
      ]),
    );
  });

  it("fails legacy trace rows that do not declare a layer", () => {
    const root = tempRoot();
    write(
      root,
      "docs/specs/shared/foo.tex",
      approvedSpec(
        "AC-1 & \\texttt{packages/foo/tests/unit.spec.ts} & \\texttt{legacy unit row} \\\\",
      ),
    );
    write(root, "packages/foo/tests/unit.spec.ts", 'it("legacy unit row", () => {});');

    const spec = parseSpec("docs/specs/shared/foo.tex", root);

    expect(checkSpec(spec, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ac: "AC-1",
          kind: "TRACE_LAYER_MISSING",
        }),
      ]),
    );
  });

  it("fails missing files and missing test names in layered rows", () => {
    const root = tempRoot();
    write(
      root,
      "docs/specs/shared/foo.tex",
      approvedSpec(
        [
          "AC-1 & \\texttt{unit} & \\texttt{packages/foo/tests/missing.spec.ts} & \\texttt{unit covers AC-1} \\\\",
          "AC-1 & \\texttt{integration} & \\texttt{apps/console-api/tests/integration/foo.spec.ts} & \\texttt{integration covers AC-1} \\\\",
          "AC-1 & \\texttt{e2e} & \\texttt{apps/console-api/tests/e2e/foo.spec.ts} & \\texttt{e2e covers AC-1} \\\\",
        ].join("\n"),
      ),
    );
    write(root, "apps/console-api/tests/integration/foo.spec.ts", 'it("different name", () => {});');
    write(root, "apps/console-api/tests/e2e/foo.spec.ts", 'it("e2e covers AC-1", () => {});');

    const spec = parseSpec("docs/specs/shared/foo.tex", root);

    expect(checkSpec(spec, root)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "TEST_FILE_MISSING" }),
        expect.objectContaining({ kind: "TEST_NAME_MISSING" }),
      ]),
    );
  });
});
