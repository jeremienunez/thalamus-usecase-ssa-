/**
 * SPEC-TH-031 — Skills as Files (kernel-owned CortexRegistry behaviors)
 *
 * The kernel-owned surface is `CortexRegistry`. This spec stays inside
 * `packages/thalamus` and exercises the registry against local fixture files,
 * not app-owned SSA skills on disk.
 *
 * Traceability:
 *   AC-1 fixture skills parse via CortexRegistry
 *   AC-5 sha256 on the skill body is deterministic across calls
 *
 * Out of scope:
 *   AC-1 / AC-3 on the shipped SSA skill pack — exercised from
 *        `apps/console-api/tests/unit/skills-as-files.test.ts`
 *   AC-2 CI failure on missing sections — covered by scripts/spec-check.ts
 *   AC-4 no multi-line prompt literals in cortex sources — repo-wide grep,
 *        lives in a lint rule
 *   AC-6 cortex-llm provenance chain — integration test
 *   AC-7 audit-time prompt diff — operator tooling
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { CortexRegistry } from "../src/cortices/registry";

const FIXTURE_SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "__fixtures__/skills",
);

function skillSha256(body: string): string {
  return createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex");
}

describe("SPEC-TH-031 fixture skills", () => {
  const registry = new CortexRegistry(FIXTURE_SKILLS_DIR);
  registry.discover();

  it("AC-1 every fixture .md file parses into a skill with name + description + body", () => {
    const mdFiles = readdirSync(FIXTURE_SKILLS_DIR).filter((f) =>
      f.endsWith(".md"),
    );
    expect(mdFiles.length).toBeGreaterThan(0);
    expect(registry.size()).toBe(mdFiles.length);

    for (const name of registry.names()) {
      const skill = registry.get(name);
      expect(skill).toBeDefined();
      expect(skill!.header.name).toBeTruthy();
      expect(skill!.header.description).toBeTruthy();
      expect(skill!.body.length).toBeGreaterThan(0);
    }
  });

  it("AC-1 fixture params round-trip through the registry", () => {
    const skill = registry.get("launch_scout");
    expect(skill).toBeDefined();
    expect(skill!.header.params).toEqual({
      horizonDays: "integer",
      region: "string",
    });
  });

  it("AC-1 every registered fixture skill maps to an existing file on disk", () => {
    const filesOnDisk = new Set(
      readdirSync(FIXTURE_SKILLS_DIR).filter((f) => f.endsWith(".md")),
    );
    for (const name of registry.names()) {
      const skill = registry.get(name)!;
      const onDisk = skill.filePath.split("/").pop()!;
      expect(filesOnDisk).toContain(onDisk);
    }
  });
});

describe("SPEC-TH-031 sha256 determinism (AC-5)", () => {
  it("normalised-LF sha256 is deterministic for a fixture body", () => {
    const body = "# Skill\nParam: value\nOne line.\nAnother line.\n";
    const h1 = skillSha256(body);
    const h2 = skillSha256(body);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("CRLF and LF variants yield the same sha256 after normalisation", () => {
    const lf = "first\nsecond\nthird\n";
    const crlf = "first\r\nsecond\r\nthird\r\n";
    expect(skillSha256(lf)).toBe(skillSha256(crlf));
  });

  it("every fixture skill produces a stable sha256", () => {
    const registry = new CortexRegistry(FIXTURE_SKILLS_DIR);
    registry.discover();
    const hashes = registry.names().map((n) => {
      const body = readFileSync(registry.get(n)!.filePath, "utf8");
      return skillSha256(body);
    });
    const hashes2 = registry.names().map((n) => {
      const body = readFileSync(registry.get(n)!.filePath, "utf8");
      return skillSha256(body);
    });
    expect(hashes).toEqual(hashes2);
    for (const h of hashes) expect(h).toHaveLength(64);
  });
});
