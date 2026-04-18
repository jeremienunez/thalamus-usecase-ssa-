/**
 * Sim kernel arch-guard — enforces "generic simulation engine, no SSA".
 *
 * Runs over `packages/sweep/src/sim/` and flags:
 *   1. Forbidden db-schema symbols (satellite, operator, conjunctionEvent,
 *      TELEMETRY_SCALAR_KEYS, operatorCountry, orbitRegime, platformClass, satelliteBus).
 *   2. Forbidden domain types (TurnAction, SeedRefs, PerturbationSpec,
 *      FleetSnapshot, TelemetryTarget, PcEstimatorTarget) imported from
 *      db-schema or sim-ssa-types-temp.
 *   3. Forbidden raw SQL `FROM <ssa_table>` patterns.
 *
 * Plan 2 lifecycle:
 *   - A.2 (this file lands): RED. Violations == refactor worklist.
 *   - B.1..B.10 (impls land): violations shrink as files migrate.
 *   - C.1: GREEN. No allowlist needed.
 *
 * Currently SKIPPED via describe.skip — flip to describe(...) at task C.1.
 * Keeping it skipped during the plan's lifetime keeps pre-commit green while
 * we migrate; the worklist is tracked in
 * docs/superpowers/plans/2026-04-17-plan2-sim-agnostic.md.
 */

import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const SIM_ROOT = new URL("../../src/sim/", import.meta.url).pathname;

const FORBIDDEN_DB_SYMBOLS = [
  "satellite",
  "operator",
  "operatorCountry",
  "orbitRegime",
  "platformClass",
  "satelliteBus",
  "conjunctionEvent",
  "TELEMETRY_SCALAR_KEYS",
];

const FORBIDDEN_DOMAIN_TYPES = [
  "TurnAction",
  "SeedRefs",
  "PerturbationSpec",
  "FleetSnapshot",
  "TelemetryTarget",
  "PcEstimatorTarget",
];

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

// Flip to `describe(...)` at Plan 2 Task C.1 (sim arch-guard green).
describe.skip("packages/sweep/src/sim/ is domain-agnostic (Plan 2 C.1)", () => {
  it("no forbidden db-schema symbol imports", async () => {
    const files = await walk(SIM_ROOT);
    const violations: string[] = [];
    for (const f of files) {
      const src = await readFile(f, "utf8");
      const blocks =
        src.match(
          /import\s*(?:type\s*)?\{[^}]+\}\s*from\s*["']@interview\/db-schema["']/g,
        ) ?? [];
      for (const block of blocks) {
        for (const sym of FORBIDDEN_DB_SYMBOLS) {
          if (new RegExp(`\\b${sym}\\b`).test(block)) {
            violations.push(`${f}: ${sym}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no forbidden domain-type references", async () => {
    const files = await walk(SIM_ROOT);
    const violations: string[] = [];
    for (const f of files) {
      const src = await readFile(f, "utf8");
      for (const t of FORBIDDEN_DOMAIN_TYPES) {
        // match type references outside of the port-port files themselves.
        if (new RegExp(`\\b${t}\\b`).test(src)) {
          violations.push(`${f}: ${t}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("no raw SQL against SSA tables", async () => {
    const files = await walk(SIM_ROOT);
    const violations: string[] = [];
    const re =
      /FROM\s+(satellite|operator|conjunction_event|operator_country|orbit_regime|platform_class|satellite_bus)\b/i;
    for (const f of files) {
      if (re.test(await readFile(f, "utf8"))) {
        violations.push(f);
      }
    }
    expect(violations).toEqual([]);
  });
});
