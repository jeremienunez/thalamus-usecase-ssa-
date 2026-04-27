import { createHash } from "node:crypto";
import { ResearchRelation } from "@interview/shared/enum";
import { createLogger } from "@interview/shared/observability";
import { assertEmbeddingDimension } from "../errors/embedding";
import type { EmbedderPort } from "../ports/embedder.port";
import type { NewResearchEdge, ResearchFinding } from "../types/research.types";
import type {
  CyclesGraphPort,
  EdgesGraphPort,
  FindingCallback,
  FindingsGraphPort,
  ResearchGraphTransactionPort,
  ResearchGraphUnitOfWork,
  StoreFindingInput,
} from "./research-graph.types";

const logger = createLogger("finding-store");

export class FindingStoreService {
  private onFindingStored: FindingCallback[] = [];
  private readonly transactionPort: ResearchGraphTransactionPort;

  constructor(
    private readonly findingRepo: FindingsGraphPort,
    private readonly edgeRepo: EdgesGraphPort,
    private readonly cycleRepo: CyclesGraphPort,
    private readonly embedder: EmbedderPort,
    transactionPort?: ResearchGraphTransactionPort,
  ) {
    this.transactionPort =
      transactionPort ??
      ({
        runInTransaction: async (work) =>
          work({
            findingRepo: this.findingRepo,
            edgeRepo: this.edgeRepo,
            cycleRepo: this.cycleRepo,
          }),
      } satisfies ResearchGraphTransactionPort);
  }

  onFinding(cb: FindingCallback): void {
    this.onFindingStored.push(cb);
  }

  async storeFinding(input: StoreFindingInput): Promise<ResearchFinding> {
    const text = `${input.finding.title}\n${input.finding.summary}`;
    const embedding = assertEmbeddingDimension(
      await this.embedder.embedQuery(text),
      {
        embedderName: this.embedderName(),
        operation: "storeFinding",
      },
    );

    const primaryEdgeForDedup = input.edges[0];
    const hasResolvedAnchor =
      primaryEdgeForDedup !== undefined &&
      primaryEdgeForDedup.entityId !== 0n &&
      primaryEdgeForDedup.entityId !== BigInt(0);
    if (embedding && hasResolvedAnchor) {
      const nearDuplicates = await this.findingRepo.findSimilar(
        embedding,
        0.92,
        3,
        {
          entityType: primaryEdgeForDedup!.entityType,
          entityId: primaryEdgeForDedup!.entityId,
        },
      );
      const sameType = nearDuplicates.find(
        (f) => f.findingType === input.finding.findingType,
      );
      if (sameType) {
        logger.info(
          {
            existingId: String(sameType.id),
            similarity: sameType.similarity,
            findingType: input.finding.findingType,
            newTitle: input.finding.title,
          },
          "Semantic dedup: merging into existing finding",
        );
        await this.transactionPort.runInTransaction(async (uow) => {
          await uow.findingRepo.mergeFinding(sameType.id, {
            confidence: Math.max(sameType.confidence, input.finding.confidence),
            evidence: Array.isArray(input.finding.evidence)
              ? input.finding.evidence
              : [],
          });
          await this.linkCycleEmission(uow, input.finding, sameType.id, true);
        });
        return sameType;
      }
    }

    const primaryEdge = input.edges[0];
    const hasHashAnchor =
      primaryEdge !== undefined &&
      primaryEdge.entityId !== 0n &&
      primaryEdge.entityId !== BigInt(0);
    const dedupKey = hasHashAnchor
      ? `${input.finding.cortex}:${primaryEdge!.entityType}:${primaryEdge!.entityId}:${input.finding.findingType}`
      : `${input.finding.cortex}:${input.finding.researchCycleId}:${Date.now()}:${input.finding.title.slice(0, 64)}`;
    const dedupHash = createHash("sha256")
      .update(dedupKey)
      .digest("hex")
      .slice(0, 32);

    const entityEdges = input.edges.filter(
      (e) => e.entityId !== 0n && e.entityId !== BigInt(0),
    );

    const { finding, inserted } = await this.transactionPort.runInTransaction(
      async (uow) => {
        const result = await uow.findingRepo.upsertByDedupHash({
          ...input.finding,
          embedding,
          dedupHash,
        });

        if (!result.inserted) {
          await this.linkCycleEmission(
            uow,
            input.finding,
            result.finding.id,
            true,
          );
          return result;
        }

        if (entityEdges.length > 0) {
          await uow.edgeRepo.createMany(
            entityEdges.map((e) => ({ ...e, findingId: result.finding.id })),
          );
        }

        await this.linkCycleEmission(
          uow,
          input.finding,
          result.finding.id,
          false,
        );

        return result;
      },
    );

    if (!inserted) {
      logger.debug(
        {
          findingId: String(finding.id),
          dedupHash,
          iteration: finding.iteration,
        },
        "Finding upserted (dedup hit, side effects skipped)",
      );
      return finding;
    }

    if (embedding) {
      try {
        const related = await this.findingRepo.findSimilar(embedding, 0.7, 5);
        const crossLinks = related
          .filter((r) => r.id !== finding.id && r.similarity < 0.92)
          .slice(0, 3);

        if (crossLinks.length > 0) {
          const linkEdges: NewResearchEdge[] = crossLinks.map((r) => ({
            findingId: finding.id,
            entityType: "finding",
            entityId: r.id,
            relation:
              r.similarity > 0.85
                ? ResearchRelation.Supports
                : ResearchRelation.SimilarTo,
            weight: r.similarity,
            context: {
              similarity: r.similarity,
              relatedTitle: r.title,
            },
          }));
          await this.edgeRepo.createMany(linkEdges);
          logger.info(
            {
              findingId: String(finding.id),
              crossLinks: crossLinks.length,
            },
            "Cross-linked to related findings",
          );
        }
      } catch (err) {
        logger.debug(
          { findingId: String(finding.id), err },
          "Cross-linking failed",
        );
      }
    }

    logger.info(
      {
        findingId: String(finding.id),
        cortex: input.finding.cortex,
        dedupHash,
      },
      "Finding stored",
    );

    for (const cb of this.onFindingStored) {
      try {
        await cb(finding);
      } catch (err) {
        logger.error(
          { findingId: String(finding.id), err },
          "Finding callback failed",
        );
      }
    }

    return finding;
  }

  private async linkCycleEmission(
    uow: ResearchGraphUnitOfWork,
    finding: StoreFindingInput["finding"],
    findingId: bigint,
    isDedupHit: boolean,
  ): Promise<void> {
    const linked = await uow.findingRepo.linkToCycle({
      cycleId: finding.researchCycleId,
      findingId,
      iteration: finding.iteration ?? 0,
      isDedupHit,
    });
    if (linked) {
      await uow.cycleRepo.incrementFindings(finding.researchCycleId);
    }
  }

  private embedderName(): string {
    const name = this.embedder.constructor?.name;
    return name && name !== "Object" ? name : "EmbedderPort";
  }
}
