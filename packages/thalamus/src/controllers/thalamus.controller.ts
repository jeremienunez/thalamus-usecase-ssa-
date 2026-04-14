/**
 * Thalamus Controller — API handlers for research cycles and findings
 */

import type { FastifyRequest, FastifyReply } from "fastify";
import {
  ResearchCycleTrigger,
  ResearchCortex,
  ResearchFindingType,
  ResearchEntityType,
} from "@interview/shared/enum";
import type { ThalamusService } from "../services/thalamus.service";
import type { ResearchGraphService } from "../services/research-graph.service";
import type { ResearchCycleRepository } from "../repositories/research-cycle.repository";
import { createLogger } from "@interview/shared/observability";

const logger = createLogger("thalamus-controller");

/** Convert BigInt fields to strings for JSON serialization */
function serializeBigInt<T>(obj: T): T {
  return JSON.parse(
    JSON.stringify(obj, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );
}

export class ThalamusController {
  constructor(
    private thalamusService: ThalamusService,
    private graphService: ResearchGraphService,
    private cycleRepo: ResearchCycleRepository,
  ) {}

  /**
   * POST /api/thalamus/research — Trigger a research cycle (async)
   */
  async triggerResearch(
    req: FastifyRequest<{
      Body: {
        query: string;
        cortices?: string[];
        depth?: string;
        lang?: "fr" | "en";
      };
    }>,
    reply: FastifyReply,
  ) {
    const { query, cortices, depth, lang } = req.body;
    const userId: bigint | undefined = undefined;

    // Fire-and-forget — return cycle ID immediately
    const cycle = await this.thalamusService.runCycle({
      query,
      userId,
      triggerType: ResearchCycleTrigger.User,
      triggerSource: query,
      cortices,
      lang: lang ?? "fr",
    });

    // Note: runCycle is awaited here for simplicity.
    // In production, dispatch via BullMQ for true async.
    return reply.send({
      cycleId: cycle.id,
      status: cycle.status,
      findingsCount: cycle.findingsCount,
      corticesUsed: cycle.corticesUsed,
    });
  }

  /**
   * GET /api/thalamus/findings — List active findings with filters
   */
  async getFindings(
    req: FastifyRequest<{
      Querystring: {
        cortex?: string;
        findingType?: string;
        minConfidence?: string;
        query?: string;
        limit?: string;
        offset?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { cortex, findingType, minConfidence, query, limit, offset } =
      req.query;

    // Semantic search if query provided
    if (query) {
      const results = await this.graphService.semanticSearch(
        query,
        Number(limit) || 10,
      );
      return reply.send(serializeBigInt({ findings: results }));
    }

    // Filter-based listing
    const findings = await this.graphService.listFindings({
      cortex: cortex as ResearchCortex | undefined,
      findingType: findingType as ResearchFindingType | undefined,
      minConfidence: minConfidence ? Number(minConfidence) : undefined,
      limit: Number(limit) || 20,
      offset: Number(offset) || 0,
    });

    return reply.send(serializeBigInt({ findings }));
  }

  /**
   * GET /api/thalamus/findings/:id — Single finding with edges
   */
  async getFinding(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const finding = await this.graphService.getFindingWithEdges(
      BigInt(req.params.id),
    );
    if (!finding) {
      return reply.status(404).send({ error: "Finding not found" });
    }
    return reply.send(serializeBigInt(finding));
  }

  /**
   * GET /api/thalamus/graph/:type/:id — All findings for an entity
   */
  async getEntityGraph(
    req: FastifyRequest<{ Params: { type: string; id: string } }>,
    reply: FastifyReply,
  ) {
    const findings = await this.graphService.queryByEntity(
      req.params.type as ResearchEntityType,
      BigInt(req.params.id),
    );
    return reply.send(serializeBigInt({ findings }));
  }

  /**
   * GET /api/thalamus/cycles — Recent research cycles
   */
  async getCycles(req: FastifyRequest, reply: FastifyReply) {
    const cycles = await this.cycleRepo.findRecent(20);
    return reply.send(serializeBigInt({ cycles }));
  }

  /**
   * GET /api/thalamus/knowledge-graph — Full graph for visualization
   */
  async getKnowledgeGraph(
    req: FastifyRequest<{
      Querystring: {
        cortex?: string;
        findingType?: string;
        minConfidence?: string;
        limit?: string;
      };
    }>,
    reply: FastifyReply,
  ) {
    const { cortex, findingType, minConfidence, limit } = req.query;
    const graph = await this.graphService.getKnowledgeGraph({
      cortex: cortex as ResearchCortex | undefined,
      findingType: findingType as ResearchFindingType | undefined,
      minConfidence: minConfidence ? Number(minConfidence) : undefined,
      limit: Number(limit) || 100,
    });
    return reply.send(serializeBigInt(graph));
  }

  /**
   * DELETE /api/thalamus/findings/:id — Archive a finding
   */
  async archiveFinding(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ) {
    const id = BigInt(req.params.id);
    const finding = await this.graphService.getFindingWithEdges(id);
    if (!finding) throw new Error("Not found");
    await this.graphService.archiveFinding(id);
    return reply.send({ archived: true });
  }
}
