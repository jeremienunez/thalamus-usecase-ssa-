/**
 * Thalamus DI container — wires repositories, services, registry, executor.
 *
 * `buildThalamusContainer` is the single entry point used by demos, tests, and
 * the eventual server bootstrap. The caller owns the `Database` lifetime.
 */

import type { Database, DatabaseExecutor } from "@interview/db-schema";
import type { ResearchWriterPort } from "../ports/research-writer.port";
import { CortexRegistry } from "../cortices/registry";
import { CortexExecutor } from "../cortices/executor";
import {
  StandardStrategy,
  StrategistStrategy,
  type CortexExecutionStrategy,
} from "../cortices/strategies";
import type { CortexDataProvider, DomainConfig } from "../cortices/types";
import { noopDomainConfig } from "../cortices/types";
import type { WebSearchPort } from "../ports/web-search.port";
import { NullWebSearchAdapter } from "../transports/openai-web-search.adapter";
import { FindingArchiveService } from "../services/finding-archive.service";
import { FindingStoreService } from "../services/finding-store.service";
import { KgQueryService } from "../services/kg-query.service";
import type {
  ResearchGraphServicePort,
  ResearchGraphTransactionPort,
} from "../services/research-graph.types";
import { ThalamusService } from "../services/thalamus.service";
import { ThalamusPlanner } from "../services/thalamus-planner.service";
import { ThalamusDAGExecutor } from "../services/thalamus-executor.service";
import { ThalamusReflexion } from "../services/thalamus-reflexion.service";
import { CycleLoopRunner } from "../services/cycle-loop.service";
import { FindingPersister } from "../services/finding-persister.service";
import { StopCriteriaEvaluator } from "../services/stop-criteria.service";
import { ResearchCycleRepository } from "../repositories/research-cycle.repository";
import { ResearchFindingRepository } from "../repositories/research-finding.repository";
import { ResearchEdgeRepository } from "../repositories/research-edge.repository";
import type { EmbedderPort } from "../ports/embedder.port";
import { NullEmbedder } from "../entities/null-embedder";
import type { EntityCatalogPort } from "../ports/entity-catalog.port";
import { NoopEntityCatalog } from "../entities/noop-entity-catalog";
import type { SourceFetcherPort } from "../ports/source-fetcher.port";
import { NoopSourceFetcher } from "../entities/noop-source-fetcher";

export interface ThalamusContainer {
  thalamusService: ThalamusService;
  graphService: ResearchGraphServicePort;
  registry: CortexRegistry;
  executor: CortexExecutor;
  cycleRepo: ResearchCycleRepository;
  findingRepo: ResearchFindingRepository;
  edgeRepo: ResearchEdgeRepository;
  embedder: EmbedderPort;
}

export interface BuildThalamusOpts {
  db: Database;
  /**
   * Required: factory producing a `ResearchWriterPort` bound to a given
   * executor. The same factory is invoked once for the top-level db and
   * again for each transaction so writes funnel through the single
   * `apps/console-api/src/services/research-write.service.ts` surface.
   */
  createResearchWriter: (db: DatabaseExecutor) => ResearchWriterPort;
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
  /**
   * Optional web-search port implementation. Defaults to
   * `NullWebSearchAdapter` (no-op) so the kernel stays free of external
   * HTTP concerns. Apps wire `OpenAIWebSearchAdapter` at their composition
   * root when a key is available.
   */
  webSearch?: WebSearchPort;
  /**
   * Optional override for the strategy list. Defaults to
   * `[StrategistStrategy, StandardStrategy]`. Provide this to add custom
   * pipelines without touching the kernel.
   */
  strategies?: CortexExecutionStrategy[];
  /**
   * Domain-owned embedder adapter. Defaults to `NullEmbedder` which
   * returns `null` for every query — the graph services then skip
   * semantic dedup and cross-linking. Apps ship a real adapter (e.g.
   * `SsaVoyageEmbedderAdapter`) at their composition root so the kernel
   * never learns which provider or API key powers embeddings.
   */
  embedder?: EmbedderPort;
  /**
   * Domain-owned entity catalog adapter. Defaults to `NoopEntityCatalog`
   * which returns empty resolutions and cleans 0 rows — enough for tests
   * and standalone demos. Apps ship an `EntityCatalogPort` impl at their
   * composition root (e.g. `SsaEntityCatalogAdapter` for SSA).
   */
  entityCatalog?: EntityCatalogPort;
  /**
   * Domain-owned source fetcher adapter. Defaults to `NoopSourceFetcher`
   * (returns empty — StandardStrategy falls through to SQL + optional
   * web-search only). SSA ships an adapter over its fetcher registry.
   */
  sourceFetcher?: SourceFetcherPort;
}

export function buildThalamusContainer(
  opts: BuildThalamusOpts,
): ThalamusContainer {
  const { db, createResearchWriter } = opts;

  const writer = createResearchWriter(db);
  const cycleRepo = new ResearchCycleRepository(db, writer);
  const findingRepo = new ResearchFindingRepository(db, writer);
  const edgeRepo = new ResearchEdgeRepository(db, writer);
  const graphTransactions: ResearchGraphTransactionPort = {
    runInTransaction: (work) =>
      db.transaction((tx) => {
        const txWriter = createResearchWriter(tx);
        return work({
          findingRepo: new ResearchFindingRepository(tx, txWriter),
          edgeRepo: new ResearchEdgeRepository(tx, txWriter),
          cycleRepo: new ResearchCycleRepository(tx, txWriter),
        });
      }),
  };
  const entityCatalog = opts.entityCatalog ?? new NoopEntityCatalog();
  const sourceFetcher = opts.sourceFetcher ?? new NoopSourceFetcher();
  const embedder = opts.embedder ?? new NullEmbedder();

  const registry = new CortexRegistry(opts.skillsDir);
  registry.discover();

  const domainConfig = opts.domainConfig ?? noopDomainConfig;
  const webSearch = opts.webSearch ?? new NullWebSearchAdapter();

  // Default strategy list: Strategist first (specialised), Standard last
  // (catch-all). First `canHandle` match wins.
  const strategies: CortexExecutionStrategy[] = opts.strategies ?? [
    new StrategistStrategy(domainConfig),
    new StandardStrategy(
      opts.dataProvider,
      domainConfig,
      webSearch,
      sourceFetcher,
    ),
  ];

  const executor = new CortexExecutor(registry, strategies);

  const findingStoreService = new FindingStoreService(
    findingRepo,
    edgeRepo,
    cycleRepo,
    embedder,
    graphTransactions,
  );
  const kgQueryService = new KgQueryService(
    findingRepo,
    edgeRepo,
    embedder,
    entityCatalog,
  );
  const findingArchiveService = new FindingArchiveService(
    findingRepo,
    entityCatalog,
  );
  const graphService = {
    storeFinding: findingStoreService.storeFinding.bind(findingStoreService),
    onFinding: findingStoreService.onFinding.bind(findingStoreService),
    queryByEntity: kgQueryService.queryByEntity.bind(kgQueryService),
    semanticSearch: kgQueryService.semanticSearch.bind(kgQueryService),
    listFindings: kgQueryService.listFindings.bind(kgQueryService),
    getFindingWithEdges:
      kgQueryService.getFindingWithEdges.bind(kgQueryService),
    getKnowledgeGraph: kgQueryService.getKnowledgeGraph.bind(kgQueryService),
    getGraphStats: kgQueryService.getGraphStats.bind(kgQueryService),
    archiveFinding:
      findingArchiveService.archiveFinding.bind(findingArchiveService),
    expireAndClean:
      findingArchiveService.expireAndClean.bind(findingArchiveService),
  } satisfies ResearchGraphServicePort;

  // Thalamus service collaborators — wired here so the service itself
  // never `new`s concrete dependencies (DIP).
  const planner = new ThalamusPlanner(registry, {
    daemonDags: domainConfig.daemonDags,
    userScopedCortices: domainConfig.userScopedCortices,
    plannerPrompt: domainConfig.plannerPrompt,
    fallbackPlan: domainConfig.fallbackPlan,
    fallbackCortices: domainConfig.fallbackCortices,
  });
  const dagExecutor = new ThalamusDAGExecutor(executor);
  const reflexion = new ThalamusReflexion();
  const stopCriteria = new StopCriteriaEvaluator();
  const cycleLoop = new CycleLoopRunner(
    dagExecutor,
    reflexion,
    planner,
    stopCriteria,
    domainConfig.isVerificationRelevantEntityType,
  );
  const persister = new FindingPersister(graphService);

  const thalamusService = new ThalamusService(
    planner,
    cycleLoop,
    persister,
    cycleRepo,
    graphService,
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
