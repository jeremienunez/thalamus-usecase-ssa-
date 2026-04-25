import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import type {
  AskSimReviewQuestionDto,
  FishTraceDto,
  SwarmClustersDto,
} from "@interview/shared/dto";

import type { SimOperatorPort } from "../../../src/controllers/sim-operator.controller";
import { registerSimOperatorRoutes } from "../../../src/routes/sim-operator.routes";

function makeTrace(): FishTraceDto {
  return {
    swarmId: "1",
    simRunId: "10",
    fishIndex: 0,
    kind: "uc3_conjunction",
    status: "done",
    seedApplied: { target: 7 },
    perturbation: { kind: "noop" },
    config: {
      turnsPerDay: 4,
      maxTurns: 8,
      llmMode: "fixtures",
      seed: 42,
      nanoModel: "stub",
    },
    agents: [],
    turns: [
      {
        id: "1000",
        turnIndex: 1,
        actorKind: "agent",
        agentId: "100",
        agentIndex: 0,
        action: { kind: "maneuver" },
        rationale: "risk is high",
        observableSummary: "Fish chose maneuver",
        llmCostUsd: 0.01,
        createdAt: "2026-04-25T10:00:30.000Z",
      },
    ],
    totalLlmCostUsd: 0.01,
    startedAt: "2026-04-25T10:00:00.000Z",
    completedAt: "2026-04-25T10:01:00.000Z",
    exportedAt: "2026-04-25T10:02:00.000Z",
  };
}

function makeApp() {
  const app = Fastify();
  const clustersResponse: SwarmClustersDto = {
    swarmId: "1",
    source: "aggregate",
    clusters: [{ label: "maneuver" }],
    summary: { quorumMet: true },
  };
  const qaResponse: AskSimReviewQuestionDto = {
    provider: "fixture",
    evidence: {
      id: "500",
      swarmId: "1",
      simRunId: null,
      scope: "swarm",
      question: "What happened?",
      answer: "The swarm converged.",
      evidenceRefs: [{ kind: "sim_swarm", id: "1" }],
      traceExcerpt: {},
      createdBy: "1",
      createdAt: "2026-04-25T10:02:00.000Z",
    },
  };
  const operator: SimOperatorPort = {
    listSwarms: vi.fn(async () => ({ swarms: [], nextCursor: null })),
    getStatus: vi.fn(async () => ({
      swarmId: "1",
      kind: "uc3_conjunction",
      status: "done",
      size: 1,
      done: 1,
      failed: 0,
      timeout: 0,
      running: 0,
      pending: 0,
      reportFindingId: null,
      suggestionId: null,
      aggregateKeys: ["aggregate"],
    })),
    streamSwarmEvents: vi.fn(),
    getFishTimeline: vi.fn(async () => makeTrace()),
    getClusters: vi.fn(async () => clustersResponse),
    getFishTrace: vi.fn(async () => makeTrace()),
    askQuestion: vi.fn(async () => qaResponse),
    listEvidence: vi.fn(async () => []),
  };
  registerSimOperatorRoutes(app, { operator });
  return { app, operator };
}

describe("registerSimOperatorRoutes", () => {
  it("serves the operator status, clusters, and Q&A endpoints", async () => {
    const { app, operator } = makeApp();

    const status = await app.inject({
      method: "GET",
      url: "/api/sim/operator/swarms/1/status",
    });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({
      swarmId: "1",
      aggregateKeys: ["aggregate"],
    });

    const clusters = await app.inject({
      method: "GET",
      url: "/api/sim/operator/swarms/1/clusters",
    });
    expect(clusters.statusCode).toBe(200);
    expect(clusters.json()).toMatchObject({
      source: "aggregate",
      clusters: [{ label: "maneuver" }],
    });

    const qa = await app.inject({
      method: "POST",
      url: "/api/sim/operator/swarms/1/qa",
      payload: { question: "What happened?" },
    });
    expect(qa.statusCode).toBe(200);
    expect(qa.json()).toMatchObject({
      provider: "fixture",
      evidence: { answer: "The swarm converged." },
    });
    expect(operator.askQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        swarmId: 1n,
        scope: "swarm",
        question: "What happened?",
      }),
    );

    await app.close();
  });

  it("exports per-fish traces as NDJSON", async () => {
    const { app } = makeApp();

    const res = await app.inject({
      method: "GET",
      url: "/api/sim/operator/swarms/1/fish/0/trace?format=ndjson",
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/x-ndjson");
    expect(res.body.trim().split("\n").map((line) => JSON.parse(line))).toEqual([
      expect.objectContaining({ kind: "trace", simRunId: "10" }),
      expect.objectContaining({ kind: "turn", id: "1000" }),
    ]);
    await app.close();
  });
});
