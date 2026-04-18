import type {
  SimSubjectProvider,
  SimSubjectSnapshot,
} from "../ports/subject.port";
import { SimHttpClient } from "./client";

interface SubjectDto {
  displayName: string;
  attributes: Record<string, unknown>;
}

interface AuthorLabelsDto {
  labels: Record<string, string>;
}

export class SimSubjectHttpAdapter implements SimSubjectProvider {
  constructor(private readonly http: SimHttpClient) {}

  getSubject(ref: { kind: string; id: number }): Promise<SimSubjectSnapshot> {
    return this.http.get<SubjectDto>(`/api/sim/subjects/${ref.kind}/${ref.id}`);
  }

  async getAuthorLabels(agentIds: number[]): Promise<Map<number, string>> {
    if (agentIds.length === 0) {
      return new Map();
    }
    const dto = await this.http.post<AuthorLabelsDto>("/api/sim/subjects/author-labels", {
      agentIds: agentIds.map(String),
    });
    return new Map(
      Object.entries(dto.labels).map(([id, label]) => [Number(id), label]),
    );
  }
}
