/**
 * Satellite sweep chat types — kept separate from the DTO/transformer
 * so the repository layer can consume them without importing a
 * transformer (the arch-guard forbids repos → transformers).
 */

export type SweepFindingCategory =
  | "orbit"
  | "advisory"
  | "mission"
  | "regime"
  | "maneuver"
  | "conjunction"
  | "lifetime"
  | "general";

export interface SweepFinding {
  id: string;
  satelliteId: string;
  category: SweepFindingCategory;
  title: string;
  summary: string;
  confidence: number;
  evidence: string[];
  calculation?: string;
  createdAt: string;
}

export interface SweepChatMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

export interface SweepChatState {
  messages: SweepChatMessage[];
  findings: SweepFinding[];
}
