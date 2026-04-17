/**
 * Ingestion Service — thin façade over the BullMQ ingestion queue.
 *
 * The worker (in `@interview/sweep`) handles execution; this service
 * exposes the operations the HTTP layer needs: enqueue a job by name,
 * list registered jobs, and report queue health. Owns no business logic
 * of its own — fetchers live in the IngestionRegistry.
 */

import type { BullQueue, IngestionRegistry } from "@interview/sweep";

export class IngestionService {
  constructor(
    private readonly queue: BullQueue,
    private readonly registry: IngestionRegistry,
  ) {}

  /** Enqueue an on-demand run of the named job. Throws if unknown. */
  async enqueue(jobName: string): Promise<{ jobId: string }> {
    if (!this.registry.has(jobName)) {
      throw new Error(
        `Unknown ingestion job "${jobName}". Known: ${this.registry.names().join(", ")}`,
      );
    }
    const job = await this.queue.add(jobName, {});
    return { jobId: String(job.id) };
  }

  listJobs(): string[] {
    return this.registry.names();
  }
}
