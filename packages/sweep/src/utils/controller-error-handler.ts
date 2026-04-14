/**
 * Shared controller error handler
 * Replaces duplicated handleError pattern across 5 controllers
 */

import type { FastifyReply } from "fastify";
import { isAppError } from "@interview/shared/utils";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("controller");

/**
 * Handle controller errors with consistent pattern:
 * 1. AppError → use its statusCode
 * 2. ZodError → 400 validation error
 * 3. Unknown → 500 with logging
 */
export function handleControllerError(
  error: unknown,
  reply: FastifyReply,
  context?: string,
): void {
  if (isAppError(error)) {
    reply.code(error.statusCode).send({ error: error.message });
    return;
  }

  if (error instanceof Error && error.name === "ZodError") {
    const zodError = error as import("zod").ZodError;
    const details = zodError.issues.map((i) => ({
      path: i.path.join("."),
      message: i.message,
    }));
    reply.code(400).send({ error: "Validation error", details });
    return;
  }

  logger.error({ err: error, context }, "Unhandled controller error");
  reply.code(500).send({ error: "Internal server error" });
}
