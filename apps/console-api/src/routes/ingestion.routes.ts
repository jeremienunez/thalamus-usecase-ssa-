// apps/console-api/src/routes/ingestion.routes.ts
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { IngestionService } from "../services/ingestion.service";

export function registerIngestionRoutes(
  app: FastifyInstance,
  service: IngestionService,
): void {
  app.get("/api/ingestion/jobs", async () => ({
    jobs: service.listJobs(),
  }));

  app.post<{ Params: { jobName: string } }>(
    "/api/ingestion/run/:jobName",
    async (
      req: FastifyRequest<{ Params: { jobName: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const result = await service.enqueue(req.params.jobName);
        return { ...result, jobName: req.params.jobName };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reply.code(404);
        return { error: message };
      }
    },
  );
}
