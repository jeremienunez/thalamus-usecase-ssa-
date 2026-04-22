import type { FastifyRequest } from "fastify";
import { z } from "zod";
import type { FindingViewService } from "../services/finding-view.service";
import { asyncHandler } from "../utils/async-handler";

const whyParamsSchema = z.object({
  findingId: z.string().min(1),
});

type WhyRequest = FastifyRequest<{
  Params: z.infer<typeof whyParamsSchema>;
}>;

export type WhyControllerPort = Pick<FindingViewService, "buildWhyTree">;

export function whyController(service: WhyControllerPort) {
  return asyncHandler<WhyRequest>((req) => {
    const { findingId } = whyParamsSchema.parse(req.params);
    return service.buildWhyTree(findingId);
  });
}
