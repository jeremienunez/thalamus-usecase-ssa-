import { describe, expect, it, vi } from "vitest";
import { closeOwnedRedis } from "../src/boot";

describe("closeOwnedRedis", () => {
  it("logs redis shutdown failures instead of swallowing them silently", async () => {
    const closeError = new Error("redis close failed");
    const redis = {
      quit: vi.fn().mockRejectedValue(closeError),
    };
    const logger = {
      warn: vi.fn(),
    };

    await closeOwnedRedis(redis, logger);

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: closeError },
      "cli shutdown: failed to close redis",
    );
  });
});
