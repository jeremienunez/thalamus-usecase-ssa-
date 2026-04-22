import { execFile as execFileCb } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFile = promisify(execFileCb);
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../..");
const INJECTION_DIR = resolve(
  REPO_ROOT,
  "packages/test-kit/src/__arch_guard_injection__",
);
const INJECTION_FILE = resolve(INJECTION_DIR, "injected.ts");

type DepCruiseViolation = {
  rule?: { name?: string };
  from?: string;
  to?: string;
};

type DepCruiseReport = {
  summary?: {
    totalCruised?: number;
    violations?: DepCruiseViolation[];
  };
};

async function runDepCruise(paths: string[]): Promise<DepCruiseReport> {
  try {
    const { stdout } = await execFile(
      "pnpm",
      [
        "exec",
        "depcruise",
        "--config",
        ".dependency-cruiser.js",
        "--output-type",
        "json",
        ...paths,
      ],
      {
        cwd: REPO_ROOT,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
    return JSON.parse(stdout) as DepCruiseReport;
  } catch (error) {
    const stdout =
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string"
        ? error.stdout
        : "";

    if (stdout !== "") {
      return JSON.parse(stdout) as DepCruiseReport;
    }
    throw error;
  }
}

describe("repo-wide arch guardrails", () => {
  it("dependency-cruiser finds zero violations across apps and packages", async () => {
    const report = await runDepCruise(["apps", "packages"]);

    expect(report.summary?.totalCruised).toBeGreaterThan(0);
    expect(
      report.summary?.violations ?? [],
      JSON.stringify(report.summary?.violations ?? [], null, 2),
    ).toEqual([]);
  });

  it("packages-no-apps-imports catches an injected packages -> apps edge", async () => {
    mkdirSync(INJECTION_DIR, { recursive: true });
    writeFileSync(
      INJECTION_FILE,
      [
        "// injected by the repo-wide arch guard test",
        'import "../../../../apps/console-api/src/server";',
        "export {};",
        "",
      ].join("\n"),
      "utf8",
    );

    try {
      const report = await runDepCruise(["packages/test-kit/src"]);
      const violations = (report.summary?.violations ?? []).filter(
        (violation) => violation.rule?.name === "packages-no-apps-imports",
      );

      expect(violations.length).toBeGreaterThan(0);
    } finally {
      rmSync(INJECTION_DIR, { recursive: true, force: true });
    }
  });
});
