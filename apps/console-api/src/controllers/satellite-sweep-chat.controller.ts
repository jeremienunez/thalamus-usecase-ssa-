import type { FastifyRequest, FastifyReply } from "fastify";
import { createLogger } from "@interview/shared/observability";
import type { SatelliteSweepChatService } from "../services/satellite-sweep-chat.service";
import { sweepChatMessageSchema } from "../schemas/satellite-sweep-chat.schema";

const logger = createLogger("satellite-sweep-chat-controller");

export class SatelliteSweepChatController {
  constructor(private service: SatelliteSweepChatService) {}

  async chatStream(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const userId = String(request.user!.id);
    const { id } = request.params as { id: string };
    const parsed = sweepChatMessageSchema.safeParse(request.body);

    if (!parsed.success) {
      reply
        .code(400)
        .send({ error: "Invalid message", details: parsed.error.flatten() });
      return;
    }

    // Stop burning nano tokens if the browser navigates away mid-stream.
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
      const stream = this.service.chat(id, userId, parsed.data.message, abort.signal);
      for await (const event of stream) {
        if (abort.signal.aborted) break;
        reply.raw.write(
          `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
        );
      }
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        logger.error({ err: error }, "SSE stream error");
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ error: "An unexpected error occurred" })}\n\n`,
        );
      }
    } finally {
      reply.raw.off("close", onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  }

  async getState(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const userId = String(request.user!.id);
    const { id } = request.params as { id: string };
    const state = await this.service.getState(id, userId);
    reply.send(state);
  }
}
