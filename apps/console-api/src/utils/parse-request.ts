import type { FastifyReply } from "fastify";
import type { ZodTypeAny, z } from "zod";

export type ParseReplyPort = Pick<FastifyReply, "code" | "send">;

/** Parses an input against a zod schema. On failure, returns a 400 reply
 *  and returns null so the controller can short-circuit. */
export function parseOrReply<S extends ZodTypeAny>(
  input: unknown,
  schema: S,
  reply: ParseReplyPort,
): z.infer<S> | null {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    reply.code(400).send({
      error: "invalid request",
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    });
    return null;
  }
  return parsed.data as z.infer<S>;
}
