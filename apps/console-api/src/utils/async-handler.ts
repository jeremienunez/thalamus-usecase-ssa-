import type { FastifyReply, FastifyRequest, RouteHandler } from "fastify";

export type Handler<Req extends FastifyRequest = FastifyRequest> = (
  req: Req,
  reply: FastifyReply,
) => Promise<unknown>;

/**
 * Wraps a controller so any thrown error becomes `{error}` JSON at status 500
 * (or the error's `.statusCode` if set). In production, internal 500s are
 * redacted to "internal error" — real message always reaches `req.log.error`.
 */
export function asyncHandler<Req extends FastifyRequest = FastifyRequest>(
  fn: Handler<Req>,
): RouteHandler {
  return (async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await fn(req as Req, reply);
      if (!reply.sent) return result;
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const explicitCode =
        typeof (err as { statusCode?: number })?.statusCode === "number"
          ? (err as { statusCode: number }).statusCode
          : undefined;
      const code = explicitCode ?? 500;
      req.log.error({ err: rawMsg, url: req.url }, "controller error");
      const clientMsg =
        process.env.NODE_ENV === "production" && explicitCode === undefined
          ? "internal error"
          : rawMsg;
      return reply.code(code).send({ error: clientMsg });
    }
  }) as RouteHandler;
}
