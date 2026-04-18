/**
 * SimFleetProvider — kernel ↔ pack contract for the agent's subject snapshot.
 *
 * Sim agents represent a domain actor (SSA: an operator). The pack resolves
 * the subject reference into a typed snapshot the kernel uses for persona
 * composition + author labels (who said what in the observable log).
 *
 * Introduced: Plan 2 Task A.1 (scaffold) / B.1 (impl delegates to
 * SatelliteAuditService + SatelliteRepository — zero new SQL).
 */

export interface AgentSubjectRef {
  /** Domain kind. SSA: "operator". */
  kind: string;
  /** Row id in the domain's primary table. */
  id: number;
}

export interface AgentSubjectSnapshot {
  /** Label rendered to other agents (author of an utterance). */
  displayName: string;
  /** Opaque bag read by SimAgentPersonaComposer — pack-defined. */
  attributes: Record<string, unknown>;
}

export interface SimFleetProvider {
  getAgentSubject(ref: AgentSubjectRef): Promise<AgentSubjectSnapshot>;
  /** Batch lookup for observable log rendering. agentId → displayName. */
  getAuthorLabels(agentIds: number[]): Promise<Map<number, string>>;
}
