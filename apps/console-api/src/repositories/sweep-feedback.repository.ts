// apps/console-api/src/repositories/sweep-feedback.repository.ts
import type Redis from "ioredis";
import type { SweepFeedbackEntry } from "../types/sweep.types";

export type { SweepFeedbackEntry } from "../types/sweep.types";

export class SweepFeedbackRepository {
  constructor(private readonly redis: Redis) {}

  async push(entry: SweepFeedbackEntry): Promise<void> {
    await this.redis.lpush("sweep:feedback", JSON.stringify(entry));
    await this.redis.ltrim("sweep:feedback", 0, 199);
  }
}
