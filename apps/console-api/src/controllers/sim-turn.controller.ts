import type { FastifyRequest } from "fastify";
import type { SimRunService } from "../services/sim-run.service";
import type { SimTurnService } from "../services/sim-turn.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  InsertAgentTurnBodySchema,
  InsertGodTurnBodySchema,
  ListGodEventsQuerySchema,
  ObservableQuerySchema,
  PersistTurnBatchBodySchema,
  SimRunIdParamsSchema,
} from "../schemas/sim.schema";
import {
  normalizePgError,
  notFound,
  parseBigIntId,
} from "./sim-controller.utils";
import {
  toGodEventDto,
  toInsertTurnDto,
  toLastTurnAtDto,
  toObservableTurnDto,
  toPersistTurnBatchDto,
} from "../transformers/sim-http.transformer";

type SimRunLookupPort = Pick<SimRunService, "findById">;
type SimTurnWritePort = Pick<
  SimTurnService,
  | "insertAgentTurn"
  | "persistTurnBatch"
  | "insertGodTurn"
  | "listGodEventsAtOrBefore"
  | "lastTurnCreatedAt"
  | "recentObservable"
>;

export function simInsertAgentTurnController(
  runRepo: SimRunLookupPort,
  turnRepo: SimTurnWritePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, InsertAgentTurnBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      try {
        const simTurnId = await turnRepo.insertAgentTurn({
          simRunId,
          turnIndex: body.turnIndex,
          agentId: parseBigIntId(body.agentId, "agentId"),
          action: body.action as never,
          rationale: body.rationale ?? "",
          observableSummary: body.observableSummary,
          llmCostUsd: body.llmCostUsd,
        });
        reply.code(201);
        return toInsertTurnDto(simTurnId);
      } catch (err) {
        normalizePgError(err);
      }
    },
  );
}

export function simPersistTurnBatchController(
  runRepo: SimRunLookupPort,
  turnRepo: SimTurnWritePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, PersistTurnBatchBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      try {
        const ids = await turnRepo.persistTurnBatch({
          agentTurns: body.agentTurns.map((t) => ({
            simRunId,
            turnIndex: t.turnIndex,
            agentId: parseBigIntId(t.agentId, "agentId"),
            action: t.action as never,
            rationale: t.rationale ?? "",
            observableSummary: t.observableSummary,
            llmCostUsd: t.llmCostUsd,
          })),
          memoryRows: body.memoryRows.map((m) => ({
            simRunId,
            agentId: parseBigIntId(m.agentId, "agentId"),
            turnIndex: m.turnIndex,
            kind: m.kind,
            content: m.content,
            embedding: m.embedding,
          })),
        });
        return toPersistTurnBatchDto(ids);
      } catch (err) {
        normalizePgError(err);
      }
    },
  );
}

export function simInsertGodTurnController(
  runRepo: SimRunLookupPort,
  turnRepo: SimTurnWritePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, InsertGodTurnBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      try {
        const simTurnId = await turnRepo.insertGodTurn({
          simRunId,
          turnIndex: body.turnIndex,
          action: body.action as never,
          rationale: body.rationale,
          observableSummary: body.observableSummary,
        });
        reply.code(201);
        return toInsertTurnDto(simTurnId);
      } catch (err) {
        normalizePgError(err);
      }
    },
  );
}

export function simGodEventsController(
  runRepo: SimRunLookupPort,
  turnRepo: SimTurnWritePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Querystring: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const query = parseOrReply(req.query, ListGodEventsQuerySchema, reply);
      if (query === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      const rows = await turnRepo.listGodEventsAtOrBefore(
        simRunId,
        query.beforeTurn,
        query.limit,
      );
      return rows.map(toGodEventDto);
    },
  );
}

export function simLastTurnAtController(
  runRepo: SimRunLookupPort,
  turnRepo: SimTurnWritePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
    if (params === null) return;
    const simRunId = parseBigIntId(params.id, "simRunId");
    const run = await runRepo.findById(simRunId);
    if (!run) throw notFound("sim_run", simRunId);
    return toLastTurnAtDto(await turnRepo.lastTurnCreatedAt(simRunId));
  });
}

export function simObservableController(
  runRepo: SimRunLookupPort,
  turnRepo: SimTurnWritePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Querystring: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const query = parseOrReply(req.query, ObservableQuerySchema, reply);
      if (query === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      const rows = await turnRepo.recentObservable({
        simRunId,
        sinceTurnIndex: query.sinceTurn,
        excludeAgentId:
          query.excludeAgentId === undefined
            ? undefined
            : parseBigIntId(query.excludeAgentId, "excludeAgentId"),
        limit: query.limit,
      });
      return rows.map(toObservableTurnDto);
    },
  );
}
