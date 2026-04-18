import type { FastifyRequest } from "fastify";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import type { SimFleetService } from "../services/sim-fleet.service";
import {
  AgentSubjectQuerySchema,
  AuthorLabelsBodySchema,
} from "../schemas/sim.schema";
import {
  toAgentSubjectDto,
  toAuthorLabelsDto,
} from "../transformers/sim-fleet.transformer";
import { parseSafeNumberId } from "./sim-controller.utils";

export function simAgentSubjectController(service: SimFleetService) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const q = parseOrReply(req.params, AgentSubjectQuerySchema, reply);
      if (q === null) return;
      const snap = await service.getAgentSubject({
        kind: q.kind,
        id: parseSafeNumberId(q.id, "id"),
      });
      return toAgentSubjectDto(snap);
    },
  );
}

export function simAuthorLabelsController(service: SimFleetService) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(
    async (req, reply) => {
      const body = parseOrReply(req.body, AuthorLabelsBodySchema, reply);
      if (body === null) return;
      const labels = await service.getAuthorLabels(
        body.agentIds.map((id) => parseSafeNumberId(id, "agentId")),
      );
      return toAuthorLabelsDto(labels);
    },
  );
}
