// apps/console-api/src/routes/repl.routes.ts
import type { FastifyInstance } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import {
  replChatController,
  replTurnController,
} from "../controllers/repl.controller";

export function registerReplRoutes(
  app: FastifyInstance,
  service: ReplChatService,
): void {
  app.post<{ Body: { input: string } }>(
    "/api/repl/chat",
    replChatController(service),
  );
  app.post<{ Body: { input: string; sessionId: string } }>(
    "/api/repl/turn",
    replTurnController(),
  );
}
