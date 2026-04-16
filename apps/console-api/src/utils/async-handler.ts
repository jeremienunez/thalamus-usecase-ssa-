import type { FastifyReply, FastifyRequest, RouteHandler } from "fastify";

export type Handler<Req extends FastifyRequest = FastifyRequest> = (
  req: Req,
  reply: FastifyReply,
) => Promise<unknown>;

/**
 * Wraps a controller fn so any thrown error is returned as {error} JSON at
 * status 500 (or the error's own `.statusCode` if set), without propagating
 * into Fastify's default HTML error path.
 */
export function asyncHandler<Req extends FastifyRequest = FastifyRequest>(
  fn: Handler<Req>,
): RouteHandler {
  return (async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await fn(req as Req, reply);
      if (!reply.sent) return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const code =
        typeof (err as { statusCode?: number })?.statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : 500;
      req.log.error({ err: msg, url: req.url }, "controller error");
      return reply.code(code).send({ error: msg });
    }
  }) as RouteHandler;
}
