import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(TEST_DIR, "../../../..");

type SourceFile = {
  path: string;
  text: string;
};

const RESEARCH_PORT_FILE =
  "apps/console-api/src/services/ports/research-write.port.ts";

const THALAMUS_PORT_DECLARATIONS = [
  {
    name: "CortexDataProvider",
    pattern: /\bexport\s+type\s+CortexDataProvider\b/,
    path: "packages/thalamus/src/ports/cortex-data-provider.port.ts",
  },
  {
    name: "DomainConfig",
    pattern: /\bexport\s+interface\s+DomainConfig\b/,
    path: "packages/thalamus/src/ports/domain-config.port.ts",
  },
  {
    name: "noopDomainConfig",
    pattern: /\bexport\s+const\s+noopDomainConfig\b/,
    path: "packages/thalamus/src/ports/domain-config.port.ts",
  },
  {
    name: "CortexExecutionStrategy",
    pattern: /\bexport\s+interface\s+CortexExecutionStrategy\b/,
    path: "packages/thalamus/src/ports/cortex-execution-strategy.port.ts",
  },
];

const DELETED_GOD_SERVICE_PATHS = [
  "apps/console-api/src/services/sim-promotion.service.ts",
  "packages/thalamus/src/services/research-graph.service.ts",
];

const C4_TARGET_FILES = [
  "packages/thalamus/src/cortices/config.ts",
  "packages/thalamus/src/services/thalamus.service.ts",
  "packages/thalamus/src/services/thalamus-planner.service.ts",
  "packages/thalamus/src/cortices/guardrails.ts",
  "packages/thalamus/src/prompts/curator.prompt.ts",
  "packages/thalamus/src/prompts/nano-swarm.prompt.ts",
];

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(resolve(REPO_ROOT, path), constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function repoPath(absPath: string): string {
  return relative(REPO_ROOT, absPath).split(sep).join("/");
}

function isSourceFile(path: string): boolean {
  if (!path.endsWith(".ts") || path.endsWith(".d.ts")) return false;
  if (path.endsWith(".test.ts") || path.endsWith(".spec.ts")) return false;
  if (path.includes("/__fixtures__/") || path.includes("/fixtures/")) {
    return false;
  }
  return true;
}

async function walkSourceFiles(dir: string, out: string[] = []): Promise<string[]> {
  const absDir = resolve(REPO_ROOT, dir);
  for (const entry of await readdir(absDir, { withFileTypes: true })) {
    const absPath = join(absDir, entry.name);
    if (entry.isDirectory()) {
      await walkSourceFiles(repoPath(absPath), out);
      continue;
    }
    if (entry.isFile() && isSourceFile(absPath)) {
      out.push(repoPath(absPath));
    }
  }
  return out;
}

async function readSources(dirs: string[]): Promise<SourceFile[]> {
  const files: SourceFile[] = [];
  for (const dir of dirs) {
    if (!(await pathExists(dir))) continue;
    for (const path of await walkSourceFiles(dir)) {
      files.push({
        path,
        text: await readFile(resolve(REPO_ROOT, path), "utf8"),
      });
    }
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

async function readSource(path: string): Promise<SourceFile> {
  return {
    path,
    text: await readFile(resolve(REPO_ROOT, path), "utf8"),
  };
}

async function readSourceIfExists(path: string): Promise<SourceFile | null> {
  if (!(await pathExists(path))) return null;
  return readSource(path);
}

function globalPattern(pattern: RegExp): RegExp {
  return pattern.global
    ? new RegExp(pattern.source, pattern.flags)
    : new RegExp(pattern.source, `${pattern.flags}g`);
}

function lineNumber(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

function findMatches(files: SourceFile[], pattern: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    const re = globalPattern(pattern);
    let match: RegExpExecArray | null;
    while ((match = re.exec(file.text)) !== null) {
      hits.push(
        `${file.path}:${lineNumber(file.text, match.index)} ${match[0].trim()}`,
      );
      if (match[0].length === 0) re.lastIndex += 1;
    }
  }
  return hits.sort((a, b) => a.localeCompare(b));
}

function findDeclarationPaths(files: SourceFile[], pattern: RegExp): string[] {
  return files
    .filter((file) => pattern.test(file.text))
    .map((file) => file.path)
    .sort((a, b) => a.localeCompare(b));
}

function findInterfaceDeclarations(files: SourceFile[], names: string[]): string[] {
  const nameAlternation = names.join("|");
  const pattern = new RegExp(
    `\\bexport\\s+interface\\s+(${nameAlternation})\\b`,
    "g",
  );
  const declarations: string[] = [];

  for (const file of files) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(file.text)) !== null) {
      declarations.push(`${match[1]}:${file.path}`);
    }
  }

  return declarations.sort((a, b) => a.localeCompare(b));
}

async function existingPaths(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const path of paths) {
    if (await pathExists(path)) found.push(path);
  }
  return found;
}

describe("Sprint 5 architecture debt BDD acceptance guardrails", () => {
  it("given Phase 1 app write ports, when scanning console-api services, then CyclesPort FindingsWritePort and EdgesWritePort are declared only in the canonical port file", async () => {
    const serviceSources = await readSources(["apps/console-api/src/services"]);

    const declarations = findInterfaceDeclarations(
      serviceSources,
      ["CyclesPort", "FindingsWritePort", "EdgesWritePort"],
    );

    expect(declarations).toEqual([
      `CyclesPort:${RESEARCH_PORT_FILE}`,
      `EdgesWritePort:${RESEARCH_PORT_FILE}`,
      `FindingsWritePort:${RESEARCH_PORT_FILE}`,
    ]);
  });

  it("given Phase 1 satellite read ports, when scanning the two satellite consumers, then divergent responsibilities have explicit port names", async () => {
    const satelliteView = await readSource(
      "apps/console-api/src/services/satellite-view.service.ts",
    );
    const sweepTaskPlanner = await readSource(
      "apps/console-api/src/services/sweep-task-planner.service.ts",
    );

    const violations = [
      satelliteView.text.includes("export interface SatelliteOrbitalReadPort")
        ? ""
        : `${satelliteView.path}: missing SatelliteOrbitalReadPort`,
      satelliteView.text.includes("export interface SatellitesReadPort")
        ? `${satelliteView.path}: still declares SatellitesReadPort`
        : "",
      sweepTaskPlanner.text.includes(
        "export interface SatellitePayloadNameReadPort",
      )
        ? ""
        : `${sweepTaskPlanner.path}: missing SatellitePayloadNameReadPort`,
      sweepTaskPlanner.text.includes("export interface SatellitesReadPort")
        ? `${sweepTaskPlanner.path}: still declares SatellitesReadPort`
        : "",
    ].filter(Boolean);

    expect(violations).toEqual([]);
  });

  it("given Phase 2 thalamus ports, when scanning thalamus source, then port declarations live under packages thalamus src ports", async () => {
    const thalamusSources = await readSources(["packages/thalamus/src"]);

    const declarationLocations = THALAMUS_PORT_DECLARATIONS.map((decl) => ({
      name: decl.name,
      paths: findDeclarationPaths(thalamusSources, decl.pattern),
    }));

    expect(declarationLocations).toEqual(
      THALAMUS_PORT_DECLARATIONS.map((decl) => ({
        name: decl.name,
        paths: [decl.path],
      })),
    );
  });

  it("given C1 app services consume the business writer, when scanning service surfaces, then no service exposes Drizzle research insert shapes", async () => {
    const serviceSources = await readSources(["apps/console-api/src/services"]);

    const insertShapeLeaks = findMatches(
      serviceSources,
      /\bresearch(?:Cycle|Finding|Edge|CycleFinding)\.\$inferInsert\b/,
    );

    expect(insertShapeLeaks).toEqual([]);
  });

  it("given C1 writer is the public contract, when scanning the writer port, then it depends on DTO types rather than Drizzle entities", async () => {
    const writerPort = await readSource(
      "packages/thalamus/src/ports/research-writer.port.ts",
    );

    expect(writerPort.text).toContain("../types/research.types");
    expect(writerPort.text).not.toContain("../entities/research.entity");
    expect(writerPort.text).not.toMatch(/\bResearch(?:Cycle|Finding|Edge)Entity\b/);
    expect(writerPort.text).not.toMatch(/\bNewResearch(?:Cycle|Finding|Edge)Entity\b/);
  });

  it("given C1 owns research persistence, when scanning app and package source, then research table inserts appear only in the research writer", async () => {
    const sources = await readSources([
      "apps/console-api/src",
      "packages/thalamus/src",
      "packages/sweep/src",
    ]);

    const insertCalls = findMatches(
      sources,
      /\.\s*insert\s*\(\s*research(?:Cycle|Finding|Edge|CycleFinding)\b/,
    ).filter(
      (hit) =>
        !hit.startsWith(
          "apps/console-api/src/services/research-write.service.ts:",
        ),
    );

    expect(insertCalls).toEqual([]);
  });

  it("given C1 deletes dormant second contracts, when scanning app repositories, then public research write methods are absent", async () => {
    const [findingRepo, edgeRepo] = await Promise.all([
      readSourceIfExists(
        "apps/console-api/src/repositories/finding.repository.ts",
      ),
      readSourceIfExists(
        "apps/console-api/src/repositories/research-edge.repository.ts",
      ),
    ]);
    const repos = [findingRepo, edgeRepo].filter(
      (file): file is SourceFile => file !== null,
    );

    const publicWriteMethods = [
      ...findMatches(
        repos.filter((file) => file.path.endsWith("finding.repository.ts")),
        /\basync\s+(?:insert|updateCycleFindingsCount)\s*\(/,
      ),
      ...findMatches(
        repos.filter((file) =>
          file.path.endsWith("research-edge.repository.ts"),
        ),
        /\basync\s+insert\s*\(/,
      ),
    ];

    expect(publicWriteMethods).toEqual([]);
  });

  it("given C1 removes private repository shortcuts, when scanning app and package imports, then research repositories are not imported as caller contracts", async () => {
    const sources = await readSources([
      "apps/console-api/src",
      "packages/thalamus/src",
      "packages/sweep/src",
    ]);

    const appResearchRepoImports = findMatches(
      sources.filter((file) => file.path.startsWith("apps/console-api/src/")),
      /\bfrom\s+["'][^"']*repositories\/research-(?:cycle|finding|edge)(?:\.repository)?["']/,
    );
    const deepThalamusRepoImports = findMatches(
      sources,
      /\bfrom\s+["']@interview\/thalamus\/src\/repositories\//,
    );

    expect([...appResearchRepoImports, ...deepThalamusRepoImports]).toEqual([]);
  });

  it("given C1 HTTP is the public kernel contract, when scanning routes and controllers, then required research write endpoints are registered", async () => {
    const httpSources = await readSources([
      "apps/console-api/src/routes",
      "apps/console-api/src/controllers",
      "apps/console-api/src/schemas",
    ]);
    const httpSurface = httpSources.map((file) => file.text).join("\n");
    const requiredEndpoints = [
      "/api/research/cycles",
      "/api/research/finding-emissions",
      "/api/research/cycles/:id/increment-findings",
    ];
    const missingEndpoints = requiredEndpoints.filter(
      (endpoint) => !httpSurface.includes(endpoint),
    );

    expect(missingEndpoints).toEqual([]);
    expect(httpSurface).toContain("ResearchCycleWriteBodySchema");
    expect(httpSurface).toContain("ResearchFindingEmissionBodySchema");
    expect(
      findMatches(
        httpSources.filter((file) =>
          file.path.endsWith("research-write.controller.ts"),
        ),
        /\breq\.body\s+as\b/,
      ),
    ).toEqual([]);
  });

  it("given finding emissions are compound writes, when scanning controller and writer, then the controller delegates to a transactional writer method", async () => {
    const [controller, writer] = await Promise.all([
      readSource("apps/console-api/src/controllers/research-write.controller.ts"),
      readSource("apps/console-api/src/services/research-write.service.ts"),
    ]);

    expect(writer.text).toContain("emitFindingTransactional");
    expect(writer.text).toMatch(/\btransaction\s*\(/);
    expect(controller.text).toContain("writer.emitFindingTransactional");
    expect(
      findMatches(
        [controller],
        /\bwriter\.(?:upsertFindingByDedupHash|linkFindingToCycle|createEdges)\s*\(/,
      ),
    ).toEqual([]);
  });

  it("given M1 moves stats onto a read model, when scanning the stats repository, then it no longer queries research tables directly", async () => {
    const statsRepo = await readSource(
      "apps/console-api/src/repositories/stats.repository.ts",
    );

    const directResearchReads = findMatches(
      [statsRepo],
      /\bFROM\s+research_(?:cycle|finding|edge)\b/i,
    );

    expect(directResearchReads).toEqual([]);
    expect(statsRepo.text).toContain("vw_research_stats_counts");
    expect(statsRepo.text).toContain("vw_research_findings_by_status");
    expect(statsRepo.text).toContain("vw_research_findings_by_cortex");
  });

  it("given C2 and M3 close the god-service debt, when scanning deleted service paths, then no compatibility facade remains", async () => {
    const stillPresent = await existingPaths(DELETED_GOD_SERVICE_PATHS);

    expect(stillPresent).toEqual([]);
  });

  it("given M4 extracts sim launch orchestration, when scanning container wiring, then no inline swarm launcher closure remains", async () => {
    const [launcherService, container] = await Promise.all([
      readSourceIfExists("apps/console-api/src/services/sim-launcher.service.ts"),
      readSource("apps/console-api/src/container.ts"),
    ]);

    expect(launcherService?.text).toContain("class SimLauncherService");
    expect(container.text).toContain("new SimLauncherService");
    expect(
      findMatches(
        [container],
        /\bstart(?:TelemetrySwarm|PcEstimatorSwarm)\s*\(/,
      ),
    ).toEqual([]);
  });

  it("given M8 bounds sweep Redis scans, when scanning the repository, then legacy all-index reads are paged", async () => {
    const sweepRepo = await readSource(
      "packages/sweep/src/repositories/sweep.repository.ts",
    );

    expect(
      findMatches(
        [sweepRepo],
        /zrevrange\s*\(\s*IDX_ALL\s*,\s*0\s*,\s*-1\s*\)/,
      ),
    ).toEqual([]);
    expect(sweepRepo.text).toContain("LEGACY_INDEX_SCAN_BATCH");
  });

  it("given I5 decouples sweep from thalamus, when scanning packages sweep source, then sweep imports no thalamus package surface", async () => {
    const sweepSources = await readSources(["packages/sweep/src"]);

    const thalamusImports = findMatches(
      sweepSources,
      /\bfrom\s+["']@interview\/thalamus(?:\/[^"']*)?["']/,
    );

    expect(thalamusImports).toEqual([]);
  });

  it("given C4 keeps the thalamus kernel domain agnostic, when scanning targeted kernel files, then SSA vocabulary is absent from defaults and prompts", async () => {
    const targetSources: SourceFile[] = [];
    for (const path of C4_TARGET_FILES) {
      if (await pathExists(path)) targetSources.push(await readSource(path));
    }

    const domainTerms = findMatches(
      targetSources,
      /\b(?:SSA|satellite|satellites|orbit|orbital|conjunction|conjunctions)\b/i,
    );

    expect(domainTerms).toEqual([]);
  });
});
