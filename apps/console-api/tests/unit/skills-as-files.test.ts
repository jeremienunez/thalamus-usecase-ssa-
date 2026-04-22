/**
 * SPEC-TH-031 — shipped SSA skills as files
 *
 * These assertions are SSA-pack specific and therefore belong in
 * `apps/console-api`, not in `packages/thalamus`.
 */
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { CortexRegistry } from "@interview/thalamus";

const SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../src/agent/ssa/skills",
);

describe("SPEC-TH-031 shipped SSA skills", () => {
  const registry = new CortexRegistry(SKILLS_DIR);
  registry.discover();

  it("AC-1 every .md file under the SSA pack parses into a skill with name + description + body", () => {
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

  it("AC-3 every registered SSA skill maps to an existing file on disk", () => {
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
    for (const name of registry.names()) {
      const skill = registry.get(name)!;
      const stem = skill.filePath.split("/").pop()!.replace(/\.md$/, "");
      const stemAsSnake = stem.replace(/-/g, "_");
      expect(
        name,
        `${skill.filePath}: frontmatter name "${name}" does not match filename stem "${stem}" under the kebab→snake convention`,
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

describe("SSA prompt contracts", () => {
  it("uses the runtime custom-format marker on the audited SSA skills", () => {
    for (const filename of [
      "conjunction-analysis.md",
      "launch-scout.md",
      "traffic-spotter.md",
      "debris-forecaster.md",
      "apogee-tracker.md",
      "conjunction-candidate-knn.md",
    ]) {
      const body = readFileSync(join(SKILLS_DIR, filename), "utf8");
      expect(body).toContain("## Output Format");
      expect(body).not.toContain("\n## Output\n");
    }
  });

  it("keeps the strategist prompt on a strict JSON-only contract", () => {
    const body = readFileSync(join(SKILLS_DIR, "strategist.md"), "utf8");
    expect(body).toContain("Return exactly one JSON object and nothing else");
    expect(body.match(/\{"findings":\[\]\}/g)?.length).toBe(1);
    expect(body).not.toMatch(/\{\s*source:/);
  });

  it("keeps the audited high-risk SSA skills off stale runtime-contract tokens", () => {
    for (const filename of [
      "fleet-analyst.md",
      "advisory-radar.md",
      "replacement-cost-analyst.md",
      "orbit-slot-optimizer.md",
      "conjunction-analysis.md",
      "conjunction-candidate-knn.md",
      "debris-forecaster.md",
      "launch-scout.md",
      "apogee-tracker.md",
      "traffic-spotter.md",
      "maneuver-planning.md",
      "research-loop.md",
      "opacity-scout.md",
    ]) {
      const body = readFileSync(join(SKILLS_DIR, filename), "utf8");
      expect(body, `${filename} still references entityRef`).not.toContain(
        "entityRef",
      );
      expect(
        body,
        `${filename} still references invalid edge relations`,
      ).not.toMatch(
        /relation:\s*"(?:owned-by|affected-by|impacts|targets|mitigates|conjunction_candidate)"/,
      );
      expect(
        body,
        `${filename} still references invalid finding types`,
      ).not.toMatch(
        /findingType[^.\n]*"(?:proposal|advisory|blocked|data_quality)"/,
      );
      expect(
        body,
        `${filename} still references a stale array-only contract`,
      ).not.toContain("JSON array of findings per SPEC-TH-030");
    }
  });

  it("keeps the sim-specialized prompts on explicit JSON-only contracts", () => {
    const researchLoop = readFileSync(
      join(SKILLS_DIR, "research-loop.md"),
      "utf8",
    );
    expect(researchLoop).toContain(
      'Return exactly one JSON object and nothing else.',
    );
    expect(researchLoop).toContain('"findings": [');
    expect(researchLoop).not.toContain("LOOP:");

    const pcEstimator = readFileSync(
      join(SKILLS_DIR, "pc-estimator-agent.md"),
      "utf8",
    );
    expect(pcEstimator).toContain("Return exactly one JSON object");
    expect(pcEstimator).toContain('"kind": "estimate_pc"');

    const telemetry = readFileSync(
      join(SKILLS_DIR, "telemetry-inference-agent.md"),
      "utf8",
    );
    expect(telemetry).toContain("Return exactly one JSON object");
    expect(telemetry).toContain('"kind": "infer_telemetry"');
    expect(telemetry).toContain('"unit": "dBW"');
    expect(telemetry).toContain('"unit": "fraction"');

    const opacity = readFileSync(join(SKILLS_DIR, "opacity-scout.md"), "utf8");
    expect(opacity).toContain("Return exactly one JSON object and nothing else.");
    expect(opacity).toContain('"findings": [');
    expect(opacity).not.toContain("writeOpacityScore");
    expect(opacity).not.toContain("source_class");
  });
});
