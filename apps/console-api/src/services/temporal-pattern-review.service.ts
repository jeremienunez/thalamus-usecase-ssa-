import type {
  AppliedTemporalPatternReview,
  ApplyTemporalPatternReviewInput,
  TemporalPatternReviewOutcome,
  TemporalPatternReviewStatus,
  TemporalPatternReviewTarget,
} from "../types/temporal.types";
import { HttpError } from "../utils/http-error";

export interface ReviewTemporalPatternInput {
  patternId: bigint;
  status: TemporalPatternReviewStatus;
  reviewerId?: bigint | null;
  reviewOutcome?: TemporalPatternReviewOutcome;
  notes?: string | null;
}

export interface TemporalPatternReviewResult {
  patternId: string;
  status: TemporalPatternReviewStatus;
  reviewId: string;
  reviewOutcome: TemporalPatternReviewOutcome;
  hypothesis: true;
  decisionAuthority: false;
}

export interface TemporalPatternReviewServiceDeps {
  reviewRepo: {
    findReviewTarget(patternId: bigint): Promise<TemporalPatternReviewTarget | null>;
    applyReview(
      input: ApplyTemporalPatternReviewInput,
    ): Promise<AppliedTemporalPatternReview>;
  };
}

export class TemporalPatternReviewService {
  constructor(private readonly deps: TemporalPatternReviewServiceDeps) {}

  async reviewPattern(
    input: ReviewTemporalPatternInput,
  ): Promise<TemporalPatternReviewResult> {
    const target = await this.deps.reviewRepo.findReviewTarget(input.patternId);
    if (!target) {
      throw HttpError.notFound(`temporal pattern ${input.patternId} not found`);
    }

    if (input.status === "accepted") {
      assertAcceptable(target);
    }

    const result = await this.deps.reviewRepo.applyReview({
      patternId: input.patternId,
      status: input.status,
      reviewerId: input.reviewerId ?? null,
      reviewOutcome: input.reviewOutcome ?? defaultReviewOutcome(input.status),
      notes: input.notes ?? null,
    });

    return {
      patternId: result.hypothesis.id.toString(),
      status: result.hypothesis.status as TemporalPatternReviewStatus,
      reviewId: result.review.id.toString(),
      reviewOutcome: result.review.reviewOutcome as TemporalPatternReviewOutcome,
      hypothesis: true,
      decisionAuthority: false,
    };
  }
}

function assertAcceptable(target: TemporalPatternReviewTarget): void {
  if (target.positiveExampleCount <= 0) {
    throw HttpError.conflict(
      "accepting temporal pattern requires at least one positive example",
    );
  }
  if (
    target.hypothesis.negativeSupportCount <= 0 &&
    target.counterexampleCount <= 0
  ) {
    throw HttpError.conflict(
      "accepting temporal pattern requires negative evidence or counterexamples",
    );
  }
  if (target.hypothesis.sourceDomain === "mixed") {
    throw HttpError.conflict(
      "accepting mixed-domain temporal pattern requires source-domain breakdown",
    );
  }
  if (target.hypothesis.containsSingletonOnly) {
    throw HttpError.conflict(
      "accepting temporal pattern requires a sequence length greater than one",
    );
  }
  if (target.hypothesis.containsTargetProxy) {
    throw HttpError.conflict(
      "accepting temporal pattern requires target-proxy-free evidence",
    );
  }
  if (
    target.hypothesis.sequenceLiftOverBestComponent == null ||
    target.hypothesis.sequenceLiftOverBestComponent <= 0
  ) {
    throw HttpError.conflict(
      "accepting temporal pattern requires lift over its strongest component",
    );
  }
  if (target.hypothesis.temporalOrderQuality === "synthetic_ordered") {
    throw HttpError.conflict(
      "accepting temporal pattern requires non-synthetic temporal order",
    );
  }
}

function defaultReviewOutcome(
  status: TemporalPatternReviewStatus,
): TemporalPatternReviewOutcome {
  if (status === "reviewable") return "needs_more_evidence";
  return status;
}
