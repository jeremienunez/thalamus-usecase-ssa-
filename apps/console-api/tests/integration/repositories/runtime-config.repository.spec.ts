import RedisMock from "ioredis-mock";
import { afterEach, describe, expect, it } from "vitest";

import { RuntimeConfigRepository } from "../../../src/repositories/runtime-config.repository";

let redis: InstanceType<typeof RedisMock> | null = null;

afterEach(async () => {
  await redis?.quit();
  redis = null;
});

describe("RuntimeConfigRepository", () => {
  it("reads empty domains, merges writes, and clears overrides", async () => {
    redis = new RedisMock();
    const repo = new RuntimeConfigRepository(redis);

    expect(await repo.read("thalamus.cortex")).toEqual({});

    await repo.write("thalamus.cortex", {
      mode: "fixtures",
      maxTokens: "4096",
    });
    await repo.write("thalamus.cortex", {
      mode: "cloud",
    });

    expect(await repo.read("thalamus.cortex")).toEqual({
      mode: "cloud",
      maxTokens: "4096",
    });

    await repo.clear("thalamus.cortex");
    expect(await repo.read("thalamus.cortex")).toEqual({});
  });

  it("ignores empty patches", async () => {
    redis = new RedisMock();
    const repo = new RuntimeConfigRepository(redis);

    await repo.write("thalamus.budgets", {});
    expect(await repo.read("thalamus.budgets")).toEqual({});
  });
});
