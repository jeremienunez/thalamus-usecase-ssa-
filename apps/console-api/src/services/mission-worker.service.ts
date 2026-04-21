// apps/console-api/src/services/mission-worker.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { MissionTask } from "../types";
import type { NanoResearchService } from "./nano-research.service";
import type { MissionFillWriter } from "./mission-fill-writer.service";

/**
 * Executes a single mission task: runs the 2-vote nano orchestration,
 * stamps the task with the outcome, and — on agreement — delegates to
 * the fill writer. No timer, no cursor, no batch awareness.
 *
 * Task object is mutated in place so the caller's state view stays live.
 */
export class MissionTaskWorker {
  constructor(
    private readonly nano: NanoResearchService,
    private readonly filler: MissionFillWriter,
    private readonly logger: FastifyBaseLogger,
  ) {}

  async runTask(task: MissionTask): Promise<void> {
    task.status = "researching";
    task.startedAt = new Date().toISOString();
    try {
      const vote1 = await this.nano.singleVote(
        task,
        "Check the operator's official documentation first.",
      );
      const vote2 = await this.nano.singleVote(
        task,
        "Check Wikipedia / eoPortal / Gunter's Space Page first.",
      );
      if (!vote1.ok || !vote2.ok) {
        task.status = "unobtainable";
        task.value = null;
        task.confidence = 0;
        task.source = vote1.ok ? vote1.source : vote2.ok ? vote2.source : null;
        task.error = `vote1=${this.nano.summary(vote1)}; vote2=${this.nano.summary(vote2)}`;
        task.completedAt = new Date().toISOString();
        return;
      }
      const v1 = vote1.value as string | number;
      const v2 = vote2.value as string | number;
      if (!this.nano.votesAgree(v1, v2)) {
        task.status = "unobtainable";
        task.value = null;
        task.confidence = 0;
        task.source = vote1.source;
        task.error = `votes disagree: ${v1} vs ${v2}`;
        task.completedAt = new Date().toISOString();
        return;
      }
      task.source = vote1.source;
      const fill = await this.filler.applyFill(
        task.satelliteId,
        task.field,
        v1,
        task.source,
      );
      if (fill.applied === false) {
        task.status = "unobtainable";
        task.value = null;
        task.confidence = 0;
        task.error = fill.reason;
        task.completedAt = new Date().toISOString();
        return;
      }
      task.status = "filled";
      task.value = fill.value;
      task.confidence = Math.min(
        0.95,
        (vote1.confidence + vote2.confidence) / 2 + 0.15,
      );
    } catch (err) {
      task.status = "error";
      task.error = err instanceof Error ? err.message : String(err);
      this.logger.error(
        { err: task.error, taskId: task.suggestionId },
        "mission task failed",
      );
    }
    task.completedAt = new Date().toISOString();
  }
}
