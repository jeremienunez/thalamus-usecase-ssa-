/**
 * Admin Sweep Controller — endpoints for nano-sweep suggestions.
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import type { NanoSweepService } from "../services/nano-sweep.service";
import type { SweepRepository } from "../repositories/sweep.repository";
import type { SweepResolutionService } from "../services/sweep-resolution.service";
import {
  listSuggestionsSchema,
  reviewSuggestionSchema,
  triggerSweepSchema,
  resolveSuggestionSchema,
} from "../transformers/sweep.dto";

export class AdminSweepController {
  constructor(
    private sweepService: NanoSweepService,
    private sweepRepo: SweepRepository,
    private resolutionService: SweepResolutionService,
  ) {}

  /** GET /admin/sweep/suggestions */
  listSuggestions = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = listSuggestionsSchema.parse(req.query);
    const { rows, total } = await this.sweepRepo.list(query);

    // SweepSuggestionRow already uses camelCase (Redis-backed)
    const suggestions = rows;

    return reply.send({
      suggestions,
      total,
      page: query.page,
      limit: query.limit,
    });
  };

  /** GET /admin/sweep/stats */
  getStats = async (_req: FastifyRequest, reply: FastifyReply) => {
    const stats = await this.sweepRepo.getStats();
    return reply.send(stats);
  };

  /** PATCH /admin/sweep/suggestions/:id */
  reviewSuggestion = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = reviewSuggestionSchema.parse(req.body);
    const ok = await this.sweepRepo.review(id, body.accepted, body.reviewerNote);

    if (!ok) return reply.status(404).send({ error: "Suggestion not found" });
    return reply.send({ ok: true });
  };

  /** POST /admin/sweep/suggestions/:id/resolve */
  resolveSuggestion = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    const body = resolveSuggestionSchema.parse(req.body ?? {});
    const result = await this.resolutionService.resolve(id, body.selections);
    const statusCode = result.status === "failed" ? 422 : 200;
    return reply.status(statusCode).send(result);
  };

  /** POST /admin/sweep/trigger */
  triggerSweep = async (req: FastifyRequest, reply: FastifyReply) => {
    const body = triggerSweepSchema.parse(req.body ?? {});
    // Run async — don't block the request
    this.sweepService
      .sweep(body.maxOperatorCountries, body.mode)
      .catch(() => {});
    return reply
      .status(202)
      .send({ message: "Sweep started", mode: body.mode ?? "dataQuality" });
  };
}
