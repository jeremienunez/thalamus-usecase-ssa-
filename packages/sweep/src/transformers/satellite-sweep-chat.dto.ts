import { z } from "zod";

export const sweepChatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});

export type SweepChatMessageBody = z.infer<typeof sweepChatMessageSchema>;

export const sweepFindingCategorySchema = z.enum([
  "orbit",
  "advisory",
  "mission",
  "regime",
  "maneuver",
  "conjunction",
  "lifetime",
  "general",
]);

export type SweepFindingCategory = z.infer<typeof sweepFindingCategorySchema>;

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
