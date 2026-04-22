import type { FastifyRequest } from "fastify";
import type { ConjunctionViewService } from "../services/conjunction-view.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  ConjunctionsQuerySchema,
  ScreenQuerySchema,
  KnnCandidatesQuerySchema,
} from "../schemas";

export type ConjunctionsControllerPort = Pick<
  ConjunctionViewService,
  "list" | "screen" | "knnCandidates"
>;

export function conjunctionsController(service: ConjunctionsControllerPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ConjunctionsQuerySchema, reply);
      if (q === null) return;
      return service.list({ minPc: q.minPc ?? 0 });
    },
  );
}

export function screenController(service: ConjunctionsControllerPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, ScreenQuerySchema, reply);
      if (q === null) return;
      return service.screen(q);
    },
  );
}

export function knnCandidatesController(service: ConjunctionsControllerPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.query, KnnCandidatesQuerySchema, reply);
      if (q === null) return;
      if (typeof q.targetNoradId !== "number") {
        return reply.code(400).send({ error: "targetNoradId is required" });
      }
      return service.knnCandidates({ ...q, targetNoradId: q.targetNoradId });
    },
  );
}
