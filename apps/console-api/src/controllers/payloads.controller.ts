import type { FastifyRequest } from "fastify";
import type { PayloadViewService } from "../services/payload-view.service";
import { asyncHandler } from "../utils/async-handler";
import { parseOrReply } from "../utils/parse-request";
import { PayloadsParamsSchema } from "../schemas";

export function payloadsController(service: PayloadViewService) {
  return asyncHandler<FastifyRequest<{ Params: unknown }>>(
    async (req, reply) => {
      const p = parseOrReply(req.params, PayloadsParamsSchema, reply);
      if (p === null) return;
      return service.listForSatellite(BigInt(p.id));
    },
  );
}
