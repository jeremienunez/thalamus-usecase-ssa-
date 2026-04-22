/**
 * RuntimeConfigService — merges Redis overrides with typed defaults and
 * validates write patches against the per-domain schema.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { fakePort } from "@interview/test-kit";
import { RuntimeConfigService } from "../../../src/services/runtime-config.service";
import { ValidationError } from "../../../src/services/runtime-config.service";
import type { RuntimeConfigRepository } from "../../../src/repositories/runtime-config.repository";
import {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
  DEFAULT_THALAMUS_BUDGETS_CONFIG,
  type RuntimeConfigDomain,
} from "@interview/shared/config";
import { registerThalamusConfigDomains } from "@interview/thalamus";
import { registerSweepConfigDomains } from "@interview/sweep";

function makeRepo(): RuntimeConfigRepository {
  const store = new Map<string, Record<string, string>>();
  return fakePort<RuntimeConfigRepository>({
    async read(domain: RuntimeConfigDomain) {
      return store.get(domain) ?? {};
    },
    async write(domain: RuntimeConfigDomain, patch: Record<string, string>) {
      const cur = store.get(domain) ?? {};
      store.set(domain, { ...cur, ...patch });
    },
    async clear(domain: RuntimeConfigDomain) {
      store.delete(domain);
    },
  });
}

describe("RuntimeConfigService", () => {
  let service: RuntimeConfigService;

  beforeEach(() => {
    service = new RuntimeConfigService(makeRepo());
    registerThalamusConfigDomains(service);
    registerSweepConfigDomains(service);
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
    ).rejects.toThrow(/expected finite number/);
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

  it("deep-merges nested json rows without wiping siblings", async () => {
    await service.update("thalamus.budgets", {
      deep: {
        ...DEFAULT_THALAMUS_BUDGETS_CONFIG.deep,
        maxCost: 0.25,
      },
    });

    const cfg = await service.get("thalamus.budgets");
    expect(cfg.deep.maxCost).toBe(0.25);
    expect(cfg.deep.maxIterations).toBe(
      DEFAULT_THALAMUS_BUDGETS_CONFIG.deep.maxIterations,
    );
    expect(cfg.deep.confidenceTarget).toBe(
      DEFAULT_THALAMUS_BUDGETS_CONFIG.deep.confidenceTarget,
    );
    expect(cfg.simple.maxCost).toBe(
      DEFAULT_THALAMUS_BUDGETS_CONFIG.simple.maxCost,
    );
  });

  it("validates merged json candidates before persisting", async () => {
    await expect(
      service.update("thalamus.budgets", {
        deep: {
          ...DEFAULT_THALAMUS_BUDGETS_CONFIG.deep,
          maxCost: 99,
        },
      }),
    ).rejects.toThrow(/max/i);
  });

  it("recursively deep-merges nested json structures", async () => {
    await service.update("thalamus.cortex", {
      overrides: { conjunction_analysis: { costCeilingUsd: 0.5 } },
    });
    await service.update("thalamus.cortex", {
      overrides: { conjunction_analysis: { enabled: true } },
    });

    const cfg = await service.get("thalamus.cortex");
    expect(cfg.overrides.conjunction_analysis?.enabled).toBe(true);
    expect(cfg.overrides.conjunction_analysis?.costCeilingUsd).toBe(0.5);
  });
});
