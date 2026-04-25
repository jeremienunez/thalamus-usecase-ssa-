import { beforeEach, describe, expect, it } from "vitest";
import Redis from "ioredis-mock";
import {
  SweepRepository,
  SweepResolutionService,
  type ResolutionHandler,
  type ResolutionHandlerRegistry,
} from "@interview/sweep";
import { fakePort, typedSpy } from "@interview/test-kit";

import {
  SsaPromotionAdapter,
  type SsaSweepAuditPort,
} from "../../../../../src/agent/ssa/sweep/promotion.ssa";

let redis: InstanceType<typeof Redis>;

beforeEach(async () => {
  redis = new Redis();
  await redis.flushall();
});

describe("Strategic Sweep resolution flow", () => {
  it("routes a triggered finding through reviewer accept, mutation, and audit proof", async () => {
    const repo = new SweepRepository({ redis, domain: "ssa" });
    const suggestionId = await repo.insertGeneric({
      domain: "ssa",
      domainFields: {
        operatorCountryId: "42",
        operatorCountryName: "Testland",
        category: "missing_data",
        severity: "warning",
        title: "Strategic Sweep proof",
        description: "A triggered audit finding requests a scalar backfill.",
        suggestedAction: "Backfill mass from reviewed evidence",
        affectedSatellites: 1,
        webEvidence: "fixture://strategic-sweep",
      },
      resolutionPayload: JSON.stringify({
        actions: [
          {
            kind: "update_field",
            field: "mass_kg",
            value: 123,
            satelliteIds: ["9001"],
          },
        ],
      }),
    });
    await expect(
      repo.review(suggestionId, true, "reviewer accepted fixture"),
    ).resolves.toBe(true);

    const handle = typedSpy<ResolutionHandler["handle"]>().mockResolvedValue({
      ok: true,
      affectedRows: 1,
    });
    const handler = fakePort<ResolutionHandler>({
      kind: "update_field",
      handle,
    });
    const registry = fakePort<ResolutionHandlerRegistry>({
      get: (kind) => (kind === "update_field" ? handler : undefined),
      list: () => [handler],
    });
    const insertResolutionAudit = typedSpy<
      SsaSweepAuditPort["insertResolutionAudit"]
    >().mockResolvedValue(undefined);
    const promotion = new SsaPromotionAdapter({
      sweepAuditRepo: fakePort<SsaSweepAuditPort>({
        insertResolutionAudit,
      }),
    });
    const service = new SweepResolutionService({
      registry,
      promotion,
      sweepRepo: repo,
    });

    const result = await service.resolve(suggestionId);

    expect(result).toMatchObject({
      status: "success",
      affectedRows: 1,
    });
    expect(handle).toHaveBeenCalledWith(
      {
        kind: "update_field",
        field: "mass_kg",
        value: 123,
        satelliteIds: ["9001"],
      },
      expect.objectContaining({
        suggestionId,
        reviewer: null,
        reviewerNote: "reviewer accepted fixture",
        domainContext: expect.objectContaining({
          title: "Strategic Sweep proof",
          severity: "warning",
        }),
      }),
    );
    expect(insertResolutionAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        suggestionId,
        operatorCountryId: "42",
        operatorCountryName: "Testland",
        category: "missing_data",
        severity: "warning",
        title: "Strategic Sweep proof",
        accepted: true,
        reviewerNote: "reviewer accepted fixture",
        resolutionStatus: "success",
        resolutionErrors: null,
      }),
    );

    const audited = insertResolutionAudit.mock.calls[0]?.[0];
    expect(audited?.resolutionPayload).toEqual({
      actions: [
        {
          kind: "update_field",
          field: "mass_kg",
          value: 123,
          satelliteIds: ["9001"],
        },
      ],
    });

    const row = await repo.getGeneric(suggestionId);
    expect(row).toMatchObject({
      accepted: true,
      reviewerNote: "reviewer accepted fixture",
      resolutionStatus: "success",
    });

    const feedback = await repo.loadPastFeedback();
    expect(feedback).toEqual([
      expect.objectContaining({
        wasAccepted: true,
        reviewerNote: "reviewer accepted fixture",
        domainFields: expect.objectContaining({
          title: "Strategic Sweep proof",
          severity: "warning",
        }),
      }),
    ]);
  });
});
