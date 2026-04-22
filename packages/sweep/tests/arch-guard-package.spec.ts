/**
 * packages/sweep/ arch-guard for the non-sim surface.
 *
 * This guard is intentionally wired to the real dependency-cruiser rules so
 * the test fails on the same `sweep-*` policy edges enforced by repo checks.
 */

import { execFile as execFileCb } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, it, expect } from "vitest";

const execFile = promisify(execFileCb);
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../..");
const DEPCRUISE_CONFIG = resolve(REPO_ROOT, ".dependency-cruiser.js");
const DEPCRUISE_BIN = resolve(
  REPO_ROOT,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);
const DEPCRUISE_MAX_BUFFER = 256 * 1024 * 1024;

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

type SweepViolation = {
  ruleName: string;
  from: string;
  to: string;
};

type DepCruiseRunResult = {
  exitCode: number;
  output: string;
};

function sweepViolations(report: DepCruiseReport): SweepViolation[] {
  return (report.summary?.violations ?? [])
    .map((violation) => ({
      ruleName: violation.rule?.name ?? "",
      from: violation.from ?? "",
      to: violation.to ?? "",
    }))
    .filter((violation) => violation.ruleName.startsWith("sweep-"));
}

async function runDepCruiseSweepCheck(): Promise<DepCruiseRunResult> {
  try {
    const { stdout, stderr } = await execFile(
      process.execPath,
      [
        DEPCRUISE_BIN,
        "--config",
        DEPCRUISE_CONFIG,
        "--output-type",
        "err-long",
        "packages/sweep/src",
      ],
      {
        cwd: REPO_ROOT,
        maxBuffer: DEPCRUISE_MAX_BUFFER,
      },
    );
    return { exitCode: 0, output: `${stdout}${stderr}`.trim() };
  } catch (error) {
    const stdout =
      typeof error === "object" &&
      error !== null &&
      "stdout" in error &&
      typeof error.stdout === "string"
        ? error.stdout
        : "";
    const stderr =
      typeof error === "object" &&
      error !== null &&
      "stderr" in error &&
      typeof error.stderr === "string"
        ? error.stderr
        : "";
    const exitCode =
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      typeof error.code === "number"
        ? error.code
        : 1;

    return { exitCode, output: `${stdout}${stderr}`.trim() };
  }
}

describe("packages/sweep arch guard", () => {
  it("detects sweep-* rule violations from dependency-cruiser JSON", () => {
    const report: DepCruiseReport = {
      summary: {
        violations: [
          {
            rule: { name: "console-api-services-no-http-imports" },
            from: "apps/console-api/src/services/foo.ts",
            to: "apps/console-api/src/routes/bar.ts",
          },
          {
            rule: { name: "sweep-services-no-new-db-coupling" },
            from: "packages/sweep/src/services/foo.ts",
            to: "packages/db-schema/src/index.ts",
          },
        ],
      },
    };

    expect(sweepViolations(report)).toEqual([
      {
        ruleName: "sweep-services-no-new-db-coupling",
        from: "packages/sweep/src/services/foo.ts",
        to: "packages/db-schema/src/index.ts",
      },
    ]);
  });

  it("dependency-cruiser sweep rules stay green for packages/sweep/src", async () => {
    const result = await runDepCruiseSweepCheck();

    expect(result.exitCode, result.output).toBe(0);
    expect(result.output).not.toContain("sweep-");
  });
});
