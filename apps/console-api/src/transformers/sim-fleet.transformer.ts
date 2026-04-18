import type { SimAgentSubjectSnapshot } from "../services/sim-fleet.service";

export interface AgentSubjectDto {
  displayName: string;
  attributes: Record<string, unknown>;
}

export function toAgentSubjectDto(
  snap: SimAgentSubjectSnapshot,
): AgentSubjectDto {
  return { displayName: snap.displayName, attributes: snap.attributes };
}

export interface AuthorLabelsDto {
  labels: Record<string, string>;
}

export function toAuthorLabelsDto(
  labels: Record<string, string>,
): AuthorLabelsDto {
  return { labels };
}
