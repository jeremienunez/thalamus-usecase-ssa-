/**
 * RuntimeConfigService — merges Redis overrides with typed defaults and
 * validates write patches against the per-domain schema.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { RuntimeConfigService } from "../../../src/services/runtime-config.service";
import { ValidationError } from "../../../src/services/runtime-config.service";
import type { RuntimeConfigRepository } from "../../../src/repositories/runtime-config.repository";
import {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
  type RuntimeConfigDomain,
} from "@interview/shared/config";

function makeRepo(): RuntimeConfigRepository {
  const store = new Map<string, Record<string, string>>();
  return {
    async read(domain: RuntimeConfigDomain) {
      return store.get(domain) ?? {};
    },
    async write(domain: RuntimeConfigDomain, patch) {
      const cur = store.get(domain) ?? {};
      store.set(domain, { ...cur, ...patch });
    },
    async clear(domain: RuntimeConfigDomain) {
      store.delete(domain);
    },
  } as unknown as RuntimeConfigRepository;
}

describe("RuntimeConfigService", () => {
  let service: RuntimeConfigService;

  beforeEach(() => {
    service = new RuntimeConfigService(makeRepo());
  });

  it("returns defaults when no override is persisted", async () => {
    expect(await service.get("thalamus.nano")).toEqual(DEFAULT_NANO_CONFIG);
    expect(await service.get("thalamus.nanoSwarm")).toEqual(
      DEFAULT_NANO_SWARM_CONFIG,
    );
    expect(await service.get("sweep.nanoSweep")).toEqual(
      DEFAULT_NANO_SWEEP_CONFIG,
    );
  });

  it("merges partial overrides with defaults", async () => {
    await service.update("thalamus.nano", { model: "gpt-5.5-nano" });
    const cfg = await service.get("thalamus.nano");
    expect(cfg.model).toBe("gpt-5.5-nano");
    expect(cfg.callTimeoutMs).toBe(DEFAULT_NANO_CONFIG.callTimeoutMs);
  });

  it("rejects unknown fields", async () => {
    await expect(
      service.update("thalamus.nano", {
        // @ts-expect-error — deliberately wrong key
        bogusField: "x",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("rejects wrong-type values", async () => {
    await expect(
      service.update("thalamus.nano", {
        // @ts-expect-error — callTimeoutMs is number
        callTimeoutMs: "not-a-number",
      }),
    ).rejects.toThrow(/must be a number/);
  });

  it("reset restores defaults", async () => {
    await service.update("thalamus.nanoSwarm", { waveSize: 12 });
    expect((await service.get("thalamus.nanoSwarm")).waveSize).toBe(12);
    await service.reset("thalamus.nanoSwarm");
    expect(await service.get("thalamus.nanoSwarm")).toEqual(
      DEFAULT_NANO_SWARM_CONFIG,
    );
  });

  it("provider(domain).get() reads fresh on every call", async () => {
    const provider = service.provider("thalamus.nano");
    expect((await provider.get()).model).toBe(DEFAULT_NANO_CONFIG.model);
    await service.update("thalamus.nano", { model: "claude-sonnet-4-6" });
    expect((await provider.get()).model).toBe("claude-sonnet-4-6");
  });
});
