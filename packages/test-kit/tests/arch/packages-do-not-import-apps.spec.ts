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
const DEPCRUISE_CONFIG = resolve(REPO_ROOT, ".dependency-cruiser.js");
const DEPCRUISE_BIN = resolve(
  REPO_ROOT,
  "node_modules/dependency-cruiser/bin/dependency-cruise.mjs",
);
const DEPCRUISE_MAX_BUFFER = 256 * 1024 * 1024;
const ARCH_GUARD_TIMEOUT_MS = 30_000;

type DepCruiseRunResult = {
  exitCode: number;
  output: string;
};

async function runDepCruise(paths: string[]): Promise<DepCruiseRunResult> {
  try {
    const { stdout, stderr } = await execFile(
      process.execPath,
      [
        DEPCRUISE_BIN,
        "--config",
        DEPCRUISE_CONFIG,
        "--output-type",
        "err-long",
        ...paths,
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

describe("repo-wide arch guardrails", () => {
  it("dependency-cruiser finds zero violations across apps and packages", async () => {
    const result = await runDepCruise(["apps", "packages"]);

    expect(result.exitCode, result.output).toBe(0);
  }, ARCH_GUARD_TIMEOUT_MS);

  it("packages-no-apps-imports catches an injected packages -> apps edge", async () => {
    const baseline = await runDepCruise(["packages/test-kit/src"]);

    expect(baseline.exitCode, baseline.output).toBe(0);

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
      const result = await runDepCruise(["packages/test-kit/src"]);

      expect(result.exitCode).toBeGreaterThan(0);
    } finally {
      rmSync(INJECTION_DIR, { recursive: true, force: true });
    }
  }, ARCH_GUARD_TIMEOUT_MS);
});
