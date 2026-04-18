/**
 * SimSubjectProvider — kernel ↔ pack contract for the agent's domain subject.
 */

export interface SimSubjectRef {
  kind: string;
  id: number;
}

export interface SimSubjectSnapshot {
  displayName: string;
  attributes: Record<string, unknown>;
}

export interface SimSubjectProvider {
  getSubject(ref: SimSubjectRef): Promise<SimSubjectSnapshot>;
  getAuthorLabels(agentIds: number[]): Promise<Map<number, string>>;
}
