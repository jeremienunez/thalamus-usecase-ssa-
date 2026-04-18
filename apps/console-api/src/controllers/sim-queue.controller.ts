import type { FastifyRequest } from "fastify";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  EnqueueSimTurnBodySchema,
  EnqueueSwarmAggregateBodySchema,
  EnqueueSwarmFishBodySchema,
} from "../schemas/sim.schema";
import { parseSafeNumberId } from "./sim-controller.utils";
import { toEmptyDto } from "../transformers/sim-http.transformer";

export interface SimQueueRoutePort {
  enqueueSimTurn(input: {
    simRunId: number;
    turnIndex: number;
    jobId?: string;
  }): Promise<void>;
  enqueueSwarmFish(input: {
    swarmId: number;
    simRunId: number;
    fishIndex: number;
    jobId?: string;
  }): Promise<void>;
  enqueueSwarmAggregate(input: {
    swarmId: number;
    jobId?: string;
  }): Promise<void>;
}

export function simQueueTurnController(service: SimQueueRoutePort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, EnqueueSimTurnBodySchema, reply);
    if (body === null) return;
    await service.enqueueSimTurn({
      simRunId: parseSafeNumberId(body.simRunId, "simRunId"),
      turnIndex: body.turnIndex,
      jobId: body.jobId,
    });
    return toEmptyDto();
  });
}

export function simQueueSwarmFishController(service: SimQueueRoutePort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, EnqueueSwarmFishBodySchema, reply);
    if (body === null) return;
    await service.enqueueSwarmFish({
      swarmId: parseSafeNumberId(body.swarmId, "swarmId"),
      simRunId: parseSafeNumberId(body.simRunId, "simRunId"),
      fishIndex: body.fishIndex,
      jobId: body.jobId,
    });
    return toEmptyDto();
  });
}

export function simQueueSwarmAggregateController(service: SimQueueRoutePort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, EnqueueSwarmAggregateBodySchema, reply);
    if (body === null) return;
    await service.enqueueSwarmAggregate({
      swarmId: parseSafeNumberId(body.swarmId, "swarmId"),
      jobId: body.jobId,
    });
    return toEmptyDto();
  });
}
