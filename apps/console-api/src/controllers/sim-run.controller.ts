import type { FastifyRequest } from "fastify";
import type { SimRunService } from "../services/sim-run.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  CreateRunBodySchema,
  SimRunIdParamsSchema,
  UpdateRunStatusBodySchema,
} from "../schemas/sim.schema";
import {
  conflict,
  normalizePgError,
  notFound,
  parseBigIntId,
  toPerturbationSpec,
  toSeedRefs,
  toSimConfig,
} from "./sim-controller.utils";
import {
  toCountDto,
  toCreateRunDto,
  toEmptyDto,
  toSeedRefsDto,
  toSimRunDto,
} from "../transformers/sim-http.transformer";

type SimRunRoutePort = Pick<
  SimRunService,
  | "create"
  | "findById"
  | "updateStatus"
  | "getSeedApplied"
  | "countAgentsForRun"
  | "countAgentTurnsForRun"
>;

function isLegalRunTransition(current: string, next: string): boolean {
  if (current === next) return true;
  switch (current) {
    case "pending":
      return next === "running" || next === "failed";
    case "running":
      return next === "paused" || next === "done" || next === "failed" || next === "timeout";
    case "paused":
      return next === "running" || next === "failed";
    default:
      return false;
  }
}

export function simCreateRunController(service: SimRunRoutePort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, CreateRunBodySchema, reply);
    if (body === null) return;
    try {
      const simRunId = await service.create({
        swarmId: parseBigIntId(body.swarmId, "swarmId"),
        fishIndex: body.fishIndex,
        kind: body.kind,
        seedApplied: toSeedRefs(body.seedApplied),
        perturbation: toPerturbationSpec(body.perturbation),
        config: toSimConfig(body.config),
      });
      reply.code(201);
      return toCreateRunDto(simRunId);
    } catch (err) {
      normalizePgError(err);
    }
  });
}

export function simGetRunController(service: SimRunRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
    if (params === null) return;
    const simRunId = parseBigIntId(params.id, "simRunId");
    const run = await service.findById(simRunId);
    if (!run) throw notFound("sim_run", simRunId);
    return toSimRunDto(run);
  });
}

export function simUpdateRunStatusController(service: SimRunRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, UpdateRunStatusBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await service.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      if (!isLegalRunTransition(run.status, body.status)) {
        throw conflict(`cannot set sim_run ${simRunId} from ${run.status} to ${body.status}`);
      }
      const completedAt =
        body.completedAt === undefined
          ? body.status === "done" || body.status === "failed" || body.status === "timeout"
            ? new Date()
            : undefined
          : body.completedAt === null
            ? null
            : new Date(body.completedAt);
      await service.updateStatus(simRunId, body.status, completedAt);
      return toEmptyDto();
    },
  );
}

export function simAgentCountController(
  service: SimRunRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
    if (params === null) return;
    const simRunId = parseBigIntId(params.id, "simRunId");
    const run = await service.findById(simRunId);
    if (!run) throw notFound("sim_run", simRunId);
    return toCountDto(await service.countAgentsForRun(simRunId));
  });
}

export function simAgentTurnCountController(
  service: SimRunRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
    if (params === null) return;
    const simRunId = parseBigIntId(params.id, "simRunId");
    const run = await service.findById(simRunId);
    if (!run) throw notFound("sim_run", simRunId);
    return toCountDto(await service.countAgentTurnsForRun(simRunId));
  });
}

export function simSeedController(service: SimRunRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
    if (params === null) return;
    const simRunId = parseBigIntId(params.id, "simRunId");
    const seed = await service.getSeedApplied(simRunId);
    if (!seed) throw notFound("sim_run", simRunId);
    return toSeedRefsDto(seed);
  });
}
