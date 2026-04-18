import type { FastifyRequest } from "fastify";
import type { SimRunService } from "../services/sim-run.service";
import type { SimAgentService } from "../services/sim-agent.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  CreateAgentBodySchema,
  SimRunIdParamsSchema,
} from "../schemas/sim.schema";
import { normalizePgError, notFound, parseBigIntId } from "./sim-controller.utils";
import {
  toCreateAgentDto,
  toSimAgentDto,
} from "../transformers/sim-http.transformer";

type SimRunLookupPort = Pick<SimRunService, "findById">;
type SimAgentRoutePort = Pick<SimAgentService, "create" | "listByRun">;

export function simCreateAgentController(
  runRepo: SimRunLookupPort,
  agentService: SimAgentRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, CreateAgentBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      try {
        const agentId = await agentService.create({
          simRunId,
          operatorId:
            body.subjectId === null ? null : parseBigIntId(body.subjectId, "subjectId"),
          agentIndex: body.agentIndex,
          persona: body.persona,
          goals: body.goals,
          constraints: body.constraints,
        });
        reply.code(201);
        return toCreateAgentDto(agentId);
      } catch (err) {
        normalizePgError(err);
      }
    },
  );
}

export function simListAgentsController(
  runRepo: SimRunLookupPort,
  agentService: SimAgentRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
    if (params === null) return;
    const simRunId = parseBigIntId(params.id, "simRunId");
    const run = await runRepo.findById(simRunId);
    if (!run) throw notFound("sim_run", simRunId);
    const rows = await agentService.listByRun(simRunId);
    return rows.map(toSimAgentDto);
  });
}
