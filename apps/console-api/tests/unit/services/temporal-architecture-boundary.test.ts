import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Temporal console-api architecture boundary", () => {
  it("keeps THL services and repositories away from KG and promotion writers", () => {
    const sourceFiles = [
      ...collectSourceFiles(join(process.cwd(), "apps/console-api/src/services")),
      ...collectSourceFiles(join(process.cwd(), "apps/console-api/src/repositories")),
    ].filter((file) => file.includes("/temporal-"));
    const forbidden = [
      "kg.repository",
      "sim-promotion.service",
      "research-write.service",
      "FindingRepository",
      "ResearchEdgeRepository",
      "createFinding",
      "createEdges",
    ];

    const offenders = sourceFiles.flatMap((file) => {
      const src = readFileSync(file, "utf8");
      return forbidden
        .filter((needle) => src.includes(needle))
        .map((needle) => `${file}:${needle}`);
    });

    expect(offenders).toEqual([]);
  });
});

function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return collectSourceFiles(fullPath);
    if (entry.isFile() && fullPath.endsWith(".ts")) return [fullPath];
    return [];
  });
}
