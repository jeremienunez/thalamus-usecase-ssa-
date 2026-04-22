import type { FastifyRequest } from "fastify";
import type { SimOrchestrator } from "@interview/sweep/internal";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { SimRunIdParamsSchema } from "../schemas/sim.schema";
import {
  toSimRunExecutionStatusDto,
  toSimScheduleNextDto,
} from "../transformers/sim-orchestrator.transformer";

type SimOrchestratorRoutePort = Pick<
  SimOrchestrator,
  "pause" | "resume" | "scheduleNext" | "status"
>;

function parseSimRunId(id: string): number {
  const simRunId = Number(id);
  if (!Number.isSafeInteger(simRunId) || simRunId < 0) {
    const err = new Error("sim_run id must be a safe integer");
    (err as Error & { statusCode?: number }).statusCode = 400;
    throw err;
  }
  return simRunId;
}

function normalizeOrchestratorError(err: unknown): never {
  if (err instanceof Error) {
    const e = err as Error & { statusCode?: number };
    if (e.statusCode === undefined) {
      if (/^sim_run \d+ not found$/.test(e.message)) {
        e.statusCode = 404;
      } else if (e.message.startsWith("cannot ")) {
        e.statusCode = 409;
      }
    }
  }
  throw err;
}

export function simPauseController(service: SimOrchestratorRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const simRunId = parseSimRunId(params.id);
      try {
        await service.pause(simRunId);
      } catch (err) {
        normalizeOrchestratorError(err);
      }
      return reply.code(204).send();
    },
  );
}

export function simResumeController(service: SimOrchestratorRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const simRunId = parseSimRunId(params.id);
      try {
        await service.resume(simRunId);
      } catch (err) {
        normalizeOrchestratorError(err);
      }
      return reply.code(204).send();
    },
  );
}

export function simScheduleNextController(service: SimOrchestratorRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const simRunId = parseSimRunId(params.id);
      try {
        const result = await service.scheduleNext(simRunId);
        return toSimScheduleNextDto(result);
      } catch (err) {
        normalizeOrchestratorError(err);
      }
    },
  );
}

export function simStatusController(service: SimOrchestratorRoutePort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const simRunId = parseSimRunId(params.id);
      const view = await service.status(simRunId);
      if (view === null) {
        reply.code(404).send({ error: "sim_run not found" });
        return;
      }
      return toSimRunExecutionStatusDto(view);
    },
  );
}
