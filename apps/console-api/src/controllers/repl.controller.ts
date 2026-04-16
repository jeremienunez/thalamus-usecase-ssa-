// apps/console-api/src/controllers/repl.controller.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { ReplChatBodySchema, ReplTurnBodySchema } from "../schemas";

export function replChatStreamController(service: ReplChatService) {
  return async (
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const body = parseOrReply(req.body, ReplChatBodySchema, reply);
    if (body === null) return;

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const evt of service.handleStream(body.input)) {
        reply.raw.write(
          `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      reply.raw.write(
        `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
      );
    } finally {
      reply.raw.end();
    }
  };
}

export function replTurnController(service: ReplTurnService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReplTurnBodySchema, reply);
    if (body === null) return;
    return service.handle(body.input, body.sessionId);
  });
}
