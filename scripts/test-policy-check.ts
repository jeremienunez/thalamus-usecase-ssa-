#!/usr/bin/env tsx
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";

type Layer = "unit" | "integration" | "e2e" | "contract";
type GrandfatherRule = "NO_AS_NEVER" | "NO_AS_UNKNOWN_AS";
type Violation = {
  file: string;
  kind: string;
  detail: string;
  line?: number;
};
type GrandfatherFile = Record<GrandfatherRule, string[]>;
type CastSite = {
  file: string;
  line: number;
  kind: GrandfatherRule;
};

type InvocationKind = "describe" | "it" | "test" | null;

type InvocationInfo = {
  kind: InvocationKind;
  modifiers: string[];
  title: string | null;
  titleLine?: number;
  callback: ts.Expression | undefined;
};

type DescribeRecord = {
  title: string;
  line: number;
  executableTests: number;
};

const ROOT = process.cwd();
const GRANDFATHER_PATH = resolve(ROOT, "scripts/test-policy-grandfather.json");
const EMPTY_GRANDFATHER: GrandfatherFile = {
  NO_AS_NEVER: [],
  NO_AS_UNKNOWN_AS: [],
};

const FORBIDDEN_SHORTCUT_RE = /\b(?:xit|xtest|xdescribe)\s*\(/g;

const VAGUE_TITLE_RULES: Array<{ re: RegExp; message: string }> = [
  { re: /\bworks\b/i, message: "use the expected behavior, not 'works'" },
  { re: /\bshould work\b/i, message: "state the observable outcome instead of 'should work'" },
  { re: /\bhappy path\b/i, message: "name the concrete behavior, not 'happy path'" },
  { re: /\bsmoke\b/i, message: "name the contract, not 'smoke'" },
  { re: /\bcorrectly\b/i, message: "say what outcome is expected instead of 'correctly'" },
  { re: /\bproperly\b/i, message: "say what outcome is expected instead of 'properly'" },
  { re: /\bsuccessfully\b/i, message: "state the success condition explicitly" },
];

const UNIT_OR_CONTRACT_FORBIDDEN: Array<{ re: RegExp; detail: string }> = [
  {
    re: /process\.env\.DATABASE_URL/,
    detail: "unit/contract tests must not read DATABASE_URL",
  },
  {
    re: /\bnew\s+Pool\s*\(/,
    detail: "unit/contract tests must not create a live Postgres pool",
  },
  {
    re: /process\.env\.REDIS_URL/,
    detail: "unit/contract tests must not read REDIS_URL",
  },
  {
    re: /\bnew\s+IORedis\s*\(/,
    detail: "unit/contract tests must not create a live Redis client",
  },
  {
    re: /CONSOLE_API_URL/,
    detail: "unit/contract tests must not depend on a booted console-api URL",
  },
  {
    re: /http:\/\/localhost:4000/,
    detail: "unit/contract tests must not hard-code the console-api base URL",
  },
];

const INTEGRATION_FORBIDDEN: Array<{ re: RegExp; detail: string }> = [
  {
    re: /\bfetch\s*\(/,
    detail: "integration tests stay below the HTTP boundary",
  },
  {
    re: /\.inject\s*\(/,
    detail: "integration tests stay below the HTTP boundary",
  },
  {
    re: /CONSOLE_API_URL/,
    detail: "integration tests must not depend on CONSOLE_API_URL",
  },
  {
    re: /http:\/\/localhost:4000/,
    detail: "integration tests must not hard-code the e2e base URL",
  },
];

function listTestFiles(): string[] {
  const out = execSync(
    "rg --files apps packages -g '*test.ts' -g '*test.tsx' -g '*spec.ts' -g '*spec.tsx'",
    {
      cwd: ROOT,
      encoding: "utf8",
    },
  );
  return out
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function inferLayer(file: string): Layer {
  if (file.includes("/tests/e2e/") || file.includes(".e2e.spec.")) return "e2e";
  if (file.includes("/tests/integration/")) return "integration";
  if (
    file.includes("/tests/unit/") ||
    /\/src\/.*\.(?:test|spec)\.[tj]sx?$/.test(file) ||
    /\/tests\/.*\.test\.[tj]sx?$/.test(file)
  ) {
    return "unit";
  }
  return "contract";
}

function lineOfSourcePos(sf: ts.SourceFile, pos: number): number {
  return ts.getLineAndCharacterOfPosition(sf, pos).line + 1;
}

function firstMatch(src: string, re: RegExp): RegExpExecArray | null {
  const probe = new RegExp(re.source, re.flags);
  return probe.exec(src);
}

function scriptKindFor(file: string): ts.ScriptKind {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (file.endsWith(".jsx")) return ts.ScriptKind.JSX;
  if (file.endsWith(".js")) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

function normalizeTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

function titleFromExpression(expr: ts.Expression | undefined, sf: ts.SourceFile): string | null {
  if (!expr) return null;
  if (ts.isStringLiteralLike(expr)) return normalizeTitle(expr.text);
  if (ts.isNoSubstitutionTemplateLiteral(expr)) return normalizeTitle(expr.text);
  if (ts.isTemplateExpression(expr)) {
    return normalizeTitle(expr.getText(sf).slice(1, -1));
  }
  return null;
}

function locationKey(file: string, line: number): string {
  return `${file}:${line}`;
}

function parseArgs() {
  const args = new Set(process.argv.slice(2));
  return {
    seedGrandfather: args.has("--seed-grandfather"),
    showGrandfatherStats: args.has("--grandfather-stats"),
  };
}

function sortUnique(items: string[]): string[] {
  return [...new Set(items)].sort((a, b) => a.localeCompare(b));
}

function normalizeGrandfather(data: Partial<GrandfatherFile> | null | undefined): GrandfatherFile {
  return {
    NO_AS_NEVER: sortUnique(data?.NO_AS_NEVER ?? []),
    NO_AS_UNKNOWN_AS: sortUnique(data?.NO_AS_UNKNOWN_AS ?? []),
  };
}

function loadGrandfather(): GrandfatherFile {
  if (!existsSync(GRANDFATHER_PATH)) return EMPTY_GRANDFATHER;
  const parsed = JSON.parse(readFileSync(GRANDFATHER_PATH, "utf8")) as
    | Partial<GrandfatherFile>
    | undefined;
  return normalizeGrandfather(parsed);
}

function writeGrandfather(data: GrandfatherFile): void {
  writeFileSync(
    GRANDFATHER_PATH,
    `${JSON.stringify(normalizeGrandfather(data), null, 2)}\n`,
    "utf8",
  );
}

function collectCastSites(file: string, sf: ts.SourceFile): CastSite[] {
  const sites: CastSite[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isAsExpression(node)) {
      if (node.type.kind === ts.SyntaxKind.NeverKeyword) {
        sites.push({
          file,
          line: lineOfSourcePos(sf, node.getStart(sf)),
          kind: "NO_AS_NEVER",
        });
      }

      if (
        node.type.kind === ts.SyntaxKind.UnknownKeyword &&
        ts.isAsExpression(node.parent)
      ) {
        sites.push({
          file,
          line: lineOfSourcePos(sf, node.getStart(sf)),
          kind: "NO_AS_UNKNOWN_AS",
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sf);
  return sites;
}

function checkCastRules(
  file: string,
  sf: ts.SourceFile,
  grandfather: GrandfatherFile,
): Violation[] {
  const violations: Violation[] = [];

  for (const site of collectCastSites(file, sf)) {
    const entry = locationKey(site.file, site.line);
    if (grandfather[site.kind].includes(entry)) continue;

    violations.push({
      file: site.file,
      kind: site.kind,
      detail:
        site.kind === "NO_AS_NEVER"
          ? "test files must not use `as never`; prefer a typed fake or helper"
          : "test files must not use `as unknown as`; prefer a typed fake, schema parse, or narrower fixture",
      line: site.line,
    });
  }

  return violations;
}

function extractCalleeParts(expr: ts.Expression): string[] | null {
  if (ts.isIdentifier(expr)) return [expr.text];
  if (ts.isPropertyAccessExpression(expr)) {
    const base = extractCalleeParts(expr.expression);
    return base ? [...base, expr.name.text] : null;
  }
  if (ts.isCallExpression(expr)) return extractCalleeParts(expr.expression);
  return null;
}

function getInvocationInfo(node: ts.CallExpression, sf: ts.SourceFile): InvocationInfo {
  const parts = extractCalleeParts(node.expression);
  if (!parts || parts.length === 0) {
    return { kind: null, modifiers: [], title: null, callback: undefined };
  }

  const [root, ...modifiers] = parts;
  if (root !== "describe" && root !== "it" && root !== "test") {
    return { kind: null, modifiers: [], title: null, callback: undefined };
  }

  const titleExpr = node.arguments[0];
  const callback = node.arguments[1];
  const title = titleFromExpression(titleExpr, sf);
  const titleLine = titleExpr ? lineOfSourcePos(sf, titleExpr.getStart(sf)) : undefined;

  return {
    kind: root,
    modifiers,
    title,
    titleLine,
    callback,
  };
}

function isFunctionLikeExpression(
  node: ts.Expression | undefined,
): node is ts.FunctionExpression | ts.ArrowFunction {
  return !!node && (ts.isFunctionExpression(node) || ts.isArrowFunction(node));
}

function hasDirectExpect(node: ts.Node): boolean {
  let found = false;
  const visit = (current: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
      if (current.expression.text === "expect") {
        found = true;
        return;
      }
    }
    ts.forEachChild(current, visit);
  };
  visit(node);
  return found;
}

function checkLayerRules(file: string, layer: Layer, src: string): Violation[] {
  const violations: Violation[] = [];
  const rules =
    layer === "integration" ? INTEGRATION_FORBIDDEN : layer === "e2e" ? [] : UNIT_OR_CONTRACT_FORBIDDEN;

  for (const rule of rules) {
    const match = firstMatch(src, rule.re);
    if (match) {
      violations.push({
        file,
        kind: "LAYER_VIOLATION",
        detail: `${layer}: ${rule.detail}`,
        line: 1 + src.slice(0, match.index).split("\n").length - 1,
      });
    }
  }

  return violations;
}

function checkFile(file: string, grandfather: GrandfatherFile): Violation[] {
  const src = readFileSync(file, "utf8");
  const layer = inferLayer(file);
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, scriptKindFor(file));
  const violations: Violation[] = [];
  const testTitleCounts = new Map<string, Array<number>>();
  let describeCount = 0;
  let executableTestCount = 0;

  const shortcut = firstMatch(src, FORBIDDEN_SHORTCUT_RE);
  if (shortcut) {
    violations.push({
      file,
      kind: "DISABLED_SHORTCUT",
      detail: "disabled aliases (`xit` / `xtest` / `xdescribe`) are forbidden",
      line: 1 + src.slice(0, shortcut.index).split("\n").length - 1,
    });
  }

  const describeStack: DescribeRecord[] = [];

  const visit = (node: ts.Node, inTestBody: boolean): void => {
    if (ts.isCallExpression(node)) {
      const info = getInvocationInfo(node, sf);
      if (info.kind === "describe") {
        describeCount += 1;
        const line = lineOfSourcePos(sf, node.getStart(sf));
        const title = info.title;

        if (info.modifiers.includes("only")) {
          violations.push({
            file,
            kind: "FOCUSED_SUITE",
            detail: "focused suites (`describe.only`) are forbidden in CI",
            line,
          });
        }
        if (info.modifiers.includes("skip")) {
          violations.push({
            file,
            kind: "DISABLED_SUITE",
            detail: "disabled suites (`describe.skip`) are forbidden",
            line,
          });
        }
        if (info.modifiers.includes("failing")) {
          violations.push({
            file,
            kind: "EXPECTED_FAILURE_SUITE",
            detail: "expected-failure suites (`describe.failing`) are forbidden",
            line,
          });
        }
        if (!title) {
          violations.push({
            file,
            kind: "DESCRIBE_TITLE_REQUIRED",
            detail: "every describe block must have a static string title",
            line,
          });
        }
        if (!isFunctionLikeExpression(info.callback)) {
          violations.push({
            file,
            kind: "DESCRIBE_CALLBACK_REQUIRED",
            detail: "every describe block must declare a callback body",
            line,
          });
          return;
        }
        if (inTestBody) {
          violations.push({
            file,
            kind: "NESTED_SUITE",
            detail: "describe blocks must not be declared inside a test body",
            line,
          });
        }

        const record: DescribeRecord = {
          title: title ?? "<missing>",
          line,
          executableTests: 0,
        };
        describeStack.push(record);
        if (ts.isBlock(info.callback.body)) {
          for (const stmt of info.callback.body.statements) visit(stmt, false);
        } else {
          visit(info.callback.body, false);
        }
        const finished = describeStack.pop()!;
        if (finished.executableTests === 0) {
          violations.push({
            file,
            kind: "EMPTY_DESCRIBE",
            detail: `describe "${finished.title}" contains no executable test`,
            line: finished.line,
          });
        }
        return;
      }

      if (info.kind === "it" || info.kind === "test") {
        const line = lineOfSourcePos(sf, node.getStart(sf));
        const title = info.title;
        const isTodo = info.modifiers.includes("todo");
        const isSkip = info.modifiers.includes("skip");
        const isOnly = info.modifiers.includes("only");
        const isFailing = info.modifiers.includes("failing");

        if (isOnly) {
          violations.push({
            file,
            kind: "FOCUSED_TEST",
            detail: "focused tests (`.only`) are forbidden in CI",
            line,
          });
        }
        if (isSkip) {
          violations.push({
            file,
            kind: "DISABLED_TEST",
            detail: "disabled tests (`skip`) are forbidden",
            line,
          });
        }
        if (isTodo) {
          violations.push({
            file,
            kind: "PLACEHOLDER_TEST",
            detail: "placeholder tests (`it.todo` / `test.todo`) are forbidden",
            line,
          });
        }
        if (isFailing) {
          violations.push({
            file,
            kind: "EXPECTED_FAILURE_TEST",
            detail: "expected-failure tests (`it.failing` / `test.failing`) are forbidden",
            line,
          });
        }

        const isActualExecutable = !!title && isFunctionLikeExpression(info.callback);
        if (!title && !isTodo) {
          return;
        }
        if (!title) {
          violations.push({
            file,
            kind: "TEST_TITLE_REQUIRED",
            detail: "every test must have a static string title",
            line,
          });
        }
        if (!isTodo && !isFunctionLikeExpression(info.callback)) {
          violations.push({
            file,
            kind: "TEST_CALLBACK_REQUIRED",
            detail: "every executable test must declare a callback body",
            line,
          });
        }

        if (!isActualExecutable) return;

        executableTestCount += 1;
        if (describeStack.length === 0) {
          violations.push({
            file,
            kind: "TEST_OUTSIDE_DESCRIBE",
            detail: `test "${title}" must be nested under a describe block naming the seam`,
            line,
          });
        } else {
          for (const describe of describeStack) describe.executableTests += 1;
        }
        if (inTestBody) {
          violations.push({
            file,
            kind: "NESTED_TEST",
            detail: `test "${title}" must not be declared inside another test body`,
            line,
          });
        }
        if (title.length < 8) {
          violations.push({
            file,
            kind: "TITLE_TOO_SHORT",
            detail: `"${title}" is too short; name the expected behavior explicitly`,
            line,
          });
        }
        for (const rule of VAGUE_TITLE_RULES) {
          if (rule.re.test(title)) {
            violations.push({
              file,
              kind: "VAGUE_TITLE",
              detail: `"${title}" — ${rule.message}`,
              line,
            });
            break;
          }
        }
        const titleKey = title.toLowerCase();
        const titleLines = testTitleCounts.get(titleKey) ?? [];
        titleLines.push(line);
        testTitleCounts.set(titleKey, titleLines);

        const callback = info.callback;
        if (isFunctionLikeExpression(callback)) {
          if (!hasDirectExpect(callback.body)) {
            violations.push({
              file,
              kind: "NO_DIRECT_ASSERTION",
              detail: `test "${title}" must assert observable behavior directly with expect(...)`,
              line,
            });
          }
          if (ts.isBlock(callback.body)) {
            for (const stmt of callback.body.statements) visit(stmt, true);
          } else {
            visit(callback.body, true);
          }
        }
        return;
      }
    }

    ts.forEachChild(node, (child) => visit(child, inTestBody));
  };

  visit(sf, false);

  if (describeCount === 0) {
    violations.push({
      file,
      kind: "DESCRIBE_REQUIRED",
      detail: "every test file must use describe(...) to name the seam under test",
    });
  }

  if (executableTestCount === 0) {
    violations.push({
      file,
      kind: "NO_EXECUTABLE_TESTS",
      detail: "a test file must contain at least one executable `it(...)` or `test(...)` block",
    });
  }

  for (const [title, lines] of testTitleCounts) {
    if (lines.length > 1) {
      for (const line of lines) {
        violations.push({
          file,
          kind: "DUPLICATE_TEST_TITLE",
          detail: `"${title}" is declared multiple times in the same file`,
          line,
        });
      }
    }
  }

  violations.push(...checkLayerRules(file, layer, src));
  violations.push(...checkCastRules(file, sf, grandfather));
  return violations;
}

function main() {
  const options = parseArgs();
  const files = listTestFiles();
  const counts: Record<Layer, number> = {
    unit: 0,
    integration: 0,
    e2e: 0,
    contract: 0,
  };
  const grandfather = loadGrandfather();

  for (const file of files) counts[inferLayer(file)] += 1;

  if (options.seedGrandfather) {
    const seeded = normalizeGrandfather({
      NO_AS_NEVER: files.flatMap((file) => {
        const src = readFileSync(file, "utf8");
        const sf = ts.createSourceFile(
          file,
          src,
          ts.ScriptTarget.Latest,
          true,
          scriptKindFor(file),
        );
        return collectCastSites(file, sf)
          .filter((site) => site.kind === "NO_AS_NEVER")
          .map((site) => locationKey(site.file, site.line));
      }),
      NO_AS_UNKNOWN_AS: files.flatMap((file) => {
        const src = readFileSync(file, "utf8");
        const sf = ts.createSourceFile(
          file,
          src,
          ts.ScriptTarget.Latest,
          true,
          scriptKindFor(file),
        );
        return collectCastSites(file, sf)
          .filter((site) => site.kind === "NO_AS_UNKNOWN_AS")
          .map((site) => locationKey(site.file, site.line));
      }),
    });
    writeGrandfather(seeded);
    const total = seeded.NO_AS_NEVER.length + seeded.NO_AS_UNKNOWN_AS.length;
    console.log(
      `seeded ${GRANDFATHER_PATH} with ${seeded.NO_AS_NEVER.length} NO_AS_NEVER + ${seeded.NO_AS_UNKNOWN_AS.length} NO_AS_UNKNOWN_AS = ${total} entries`,
    );
    return;
  }

  const violations = files.flatMap((file) => checkFile(file, grandfather));
  const grandfatherTotal =
    grandfather.NO_AS_NEVER.length + grandfather.NO_AS_UNKNOWN_AS.length;

  console.log(
    [
      "",
      `  test-policy — ${files.length} files scanned`,
      `    unit: ${counts.unit}`,
      `    integration: ${counts.integration}`,
      `    e2e: ${counts.e2e}`,
      `    contract: ${counts.contract}`,
      `    grandfather: ${grandfatherTotal} cast site(s) (${grandfather.NO_AS_NEVER.length} as never, ${grandfather.NO_AS_UNKNOWN_AS.length} as unknown as)`,
      "",
    ].join("\n"),
  );

  if (violations.length === 0) {
    if (options.showGrandfatherStats) {
      console.log("  grandfather stats:");
      console.log(`    - NO_AS_NEVER: ${grandfather.NO_AS_NEVER.length}`);
      console.log(`    - NO_AS_UNKNOWN_AS: ${grandfather.NO_AS_UNKNOWN_AS.length}`);
    }
    console.log("  ✓ test policy holds\n");
    return;
  }

  const sorted = [...violations].sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return (a.line ?? 0) - (b.line ?? 0);
  });

  for (const violation of sorted) {
    const where = violation.line ? `${violation.file}:${violation.line}` : violation.file;
    console.log(`  ✗ ${where} — ${violation.kind}: ${violation.detail}`);
  }

  console.log(`\n  ✗ ${sorted.length} violation(s) — CI must stay red until they are fixed.\n`);
  if (options.showGrandfatherStats) {
    console.log("  grandfather stats:");
    console.log(`    - NO_AS_NEVER: ${grandfather.NO_AS_NEVER.length}`);
    console.log(`    - NO_AS_UNKNOWN_AS: ${grandfather.NO_AS_UNKNOWN_AS.length}`);
    console.log("");
  }
  console.log("  Fix:");
  console.log("    - every file needs describe(...) naming the seam under test");
  console.log("    - every executable test must live under describe(...) and assert directly with expect(...)");
  console.log("    - remove `.skip` / `.todo` / `.only` / `.failing` and x-prefixed aliases");
  console.log("    - replace vague or duplicate titles with explicit expected-behavior titles");
  console.log("    - move the test to the right layer if it crosses the wrong boundary");
  console.log("    - replace `as never` / `as unknown as` with typed helpers or schema-backed fixtures");
  console.log("    - see docs/testing/README.md for the testability contract\n");
  process.exit(1);
}

main();
