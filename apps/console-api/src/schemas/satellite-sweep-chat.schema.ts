import { z } from "zod";

export const sweepChatMessageSchema = z.object({
  message: z.string().min(1).max(2000),
});

// Keep chat shapes in the local types module so repositories and services can
// share them without depending on HTTP-facing schemas.
export type {
  SweepFinding,
  SweepChatMessage,
  SweepChatState,
} from "../types/satellite-sweep-chat.types";
