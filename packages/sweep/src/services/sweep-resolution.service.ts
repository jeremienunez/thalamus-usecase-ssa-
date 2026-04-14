/**
 * Sweep Resolution Service — executes accepted sweep suggestions.
 *
 * Dispatches to per-kind handlers that perform DB mutations via SatelliteRepository.
 * Supports selectors for ambiguous cases (multiple payload/operator-country matches).
 * Post-resolution hooks: KG logging + kMultiplier proposals.
 */

import { randomUUID } from "node:crypto";
import { createLogger } from "@interview/shared/observability";
import { sql } from "drizzle-orm";
import { ResearchCortex } from "@interview/shared/enum";
import type { SatelliteRepository } from "../repositories/satellite.repository";
import type { SweepRepository } from "../repositories/sweep.repository";
import type {
  ResearchGraphService,
  StoreFindingInput,
} from "@interview/thalamus/services/research-graph.service";
import type { Database } from "@interview/db-schema";
import { sweepAudit, type NewSweepAudit } from "@interview/db-schema";
import {
  resolutionPayloadSchema,
  type ResolutionPayload,
  type ResolutionAction,
  type ResolutionResult,
  type PendingSelection,
  type UpdateFieldAction,
  type LinkPayloadAction,
  type UnlinkPayloadAction,
  type ReassignOperatorCountryAction,
  type EnrichAction,
} from "../transformers/sweep.dto";

const logger = createLogger("sweep-resolution");

export class SweepResolutionService {
  constructor(
    private satelliteRepo: SatelliteRepository,
    private sweepRepo: SweepRepository,
    private graphService: ResearchGraphService | null,
    private db: Database,
  ) {}

  setGraphService(gs: ResearchGraphService): void {
    this.graphService = gs;
  }

  /**
   * Resolve a suggestion: parse payload, dispatch handlers, store result.
   * @param selections — reviewer-provided values for ambiguous fields (2nd call)
   */
  async resolve(
    suggestionId: string,
    selections?: Record<string, string | number>,
  ): Promise<ResolutionResult> {
    // 1. Load suggestion from Redis
    const suggestion = await this.sweepRepo.getById(suggestionId);
    if (!suggestion) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Suggestion not found"],
      };
    }
    if (suggestion.accepted !== true) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Suggestion not accepted"],
      };
    }
    if (!suggestion.resolutionPayload) {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["No resolution payload"],
      };
    }

    // 2. Parse + validate payload
    let payload: ResolutionPayload;
    try {
      const raw = JSON.parse(suggestion.resolutionPayload);
      const parsed = resolutionPayloadSchema.safeParse(raw);
      if (!parsed.success) {
        return {
          status: "failed",
          affectedRows: 0,
          errors: [`Invalid payload: ${parsed.error.message}`],
        };
      }
      payload = parsed.data;
    } catch {
      return {
        status: "failed",
        affectedRows: 0,
        errors: ["Malformed payload JSON"],
      };
    }

    // 3. Dispatch each action
    let totalAffected = 0;
    const errors: string[] = [];
    const pendingSelections: PendingSelection[] = [];

    for (const action of payload.actions) {
      try {
        const result = await this.dispatchAction(
          action,
          suggestion.operatorCountryId,
          selections,
        );
        if (result.pending) {
          pendingSelections.push(...result.pending);
        }
        totalAffected += result.affected;
        if (result.errors) errors.push(...result.errors);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        errors.push(`${action.kind}: ${msg}`);
        logger.error({ err, action: action.kind }, "Resolution action failed");
      }
    }

    // 4. If selectors needed, return pending
    if (pendingSelections.length > 0 && !selections) {
      const result: ResolutionResult = {
        status: "pending_selection",
        affectedRows: 0,
        pendingSelections,
      };
      await this.sweepRepo.updateResolution(suggestionId, {
        status: "pending_selection",
        pendingSelections,
      });
      return result;
    }

    // 5. Compute final status
    const status: ResolutionResult["status"] =
      errors.length === 0
        ? "success"
        : totalAffected > 0
          ? "partial"
          : "failed";

    const result: ResolutionResult = {
      status,
      resolvedAt: new Date().toISOString(),
      affectedRows: totalAffected,
      errors: errors.length > 0 ? errors : undefined,
    };

    // 6. Store result in Redis
    await this.sweepRepo.updateResolution(suggestionId, {
      status: result.status,
      resolvedAt: result.resolvedAt,
      errors: result.errors,
    });

    // 7. Durable audit row — survives Redis TTL and feeds the feedback loop.
    //    Every mutation dispatched above is now linked to an immutable record
    //    with who/what/when/why and the full resolution payload.
    await this.writeAudit(suggestion, payload, result, totalAffected, errors);

    // 8. Post-hook: KG logging
    if (status !== "failed" && this.graphService) {
      await this.logToKnowledgeGraph(suggestion, payload, totalAffected);
    }

    logger.info(
      {
        suggestionId,
        status,
        affected: totalAffected,
        errors: errors.length,
      },
      "Resolution complete",
    );

    return result;
  }

  /**
   * Insert a durable sweep_audit row for this resolution. Non-fatal on
   * failure: the mutations already landed; missing an audit row must not
   * roll them back. The failure is logged for the oncall.
   */
  private async writeAudit(
    suggestion: Awaited<ReturnType<SweepRepository["getById"]>> & object,
    payload: ResolutionPayload,
    result: ResolutionResult,
    totalAffected: number,
    errors: string[],
  ): Promise<void> {
    try {
      const row: NewSweepAudit = {
        suggestionId: suggestion.id,
        operatorCountryId: suggestion.operatorCountryId
          ? BigInt(suggestion.operatorCountryId)
          : null,
        operatorCountryName: suggestion.operatorCountryName,
        category: suggestion.category,
        severity: suggestion.severity,
        title: suggestion.title,
        description: suggestion.description,
        suggestedAction: suggestion.suggestedAction,
        affectedSatellites: totalAffected,
        webEvidence: suggestion.webEvidence ?? null,
        accepted: suggestion.accepted ?? true,
        reviewerNote: suggestion.reviewerNote ?? null,
        reviewedAt: suggestion.reviewedAt
          ? new Date(suggestion.reviewedAt)
          : new Date(),
        resolutionStatus: result.status,
        resolutionPayload: payload as unknown as Record<string, unknown>,
        resolutionErrors: errors.length > 0 ? errors : null,
        resolvedAt: result.resolvedAt ? new Date(result.resolvedAt) : new Date(),
      };
      await this.db.insert(sweepAudit).values(row);
      logger.info(
        { suggestionId: suggestion.id, status: result.status },
        "Sweep audit row written",
      );
    } catch (err) {
      logger.error(
        {
          err,
          suggestionId: suggestion.id,
        },
        "Failed to write sweep_audit — mutations already landed, trail lost",
      );
    }
  }

  // ─── Action Dispatcher ──────────────────────────────────────

  private async dispatchAction(
    action: ResolutionAction,
    operatorCountryId: string | null,
    selections?: Record<string, string | number>,
  ): Promise<{
    affected: number;
    errors?: string[];
    pending?: PendingSelection[];
  }> {
    switch (action.kind) {
      case "update_field":
        return this.handleUpdateField(action, operatorCountryId, selections);
      case "link_payload":
        return this.handleLinkPayload(action, operatorCountryId, selections);
      case "unlink_payload":
        return this.handleUnlinkPayload(action, operatorCountryId);
      case "reassign_operator_country":
        return this.handleReassignOperatorCountry(
          action,
          operatorCountryId,
          selections,
        );
      case "enrich":
        return this.handleEnrich(action, operatorCountryId);
    }
  }

  // ─── Handlers ───────────────────────────────────────────────

  private async handleUpdateField(
    action: UpdateFieldAction,
    operatorCountryId: string | null,
    selections?: Record<string, string | number>,
  ): Promise<{
    affected: number;
    errors?: string[];
    pending?: PendingSelection[];
  }> {
    const { field, value } = action;

    // For FK fields, resolve name → id if value is a name string
    if (
      field === "operator_country_id" ||
      field === "orbit_regime_id" ||
      field === "platform_class_id"
    ) {
      if (selections?.[field]) {
        return this.updateSatellitesFk(
          operatorCountryId,
          action.satelliteIds,
          field,
          BigInt(selections[field]),
        );
      }
      return this.resolveAndUpdate(
        field,
        String(value),
        operatorCountryId,
        action.satelliteIds,
      );
    }

    // Direct value fields (mass_kg, launch_year)
    const fieldMap: Record<string, string> = {
      mass_kg: "massKg",
      launch_year: "launchYear",
    };
    const drizzleField = fieldMap[field] ?? field;
    return this.updateSatellitesScalar(
      operatorCountryId,
      action.satelliteIds,
      drizzleField,
      Number(value),
    );
  }

  private async handleLinkPayload(
    action: LinkPayloadAction,
    operatorCountryId: string | null,
    selections?: Record<string, string | number>,
  ): Promise<{
    affected: number;
    errors?: string[];
    pending?: PendingSelection[];
  }> {
    let payloadId: bigint | null = null;

    if (selections?.payload) {
      payloadId = BigInt(selections.payload);
    } else {
      const payloads = await this.findPayloadsByName(action.payloadName);
      if (payloads.length === 0) {
        return {
          affected: 0,
          errors: [`Payload not found: ${action.payloadName}`],
        };
      }
      if (payloads.length > 1) {
        return {
          affected: 0,
          pending: [
            {
              key: "payload",
              label: `Select payload: ${action.payloadName}`,
              options: payloads.map((p) => ({
                value: p.id.toString(),
                label: p.name,
                detail: `ID ${p.id}`,
              })),
            },
          ],
        };
      }
      payloadId = payloads[0].id;
    }

    const satelliteIds = await this.resolveSatelliteIds(
      action.satelliteIds,
      operatorCountryId,
    );
    if (satelliteIds.length === 0) {
      return { affected: 0, errors: ["No target satellites found"] };
    }

    let inserted = 0;
    for (const satelliteId of satelliteIds) {
      try {
        await this.db.execute(
          sql`INSERT INTO satellite_payload (satellite_id, payload_id, role)
              VALUES (${satelliteId}, ${payloadId}, ${action.role ?? null})
              ON CONFLICT (satellite_id, payload_id) DO NOTHING`,
        );
        inserted++;
      } catch (err) {
        logger.warn(
          { err, satelliteId, payloadId },
          "Failed to link payload",
        );
      }
    }

    return { affected: inserted };
  }

  private async handleUnlinkPayload(
    action: UnlinkPayloadAction,
    operatorCountryId: string | null,
  ): Promise<{ affected: number; errors?: string[] }> {
    const satelliteIds = await this.resolveSatelliteIds(
      action.satelliteIds,
      operatorCountryId,
    );
    if (satelliteIds.length === 0) {
      return { affected: 0, errors: ["No target satellites found"] };
    }

    // Find all payload variants matching the name that are actually linked
    const payloads = await this.findPayloadsByName(action.payloadName);
    if (payloads.length === 0) {
      return {
        affected: 0,
        errors: [`Payload not found: ${action.payloadName}`],
      };
    }
    const payloadIds = payloads.map((p) => p.id);

    // Delete all matching payload links for target satellites
    let deleted = 0;
    for (const satelliteId of satelliteIds) {
      for (const payloadId of payloadIds) {
        const result = await this.db.execute(
          sql`DELETE FROM satellite_payload WHERE satellite_id = ${satelliteId} AND payload_id = ${payloadId}`,
        );
        deleted += (result as { rowCount?: number }).rowCount ?? 0;
      }
    }

    return { affected: deleted };
  }

  private async handleReassignOperatorCountry(
    action: ReassignOperatorCountryAction,
    operatorCountryId: string | null,
    selections?: Record<string, string | number>,
  ): Promise<{
    affected: number;
    errors?: string[];
    pending?: PendingSelection[];
  }> {
    let targetOcId: bigint | null = null;

    if (selections?.operator_country) {
      targetOcId = BigInt(selections.operator_country);
    } else {
      const ocs = await this.findOperatorCountriesByName(action.toName);
      if (ocs.length === 0) {
        return {
          affected: 0,
          errors: [`Operator-country not found: ${action.toName}`],
        };
      }
      if (ocs.length > 1) {
        return {
          affected: 0,
          pending: [
            {
              key: "operator_country",
              label: `Select operator-country: ${action.toName}`,
              options: ocs.map((o) => ({
                value: o.id.toString(),
                label: o.name,
                detail: o.orbitRegime ?? undefined,
              })),
            },
          ],
        };
      }
      targetOcId = ocs[0].id;
    }

    const satelliteIds = await this.resolveSatelliteIds(
      action.satelliteIds,
      operatorCountryId,
    );
    if (satelliteIds.length === 0) {
      return { affected: 0, errors: ["No target satellites found"] };
    }

    let updated = 0;
    for (const satelliteId of satelliteIds) {
      const result = await this.db.execute(
        sql`UPDATE satellite SET operator_country_id = ${targetOcId}, updated_at = NOW()
            WHERE id = ${satelliteId}`,
      );
      if ((result as { rowCount?: number }).rowCount ?? 0 > 0) updated++;
    }

    return { affected: updated };
  }

  private async handleEnrich(
    action: EnrichAction,
    operatorCountryId: string | null,
  ): Promise<{ affected: number; errors?: string[] }> {
    const satelliteIds = await this.resolveSatelliteIds(
      action.satelliteIds,
      operatorCountryId,
    );
    if (satelliteIds.length === 0) {
      return { affected: 0, errors: ["No target satellites found"] };
    }

    try {
      const { satelliteQueue } = await import("../jobs/queues");
      for (const satelliteId of satelliteIds) {
        await satelliteQueue.add(
          "enrich-satellite",
          { satelliteId: satelliteId.toString() },
          {
            attempts: 3,
            backoff: { type: "exponential", delay: 5000 },
          },
        );
      }
      return { affected: satelliteIds.length };
    } catch (err) {
      return {
        affected: 0,
        errors: [`Failed to queue enrichment: ${(err as Error).message}`],
      };
    }
  }

  // ─── Helpers ────────────────────────────────────────────────

  private async resolveSatelliteIds(
    explicitIds: string[],
    operatorCountryId: string | null,
  ): Promise<bigint[]> {
    if (explicitIds.length > 0) {
      return explicitIds.map((id) => BigInt(id));
    }
    if (!operatorCountryId) return [];

    const rows = await this.db.execute(
      sql`SELECT id FROM satellite WHERE operator_country_id = ${BigInt(operatorCountryId)}`,
    );
    return ((rows as unknown as { rows: { id: bigint }[] }).rows ?? []).map(
      (r) => r.id,
    );
  }

  private async findPayloadsByName(
    name: string,
  ): Promise<Array<{ id: bigint; name: string }>> {
    const rows = await this.db.execute(
      sql`SELECT id, name FROM payload
          WHERE lower(unaccent(name)) LIKE '%' || lower(unaccent(${name})) || '%'
          ORDER BY CASE WHEN lower(name) = lower(${name}) THEN 0 ELSE 1 END, name
          LIMIT 10`,
    );
    return (
      (rows as unknown as { rows: Array<{ id: bigint; name: string }> }).rows ??
      []
    );
  }

  private async findOperatorCountriesByName(
    name: string,
  ): Promise<
    Array<{ id: bigint; name: string; orbitRegime: string | null }>
  > {
    const rows = await this.db.execute(
      sql`SELECT oc.id, oc.name, orb.name as "orbitRegime"
          FROM operator_country oc
          LEFT JOIN orbit_regime orb ON orb.id = oc.orbit_regime_id
          WHERE lower(unaccent(oc.name)) LIKE '%' || lower(unaccent(${name})) || '%'
          ORDER BY CASE WHEN lower(oc.name) = lower(${name}) THEN 0 ELSE 1 END, oc.name
          LIMIT 10`,
    );
    return (
      (
        rows as unknown as {
          rows: Array<{ id: bigint; name: string; orbitRegime: string | null }>;
        }
      ).rows ?? []
    );
  }

  /**
   * Update a scalar field on satellites (mass_kg, launchYear).
   */
  private async updateSatellitesScalar(
    operatorCountryId: string | null,
    explicitSatelliteIds: string[],
    field: string,
    value: number,
  ): Promise<{ affected: number; errors?: string[] }> {
    const satelliteIds = await this.resolveSatelliteIds(
      explicitSatelliteIds,
      operatorCountryId,
    );
    if (satelliteIds.length === 0) {
      return { affected: 0, errors: ["No target satellites found"] };
    }

    let updated = 0;
    for (const satelliteId of satelliteIds) {
      const ok = await this.satelliteRepo.update(satelliteId, {
        [field]: value,
      } as never);
      if (ok) updated++;
    }
    return { affected: updated };
  }

  /**
   * Update a FK field on satellites via raw SQL.
   */
  private async updateSatellitesFk(
    operatorCountryId: string | null,
    explicitSatelliteIds: string[],
    field: string,
    value: bigint,
  ): Promise<{ affected: number; errors?: string[] }> {
    const satelliteIds = await this.resolveSatelliteIds(
      explicitSatelliteIds,
      operatorCountryId,
    );
    if (satelliteIds.length === 0) {
      return { affected: 0, errors: ["No target satellites found"] };
    }

    const column =
      field === "operator_country_id"
        ? "operator_country_id"
        : field === "orbit_regime_id"
          ? "orbit_regime_id"
          : "platform_class_id";

    let updated = 0;
    for (const satelliteId of satelliteIds) {
      const result = await this.db.execute(
        sql`UPDATE satellite SET ${sql.identifier(column)} = ${value}, updated_at = NOW()
            WHERE id = ${satelliteId}`,
      );
      if ((result as { rowCount?: number }).rowCount ?? 0 > 0) updated++;
    }
    return { affected: updated };
  }

  /**
   * Resolve an FK field name → id, returning selector if ambiguous.
   */
  private async resolveAndUpdate(
    field: string,
    valueName: string,
    operatorCountryId: string | null,
    explicitSatelliteIds: string[],
  ): Promise<{
    affected: number;
    errors?: string[];
    pending?: PendingSelection[];
  }> {
    if (field === "operator_country_id") {
      const ocs = await this.findOperatorCountriesByName(valueName);
      if (ocs.length === 0)
        return {
          affected: 0,
          errors: [`Operator-country not found: ${valueName}`],
        };
      if (ocs.length > 1) {
        return {
          affected: 0,
          pending: [
            {
              key: "operator_country_id",
              label: `Select operator-country: ${valueName}`,
              options: ocs.map((o) => ({
                value: o.id.toString(),
                label: o.name,
                detail: o.orbitRegime ?? undefined,
              })),
            },
          ],
        };
      }
      return this.updateSatellitesFk(
        operatorCountryId,
        explicitSatelliteIds,
        field,
        ocs[0].id,
      );
    }

    // orbit_regime_id, platform_class_id — simple lookup
    const table =
      field === "orbit_regime_id" ? "orbit_regime" : "platform_class";
    const rows = await this.db.execute(
      sql`SELECT id, name FROM ${sql.identifier(table)}
          WHERE lower(unaccent(name)) = lower(unaccent(${valueName}))
          LIMIT 5`,
    );
    const matches =
      (rows as unknown as { rows: Array<{ id: bigint; name: string }> }).rows ??
      [];
    if (matches.length === 0)
      return { affected: 0, errors: [`${table} not found: ${valueName}`] };
    if (matches.length > 1) {
      return {
        affected: 0,
        pending: [
          {
            key: field,
            label: `Select: ${valueName}`,
            options: matches.map((m) => ({
              value: m.id.toString(),
              label: m.name,
            })),
          },
        ],
      };
    }
    return this.updateSatellitesFk(
      operatorCountryId,
      explicitSatelliteIds,
      field,
      matches[0].id,
    );
  }

  // ─── KG Logging ─────────────────────────────────────────────

  private async logToKnowledgeGraph(
    suggestion: {
      id: string;
      operatorCountryName: string;
      category: string;
      title: string;
    },
    payload: ResolutionPayload,
    affectedRows: number,
  ): Promise<void> {
    if (!this.graphService) return;

    try {
      const summary = payload.actions
        .map(
          (a) => `${a.kind}${a.kind === "update_field" ? `:${a.field}` : ""}`,
        )
        .join(", ");

      await this.graphService.storeFinding({
        finding: {
          cortex: ResearchCortex.DataAuditor,
          findingType: "anomaly",
          title: `[Sweep Resolution] ${suggestion.title}`,
          summary: `Resolved ${affectedRows} satellite(s) in ${suggestion.operatorCountryName}: ${summary}`,
          confidence: 1.0,
          sourceUrls: [],
          evidence: { resolution: true, suggestionId: suggestion.id },
          researchCycleId: randomUUID(),
          metadata: {
            suggestionId: suggestion.id,
            category: suggestion.category,
            actions: payload.actions.map((a) => a.kind),
            affectedRows,
          },
        },
        edges: [],
      } as unknown as StoreFindingInput);
    } catch (err) {
      logger.warn({ err }, "Failed to log resolution to KG");
    }
  }
}
