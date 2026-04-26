import { describe, expect, it, vi } from "vitest";
import { createSimOperatorApi } from "./sim-operator";

describe("createSimOperatorApi", () => {
  it("lists swarms through the public operator route with stable query defaults", async () => {
    const paths: string[] = [];
    const api = createSimOperatorApi({
      getJson: vi.fn(async (path: string) => {
        paths.push(path);
        return { swarms: [], nextCursor: null };
      }),
      postJson: vi.fn(),
    });

    await api.listSwarms();
    await api.listSwarms({
      status: "running",
      kind: "uc3_conjunction",
      limit: 25,
      cursor: "99",
    });

    expect(paths).toEqual([
      "/api/sim/operator/swarms?limit=50",
      "/api/sim/operator/swarms?status=running&kind=uc3_conjunction&limit=25&cursor=99",
    ]);
  });

  it("reads status, clusters, fish timeline, fish trace, and evidence via HTTP", async () => {
    const paths: string[] = [];
    const api = createSimOperatorApi({
      getJson: vi.fn(async (path: string) => {
        paths.push(path);
        return {};
      }),
      postJson: vi.fn(),
    });

    await api.getStatus("swarm/1");
    await api.listTerminals("swarm/1");
    await api.getClusters("swarm/1");
    await api.getFishTimeline("swarm/1", 7);
    await api.getFishTrace("swarm/1", 7);
    await api.listEvidence("swarm/1");

    expect(paths).toEqual([
      "/api/sim/operator/swarms/swarm%2F1/status",
      "/api/sim/swarms/swarm%2F1/terminals",
      "/api/sim/operator/swarms/swarm%2F1/clusters",
      "/api/sim/operator/swarms/swarm%2F1/fish/7/timeline",
      "/api/sim/operator/swarms/swarm%2F1/fish/7/trace",
      "/api/sim/operator/swarms/swarm%2F1/evidence",
    ]);
  });

  it("posts scoped review questions without inventing a second contract", async () => {
    const postJson = vi.fn(async () => ({
      provider: "fixture",
      evidence: { answer: "cluster converged" },
    }));
    const api = createSimOperatorApi({
      getJson: vi.fn(),
      postJson,
    });

    await api.askQuestion("42", {
      scope: "cluster",
      question: "Why did this cluster converge?",
      clusterLabel: "maneuver",
    });

    expect(postJson).toHaveBeenCalledWith("/api/sim/operator/swarms/42/qa", {
      scope: "cluster",
      question: "Why did this cluster converge?",
      clusterLabel: "maneuver",
    });
  });
});
