import { describe, expect, it, vi } from "vitest";
import { SweepResolutionService } from "../../src/services/sweep-resolution.service";
import type {
  GenericSuggestionRow,
  ResolutionHandler,
  ResolutionHandlerRegistry,
  SweepPromotionAdapter,
} from "../../src/ports";

function makeRow(
  overrides: Partial<GenericSuggestionRow> = {},
): GenericSuggestionRow {
  return {
    id: "sug-1",
    domain: "test",
    createdAt: "2026-04-25T00:00:00.000Z",
    accepted: true,
    reviewedAt: "2026-04-25T00:00:00.000Z",
    reviewerNote: null,
    resolutionStatus: "pending",
    resolvedAt: null,
    resolutionErrors: null,
    simSwarmId: null,
    simDistribution: null,
    domainFields: {},
    resolutionPayload: JSON.stringify({ actions: [{ kind: "touch" }] }),
    ...overrides,
  };
}

function makeHarness(row: GenericSuggestionRow) {
  const handler: ResolutionHandler = {
    kind: "touch",
    handle: vi.fn(async () => ({ ok: true, affectedRows: 1 })),
  };
  const registry: ResolutionHandlerRegistry = {
    get: vi.fn(() => handler),
    list: vi.fn(() => [handler]),
  };
  const promotion: SweepPromotionAdapter = {
    promote: vi.fn(async () => ({ ok: true })),
  };
  const sweepRepo = {
    getGeneric: vi.fn(async () => row),
    updateResolution: vi.fn(async () => undefined),
  };
  const service = new SweepResolutionService({
    registry,
    promotion,
    sweepRepo,
  });
  return { handler, registry, promotion, sweepRepo, service };
}

describe("SweepResolutionService", () => {
  it("returns a stored terminal resolution without dispatching actions again", async () => {
    const { handler, registry, promotion, sweepRepo, service } = makeHarness(
      makeRow({
        resolutionStatus: "success",
        resolvedAt: "2026-04-25T12:00:00.000Z",
        resolutionErrors: JSON.stringify(["promotion warning"]),
      }),
    );

    await expect(service.resolve("sug-1")).resolves.toEqual({
      status: "success",
      resolvedAt: "2026-04-25T12:00:00.000Z",
      affectedRows: 0,
      errors: ["promotion warning"],
    });

    expect(registry.get).not.toHaveBeenCalled();
    expect(handler.handle).not.toHaveBeenCalled();
    expect(promotion.promote).not.toHaveBeenCalled();
    expect(sweepRepo.updateResolution).not.toHaveBeenCalled();
  });

  it("treats failed resolved rows as terminal so retries cannot replay side effects", async () => {
    const { handler, promotion, sweepRepo, service } = makeHarness(
      makeRow({
        resolutionStatus: "failed",
        resolvedAt: "2026-04-25T12:00:00.000Z",
        resolutionErrors: "handler threw after mutation",
      }),
    );

    await expect(service.resolve("sug-1")).resolves.toEqual({
      status: "failed",
      resolvedAt: "2026-04-25T12:00:00.000Z",
      affectedRows: 0,
      errors: ["handler threw after mutation"],
    });

    expect(handler.handle).not.toHaveBeenCalled();
    expect(promotion.promote).not.toHaveBeenCalled();
    expect(sweepRepo.updateResolution).not.toHaveBeenCalled();
  });
});
