import type {
  SimSubjectProvider,
  SimSubjectSnapshot,
} from "../ports/subject.port";
import type {
  AuthorLabelsDto,
  SimSubjectDto,
} from "@interview/shared/dto/sim-subject.dto";
import { SimHttpClient } from "./client";

export class SimSubjectHttpAdapter implements SimSubjectProvider {
  constructor(private readonly http: SimHttpClient) {}

  getSubject(ref: { kind: string; id: number }): Promise<SimSubjectSnapshot> {
    return this.http.get<SimSubjectDto>(`/api/sim/subjects/${ref.kind}/${ref.id}`);
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
