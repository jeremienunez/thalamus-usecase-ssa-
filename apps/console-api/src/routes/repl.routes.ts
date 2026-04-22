// apps/console-api/src/routes/repl.routes.ts
import type { FastifyInstance } from "fastify";
import { authenticate } from "../middleware/auth.middleware";
import {
  type ReplChatStreamPort,
  type ReplFollowUpRunPort,
  type ReplTurnPort,
  replFollowUpRunStreamController,
  replChatStreamController,
  replTurnController,
} from "../controllers/repl.controller";

export function registerReplRoutes(
  app: FastifyInstance,
  chat: ReplChatStreamPort,
  followUps: ReplFollowUpRunPort,
  turn: ReplTurnPort,
): void {
  app.post<{ Body: { input: string } }>(
    "/api/repl/chat",
    {
      preHandler: authenticate,
      handler: replChatStreamController(chat),
    },
  );
  app.post<{ Body: { input: string; sessionId: string } }>(
    "/api/repl/turn",
    replTurnController(turn),
  );
  app.post<{ Body: unknown }>(
    "/api/repl/followups/run",
    {
      preHandler: authenticate,
      handler: replFollowUpRunStreamController(followUps),
    },
  );
}
