// apps/console-api/src/routes/repl.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplFollowUpService } from "../services/repl-followup.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import { authenticate } from "../middleware/auth.middleware";
import {
  replFollowUpRunStreamController,
  replChatStreamController,
  replTurnController,
} from "../controllers/repl.controller";

export function registerReplRoutes(
  app: FastifyInstance,
  chat: ReplChatService,
  followUps: ReplFollowUpService,
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
  app.post<{ Body: unknown }>(
    "/api/repl/followups/run",
    {
      preHandler: authenticate,
      handler: replFollowUpRunStreamController(followUps),
    },
  );
}
