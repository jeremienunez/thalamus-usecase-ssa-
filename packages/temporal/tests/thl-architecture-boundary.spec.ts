import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("Temporal package architecture boundary", () => {
  it("keeps the pure THL package away from KG and sim-promotion writers", () => {
    const sourceFiles = collectSourceFiles(join(process.cwd(), "packages/temporal/src"));
    const forbidden = [
      "@interview/db-schema",
      "kg.repository",
      "research-edge.repository",
      "finding.repository",
      "sim-promotion.service",
      "sim-promotion",
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
