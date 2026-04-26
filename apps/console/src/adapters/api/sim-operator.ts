import type {
  AskSimReviewQuestionDto,
  FishTimelineDto,
  FishTraceDto,
  OperatorSwarmListDto,
  OperatorSwarmStatusDto,
  SimFishTerminalDto,
  SimReviewEvidenceDto,
  SimReviewScopeDto,
  SimSwarmStatusDto,
  SwarmClustersDto,
} from "@/dto/http";
import type { ApiFetcher } from "./client";

export interface ListOperatorSwarmsQuery {
  status?: SimSwarmStatusDto;
  kind?: string;
  limit?: number;
  cursor?: string;
}

export interface AskSimReviewQuestionRequest {
  scope?: SimReviewScopeDto;
  question: string;
  fishIndex?: number;
  clusterIndex?: number;
  clusterLabel?: string;
}

export interface SimOperatorApiPort {
  listSwarms(query?: ListOperatorSwarmsQuery): Promise<OperatorSwarmListDto>;
  getStatus(swarmId: string): Promise<OperatorSwarmStatusDto>;
  listTerminals(swarmId: string): Promise<SimFishTerminalDto[]>;
  getFishTimeline(swarmId: string, fishIndex: number): Promise<FishTimelineDto>;
  getClusters(swarmId: string): Promise<SwarmClustersDto>;
  getFishTrace(swarmId: string, fishIndex: number): Promise<FishTraceDto>;
  askQuestion(
    swarmId: string,
    body: AskSimReviewQuestionRequest,
  ): Promise<AskSimReviewQuestionDto>;
  listEvidence(swarmId: string): Promise<SimReviewEvidenceDto[]>;
}

export function createSimOperatorApi(f: ApiFetcher): SimOperatorApiPort {
  return {
    listSwarms: (query = {}) =>
      f.getJson(`/api/sim/operator/swarms${toQueryString(query)}`),
    getStatus: (swarmId) =>
      f.getJson(`/api/sim/operator/swarms/${encode(swarmId)}/status`),
    listTerminals: (swarmId) =>
      f.getJson(`/api/sim/swarms/${encode(swarmId)}/terminals`),
    getFishTimeline: (swarmId, fishIndex) =>
      f.getJson(
        `/api/sim/operator/swarms/${encode(swarmId)}/fish/${fishIndex}/timeline`,
      ),
    getClusters: (swarmId) =>
      f.getJson(`/api/sim/operator/swarms/${encode(swarmId)}/clusters`),
    getFishTrace: (swarmId, fishIndex) =>
      f.getJson(
        `/api/sim/operator/swarms/${encode(swarmId)}/fish/${fishIndex}/trace`,
      ),
    askQuestion: (swarmId, body) =>
      f.postJson(`/api/sim/operator/swarms/${encode(swarmId)}/qa`, body),
    listEvidence: (swarmId) =>
      f.getJson(`/api/sim/operator/swarms/${encode(swarmId)}/evidence`),
  };
}

function toQueryString(query: ListOperatorSwarmsQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.kind) params.set("kind", query.kind);
  params.set("limit", String(query.limit ?? 50));
  if (query.cursor) params.set("cursor", query.cursor);
  return `?${params.toString()}`;
}

function encode(value: string): string {
  return encodeURIComponent(value);
}
