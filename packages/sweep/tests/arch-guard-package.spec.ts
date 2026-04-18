/**
 * packages/sweep/ arch-guard — enforces "generic sweep engine, no SSA".
 *
 * Three checks (all excluding sim/, handled by Plan 2):
 *   1. No SSA-flavoured file names outside sim/.
 *   2. No imports of SSA-scoped symbols from @interview/db-schema outside sim/.
 *   3. No raw SQL against SSA tables outside sim/.
 *
 * Plan 2 deferrals are explicitly allowlisted:
 *   - packages/sweep/src/repositories/satellite.repository.ts
 *   - packages/sweep/src/types/satellite.types.ts
 *   - packages/sweep/src/services/legacy-ssa-resolution.ts
 *   - packages/sweep/src/services/legacy-ssa-promotion.ts
 *   - packages/sweep/src/services/nano-sweep.service.ts (holds LegacyNanoSweepAuditProvider)
 *
 * These files exist solely as the fallback path used by the UC3 E2E
 * fixture in packages/sweep/tests/e2e/swarm-uc3.e2e.spec.ts, which
 * instantiates buildSweepContainer without opts.ports. Plan 2 moves the
 * fixture to apps/console-api and deletes the fallback.
 */

import { describe, it, expect } from "vitest";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
const SIM = join(ROOT, "sim/");

const FORBIDDEN_DB_SYMBOLS = [
  "satellite",
  "operator",
  "operatorCountry",
  "orbitRegime",
  "platformClass",
  "satelliteBus",
  "conjunctionEvent",
];

const FORBIDDEN_FILE_NAMES = [
  "satellite.service.ts",
  "satellite-sweep-chat.service.ts",
  "satellite-sweep-chat.repository.ts",
  "satellite-sweep-chat.controller.ts",
  "satellite-sweep-chat.routes.ts",
  "satellite-sweep-chat.dto.ts",
  "doctrine-parser.ts",
  "finding-routing.ts",
  "fragmentation-events-fetcher.ts",
  "itu-filings-fetcher.ts",
  "launch-manifest-fetcher.ts",
  "tle-history-fetcher.ts",
  "notam-fetcher.ts",
  "space-weather-fetcher.ts",
];

/**
 * Files allowed to retain SSA-flavoured imports / raw SQL for Plan 1.
 * Plan 2 removes all of them when the UC3 E2E fixture moves to console-api.
 */
const PLAN2_DEFERRED_ALLOWLIST = [
  "/repositories/satellite.repository.ts",
  "/types/satellite.types.ts",
  "/services/legacy-ssa-resolution.ts",
  "/services/legacy-ssa-promotion.ts",
  "/services/nano-sweep.service.ts",
];

function isAllowlisted(file: string): boolean {
  return PLAN2_DEFERRED_ALLOWLIST.some((suffix) => file.endsWith(suffix));
}

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

describe("packages/sweep/ is SSA-agnostic (sim/ excluded — Plan 2 handles it)", () => {
  it("no SSA-flavoured file names exist outside sim/ (Plan 2 allowlist applied)", async () => {
    const files = await walk(ROOT);
    const violations = files
      .filter((f) => !f.startsWith(SIM))
      .filter((f) => FORBIDDEN_FILE_NAMES.some((n) => f.endsWith(`/${n}`)))
      .filter((f) => !isAllowlisted(f));
    expect(violations).toEqual([]);
  });

  it("no imports of SSA symbols from @interview/db-schema outside sim/ (Plan 2 allowlist applied)", async () => {
    const files = (await walk(ROOT))
      .filter((f) => !f.startsWith(SIM))
      .filter((f) => !isAllowlisted(f));
    const violations: string[] = [];
    for (const f of files) {
      const src = await readFile(f, "utf8");
      const blocks = src.match(
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

  it("no raw SQL against SSA tables outside sim/ (Plan 2 allowlist applied)", async () => {
    const files = (await walk(ROOT))
      .filter((f) => !f.startsWith(SIM))
      .filter((f) => !isAllowlisted(f));
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
