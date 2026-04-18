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

// Types moved to ../types/satellite-sweep-chat.types to satisfy the
// arch-guard (repos cannot import transformers). Re-exported here so
// existing import paths keep working.
export type {
  SweepFindingCategory,
  SweepFinding,
  SweepChatMessage,
  SweepChatState,
} from "../types/satellite-sweep-chat.types";
