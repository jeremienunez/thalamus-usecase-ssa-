import type { FastifyRequest } from "fastify";
import type { ResearchWriterPort } from "@interview/thalamus";
import {
  ResearchCycleIdParamsSchema,
  ResearchCycleWriteBodySchema,
  ResearchFindingEmissionBodySchema,
  type ResearchCycleIdParams,
  type ResearchCycleWriteBody,
  type ResearchFindingEmissionBody,
} from "../schemas/research-write.schema";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";

/**
 * Kernel-only HTTP surface for `research_*` writes (Sprint 5 / C1).
 *
 * Mirrors the `apps/console-api/src/services/research-write.service.ts`
 * writer port so the kernel can consume a single contract over HTTP rather
 * than reaching into the app's Drizzle repos. Auth-scoped kernel-only.
 */

export function postResearchCycleController(writer: ResearchWriterPort) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(
      req.body,
      ResearchCycleWriteBodySchema,
      reply,
    ) as ResearchCycleWriteBody | null;
    if (body === null) return;
    const row = await writer.createCycle(body);
    return reply.code(201).send({ id: row.id.toString() });
  });
}

export function postResearchFindingEmissionsController(
  writer: ResearchWriterPort,
) {
  return asyncHandler<FastifyRequest<{ Body: unknown }>>(async (req, reply) => {
    const body = parseOrReply(
      req.body,
      ResearchFindingEmissionBodySchema,
      reply,
    ) as ResearchFindingEmissionBody | null;
    if (body === null) return;

    const result = await writer.emitFindingTransactional(body);
    return reply.code(201).send({
      findingId: result.finding.id.toString(),
      inserted: result.inserted,
      linked: result.linked,
      edgeIds: result.edges.map((row) => row.id.toString()),
    });
  });
}

export function postIncrementCycleFindingsController(
  writer: ResearchWriterPort,
) {
  return asyncHandler<
    FastifyRequest<{ Params: { id: string }; Body: unknown }>
  >(async (req, reply) => {
    const params = parseOrReply(
      req.params,
      ResearchCycleIdParamsSchema,
      reply,
    ) as ResearchCycleIdParams | null;
    if (params === null) return;

    await writer.incrementCycleFindings(params.id);
    return reply.code(204).send();
  });
}
