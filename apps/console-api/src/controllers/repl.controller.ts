// apps/console-api/src/controllers/repl.controller.ts
import type { FastifyReply, FastifyRequest } from "fastify";
import type { ReplFollowUpPlanItem } from "@interview/shared";
import type { ReplChatService } from "../services/repl-chat.service";
import type { ReplFollowUpService } from "../services/repl-followup.service";
import type { ReplTurnService } from "../services/repl-turn.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  ReplChatBodySchema,
  ReplFollowUpRunBodySchema,
  ReplTurnBodySchema,
} from "../schemas";

export type ReplChatStreamPort = Pick<ReplChatService, "handleStream">;
export type ReplFollowUpRunPort = Pick<ReplFollowUpService, "executeSelected">;
export type ReplTurnPort = Pick<ReplTurnService, "handle">;

export function replChatStreamController(service: ReplChatStreamPort) {
  return async (
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const body = parseOrReply(req.body, ReplChatBodySchema, reply);
    if (body === null) return;
    const userId = req.user ? BigInt(req.user.id) : undefined;

    // Abort the service stream when the client disconnects so cortex/LLM
    // calls stop burning tokens after the browser navigates away.
    const abort = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.on("close", onClose);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const evt of service.handleStream(
        body.input,
        userId,
        abort.signal,
      )) {
        if (abort.signal.aborted) break;
        reply.raw.write(
          `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
        );
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
        );
      }
    } finally {
      reply.raw.off("close", onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  };
}

export function replTurnController(service: ReplTurnPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, ReplTurnBodySchema, reply);
    if (body === null) return;
    return service.handle(body.input, body.sessionId);
  });
}

export function replFollowUpRunStreamController(service: ReplFollowUpRunPort) {
  return async (
    req: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const body = parseOrReply(req.body, ReplFollowUpRunBodySchema, reply);
    if (body === null) return;
    const userId = req.user ? BigInt(req.user.id) : undefined;

    const abort = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.on("close", onClose);

    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const evt of service.executeSelected({
        item: body.item as ReplFollowUpPlanItem,
        query: body.query,
        userId,
        parentCycleId: body.parentCycleId,
        signal: abort.signal,
      })) {
        if (abort.signal.aborted) break;
        reply.raw.write(
          `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
        );
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
        );
      }
    } finally {
      reply.raw.off("close", onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  };
}
