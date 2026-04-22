import type { AuthorLabelsDto, SimSubjectDto } from "@interview/shared/dto/sim-subject.dto";
import type { SimAgentSubjectSnapshot } from "../services/sim-fleet.service";

export function toSimSubjectDto(
  snap: SimAgentSubjectSnapshot,
): SimSubjectDto {
  return { displayName: snap.displayName, attributes: snap.attributes };
}

export function toAuthorLabelsDto(
  labels: Record<string, string>,
): AuthorLabelsDto {
  return { labels };
}
