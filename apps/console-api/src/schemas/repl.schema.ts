import { z } from "zod";

export const ReplChatBodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
});
export type ReplChatBody = z.infer<typeof ReplChatBodySchema>;

export const ReplTurnBodySchema = z.object({
  input: z.string().trim().min(1).max(4000),
  sessionId: z.string().min(1).max(128).default("anon"),
});
export type ReplTurnBody = z.infer<typeof ReplTurnBodySchema>;
