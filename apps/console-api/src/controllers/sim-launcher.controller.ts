import type { FastifyRequest } from "fastify";
import type { LaunchSwarmResult, SimOrchestrator } from "@interview/sweep/internal";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  StartPcBodySchema,
  StartStandaloneBodySchema,
  StartTelemetryBodySchema,
} from "../schemas/sim.schema";
import {
  parseOptionalSafeNumberId,
  parseSafeNumberId,
} from "./sim-controller.utils";
import {
  toLaunchPcDto,
  toLaunchSwarmDto,
  toStartStandaloneDto,
} from "../transformers/sim-http.transformer";

type SimOrchestratorLaunchPort = Pick<SimOrchestrator, "startStandalone">;

export interface SimLauncherRoutePort {
  startTelemetry(opts: {
    satelliteId: number;
    fishCount?: number;
    priorJitter?: number;
    config?: {
      llmMode?: "cloud" | "fixtures" | "record";
      quorumPct?: number;
      perFishTimeoutMs?: number;
      fishConcurrency?: number;
      nanoModel?: string;
      seed?: number;
    };
    createdBy?: number;
  }): Promise<LaunchSwarmResult>;
  startPc(opts: {
    conjunctionId: number;
    fishCount?: number;
    config?: {
      llmMode?: "cloud" | "fixtures" | "record";
      quorumPct?: number;
      perFishTimeoutMs?: number;
      fishConcurrency?: number;
      nanoModel?: string;
      seed?: number;
    };
    createdBy?: number;
  }): Promise<LaunchSwarmResult & { conjunctionId: number }>;
}

export function simStartTelemetryController(service: SimLauncherRoutePort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, StartTelemetryBodySchema, reply);
    if (body === null) return;
    const result = await service.startTelemetry({
      satelliteId: parseSafeNumberId(body.satelliteId, "satelliteId"),
      fishCount: body.fishCount,
      priorJitter: body.priorJitter,
      config: body.config,
      createdBy: parseOptionalSafeNumberId(body.createdBy, "createdBy"),
    });
    reply.code(201);
    return toLaunchSwarmDto(result);
  });
}

export function simStartPcController(service: SimLauncherRoutePort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, StartPcBodySchema, reply);
    if (body === null) return;
    const result = await service.startPc({
      conjunctionId: parseSafeNumberId(body.conjunctionId, "conjunctionId"),
      fishCount: body.fishCount,
      config: body.config,
      createdBy: parseOptionalSafeNumberId(body.createdBy, "createdBy"),
    });
    reply.code(201);
    return toLaunchPcDto(result);
  });
}

export function simStartStandaloneController(
  service: SimOrchestratorLaunchPort,
) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(req.body, StartStandaloneBodySchema, reply);
    if (body === null) return;
    const result = await service.startStandalone({
      kind: body.kind,
      title: body.title,
      subjectIds: body.operatorIds.map((id) => parseSafeNumberId(id, "operatorId")),
      subjectKind: "operator",
      baseSeed: {
        ...(body.conjunctionFindingId === undefined
          ? {}
          : {
              conjunctionFindingId: parseSafeNumberId(
                body.conjunctionFindingId,
                "conjunctionFindingId",
              ),
            }),
      },
      horizonDays: body.horizonDays,
      turnsPerDay: body.turnsPerDay,
      maxTurns: body.maxTurns,
      llmMode: body.llmMode,
      nanoModel: body.nanoModel,
      seed: body.seed,
      createdBy: parseOptionalSafeNumberId(body.createdBy, "createdBy"),
    });
    reply.code(201);
    return toStartStandaloneDto(result);
  });
}
