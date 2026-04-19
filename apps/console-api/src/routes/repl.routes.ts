// apps/console-api/src/routes/repl.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import { authenticate } from "../middleware/auth.middleware";
import {
  replChatStreamController,
  replTurnController,
} from "../controllers/repl.controller";

export function registerReplRoutes(
  app: FastifyInstance,
  chat: ReplChatService,
  turn: ReplTurnService,
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
}
