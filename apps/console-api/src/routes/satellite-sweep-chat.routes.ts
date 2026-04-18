import type { FastifyInstance } from "fastify";
import type { SatelliteSweepChatController } from "../controllers/satellite-sweep-chat.controller";
import { authenticate, requireTier } from "../middleware/auth.middleware";

export async function satelliteSweepChatRoutes(
  app: FastifyInstance,
  controller: SatelliteSweepChatController,
): Promise<void> {
  app.addHook("preHandler", authenticate);
  app.addHook("preHandler", requireTier("investment", "franchise"));

  app.post("/:id/sweep-chat", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      body: {
        type: "object",
        properties: { message: { type: "string" } },
        required: ["message"],
      },
    },
    handler: (req, reply) => controller.chatStream(req, reply),
  });

  app.get("/:id/sweep-chat/state", {
    schema: {
      params: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
    },
    handler: (req, reply) => controller.getState(req, reply),
  });
}
