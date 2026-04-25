import type { ReplFollowUpPlanItem } from "@interview/shared";
import { ResearchCycleTrigger } from "@interview/shared";
import type { EdgeRow } from "../../../types/finding.types";

export type SsaReplFollowUpKind =
  | "deep_research_30d"
  | "sim_pc_verification"
  | "sim_telemetry_verification"
  | "sweep_targeted_audit";

export type FollowUpVerification = {
  needsVerification: boolean;
  reasonCodes: string[];
  confidence: number;
  targetHints?: Array<{
    entityType: string | null;
    entityId: bigint | string | null;
    sourceCortex: string | null;
    sourceTitle: string | null;
    confidence: number | null;
  }>;
};

export type FollowUpFindingRow = {
  id: bigint | string;
  title?: string;
  summary?: string;
  cortex?: string;
  findingType?: string;
  urgency?: string;
  confidence?: number | null;
};

export type FollowUpPlan = {
  autoLaunched: ReplFollowUpPlanItem[];
  proposed: ReplFollowUpPlanItem[];
  dropped: ReplFollowUpPlanItem[];
};

export type FollowUpCandidate = {
  followupId: string;
  kind: SsaReplFollowUpKind;
  title: string;
  rationale: string;
  reasonCodes: string[];
  target?: ReplFollowUpPlanItem["target"];
  score: number;
  gateScore: number;
  costClass: "low" | "medium";
  autoEligible: boolean;
};

export type ChildCycleResult = {
  id: bigint | string;
};

export type FollowUpEdgeRow = EdgeRow;

export interface SsaReplFollowUpDeps {
  thalamusService: {
    runCycle(args: {
      query: string;
      userId?: bigint;
      triggerType: ResearchCycleTrigger;
      triggerSource: string;
      signal?: AbortSignal;
    }): Promise<ChildCycleResult>;
  };
  findingRepo: {
    findByCycleId(id: bigint | string): Promise<FollowUpFindingRow[]>;
    findById?(id: bigint): Promise<{
      id: bigint | string;
      title: string;
      summary: string;
      cortex: string;
      confidence: number;
    } | null>;
  };
  edgeRepo: {
    findByFindingIds(ids: bigint[]): Promise<FollowUpEdgeRow[]>;
  };
  sim?: {
    preflight?: {
      canStartTelemetry(target: { satelliteId: number }): Promise<boolean>;
      canStartPc(target: { conjunctionId: number }): Promise<boolean>;
    };
    launcher: {
      startTelemetry(opts: {
        satelliteId: number;
        fishCount?: number;
      }): Promise<{ swarmId: number; fishCount: number }>;
      startPc(opts: {
        conjunctionId: number;
        fishCount?: number;
      }): Promise<{ swarmId: number; fishCount: number; conjunctionId: number }>;
    };
    swarm: {
      findById(
        swarmId: bigint,
      ): Promise<{
        status: "pending" | "running" | "done" | "failed";
        outcomeReportFindingId: bigint | null;
        suggestionId: bigint | null;
      } | null>;
      countFishByStatus(swarmId: bigint): Promise<{
        done: number;
        failed: number;
        timeout: number;
        running: number;
        pending: number;
        paused: number;
      }>;
    };
  };
  sweep?: {
    nanoSweepService: {
      sweep(
        limit?: number,
        mode?: string,
        target?: {
          entityType?: string;
          entityIds?: string[];
          columnHints?: string[];
          reasonCodes?: string[];
          parentCycleId?: string;
        },
      ): Promise<{ suggestionsStored: number; wallTimeMs: number }>;
    };
  };
}
