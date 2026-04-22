import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_SIM_KERNEL_SHARED_SECRET,
  readServerEnv,
} from "../../../src/server";

describe("readServerEnv", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses the default sim kernel secret without mutating process.env", () => {
    vi.stubEnv("SIM_KERNEL_SHARED_SECRET", undefined);

    const env = readServerEnv();

    expect(env.simKernelSharedSecret).toBe(DEFAULT_SIM_KERNEL_SHARED_SECRET);
    expect(process.env.SIM_KERNEL_SHARED_SECRET).toBeUndefined();
  });

  it("preserves an explicit sim kernel secret", () => {
    vi.stubEnv("SIM_KERNEL_SHARED_SECRET", "top-secret");

    const env = readServerEnv();

    expect(env.simKernelSharedSecret).toBe("top-secret");
  });
});
