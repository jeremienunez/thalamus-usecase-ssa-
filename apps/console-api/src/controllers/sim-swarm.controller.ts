import type { FastifyRequest } from "fastify";
import type { SwarmService } from "@interview/sweep/internal";
import type { SimSwarmService } from "../services/sim-swarm.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  ClaimPendingFishBodySchema,
  CloseSwarmBodySchema,
  CreateSwarmBodySchema,
  LinkOutcomeBodySchema,
  SnapshotAggregateBodySchema,
  SimSwarmIdParamsSchema,
} from "../schemas/sim.schema";
import {
  conflict,
  normalizePgError,
  notFound,
  parseBigIntId,
  parseSafeNumberId,
  toPerturbationSpec,
  toSeedRefs,
  toSwarmConfig,
} from "./sim-controller.utils";
import {
  toClaimedSwarmFishDto,
  toCreateSwarmDto,
  toEmptyDto,
  toSimSwarmDto,
  toSwarmFishCountsDto,
  toSwarmStatusDto,
} from "../transformers/sim-http.transformer";

type SimSwarmRowPort = Pick<
  SimSwarmService,
  | "create"
  | "findById"
  | "markDone"
  | "markFailed"
  | "linkOutcome"
  | "countFishByStatus"
>;
type SimSwarmStatusPort = Pick<SwarmService, "status">;
type SimSwarmStoreRoutePort = {
  abortSwarm(swarmId: number): Promise<void>;
  claimPendingFishForSwarm(
    swarmId: number,
    limit: number,
  ): Promise<Array<{ simRunId: number; fishIndex: number }>>;
  snapshotAggregate(input: {
    swarmId: number;
    key: string;
    value: Record<string, unknown>;
  }): Promise<void>;
  closeSwarm(input: {
    swarmId: number;
    status: "done" | "failed";
    suggestionId?: number | null;
    reportFindingId?: number | null;
    completedAt?: Date;
  }): Promise<void>;
};
type SimSwarmAutoReviewPort = {
  recordAutoReviewEvidence(swarmId: bigint): Promise<void>;
};

export function simCreateSwarmController(service: SimSwarmRowPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, CreateSwarmBodySchema, reply);
    if (body === null) return;
    try {
      const swarmId = await service.create({
        kind: body.kind,
        title: body.title,
        baseSeed: toSeedRefs(body.baseSeed),
        perturbations: body.perturbations.map(toPerturbationSpec),
        size: body.size,
        config: toSwarmConfig(body.config),
        createdBy:
          body.createdBy === undefined ? null : parseBigIntId(body.createdBy, "createdBy"),
      });
      reply.code(201);
      return toCreateSwarmDto(swarmId);
    } catch (err) {
      normalizePgError(err);
    }
  });
}

export function simGetSwarmController(service: SimSwarmRowPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const swarmId = parseBigIntId(params.id, "swarmId");
    const swarm = await service.findById(swarmId);
    if (!swarm) throw notFound("sim_swarm", swarmId);
    return toSimSwarmDto(swarm);
  });
}

export function simFishCountsController(
  service: SimSwarmRowPort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const swarmId = parseBigIntId(params.id, "swarmId");
    const swarm = await service.findById(swarmId);
    if (!swarm) throw notFound("sim_swarm", swarmId);
    return toSwarmFishCountsDto(await service.countFishByStatus(swarmId));
  });
}

export function simSwarmDoneController(service: SimSwarmRowPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const swarmId = parseBigIntId(params.id, "swarmId");
    const swarm = await service.findById(swarmId);
    if (!swarm) throw notFound("sim_swarm", swarmId);
    if (swarm.status === "done" || swarm.status === "failed") {
      throw conflict(`cannot mark sim_swarm ${swarmId} done from ${swarm.status}`);
    }
    await service.markDone(swarmId);
    return toEmptyDto();
  });
}

export function simSwarmFailedController(service: SimSwarmRowPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const swarmId = parseBigIntId(params.id, "swarmId");
    const swarm = await service.findById(swarmId);
    if (!swarm) throw notFound("sim_swarm", swarmId);
    if (swarm.status === "done" || swarm.status === "failed") {
      throw conflict(`cannot mark sim_swarm ${swarmId} failed from ${swarm.status}`);
    }
    await service.markFailed(swarmId);
    return toEmptyDto();
  });
}

export function simLinkOutcomeController(service: SimSwarmRowPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, LinkOutcomeBodySchema, reply);
      if (body === null) return;
      const swarmId = parseBigIntId(params.id, "swarmId");
      const swarm = await service.findById(swarmId);
      if (!swarm) throw notFound("sim_swarm", swarmId);
      await service.linkOutcome(swarmId, {
        reportFindingId:
          body.reportFindingId === undefined
            ? undefined
            : parseBigIntId(body.reportFindingId, "reportFindingId"),
        suggestionId:
          body.suggestionId === undefined
            ? undefined
            : parseBigIntId(body.suggestionId, "suggestionId"),
      });
      return toEmptyDto();
    },
  );
}

export function simSwarmStatusController(service: SimSwarmStatusPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const status = await service.status(parseSafeNumberId(params.id, "swarmId"));
    if (!status) throw notFound("sim_swarm", params.id);
    return toSwarmStatusDto(status);
  });
}

export function simSwarmAbortController(service: SimSwarmStoreRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const swarmId = parseSafeNumberId(params.id, "swarmId");
    await service.abortSwarm(swarmId);
    return toEmptyDto();
  });
}

export function simClaimPendingFishController(
  service: SimSwarmStoreRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, ClaimPendingFishBodySchema, reply);
      if (body === null) return;
      const rows = await service.claimPendingFishForSwarm(
        parseSafeNumberId(params.id, "swarmId"),
        body.limit,
      );
      return rows.map(toClaimedSwarmFishDto);
    },
  );
}

export function simSnapshotAggregateController(service: SimSwarmStoreRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, SnapshotAggregateBodySchema, reply);
      if (body === null) return;
      await service.snapshotAggregate({
        swarmId: parseSafeNumberId(params.id, "swarmId"),
        key: body.key,
        value: body.value,
      });
      return toEmptyDto();
    },
  );
}

export function simCloseSwarmController(
  service: SimSwarmStoreRoutePort,
  autoReview?: SimSwarmAutoReviewPort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, CloseSwarmBodySchema, reply);
      if (body === null) return;
      const swarmId = parseSafeNumberId(params.id, "swarmId");
      await service.closeSwarm({
        swarmId,
        status: body.status,
        suggestionId:
          body.suggestionId === undefined
            ? undefined
            : body.suggestionId === null
              ? null
              : parseSafeNumberId(body.suggestionId, "suggestionId"),
        reportFindingId:
          body.reportFindingId === undefined
            ? undefined
            : body.reportFindingId === null
              ? null
              : parseSafeNumberId(body.reportFindingId, "reportFindingId"),
        completedAt:
          body.completedAt === undefined ? undefined : new Date(body.completedAt),
      });
      try {
        await autoReview?.recordAutoReviewEvidence(BigInt(swarmId));
      } catch (err) {
        req.log.warn(
          { err, swarmId },
          "sim auto-review evidence seeding failed after close",
        );
      }
      return toEmptyDto();
    },
  );
}
