/**
 * RuntimeConfigService — merges Redis overrides with typed defaults and
 * validates write patches against the per-domain schema.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";
import { RuntimeConfigService } from "../../../src/services/runtime-config.service";
import { ValidationError } from "../../../src/services/runtime-config.service";
import type { RuntimeConfigRepository } from "../../../src/repositories/runtime-config.repository";
import {
  DEFAULT_NANO_CONFIG,
  DEFAULT_NANO_SWARM_CONFIG,
  DEFAULT_NANO_SWEEP_CONFIG,
  type RuntimeConfigDomain,
} from "@interview/shared/config";
import { registerThalamusConfigDomains } from "@interview/thalamus";
import { registerSweepConfigDomains } from "@interview/sweep";

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
    service.registerDomain("thalamus.budgets" as never, {
      defaults: {
        simple: {
          maxIterations: 2,
          maxCost: 0.03,
          confidenceTarget: 0.7,
          coverageTarget: 0.5,
          minFindingsToStop: 2,
        },
        moderate: {
          maxIterations: 4,
          maxCost: 0.06,
          confidenceTarget: 0.75,
          coverageTarget: 0.6,
          minFindingsToStop: 3,
        },
        deep: {
          maxIterations: 8,
          maxCost: 0.1,
          confidenceTarget: 0.8,
          coverageTarget: 0.7,
          minFindingsToStop: 5,
        },
      } as never,
      schema: { simple: "json", moderate: "json", deep: "json" } as never,
    });

    await service.update("thalamus.budgets" as never, {
      deep: { maxCost: 0.25 },
    } as never);

    const cfg = (await service.get("thalamus.budgets" as never)) as {
      deep: Record<string, number>;
      simple: Record<string, number>;
    };
    expect(cfg.deep.maxCost).toBe(0.25);
    expect(cfg.deep.maxIterations).toBe(8);
    expect(cfg.deep.confidenceTarget).toBe(0.8);
    expect(cfg.simple.maxCost).toBe(0.03);
  });

  it("validates merged json candidates before persisting", async () => {
    const rowSchema = z.object({
      maxIterations: z.number().int().min(1).max(20),
      maxCost: z.number().min(0).max(10),
      confidenceTarget: z.number().min(0).max(1),
      coverageTarget: z.number().min(0).max(1),
      minFindingsToStop: z.number().int().min(0).max(50),
    });

    service.registerDomain("thalamus.budgets" as never, {
      defaults: {
        simple: {
          maxIterations: 2,
          maxCost: 0.03,
          confidenceTarget: 0.7,
          coverageTarget: 0.5,
          minFindingsToStop: 2,
        },
        moderate: {
          maxIterations: 4,
          maxCost: 0.06,
          confidenceTarget: 0.75,
          coverageTarget: 0.6,
          minFindingsToStop: 3,
        },
        deep: {
          maxIterations: 8,
          maxCost: 0.1,
          confidenceTarget: 0.8,
          coverageTarget: 0.7,
          minFindingsToStop: 5,
        },
      } as never,
      schema: { simple: "json", moderate: "json", deep: "json" } as never,
      validate: (merged) => {
        for (const key of ["simple", "moderate", "deep"] as const) {
          const row = merged[key as keyof typeof merged];
          if (row !== undefined) rowSchema.parse(row);
        }
      },
    });

    await expect(
      service.update("thalamus.budgets" as never, {
        deep: { maxCost: 99 },
      } as never),
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
