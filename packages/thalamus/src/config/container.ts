/**
 * Thalamus DI container — wires repositories, services, registry, executor.
 *
 * `buildThalamusContainer` is the single entry point used by demos, tests, and
 * the eventual server bootstrap. The caller owns the `Database` lifetime.
 */

import type { Database } from "@interview/db-schema";
import { CortexRegistry } from "../cortices/registry";
import { CortexExecutor } from "../cortices/executor";
import type { CortexDataProvider, DomainConfig } from "../cortices/types";
import { noopDomainConfig } from "../cortices/types";
import { ResearchGraphService } from "../services/research-graph.service";
import { ThalamusService } from "../services/thalamus.service";
import { ResearchCycleRepository } from "../repositories/research-cycle.repository";
import { ResearchFindingRepository } from "../repositories/research-finding.repository";
import { ResearchEdgeRepository } from "../repositories/research-edge.repository";
import { EntityNameResolver } from "../repositories/entity-name-resolver";
import { VoyageEmbedder } from "../utils/voyage-embedder";

export interface ThalamusContainer {
  thalamusService: ThalamusService;
  graphService: ResearchGraphService;
  registry: CortexRegistry;
  executor: CortexExecutor;
  cycleRepo: ResearchCycleRepository;
  findingRepo: ResearchFindingRepository;
  edgeRepo: ResearchEdgeRepository;
  embedder: VoyageEmbedder;
}

export interface BuildThalamusOpts {
  db: Database;
  /** Required: path to the caller's cortex-skill directory (domain pack). */
  skillsDir: string;
  /** Required: app-provided data provider map (sqlHelper name → fetcher fn). */
  dataProvider: CortexDataProvider;
  /**
   * Domain vocabulary + cortex classifications + pre-built DAGs.
   * Optional — defaults to `noopDomainConfig` for agents that route via HTTP
   * and don't run cycles in-process (e.g. CLI).
   */
  domainConfig?: DomainConfig;
  /** Optional Voyage API key override */
  voyageApiKey?: string;
}

export function buildThalamusContainer(
  opts: BuildThalamusOpts,
): ThalamusContainer {
  const { db } = opts;

  const cycleRepo = new ResearchCycleRepository(db);
  const findingRepo = new ResearchFindingRepository(db);
  const edgeRepo = new ResearchEdgeRepository(db);
  const entityResolver = new EntityNameResolver(db);
  const embedder = new VoyageEmbedder(opts.voyageApiKey);

  const registry = new CortexRegistry(opts.skillsDir);
  registry.discover();

  const executor = new CortexExecutor(
    registry,
    opts.dataProvider,
    opts.domainConfig ?? noopDomainConfig,
  );

  const graphService = new ResearchGraphService(
    findingRepo,
    edgeRepo,
    cycleRepo,
    embedder,
    entityResolver,
  );

  const thalamusService = new ThalamusService(
    registry,
    executor,
    graphService,
    cycleRepo,
  );

  return {
    thalamusService,
    graphService,
    registry,
    executor,
    cycleRepo,
    findingRepo,
    edgeRepo,
    embedder,
  };
}
