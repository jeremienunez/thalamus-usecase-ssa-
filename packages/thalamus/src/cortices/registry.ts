/**
 * Cortex Registry — Discovers cortex skills from server/src/agent/cortices/skills/
 *
 * At startup, reads all .md files in the skills/ directory.
 * Parses YAML frontmatter for routing metadata (name, description, sqlHelper, params).
 * The planner receives only headers (~200 tokens each) for DAG planning.
 * The executor reads the full file body when activating a cortex.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createLogger } from "@interview/shared/observability";

const __dirname = dirname(fileURLToPath(import.meta.url));

const logger = createLogger("cortex-registry");

// ============================================================================
// Types
// ============================================================================

export interface CortexSkillHeader {
  name: string;
  description: string;
  sqlHelper: string;
  params: Record<string, string>;
}

export interface CortexSkill {
  header: CortexSkillHeader;
  body: string; // Full markdown body (system prompt for LLM)
  filePath: string;
}

// ============================================================================
// Parser
// ============================================================================

/**
 * Parse a cortex skill .md file into header + body.
 * Frontmatter is YAML between --- delimiters.
 */
function parseSkillFile(content: string, filePath: string): CortexSkill | null {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch) {
    logger.warn({ filePath }, "Skill file missing frontmatter, skipping");
    return null;
  }

  const [, frontmatter, body] = fmMatch;

  // Simple YAML parsing (no dependency — these are our own files)
  const header: Record<string, unknown> = {};
  let currentKey = "";
  let inParams = false;
  const params: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (inParams) {
      const paramMatch = trimmed.match(/^(\w+):\s*(.+)$/);
      if (paramMatch && line.startsWith("  ")) {
        params[paramMatch[1]] = paramMatch[2];
        continue;
      } else {
        inParams = false;
      }
    }

    const kvMatch = trimmed.match(/^(\w+):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      if (currentKey === "params" && !kvMatch[2]) {
        inParams = true;
      } else {
        header[currentKey] = kvMatch[2];
      }
    }
  }

  if (!header.name || !header.description) {
    logger.warn({ filePath }, "Skill missing name or description, skipping");
    return null;
  }

  return {
    header: {
      name: header.name as string,
      description: header.description as string,
      sqlHelper: (header.sqlHelper as string) ?? "",
      params,
    },
    body: body.trim(),
    filePath,
  };
}

// ============================================================================
// Registry
// ============================================================================

export class CortexRegistry {
  private skills = new Map<string, CortexSkill>();
  private skillsDir: string;

  constructor(skillsDir?: string) {
    this.skillsDir = skillsDir ?? join(__dirname, "skills");
  }

  /**
   * Discover all .md skill files in the skills/ directory.
   * Called once at startup.
   */
  discover(): void {
    let files: string[];
    try {
      files = readdirSync(this.skillsDir).filter((f) => f.endsWith(".md"));
    } catch {
      logger.warn({ dir: this.skillsDir }, "Skills directory not found");
      return;
    }

    for (const file of files) {
      const filePath = join(this.skillsDir, file);
      const content = readFileSync(filePath, "utf-8");
      const skill = parseSkillFile(content, filePath);
      if (skill) {
        this.skills.set(skill.header.name, skill);
      }
    }

    logger.info(
      { count: this.skills.size, names: this.names() },
      "Cortex skills discovered",
    );
  }

  /**
   * Get headers for all skills (~200 tokens each).
   * Used by the planner to decide which cortices to activate.
   */
  getHeaders(): CortexSkillHeader[] {
    return [...this.skills.values()].map((s) => s.header);
  }

  /**
   * Get headers formatted as a compact string for the planner prompt.
   * One line per cortex: "name: description"
   */
  getHeadersForPlanner(): string {
    return this.getHeaders()
      .map((h) => `- **${h.name}**: ${h.description} [sql: ${h.sqlHelper}]`)
      .join("\n");
  }

  /**
   * Get full skill (header + body) for execution.
   */
  get(name: string): CortexSkill | undefined {
    return this.skills.get(name);
  }

  has(name: string): boolean {
    return this.skills.has(name);
  }

  names(): string[] {
    return [...this.skills.keys()];
  }

  size(): number {
    return this.skills.size;
  }
}
