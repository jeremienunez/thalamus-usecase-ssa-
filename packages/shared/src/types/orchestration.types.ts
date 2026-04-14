/**
 * Multi-Agent Orchestration — Shared SSE Event Types
 *
 * Used by both server (event emission) and client (event consumption).
 * Additive to existing SSEEvent types — backward compatible.
 */

export type AgentRole = "researcher" | "profiler" | "cartographer" | "analyst";

export type CardCategory = "satellite" | "data" | "map" | "web" | "process";

export interface RouterPlanEventData {
  intent: string;
  missionCount: number;
  agents: AgentRole[];
}

export interface AgentDoneEventData {
  agent: AgentRole;
}

export type SynthesisStartEventData = Record<string, never>;
