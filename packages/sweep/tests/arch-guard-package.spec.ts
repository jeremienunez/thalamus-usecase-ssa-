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

function sweepViolations(report: DepCruiseReport): SweepViolation[] {
  return (report.summary?.violations ?? [])
    .map((violation) => ({
      ruleName: violation.rule?.name ?? "",
      from: violation.from ?? "",
      to: violation.to ?? "",
    }))
    .filter((violation) => violation.ruleName.startsWith("sweep-"));
}

async function runDepCruiseSweepReport(): Promise<DepCruiseReport> {
  try {
    const { stdout } = await execFile(
      "pnpm",
      [
        "exec",
        "depcruise",
        "--config",
        ".dependency-cruiser.js",
        "packages/sweep/src",
        "--output-type",
        "json",
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
    const report = await runDepCruiseSweepReport();

    expect(report.summary?.totalCruised).toBeGreaterThan(0);
    expect(sweepViolations(report)).toEqual([]);
  });
});
