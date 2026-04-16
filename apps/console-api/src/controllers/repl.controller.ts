// apps/console-api/src/controllers/repl.controller.ts
import type { FastifyRequest } from "fastify";
import type { ReplChatService } from "../services/repl-chat.service";
import { runTurn } from "../repl";
import { asyncHandler } from "../utils/async-handler";

export function replChatController(service: ReplChatService) {
  return asyncHandler<FastifyRequest<{ Body: { input: string } }>>(
    async (req, reply) => {
      const { input } = req.body ?? ({} as { input: string });
      if (!input || typeof input !== "string")
        return reply.code(400).send({ error: "input required" });
      return service.handle(input);
    },
  );
}

export function replTurnController() {
  return asyncHandler<
    FastifyRequest<{ Body: { input: string; sessionId: string } }>
  >(async (req, reply) => {
    const { input, sessionId } =
      req.body ?? ({} as { input: string; sessionId: string });
    if (!input || typeof input !== "string")
      return reply.code(400).send({ error: "input required" });
    return runTurn(
      input,
      { satellites: [], kgNodes: [], kgEdges: [], findings: [] },
      sessionId ?? "anon",
    );
  });
}
