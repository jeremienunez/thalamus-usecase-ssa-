import type { FastifyInstance } from "fastify";
import {
  type WhyControllerPort,
  whyController,
} from "../controllers/why.controller";

export function registerWhyRoutes(
  app: FastifyInstance,
  service: WhyControllerPort,
): void {
  app.get("/api/why/:findingId", whyController(service));
}
