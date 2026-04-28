import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@interview/db-schema";
import {
  temporalPatternExample,
  temporalPatternHypothesis,
  temporalPatternReview,
  type NewTemporalPatternReview,
} from "@interview/db-schema";
import type {
  AppliedTemporalPatternReview,
  ApplyTemporalPatternReviewInput,
  TemporalPatternReviewTarget,
} from "../types/temporal.types";

export class TemporalPatternReviewRepository {
  constructor(private readonly db: NodePgDatabase<typeof schema>) {}

  async findReviewTarget(
    patternId: bigint,
  ): Promise<TemporalPatternReviewTarget | null> {
    const [hypothesis] = await this.db
      .select()
      .from(temporalPatternHypothesis)
      .where(eq(temporalPatternHypothesis.id, patternId))
      .limit(1);
    if (!hypothesis) return null;

    const examples = await this.db
      .select({ role: temporalPatternExample.role })
      .from(temporalPatternExample)
      .where(eq(temporalPatternExample.patternId, patternId));

    return {
      hypothesis,
      positiveExampleCount: examples.filter((example) => example.role === "positive")
        .length,
      counterexampleCount: examples.filter(
        (example) => example.role === "counterexample",
      ).length,
    };
  }

  async applyReview(
    input: ApplyTemporalPatternReviewInput,
  ): Promise<AppliedTemporalPatternReview> {
    return this.db.transaction(async (tx) => {
      const reviewRow: NewTemporalPatternReview = {
        patternId: input.patternId,
        reviewerId: input.reviewerId ?? null,
        reviewOutcome: input.reviewOutcome,
        notes: input.notes ?? null,
      };
      const [review] = await tx
        .insert(temporalPatternReview)
        .values(reviewRow)
        .returning();
      if (!review) {
        throw new Error("insert temporal_pattern_review returned no row");
      }

      const [hypothesis] = await tx
        .update(temporalPatternHypothesis)
        .set({
          status: input.status,
          updatedAt: new Date(),
        })
        .where(eq(temporalPatternHypothesis.id, input.patternId))
        .returning();
      if (!hypothesis) {
        throw new Error("update temporal_pattern_hypothesis returned no row");
      }

      return { hypothesis, review };
    });
  }
}
