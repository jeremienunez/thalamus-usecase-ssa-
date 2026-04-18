import type { FastifyRequest } from "fastify";
import type { SimMemoryService } from "../services/sim-memory.service";
import type { SimRunService } from "../services/sim-run.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  MemoryRecentQuerySchema,
  MemorySearchBodySchema,
  SimRunIdParamsSchema,
  WriteMemoryBatchBodySchema,
} from "../schemas/sim.schema";
import { normalizePgError, notFound, parseBigIntId } from "./sim-controller.utils";
import {
  toMemoryBatchWriteDto,
  toSimMemoryRowDto,
} from "../transformers/sim-http.transformer";

type SimRunLookupPort = Pick<SimRunService, "findById">;
type SimMemoryRoutePort = Pick<
  SimMemoryService,
  "writeMany" | "topKByVector" | "topKByRecency"
>;

export function simMemoryBatchController(
  runRepo: SimRunLookupPort,
  memoryRepo: SimMemoryRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, WriteMemoryBatchBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      try {
        const ids = await memoryRepo.writeMany(
          body.map((row) => ({
            simRunId,
            agentId: parseBigIntId(row.agentId, "agentId"),
            turnIndex: row.turnIndex,
            kind: row.kind,
            content: row.content,
            embedding: row.embedding,
          })),
        );
        return toMemoryBatchWriteDto(ids);
      } catch (err) {
        normalizePgError(err);
      }
    },
  );
}

export function simMemorySearchController(
  runRepo: SimRunLookupPort,
  memoryRepo: SimMemoryRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, MemorySearchBodySchema, reply);
      if (body === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      const rows = await memoryRepo.topKByVector({
        simRunId,
        agentId: parseBigIntId(body.agentId, "agentId"),
        vec: body.vec,
        k: body.k,
      });
      return rows.map(toSimMemoryRowDto);
    },
  );
}

export function simMemoryRecentController(
  runRepo: SimRunLookupPort,
  memoryRepo: SimMemoryRoutePort,
) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Querystring: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimRunIdParamsSchema, reply);
      if (params === null) return;
      const query = parseOrReply(req.query, MemoryRecentQuerySchema, reply);
      if (query === null) return;
      const simRunId = parseBigIntId(params.id, "simRunId");
      const run = await runRepo.findById(simRunId);
      if (!run) throw notFound("sim_run", simRunId);
      const rows = await memoryRepo.topKByRecency({
        simRunId,
        agentId: parseBigIntId(query.agentId, "agentId"),
        k: query.k,
      });
      return rows.map(toSimMemoryRowDto);
    },
  );
}
