// apps/console-api/src/controllers/repl.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { ReplChatBodySchema, ReplTurnBodySchema } from "../schemas";

export function replChatController(service: ReplChatService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReplChatBodySchema, reply);
    if (body === null) return;
    return service.handle(body.input);
  });
}

export function replTurnController(service: ReplTurnService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReplTurnBodySchema, reply);
    if (body === null) return;
    return service.handle(body.input, body.sessionId);
  });
}
