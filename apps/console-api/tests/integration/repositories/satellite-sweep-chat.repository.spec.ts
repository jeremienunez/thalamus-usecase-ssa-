// @ts-expect-error -- ioredis-mock default export type is looser than ioredis
import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";

import { SatelliteSweepChatRepository } from "../../../src/repositories/satellite-sweep-chat.repository";

let redis: InstanceType<typeof RedisMock> | null = null;

afterEach(async () => {
  await redis?.quit();
  redis = null;
});

describe("SatelliteSweepChatRepository", () => {
  it("enforces the per-minute rate limit", async () => {
    redis = new RedisMock();
    const repo = new SatelliteSweepChatRepository(redis);

    const results: boolean[] = [];
    for (let index = 0; index < 11; index += 1) {
      results.push(await repo.checkRateLimit("user-1"));
    }

    expect(results.slice(0, 10)).toEqual(new Array(10).fill(true));
    expect(results[10]).toBe(false);
  });

  it("trims message history and returns full chat state with findings", async () => {
    redis = new RedisMock();
    const repo = new SatelliteSweepChatRepository(redis);

    for (let index = 0; index < 55; index += 1) {
      await repo.appendMessage("sat-1", "user-1", {
        role: index % 2 === 0 ? "user" : "assistant",
        content: `message-${index}`,
        timestamp: `2026-04-22T00:00:${String(index).padStart(2, "0")}Z`,
      });
    }

    await repo.storeFinding("sat-1", {
      satelliteId: "sat-1",
      category: "conjunction",
      title: "Collision risk",
      summary: "Close approach observed",
      confidence: 0.71,
      evidence: ["tle_history", "screening"],
      calculation: "pc=1.2e-4",
    });
    await repo.storeFinding("sat-1", {
      satelliteId: "sat-1",
      category: "general",
      title: "Battery stress",
      summary: "Depth of discharge trending up",
      confidence: 0.62,
      evidence: ["telemetry"],
    });

    const state = await repo.getState("sat-1", "user-1");

    expect(state.messages).toHaveLength(50);
    expect(state.messages[0]?.content).toBe("message-5");
    expect(state.messages.at(-1)?.content).toBe("message-54");
    expect(state.findings.map((finding) => finding.title)).toEqual([
      "Battery stress",
      "Collision risk",
    ]);
  });
});
