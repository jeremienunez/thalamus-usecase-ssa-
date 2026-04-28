import { typedSpy } from "@interview/test-kit";
import { describe, expect, it } from "vitest";
import {
  TemporalPatternReviewService,
  type TemporalPatternReviewServiceDeps,
} from "../../../src/services/temporal-pattern-review.service";
import type {
  AppliedTemporalPatternReview,
  TemporalPatternHypothesisRow,
  TemporalPatternReviewTarget,
} from "../../../src/types/temporal.types";

describe("TemporalPatternReviewService", () => {
  it("accepts a temporal pattern only after examples and negative evidence exist", async () => {
    const { service, applyReview } = buildService({
      target: reviewTarget({
        positiveExampleCount: 2,
        counterexampleCount: 0,
        hypothesis: hypothesis({ negativeSupportCount: 1 }),
      }),
    });

    const result = await service.reviewPattern({
      patternId: 123n,
      status: "accepted",
      reviewerId: 42n,
      notes: "evidence checked",
    });

    expect(applyReview).toHaveBeenCalledWith({
      patternId: 123n,
      status: "accepted",
      reviewerId: 42n,
      reviewOutcome: "accepted",
      notes: "evidence checked",
    });
    expect(result).toEqual({
      patternId: "123",
      status: "accepted",
      reviewId: "900",
      reviewOutcome: "accepted",
      hypothesis: true,
      decisionAuthority: false,
    });
  });

  it("keeps needs-more-evidence reviews in reviewable status", async () => {
    const { service, applyReview } = buildService();

    await service.reviewPattern({
      patternId: 123n,
      status: "reviewable",
      notes: "counterexamples missing",
    });

    expect(applyReview).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "reviewable",
        reviewOutcome: "needs_more_evidence",
      }),
    );
  });

  it("rejects acceptance without negative evidence or counterexamples", async () => {
    const { service, applyReview } = buildService({
      target: reviewTarget({
        positiveExampleCount: 1,
        counterexampleCount: 0,
        hypothesis: hypothesis({ negativeSupportCount: 0 }),
      }),
    });

    await expect(
      service.reviewPattern({ patternId: 123n, status: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "accepting temporal pattern requires negative evidence or counterexamples",
    });
    expect(applyReview).not.toHaveBeenCalled();
  });

  it("rejects mixed-domain acceptance until domain breakdown exists", async () => {
    const { service, applyReview } = buildService({
      target: reviewTarget({
        positiveExampleCount: 1,
        counterexampleCount: 1,
        hypothesis: hypothesis({ sourceDomain: "mixed", negativeSupportCount: 1 }),
      }),
    });

    await expect(
      service.reviewPattern({ patternId: 123n, status: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "accepting mixed-domain temporal pattern requires source-domain breakdown",
    });
    expect(applyReview).not.toHaveBeenCalled();
  });

  it("rejects acceptance for singletons and non-incremental sequences", async () => {
    const singleton = buildService({
      target: reviewTarget({
        hypothesis: hypothesis({
          containsSingletonOnly: true,
          sequenceLiftOverBestComponent: 0.4,
        }),
      }),
    });

    await expect(
      singleton.service.reviewPattern({ patternId: 123n, status: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "accepting temporal pattern requires a sequence length greater than one",
    });

    const noLift = buildService({
      target: reviewTarget({
        hypothesis: hypothesis({ sequenceLiftOverBestComponent: 0 }),
      }),
    });

    await expect(
      noLift.service.reviewPattern({ patternId: 123n, status: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message:
        "accepting temporal pattern requires lift over its strongest component",
    });
  });

  it("rejects acceptance for target proxies and synthetic order", async () => {
    const targetProxy = buildService({
      target: reviewTarget({
        hypothesis: hypothesis({ containsTargetProxy: true }),
      }),
    });

    await expect(
      targetProxy.service.reviewPattern({ patternId: 123n, status: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "accepting temporal pattern requires target-proxy-free evidence",
    });

    const synthetic = buildService({
      target: reviewTarget({
        hypothesis: hypothesis({ temporalOrderQuality: "synthetic_ordered" }),
      }),
    });

    await expect(
      synthetic.service.reviewPattern({ patternId: 123n, status: "accepted" }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: "accepting temporal pattern requires non-synthetic temporal order",
    });
  });

  it("returns 404 when the pattern is unknown", async () => {
    const { service, applyReview } = buildService({ target: null });

    await expect(
      service.reviewPattern({ patternId: 404n, status: "rejected" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "temporal pattern 404 not found",
    });
    expect(applyReview).not.toHaveBeenCalled();
  });
});

function buildService(input: {
  target?: TemporalPatternReviewTarget | null;
} = {}): {
  service: TemporalPatternReviewService;
  applyReview: ReturnType<
    typeof typedSpy<TemporalPatternReviewServiceDeps["reviewRepo"]["applyReview"]>
  >;
} {
  const applyReview =
    typedSpy<TemporalPatternReviewServiceDeps["reviewRepo"]["applyReview"]>();
  applyReview.mockImplementation(async (reviewInput) =>
    appliedReview(reviewInput.status, reviewInput.reviewOutcome),
  );
  const findReviewTarget =
    typedSpy<TemporalPatternReviewServiceDeps["reviewRepo"]["findReviewTarget"]>();
  findReviewTarget.mockResolvedValue(
    "target" in input ? input.target ?? null : reviewTarget(),
  );
  return {
    service: new TemporalPatternReviewService({
      reviewRepo: {
        findReviewTarget,
        applyReview,
      },
    }),
    applyReview,
  };
}

function reviewTarget(
  overrides: Partial<TemporalPatternReviewTarget> = {},
): TemporalPatternReviewTarget {
  return {
    hypothesis: hypothesis(),
    positiveExampleCount: 1,
    counterexampleCount: 1,
    ...overrides,
  };
}

function appliedReview(
  status: AppliedTemporalPatternReview["hypothesis"]["status"],
  reviewOutcome: string,
): AppliedTemporalPatternReview {
  return {
    hypothesis: hypothesis({ status }),
    review: {
      id: 900n,
      patternId: 123n,
      reviewerId: 42n,
      reviewOutcome,
      notes: "evidence checked",
      createdAt: new Date("2026-04-28T10:00:00.000Z"),
    },
  };
}

function hypothesis(
  overrides: Partial<TemporalPatternHypothesisRow> = {},
): TemporalPatternHypothesisRow {
  return {
    id: 123n,
    patternHash: "pattern-hash-123",
    patternVersion: "temporal-v0.2.0",
    status: "reviewable",
    sourceDomain: "production",
    terminalStatus: "timeout",
    patternWindowMs: 900_000,
    patternScore: 0.9,
    supportCount: 8,
    negativeSupportCount: 1,
    baselineRate: 0.2,
    patternRate: 0.89,
    lift: 2.1,
    bestComponentSignature: "review.missing_relative_velocity|review|none|none",
    bestComponentRate: 0.4,
    sequenceLiftOverBestComponent: 0.49,
    leadTimeMsAvg: 300_000,
    leadTimeMsP50: 240_000,
    leadTimeMsP95: 600_000,
    temporalOrderQuality: "real_time_ordered",
    containsTargetProxy: false,
    containsSingletonOnly: false,
    scoreComponentsJson: {
      temporal_weight: 0.9,
      support_factor: 1,
      lift_factor: 0.8,
      negative_penalty: 0.9,
      stability_factor: 1,
    },
    createdFromLearningRunId: 77n,
    createdAt: new Date("2026-04-28T09:00:00.000Z"),
    updatedAt: new Date("2026-04-28T09:00:00.000Z"),
    ...overrides,
  };
}
