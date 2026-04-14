/**
 * SPEC-TH-002 — Cortex Registry
 *
 * Traceability:
 *   AC-1 discovers valid skills, skips invalid
 *   AC-2 missing directory is non-fatal
 *   AC-3 skips files missing required fields
 *   AC-4 planner view excludes body
 *   AC-5 params map round-trip
 *   AC-6 has and get are consistent
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CortexRegistry } from "../src/cortices/registry";

function writeSkill(dir: string, filename: string, content: string): void {
  writeFileSync(join(dir, filename), content, "utf8");
}

const SKILL_VALID = (name: string) => `---
name: ${name}
description: A valid SSA ${name} skill
sqlHelper: ${name}
params:
  a: bigint
  b: string
---

# ${name} body
Some markdown body here — instructions for the cortex.
`;

const SKILL_NO_FRONTMATTER = `# No frontmatter here
This file is just a plain markdown body, no YAML.
`;

const SKILL_NO_DESCRIPTION = `---
name: orphan
sqlHelper: orphan
---

body
`;

const SKILL_NO_NAME = `---
description: nameless skill
sqlHelper: nameless
---

body
`;

let dir: string;
let registry: CortexRegistry;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cortex-registry-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SPEC-TH-002 CortexRegistry.discover", () => {
  it("AC-1 discovers valid skills and skips invalid ones", () => {
    writeSkill(dir, "catalog.md", SKILL_VALID("catalog"));
    writeSkill(dir, "observations.md", SKILL_VALID("observations"));
    writeSkill(dir, "broken.md", SKILL_NO_FRONTMATTER);

    registry = new CortexRegistry(dir);
    registry.discover();

    expect(registry.size()).toBe(2);
    for (const name of registry.names()) {
      const skill = registry.get(name);
      expect(skill).toBeDefined();
      expect(skill!.header.name).toBe(name);
    }
  });

  it("AC-2 missing directory is non-fatal", () => {
    registry = new CortexRegistry(join(dir, "does-not-exist"));
    expect(() => registry.discover()).not.toThrow();
    expect(registry.size()).toBe(0);
    expect(registry.names()).toEqual([]);
  });

  it("AC-3 skips files missing required fields (name or description)", () => {
    writeSkill(dir, "valid.md", SKILL_VALID("valid"));
    writeSkill(dir, "no-description.md", SKILL_NO_DESCRIPTION);
    writeSkill(dir, "no-name.md", SKILL_NO_NAME);

    registry = new CortexRegistry(dir);
    registry.discover();

    expect(registry.size()).toBe(1);
    expect(registry.names()).toEqual(["valid"]);
    expect(registry.has("orphan")).toBe(false);
    expect(registry.has("nameless")).toBe(false);
  });

  it("AC-3 non-md files are ignored", () => {
    writeSkill(dir, "catalog.md", SKILL_VALID("catalog"));
    writeSkill(dir, "README.txt", "not a skill");
    writeSkill(dir, "notes.json", "{}");

    registry = new CortexRegistry(dir);
    registry.discover();

    expect(registry.size()).toBe(1);
    expect(registry.names()).toEqual(["catalog"]);
  });
});

describe("SPEC-TH-002 planner view", () => {
  it("AC-4 getHeadersForPlanner contains each name + description exactly once and excludes body", () => {
    const body1 = "---\nname: a\ndescription: alpha skill\nsqlHelper: a\n---\nSECRET-BODY-TOKEN-A\n";
    const body2 = "---\nname: b\ndescription: beta skill\nsqlHelper: b\n---\nSECRET-BODY-TOKEN-B\n";
    writeFileSync(join(dir, "a.md"), body1);
    writeFileSync(join(dir, "b.md"), body2);

    registry = new CortexRegistry(dir);
    registry.discover();

    const view = registry.getHeadersForPlanner();
    expect(view).toContain("a");
    expect(view).toContain("alpha skill");
    expect(view).toContain("b");
    expect(view).toContain("beta skill");
    expect(view).not.toContain("SECRET-BODY-TOKEN-A");
    expect(view).not.toContain("SECRET-BODY-TOKEN-B");

    // Each name appears exactly once
    expect((view.match(/\*\*a\*\*/g) ?? []).length).toBe(1);
    expect((view.match(/\*\*b\*\*/g) ?? []).length).toBe(1);
  });
});

describe("SPEC-TH-002 params parsing", () => {
  it("AC-5 params map preserves all declared keys as strings", () => {
    const content = `---
name: params_roundtrip
description: params test
sqlHelper: ph
params:
  userId: bigint
  query: string
  limit: number
  locale: string
---
body
`;
    writeFileSync(join(dir, "params_roundtrip.md"), content);
    registry = new CortexRegistry(dir);
    registry.discover();

    const skill = registry.get("params_roundtrip");
    expect(skill).toBeDefined();
    expect(skill!.header.params).toEqual({
      userId: "bigint",
      query: "string",
      limit: "number",
      locale: "string",
    });
  });

  it("AC-5 skill without params yields empty object", () => {
    const content = `---
name: no_params
description: no params
sqlHelper: np
---
body
`;
    writeFileSync(join(dir, "no_params.md"), content);
    registry = new CortexRegistry(dir);
    registry.discover();
    expect(registry.get("no_params")!.header.params).toEqual({});
  });
});

describe("SPEC-TH-002 has/get consistency", () => {
  it("AC-6 has(name) === (get(name) !== undefined) for every tested name", () => {
    writeSkill(dir, "a.md", SKILL_VALID("a"));
    writeSkill(dir, "b.md", SKILL_VALID("b"));
    registry = new CortexRegistry(dir);
    registry.discover();

    const probes = ["a", "b", "c", "d", ""];
    for (const name of probes) {
      expect(registry.has(name)).toBe(registry.get(name) !== undefined);
    }
  });
});
