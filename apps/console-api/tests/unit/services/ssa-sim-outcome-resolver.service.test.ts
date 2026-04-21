import { describe, expect, it, vi } from "vitest";
import { SsaSimOutcomeResolverService } from "../../../src/services/ssa-sim-outcome-resolver.service";

describe("SsaSimOutcomeResolverService", () => {
  it("resolves a modal narrative swarm and triggers promotion", async () => {
    const emitSuggestionFromModal = vi.fn(async () => 123);
    const emitTelemetrySuggestions = vi.fn(async (): Promise<number[]> => []);
    const service = new SsaSimOutcomeResolverService({
      aggregator: {
        aggregate: vi.fn(async () => ({
          swarmId: 42,
          totalFish: 3,
          quorumMet: true,
          succeededFish: 3,
          failedFish: 0,
          clusters: [] as unknown[],
          modal: {
            actionKind: "accept",
            fraction: 0.67,
            exemplarSimRunId: 77,
            exemplarAction: { kind: "accept", reason: "ok" },
          },
          divergenceScore: 0.33,
        })),
      } as never,
      telemetryAggregator: {
        aggregate: vi.fn(),
      },
      pcAggregator: {
        aggregate: vi.fn(),
      },
      promotionService: {
        emitSuggestionFromModal,
        emitTelemetrySuggestions,
      },
    });

    const result = await service.resolve({
      swarmId: 42,
      terminals: [],
      swarm: {
        id: 42,
        kind: "uc3_conjunction",
        size: 3,
        config: {},
        baseSeed: {},
      },
    });

    expect(result.status).toBe("done");
    expect(result.snapshotKey).toBe("aggregate");
    expect(emitSuggestionFromModal).toHaveBeenCalledWith(
      42,
      expect.objectContaining({
        quorumMet: true,
      }),
    );
    expect(emitTelemetrySuggestions).not.toHaveBeenCalled();
  });

  it("resolves a telemetry swarm and emits scalar promotions", async () => {
    const emitTelemetrySuggestions = vi.fn(
      async (): Promise<number[]> => [11, 12],
    );
    const service = new SsaSimOutcomeResolverService({
      aggregator: {
        aggregate: vi.fn(),
      } as never,
      telemetryAggregator: {
        aggregate: vi.fn(async () => ({
          swarmId: 7,
          satelliteId: 9,
          totalFish: 5,
          succeededFish: 5,
          failedFish: 0,
          quorumMet: true,
          scalars: {
            powerDraw: {
              median: 1,
              sigma: 0.1,
              min: 0.9,
              max: 1.1,
              mean: 1,
              n: 5,
              values: [1],
              unit: "W",
              avgFishConfidence: 0.4,
            },
          },
          simConfidence: 0.25,
        })),
      },
      pcAggregator: {
        aggregate: vi.fn(),
      },
      promotionService: {
        emitSuggestionFromModal: vi.fn(async (): Promise<null> => null),
        emitTelemetrySuggestions,
      },
    });

    const result = await service.resolve({
      swarmId: 7,
      terminals: [],
      swarm: {
        id: 7,
        kind: "uc_telemetry_inference",
        size: 5,
        config: {},
        baseSeed: {},
      },
    });

    expect(result).toMatchObject({
      status: "done",
      snapshotKey: "telemetryAggregate",
    });
    expect(emitTelemetrySuggestions).toHaveBeenCalledOnce();
  });

  it("marks a narrative swarm failed when quorum is not met", async () => {
    const emitSuggestionFromModal = vi.fn(async () => 123);
    const service = new SsaSimOutcomeResolverService({
      aggregator: {
        aggregate: vi.fn(async () => ({
          swarmId: 99,
          totalFish: 4,
          quorumMet: false,
          succeededFish: 1,
          failedFish: 3,
          clusters: [] as unknown[],
          modal: null as null,
          divergenceScore: 1,
        })),
      } as never,
      telemetryAggregator: {
        aggregate: vi.fn(),
      },
      pcAggregator: {
        aggregate: vi.fn(),
      },
      promotionService: {
        emitSuggestionFromModal,
        emitTelemetrySuggestions: vi.fn(async (): Promise<number[]> => []),
      },
    });

    const result = await service.resolve({
      swarmId: 99,
      terminals: [],
      swarm: {
        id: 99,
        kind: "uc3_conjunction",
        size: 4,
        config: {},
        baseSeed: {},
      },
    });

    expect(result.status).toBe("failed");
    expect(emitSuggestionFromModal).not.toHaveBeenCalled();
  });
});
