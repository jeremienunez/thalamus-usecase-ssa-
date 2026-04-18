import { describe, expect, it } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const SIM_ROOT = new URL("../../src/sim/", import.meta.url).pathname;
const FORBIDDEN_WORD_RE = /\b(?:ssa|satellite|operator|conjunction|telemetry)\b/;
const FORBIDDEN_SQL_RE =
  /FROM\s+(satellite|operator|conjunction_event|operator_country|orbit_regime|platform_class|satellite_bus)\b/i;

async function walk(dir: string, out: string[] = []): Promise<string[]> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, ent.name);
    if (ent.isDirectory()) await walk(full, out);
    else if (ent.name.endsWith(".ts") && !ent.name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("packages/sweep/src/sim is pack-agnostic", () => {
  it("contains no forbidden domain markers", async () => {
    const files = await walk(SIM_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, "utf8");
      if (FORBIDDEN_WORD_RE.test(source)) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });

  it("contains no raw SQL against domain tables", async () => {
    const files = await walk(SIM_ROOT);
    const violations: string[] = [];
    for (const file of files) {
      if (FORBIDDEN_SQL_RE.test(await readFile(file, "utf8"))) {
        violations.push(file);
      }
    }
    expect(violations).toEqual([]);
  });
});
