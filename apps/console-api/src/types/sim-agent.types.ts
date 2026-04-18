export interface SimAgentRow {
  id: bigint;
  simRunId: bigint;
  operatorId: bigint | null;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
  createdAt: Date;
}

export interface InsertSimAgentInput {
  simRunId: bigint;
  operatorId: bigint | null;
  agentIndex: number;
  persona: string;
  goals: string[];
  constraints: Record<string, unknown>;
}
