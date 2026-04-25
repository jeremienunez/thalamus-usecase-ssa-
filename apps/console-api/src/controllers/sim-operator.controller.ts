import type { FastifyReply, FastifyRequest } from "fastify";
import type { FishTraceDto } from "@interview/shared/dto/sim-http.dto";
import type { SimOperatorService } from "../services/sim-operator.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import {
  AskSimReviewQuestionBodySchema,
  FishTraceQuerySchema,
  OperatorSwarmsQuerySchema,
  SimSwarmFishParamsSchema,
  SimSwarmIdParamsSchema,
} from "../schemas/sim.schema";
import { parseBigIntId, parseSafeNumberId } from "./sim-controller.utils";

export type SimOperatorPort = Pick<
  SimOperatorService,
  | "listSwarms"
  | "getStatus"
  | "streamSwarmEvents"
  | "getFishTimeline"
  | "getClusters"
  | "getFishTrace"
  | "askQuestion"
  | "listEvidence"
>;

export function simOperatorListSwarmsController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Querystring: unknown }>>(
    async (req, reply) => {
      const query = parseOrReply(req.query, OperatorSwarmsQuerySchema, reply);
      if (query === null) return;
      return service.listSwarms({
        status: query.status,
        kind: query.kind,
        limit: query.limit,
        cursor:
          query.cursor === undefined
            ? undefined
            : parseBigIntId(query.cursor, "cursor"),
      });
    },
  );
}

export function simOperatorStatusController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    return service.getStatus(parseBigIntId(params.id, "swarmId"));
  });
}

export function simOperatorEventsController(service: SimOperatorPort) {
  return async (
    req: FastifyRequest<{ Params: unknown }>,
    reply: FastifyReply,
  ): Promise<void> => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    const swarmId = parseBigIntId(params.id, "swarmId");
    await service.getStatus(swarmId);

    const abort = new AbortController();
    const onClose = (): void => {
      if (!reply.raw.writableEnded) abort.abort();
    };
    reply.raw.on("close", onClose);
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    try {
      for await (const evt of service.streamSwarmEvents(swarmId, abort.signal)) {
        if (abort.signal.aborted) break;
        reply.raw.write(
          `event: ${evt.event}\ndata: ${JSON.stringify(evt.data)}\n\n`,
        );
      }
    } catch (err) {
      if (!abort.signal.aborted) {
        const message = err instanceof Error ? err.message : String(err);
        reply.raw.write(
          `event: error\ndata: ${JSON.stringify({ message })}\n\n`,
        );
      }
    } finally {
      reply.raw.off("close", onClose);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  };
}

export function simOperatorFishTimelineController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmFishParamsSchema, reply);
    if (params === null) return;
    return service.getFishTimeline(
      parseBigIntId(params.id, "swarmId"),
      parseSafeNumberId(params.fishIndex, "fishIndex"),
    );
  });
}

export function simOperatorClustersController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    return service.getClusters(parseBigIntId(params.id, "swarmId"));
  });
}

export function simOperatorFishTraceController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Querystring: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimSwarmFishParamsSchema, reply);
      if (params === null) return;
      const query = parseOrReply(req.query, FishTraceQuerySchema, reply);
      if (query === null) return;
      const trace = await service.getFishTrace(
        parseBigIntId(params.id, "swarmId"),
        parseSafeNumberId(params.fishIndex, "fishIndex"),
      );
      if (query.format === "ndjson") {
        reply.header("Content-Type", "application/x-ndjson");
        return toNdjson(trace);
      }
      return trace;
    },
  );
}

export function simOperatorAskQuestionController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown; Body: unknown }>>(
    async (req, reply) => {
      const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
      if (params === null) return;
      const body = parseOrReply(req.body, AskSimReviewQuestionBodySchema, reply);
      if (body === null) return;
      return service.askQuestion({
        swarmId: parseBigIntId(params.id, "swarmId"),
        scope: body.scope,
        question: body.question,
        fishIndex: body.fishIndex,
        clusterIndex: body.clusterIndex,
        clusterLabel: body.clusterLabel,
        createdBy: req.user ? BigInt(req.user.id) : null,
      });
    },
  );
}

export function simOperatorEvidenceController(service: SimOperatorPort) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(async (req, reply) => {
    const params = parseOrReply(req.params, SimSwarmIdParamsSchema, reply);
    if (params === null) return;
    return service.listEvidence(parseBigIntId(params.id, "swarmId"));
  });
}

function toNdjson(trace: FishTraceDto): string {
  return [
    { ...trace, turns: undefined, kind: "trace" },
    ...trace.turns.map((turn) => ({ kind: "turn", ...turn })),
  ]
    .map((row) => JSON.stringify(row))
    .join("\n")
    .concat("\n");
}
