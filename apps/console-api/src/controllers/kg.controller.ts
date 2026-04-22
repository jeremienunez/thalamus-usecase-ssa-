import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { KgViewService } from "../services/kg-view.service";
import { asyncHandler } from "../utils/async-handler";

const kgGraphParamsSchema = z.object({
  id: z.string().min(1),
});

const kgGraphQuerySchema = z.object({
  depth: z.coerce.number().int().min(1).max(5).default(2),
});

type KgGraphRequest = FastifyRequest<{
  Params: z.infer<typeof kgGraphParamsSchema>;
  Querystring: z.infer<typeof kgGraphQuerySchema>;
}>;

export type KgControllerPort = Pick<
  KgViewService,
  "listNodes" | "listEdges" | "getNeighbourhood"
>;

export function kgNodesController(service: KgControllerPort) {
  return asyncHandler(() => service.listNodes());
}

export function kgEdgesController(service: KgControllerPort) {
  return asyncHandler(() => service.listEdges());
}

export function kgGraphController(service: KgControllerPort) {
  return asyncHandler<KgGraphRequest>((req) => {
    const { id } = kgGraphParamsSchema.parse(req.params);
    const { depth } = kgGraphQuerySchema.parse(req.query);
    return service.getNeighbourhood(id, depth);
  });
}
