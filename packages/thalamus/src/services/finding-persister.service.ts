/**
 * Finding Persister — Writes cortex findings into the research knowledge graph.
 *
 * Extracted from `ThalamusService.runCycle` to uphold SRP. Owns the
 * store loop, cortex resolution and TTL policy for research findings.
 */

import { createLogger } from "@interview/shared/observability";
import {
  ResearchRelation,
  ResearchStatus,
} from "@interview/shared/enum";
import type { CortexFinding } from "../cortices/types";
import type { ResearchGraphService } from "./research-graph.service";
import type { DAGPlan } from "./thalamus-planner.service";

const logger = createLogger("finding-persister");

export interface PersistContext {
  cycleId: bigint;
  iteration: number;
  plan: DAGPlan;
  entityOverride?: { entityType: string; entityId: bigint };
}

export class FindingPersister {
  constructor(private graphService: ResearchGraphService) {}

  /**
   * Persist each finding into the knowledge graph.
   * Errors are swallowed per-finding (logged) so one bad row can't sink
   * a whole cycle — matches the original `runCycle` behaviour.
   * Returns the number of findings actually stored.
   */
  async persist(
    findings: CortexFinding[],
    ctx: PersistContext,
  ): Promise<number> {
    let storedCount = 0;

    for (const finding of findings) {
      try {
        await this.graphService.storeFinding({
          finding: {
            cortex: findingCortex(finding, ctx.plan),
            findingType: finding.findingType,
            title: finding.title,
            summary: finding.summary,
            evidence: finding.evidence,
            reasoning: null,
            confidence: finding.confidence,
            impactScore: finding.impactScore,
            urgency: finding.urgency,
            extensions: finding.extensions ?? null,
            researchCycleId: ctx.cycleId,
            reflexionNotes: null,
            iteration: ctx.iteration,
            status: ResearchStatus.Active,
            expiresAt: computeTTL(finding.confidence),
          },
          edges: ctx.entityOverride
            ? [
                {
                  entityType: ctx.entityOverride.entityType,
                  entityId: ctx.entityOverride.entityId,
                  relation: ResearchRelation.About,
                  weight: 1.0,
                  context: null,
                },
              ]
            : finding.edges.map((e) => ({
                entityType: e.entityType,
                entityId: BigInt(e.entityId),
                relation: e.relation as ResearchRelation,
                weight: 1.0,
                context: e.context ?? null,
              })),
        });
        storedCount++;
      } catch (err) {
        logger.error(
          { finding: finding.title, err },
          "Failed to store finding",
        );
      }
    }

    return storedCount;
  }
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Derive which cortex produced a finding.
 * Preferred source is `finding.sourceCortex` stamped by `normalizeFinding`.
 * Falls back to the plan's first node when the finding wasn't stamped —
 * shouldn't happen in normal pipeline runs but keeps parsing robust for
 * older persisted objects / tests. Final fallback is a neutral sentinel
 * string; the domain is responsible for registering valid cortex names
 * upstream (pg enum validates at write time).
 */
function findingCortex(finding: CortexFinding, plan: DAGPlan): string {
  const stamped = finding.sourceCortex;
  if (stamped && stamped.length > 0) return stamped;
  const first = plan.nodes[0]?.cortex;
  if (first && first.length > 0) return first;
  return "unknown";
}

/**
 * TTL based on confidence:
 * - confidence < 0.5 → 14 days
 * - confidence 0.5-0.7 → 30 days
 * - confidence 0.7-0.85 → 60 days
 * - confidence > 0.85 → 90 days
 */
function computeTTL(confidence: number): Date {
  const days =
    confidence < 0.5 ? 14 : confidence < 0.7 ? 30 : confidence < 0.85 ? 60 : 90;
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
