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

// Keep chat shapes in the local types module so repositories and services can
// share them without depending on HTTP-facing schemas.
export type {
  SweepFindingCategory,
  SweepFinding,
  SweepChatMessage,
  SweepChatState,
} from "../types/satellite-sweep-chat.types";
