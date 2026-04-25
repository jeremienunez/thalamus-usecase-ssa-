import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  DEFAULT_THALAMUS_REFLEXION_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import {
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import { fakePort, typedSpy } from "@interview/test-kit";

import type { CortexExecutor } from "../src/cortices/executor";
import type { CortexFinding, CortexOutput } from "../src/cortices/types";
import type { EmbedderPort } from "../src/ports/embedder.port";
import type { EntityCatalogPort } from "../src/ports/entity-catalog.port";
import {
  setBudgetsConfigProvider,
  setCortexConfigProvider,
  setPlannerConfigProvider,
  setReflexionConfigProvider,
} from "../src/config/runtime-config";
import { CycleLoopRunner } from "../src/services/cycle-loop.service";
import { FindingPersister } from "../src/services/finding-persister.service";
import {
  type CyclesGraphPort,
  type EdgesGraphPort,
  type FindingsGraphPort,
  ResearchGraphService,
} from "../src/services/research-graph.service";
import { StopCriteriaEvaluator } from "../src/services/stop-criteria.service";
import { ThalamusDAGExecutor } from "../src/services/thalamus-executor.service";
import {
  type CyclesPort,
  ThalamusService,
} from "../src/services/thalamus.service";
import type {
  DAGPlan,
  ThalamusPlanner,
} from "../src/services/thalamus-planner.service";
import type {
  ReflexionResult,
  ThalamusReflexion,
} from "../src/services/thalamus-reflexion.service";
import type {
  NewResearchCycle,
  NewResearchFinding,
  ResearchCycle,
  ResearchEdge,
  ResearchFinding,
} from "../src/types/research.types";

const STARTED_AT = new Date("2026-04-25T10:00:00.000Z");

function makeStrategicPlan(): DAGPlan {
  return {
    intent: "strategic labelled thalamus graph write",
    complexity: "simple",
    nodes: [
      {
        cortex: "strategic_probe",
        params: { fixture: "graph-write" },
        dependsOn: [],
      },
    ],
  };
}

function makeCortexFinding(): CortexFinding {
  return {
    title: "Strategic graph write proof",
    summary: "A mocked cortex finding should be persisted with an entity edge.",
    findingType: ResearchFindingType.Insight,
    urgency: ResearchUrgency.Medium,
    evidence: [{ source: "fixture://strategic-thalamus", data: { ok: true }, weight: 1 }],
    confidence: 0.91,
    impactScore: 4,
    sourceCortex: "strategic_probe",
    edges: [
      {
        entityType: "satellite",
        entityId: 4242,
        relation: ResearchRelation.About,
        context: { labelled: true },
      },
    ],
  };
}

function makeStoredFinding(data: NewResearchFinding): ResearchFinding {
  return {
    id: 9001n,
    researchCycleId: data.researchCycleId,
    cortex: data.cortex,
    findingType: data.findingType,
    status: data.status ?? ResearchStatus.Active,
    urgency: data.urgency ?? null,
    title: data.title,
    summary: data.summary,
    evidence: data.evidence ?? [],
    reasoning: data.reasoning ?? null,
    confidence: data.confidence,
    impactScore: data.impactScore ?? null,
    extensions: data.extensions ?? null,
    reflexionNotes: data.reflexionNotes ?? null,
    iteration: data.iteration ?? 0,
    dedupHash: data.dedupHash ?? null,
    embedding: data.embedding ?? null,
    expiresAt: data.expiresAt ?? null,
    createdAt: STARTED_AT,
    updatedAt: STARTED_AT,
  };
}

function createCycleRepo(): {
  repo: CyclesPort;
  create: ReturnType<typeof typedSpy<CyclesPort["create"]>>;
  updateStatus: ReturnType<typeof typedSpy<CyclesPort["updateStatus"]>>;
} {
  let cycle: ResearchCycle | null = null;
  const create = typedSpy<CyclesPort["create"]>();
  const findById = typedSpy<CyclesPort["findById"]>();
  const updateStatus = typedSpy<CyclesPort["updateStatus"]>();

  create.mockImplementation(async (data: NewResearchCycle) => {
    cycle = {
      id: 501n,
      triggerType: data.triggerType,
      triggerSource: data.triggerSource ?? null,
      userId: data.userId ?? null,
      dagPlan: data.dagPlan ?? null,
      corticesUsed: data.corticesUsed ?? null,
      status: data.status,
      findingsCount: data.findingsCount ?? 0,
      totalCost: data.totalCost ?? null,
      error: data.error ?? null,
      startedAt: data.startedAt ?? STARTED_AT,
      completedAt: data.completedAt ?? null,
    };
    return cycle;
  });

  updateStatus.mockImplementation(async (id, status, opts) => {
    if (!cycle || cycle.id !== id) return;
    cycle = {
      ...cycle,
      status,
      totalCost: opts?.totalCost ?? cycle.totalCost,
      error: opts?.error ?? cycle.error,
      completedAt: opts?.completedAt ?? cycle.completedAt,
    };
  });

  findById.mockImplementation(async (id) => {
    if (!cycle || cycle.id !== id) return null;
    return cycle;
  });

  return {
    repo: fakePort<CyclesPort>({ create, findById, updateStatus }),
    create,
    updateStatus,
  };
}

function createGraphHarness() {
  const storedFindings: ResearchFinding[] = [];
  const storedEdges: ResearchEdge[] = [];
  const cycleLinks: Array<{
    cycleId: bigint;
    findingId: bigint;
    iteration: number;
    isDedupHit: boolean;
  }> = [];
  const cycleCounts = new Map<bigint, number>();

  const upsertByDedupHash = typedSpy<FindingsGraphPort["upsertByDedupHash"]>();
  const findSimilar = typedSpy<FindingsGraphPort["findSimilar"]>();
  const linkToCycle = typedSpy<FindingsGraphPort["linkToCycle"]>();
  const createMany = typedSpy<EdgesGraphPort["createMany"]>();
  const incrementFindings = typedSpy<CyclesGraphPort["incrementFindings"]>();
  const embedQuery = typedSpy<EmbedderPort["embedQuery"]>();

  embedQuery.mockResolvedValue(null);
  findSimilar.mockResolvedValue([]);
  upsertByDedupHash.mockImplementation(async (data) => {
    const finding = makeStoredFinding(data);
    storedFindings.push(finding);
    return { finding, inserted: true };
  });
  createMany.mockImplementation(async (edges) => {
    const created = edges.map((edge, index) => ({
      id: BigInt(index + 1),
      findingId: edge.findingId,
      entityType: edge.entityType,
      entityId: edge.entityId,
      relation: edge.relation,
      weight: edge.weight ?? null,
      context: edge.context ?? null,
      createdAt: edge.createdAt ?? STARTED_AT,
    }));
    storedEdges.push(...created);
    return created;
  });
  linkToCycle.mockImplementation(async (link) => {
    cycleLinks.push(link);
    return true;
  });
  incrementFindings.mockImplementation(async (cycleId) => {
    cycleCounts.set(cycleId, (cycleCounts.get(cycleId) ?? 0) + 1);
  });

  const findingRepo = fakePort<FindingsGraphPort>({
    upsertByDedupHash,
    findSimilar,
    linkToCycle,
  });
  const edgeRepo = fakePort<EdgesGraphPort>({ createMany });
  const cycleRepo = fakePort<CyclesGraphPort>({ incrementFindings });
  const embedder = fakePort<EmbedderPort>({
    isAvailable: () => true,
    embedQuery,
    embedDocuments: async (texts) => texts.map(() => null),
  });
  const entityCatalog = fakePort<EntityCatalogPort>({
    resolveNames: async () => new Map(),
    cleanOrphans: async () => 0,
  });

  return {
    service: new ResearchGraphService(
      findingRepo,
      edgeRepo,
      cycleRepo,
      embedder,
      entityCatalog,
    ),
    storedFindings,
    storedEdges,
    cycleLinks,
    cycleCounts,
    upsertByDedupHash,
    createMany,
    linkToCycle,
    incrementFindings,
  };
}

afterEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG),
  );
  setReflexionConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_REFLEXION_CONFIG),
  );
  setBudgetsConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_BUDGETS_CONFIG),
  );
  vi.restoreAllMocks();
});

describe("Strategic Thalamus flow", () => {
  it("routes a labelled query through planner, executor, and graph write", async () => {
    setReflexionConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_REFLEXION_CONFIG,
        maxIterations: 1,
      }),
    );

    const plan = makeStrategicPlan();
    const plannerPlan = typedSpy<ThalamusPlanner["plan"]>();
    const cortexExecute = typedSpy<CortexExecutor["execute"]>();
    const reflexionEvaluate = typedSpy<ThalamusReflexion["evaluate"]>();
    const graph = createGraphHarness();
    const cycleRepo = createCycleRepo();

    plannerPlan.mockResolvedValue(plan);
    reflexionEvaluate.mockResolvedValue({
      replan: false,
      notes: "not used when maxIterations is one",
      gaps: [],
      overallConfidence: 0.9,
    } satisfies ReflexionResult);
    cortexExecute.mockResolvedValue({
      findings: [makeCortexFinding()],
      metadata: {
        tokensUsed: 42,
        duration: 12,
        model: "fixture-cortex",
      },
    } satisfies CortexOutput);

    const dagExecutor = new ThalamusDAGExecutor(
      fakePort<CortexExecutor>({
        execute: cortexExecute,
        knownCortices: () => ["strategic_probe"],
      }),
    );
    const loop = new CycleLoopRunner(
      dagExecutor,
      fakePort<ThalamusReflexion>({ evaluate: reflexionEvaluate }),
      fakePort<ThalamusPlanner>({ plan: plannerPlan }),
      new StopCriteriaEvaluator(),
    );
    const service = new ThalamusService(
      fakePort<ThalamusPlanner>({
        plan: plannerPlan,
        finalizePlan: async (dag) => dag,
        buildManualDag: (query, cortices) => ({
          intent: query,
          complexity: "simple",
          nodes: cortices.map((cortex) => ({
            cortex,
            params: {},
            dependsOn: [],
          })),
        }),
        getDaemonDag: async () => null,
      }),
      loop,
      new FindingPersister(graph.service),
      cycleRepo.repo,
      graph.service,
    );

    const result = await service.runCycle({
      query: "strategic labelled thalamus graph write",
      triggerType: ResearchCycleTrigger.User,
      lang: "en",
      mode: "audit",
    });

    expect(plannerPlan).toHaveBeenCalledWith(
      "strategic labelled thalamus graph write",
      { hasUser: false },
    );
    expect(cortexExecute).toHaveBeenCalledWith(
      "strategic_probe",
      expect.objectContaining({
        query: "strategic labelled thalamus graph write",
        cycleId: 501n,
        lang: "en",
        mode: "audit",
        params: { fixture: "graph-write" },
      }),
    );
    expect(reflexionEvaluate).not.toHaveBeenCalled();

    expect(graph.upsertByDedupHash).toHaveBeenCalledWith(
      expect.objectContaining({
        researchCycleId: 501n,
        cortex: "strategic_probe",
        findingType: ResearchFindingType.Insight,
        title: "Strategic graph write proof",
        status: ResearchStatus.Active,
        confidence: 0.91,
      }),
    );
    expect(graph.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        findingId: 9001n,
        entityType: "satellite",
        entityId: 4242n,
        relation: ResearchRelation.About,
      }),
    ]);
    expect(graph.linkToCycle).toHaveBeenCalledWith({
      cycleId: 501n,
      findingId: 9001n,
      iteration: 1,
      isDedupHit: false,
    });
    expect(graph.incrementFindings).toHaveBeenCalledWith(501n);
    expect(cycleRepo.updateStatus).toHaveBeenCalledWith(
      501n,
      ResearchCycleStatus.Completed,
      expect.objectContaining({
        completedAt: expect.any(Date),
      }),
    );

    expect(graph.storedFindings).toHaveLength(1);
    expect(graph.storedEdges).toHaveLength(1);
    expect(graph.cycleLinks).toHaveLength(1);
    expect(graph.cycleCounts.get(501n)).toBe(1);
    expect(result).toMatchObject({
      id: 501n,
      status: ResearchCycleStatus.Completed,
      persistence: {
        storedCount: 1,
        failedCount: 0,
        failures: [],
      },
      verification: {
        needsVerification: true,
        confidence: 0.91,
      },
    });
    expect(result.verification.targetHints).toEqual([
      expect.objectContaining({
        entityType: "satellite",
        entityId: 4242n,
        sourceCortex: "strategic_probe",
        sourceTitle: "Strategic graph write proof",
        confidence: 0.91,
      }),
    ]);
  });
});
