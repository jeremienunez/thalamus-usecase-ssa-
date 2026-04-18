import type { FastifyRequest } from "fastify";
import type { SwarmAggregate } from "@interview/sweep";
import type { TelemetryAggregate } from "../agent/ssa/sim/aggregators/telemetry";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  PromotionFromModalBodySchema,
  PromotionTelemetryBodySchema,
} from "../schemas/sim.schema";
import { toEmptyDto } from "../transformers/sim-http.transformer";
import {
  badRequest,
  parseSafeNumberId,
} from "./sim-controller.utils";

export interface SimPromotionRoutePort {
  emitSuggestionFromModal(
    swarmId: number,
    aggregate: SwarmAggregate,
  ): Promise<number | null>;
  emitTelemetrySuggestions(aggregate: TelemetryAggregate): Promise<number[]>;
}

export function simPromotionFromModalController(
  service: SimPromotionRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, PromotionFromModalBodySchema, reply);
    if (body === null) return;
    const swarmId = parseSafeNumberId(body.swarmId, "swarmId");
    if (
      body.aggregate.swarmId !== undefined &&
      body.aggregate.swarmId !== swarmId
    ) {
      throw badRequest("aggregate.swarmId must match swarmId");
    }
    const aggregate: SwarmAggregate = {
      swarmId,
      totalFish: body.aggregate.totalFish,
      quorumMet: body.aggregate.quorumMet,
      succeededFish: body.aggregate.succeededFish,
      failedFish: body.aggregate.failedFish,
      clusters: body.aggregate.clusters as SwarmAggregate["clusters"],
      modal: body.aggregate.modal as SwarmAggregate["modal"],
      divergenceScore: body.aggregate.divergenceScore,
    };
    await service.emitSuggestionFromModal(swarmId, aggregate);
    return toEmptyDto();
  });
}

export function simPromotionTelemetryController(
  service: SimPromotionRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, PromotionTelemetryBodySchema, reply);
    if (body === null) return;
    const swarmId = parseSafeNumberId(body.swarmId, "swarmId");
    if (
      body.aggregate.swarmId !== undefined &&
      body.aggregate.swarmId !== swarmId
    ) {
      throw badRequest("aggregate.swarmId must match swarmId");
    }
    const aggregate: TelemetryAggregate = {
      swarmId,
      satelliteId: body.aggregate.satelliteId,
      totalFish: body.aggregate.totalFish,
      succeededFish: body.aggregate.succeededFish,
      failedFish: body.aggregate.failedFish,
      quorumMet: body.aggregate.quorumMet,
      scalars: body.aggregate.scalars as TelemetryAggregate["scalars"],
      simConfidence: body.aggregate.simConfidence,
    };
    await service.emitTelemetrySuggestions(aggregate);
    return toEmptyDto();
  });
}
