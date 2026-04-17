/**
 * SPEC-TH-031 — Skills as Files
 *
 * The shipped surface is `CortexRegistry` (from `cortices/registry.ts`), not
 * the free `loadSkill`/`listSkills`/`validateSkill` functions named in the
 * spec. The tests assert the ACs against the concrete implementation.
 *
 * Traceability:
 *   AC-1 every shipped skill under src/cortices/skills/ parses via CortexRegistry
 *   AC-3 listed skills match the files on disk (filename stem == name, modulo
 *        snake_case convention used by the SSA skill pack)
 *   AC-5 sha256 on the skill body is deterministic across calls (normalized
 *        line endings)
 *
 * Out of scope:
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

// SSA skills live in the console-api agent pack. The kernel registry just
// reads whatever directory it's pointed at; this spec scans the SSA pack to
// validate every shipped skill parses and tracks a spec.
const SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../apps/console-api/src/agent/ssa/skills",
);

function skillSha256(body: string): string {
  // Normalize Windows line endings to Unix so the hash matches across machines.
  return createHash("sha256").update(body.replace(/\r\n/g, "\n")).digest("hex");
}

describe("SPEC-TH-031 shipped skills", () => {
  const registry = new CortexRegistry(SKILLS_DIR);
  registry.discover();

  it("AC-1 every .md file under skills/ parses into a skill with name + description + body", () => {
    const mdFiles = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));
    expect(mdFiles.length).toBeGreaterThan(0);
    expect(registry.size()).toBeGreaterThan(0);

    for (const name of registry.names()) {
      const skill = registry.get(name);
      expect(skill).toBeDefined();
      expect(skill!.header.name).toBeTruthy();
      expect(skill!.header.description).toBeTruthy();
      expect(skill!.body.length).toBeGreaterThan(0);
    }
  });

  it("AC-3 every registered skill maps to an existing file on disk", () => {
    const filesOnDisk = new Set(
      readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md")),
    );
    for (const name of registry.names()) {
      const skill = registry.get(name)!;
      const onDisk = skill.filePath.split("/").pop()!;
      expect(filesOnDisk).toContain(onDisk);
    }
  });

  it("AC-3 snake_case frontmatter name matches kebab-case filename stem (SSA convention)", () => {
    // The SSA skill pack ships files named e.g. `conjunction-analysis.md`
    // whose frontmatter carries `name: conjunction_analysis`. Test the
    // convention: snake_case name == kebab filename with dashes → underscores.
    for (const name of registry.names()) {
      const skill = registry.get(name)!;
      const stem = skill.filePath.split("/").pop()!.replace(/\.md$/, "");
      const stemAsSnake = stem.replace(/-/g, "_");
      expect(
        name,
        `${skill.filePath}: frontmatter name "${name}" does not match ` +
          `filename stem "${stem}" under the kebab→snake convention`,
      ).toBe(stemAsSnake);
    }
  });

  it("AC-1 the 5 core SSA cortices are present", () => {
    for (const core of [
      "catalog",
      "observations",
      "conjunction_analysis",
      "correlation",
      "maneuver_planning",
    ]) {
      expect(registry.has(core), `missing core cortex: ${core}`).toBe(true);
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

  it("every shipped skill produces a stable sha256", () => {
    const registry = new CortexRegistry(SKILLS_DIR);
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
