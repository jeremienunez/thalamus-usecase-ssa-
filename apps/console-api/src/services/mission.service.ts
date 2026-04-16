// apps/console-api/src/services/mission.service.ts
import type { FastifyBaseLogger } from "fastify";
import type { MissionState, MissionTask } from "../types";
import type { SatelliteRepository } from "../repositories/satellite.repository";
import type { SweepAuditRepository } from "../repositories/sweep-audit.repository";
import type { NanoResearchService } from "./nano-research.service";
import type { EnrichmentFindingService } from "./enrichment-finding.service";
import { MISSION_WRITABLE_COLUMNS, inRange } from "../utils/field-constraints";

const MAX_SATS_PER_SUGGESTION = 5;
const TICK_INTERVAL_MS = 1500;

type SweepListRow = {
  id: string;
  operatorCountryName: string | null;
  resolutionPayload: string | null;
};

export interface SweepListProvider {
  list(opts: {
    reviewed: boolean;
    limit: number;
  }): Promise<{ rows: SweepListRow[] }>;
}

export class MissionService {
  private state: MissionState = {
    running: false,
    startedAt: null,
    tasks: [],
    completedCount: 0,
    filledCount: 0,
    unobtainableCount: 0,
    errorCount: 0,
    cursor: 0,
    timer: null,
    busy: false,
  };

  constructor(
    private readonly satellites: SatelliteRepository,
    private readonly audit: SweepAuditRepository,
    private readonly nano: NanoResearchService,
    private readonly enrichment: EnrichmentFindingService,
    private readonly sweepRepo: SweepListProvider,
    private readonly logger: FastifyBaseLogger,
  ) {}

  publicState() {
    return {
      running: this.state.running,
      startedAt: this.state.startedAt,
      total: this.state.tasks.length,
      completed: this.state.completedCount,
      filled: this.state.filledCount,
      unobtainable: this.state.unobtainableCount,
      errors: this.state.errorCount,
      cursor: this.state.cursor,
      currentTask:
        this.state.running && this.state.cursor > 0
          ? this.state.tasks[this.state.cursor - 1]
          : null,
      recent: this.state.tasks
        .filter((t) => t.status !== "pending")
        .slice(-20)
        .reverse(),
    };
  }

  async start(opts: {
    maxSatsPerSuggestion?: number;
  }): Promise<{
    ok: true;
    alreadyRunning?: boolean;
    state: ReturnType<MissionService["publicState"]>;
  }> {
    if (this.state.running)
      return { ok: true, alreadyRunning: true, state: this.publicState() };
    // Controller-side MissionStartBodySchema already clamps to [1, 20]. We
    // still allow `undefined` for programmatic callers without a schema.
    const cap = opts.maxSatsPerSuggestion ?? MAX_SATS_PER_SUGGESTION;
    const listing = await this.sweepRepo.list({ reviewed: false, limit: 300 });
    const tasks: MissionTask[] = [];

    for (const r of listing.rows) {
      if (!r.resolutionPayload) continue;
      if (
        !r.operatorCountryName ||
        r.operatorCountryName.toLowerCase().includes("unknown")
      )
        continue;
      try {
        const p = JSON.parse(r.resolutionPayload) as {
          actions?: Array<{
            kind?: string;
            field?: string;
            value?: unknown;
            satelliteIds?: string[];
          }>;
        };
        const action = p.actions?.[0];
        if (!action || action.kind !== "update_field" || !action.field)
          continue;
        if (!MISSION_WRITABLE_COLUMNS[action.field]) continue;
        if (action.value !== null && action.value !== undefined) continue;
        const satIds = (action.satelliteIds ?? []).slice(0, cap);
        if (satIds.length === 0) continue;
        const satRows = await this.satellites.findPayloadNamesByIds(
          satIds.map((i) => BigInt(i)),
        );
        for (const s of satRows) {
          tasks.push({
            suggestionId: r.id,
            satelliteId: s.id,
            satelliteName: s.name,
            noradId: s.norad_id ? Number(s.norad_id) : null,
            field: action.field,
            operatorCountry: r.operatorCountryName,
            status: "pending",
            value: null,
            confidence: 0,
            source: null,
          });
        }
      } catch {
        // skip malformed payload
      }
    }

    this.state = {
      running: true,
      startedAt: new Date().toISOString(),
      tasks,
      completedCount: 0,
      filledCount: 0,
      unobtainableCount: 0,
      errorCount: 0,
      cursor: 0,
      busy: false,
      timer: setInterval(() => {
        void this.tick();
      }, TICK_INTERVAL_MS),
    };
    void this.tick();
    return { ok: true, state: this.publicState() };
  }

  stop(): { ok: true; state: ReturnType<MissionService["publicState"]> } {
    if (this.state.timer) clearInterval(this.state.timer);
    this.state.timer = null;
    this.state.running = false;
    return { ok: true, state: this.publicState() };
  }

  private async tick(): Promise<void> {
    if (this.state.busy || !this.state.running) return;
    if (this.state.cursor >= this.state.tasks.length) {
      this.state.running = false;
      if (this.state.timer) clearInterval(this.state.timer);
      this.state.timer = null;
      return;
    }
    this.state.busy = true;
    const task = this.state.tasks[this.state.cursor]!;
    this.state.cursor++;
    try {
      await this.runTask(task);
      this.state.completedCount++;
      if (task.status === "filled") this.state.filledCount++;
      else if (task.status === "unobtainable") this.state.unobtainableCount++;
      else if (task.status === "error") this.state.errorCount++;
    } finally {
      this.state.busy = false;
    }
  }

  private async runTask(task: MissionTask): Promise<void> {
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
      task.status = "filled";
      task.value = v1;
      task.confidence = Math.min(
        0.95,
        (vote1.confidence + vote2.confidence) / 2 + 0.15,
      );
      task.source = vote1.source;
      await this.applyFill(task.satelliteId, task.field, v1, task.source);
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

  private async applyFill(
    satelliteId: string,
    field: string,
    value: string | number,
    source: string,
  ): Promise<void> {
    const kind = MISSION_WRITABLE_COLUMNS[field];
    if (!kind) return;
    const coerced =
      kind === "numeric"
        ? typeof value === "number"
          ? value
          : Number.parseFloat(String(value).replace(/[^\d.+-]/g, ""))
        : String(value);
    if (kind === "numeric" && !Number.isFinite(coerced as number)) return;
    if (kind === "numeric" && !inRange(field, coerced as number)) return;

    await this.satellites.updateField(BigInt(satelliteId), field, coerced);
    await this.audit.insertEnrichmentSuccess({
      suggestionId: `mission:${satelliteId}:${field}`,
      operatorCountryName: "mission-fill",
      title: `Fill ${field}=${coerced} on satellite ${satelliteId}`,
      description: "",
      suggestedAction: `UPDATE satellite SET ${field}=${coerced}`,
      affectedSatellites: 1,
      webEvidence: source,
      resolutionPayload: { field, value: coerced, source },
    });
    await this.enrichment.emit({
      kind: "mission",
      satelliteId,
      field,
      value: coerced,
      confidence: 0.9,
      source,
    });
  }
}
