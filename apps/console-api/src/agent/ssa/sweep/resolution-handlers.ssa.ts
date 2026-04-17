/**
 * SSA resolution handlers — lifted verbatim from
 * packages/sweep/src/services/sweep-resolution.service.ts:290-776.
 *
 * Five handlers, one ResolutionHandler each, behind the ResolutionHandlerRegistry
 * port. The sweep-resolution engine (Task 2.3) will dispatch action.kind → handler.
 *
 * Dep shape temporarily uses the sweep-side SatelliteRepository — Phase 4
 * swaps it for SatelliteAuditService once the 8 audit methods fold in.
 *
 * The onSimUpdateAccepted hook stays on the legacy sweep container path
 * until Plan 2 consolidates sim source-class promotion.
 */

import { randomUUID as _ignoreUnused } from "node:crypto";
import { sql } from "drizzle-orm";
import type { Database } from "@interview/db-schema";
import type { SatelliteRepository } from "@interview/sweep";
import type {
  ResolutionHandler,
  ResolutionHandlerRegistry,
  ResolutionHandlerResult,
  ResolutionActionContext,
  ResolutionPendingSelection,
} from "@interview/sweep";
import type {
  UpdateFieldAction,
  LinkPayloadAction,
  UnlinkPayloadAction,
  ReassignOperatorCountryAction,
  EnrichAction,
} from "@interview/sweep";

/** Avoid "unused import" TS6133 on the helper surface. */
void _ignoreUnused;

export type OnSimUpdateAccepted = (event: {
  satelliteId: bigint;
  field: string;
  value: number;
  swarmId: number | null;
  priorSourceClass: string;
  nextSourceClass: string;
}) => Promise<void>;

export interface SsaHandlerDeps {
  db: Database;
  satelliteRepo: SatelliteRepository;
  /**
   * Optional sim-provenance callback. When set, the update_field handler
   * fires it for sim_swarm_telemetry-sourced suggestions (matches legacy
   * sweep-resolution.service behavior). When null in Plan 1 wiring, the
   * legacy sweepContainer.setOnSimUpdateAccepted hook keeps firing.
   */
  onSimUpdateAccepted?: OnSimUpdateAccepted | null;
  /**
   * Optional BullMQ queue for enrichment jobs. The `enrich` handler adds
   * satelliteId jobs here. When omitted, enrich returns a non-fatal error.
   */
  satelliteEnrichmentQueue?: {
    add: (name: string, data: unknown, opts?: unknown) => Promise<unknown>;
  } | null;
}

// ─── Shared helpers ──────────────────────────────────────────────

async function resolveSatelliteIds(
  db: Database,
  explicitIds: string[],
  operatorCountryId: string | null,
): Promise<bigint[]> {
  if (explicitIds.length > 0) {
    return explicitIds.map((id) => BigInt(id));
  }
  if (!operatorCountryId) return [];
  const result = await db.execute<{ id: bigint }>(
    sql`SELECT id FROM satellite WHERE operator_country_id = ${BigInt(operatorCountryId)}`,
  );
  return (result.rows ?? []).map((r) => r.id);
}

async function findPayloadsByName(
  db: Database,
  name: string,
): Promise<Array<{ id: bigint; name: string }>> {
  const result = await db.execute<{ id: bigint; name: string }>(
    sql`SELECT id, name FROM payload
        WHERE lower(unaccent(name)) LIKE '%' || lower(unaccent(${name})) || '%'
        ORDER BY CASE WHEN lower(name) = lower(${name}) THEN 0 ELSE 1 END, name
        LIMIT 10`,
  );
  return result.rows ?? [];
}

async function findOperatorCountriesByName(
  db: Database,
  name: string,
): Promise<Array<{ id: bigint; name: string; orbitRegime: string | null }>> {
  const result = await db.execute<{
    id: bigint;
    name: string;
    orbitRegime: string | null;
  }>(
    sql`SELECT oc.id, oc.name, orb.name as "orbitRegime"
        FROM operator_country oc
        LEFT JOIN orbit_regime orb ON orb.id = oc.orbit_regime_id
        WHERE lower(unaccent(oc.name)) LIKE '%' || lower(unaccent(${name})) || '%'
        ORDER BY CASE WHEN lower(oc.name) = lower(${name}) THEN 0 ELSE 1 END, oc.name
        LIMIT 10`,
  );
  return result.rows ?? [];
}

async function updateSatellitesScalar(
  deps: SsaHandlerDeps,
  operatorCountryId: string | null,
  explicitSatelliteIds: string[],
  field: string,
  value: number,
): Promise<{ affectedRows: number; errors?: string[] }> {
  const satelliteIds = await resolveSatelliteIds(
    deps.db,
    explicitSatelliteIds,
    operatorCountryId,
  );
  if (satelliteIds.length === 0) {
    return { affectedRows: 0, errors: ["No target satellites found"] };
  }
  let updated = 0;
  for (const satelliteId of satelliteIds) {
    const ok = await deps.satelliteRepo.update(satelliteId, {
      [field]: value,
    } as never);
    if (ok) updated++;
  }
  return { affectedRows: updated };
}

async function updateSatellitesFk(
  deps: SsaHandlerDeps,
  operatorCountryId: string | null,
  explicitSatelliteIds: string[],
  field: string,
  value: bigint,
): Promise<{ affectedRows: number; errors?: string[] }> {
  const satelliteIds = await resolveSatelliteIds(
    deps.db,
    explicitSatelliteIds,
    operatorCountryId,
  );
  if (satelliteIds.length === 0) {
    return { affectedRows: 0, errors: ["No target satellites found"] };
  }

  const column =
    field === "operator_country_id"
      ? "operator_country_id"
      : field === "orbit_regime_id"
        ? "orbit_regime_id"
        : "platform_class_id";

  let updated = 0;
  for (const satelliteId of satelliteIds) {
    const result = await deps.db.execute(
      sql`UPDATE satellite SET ${sql.identifier(column)} = ${value}, updated_at = NOW()
          WHERE id = ${satelliteId}`,
    );
    if ((result as { rowCount?: number }).rowCount ?? 0 > 0) updated++;
  }
  return { affectedRows: updated };
}

async function resolveAndUpdate(
  deps: SsaHandlerDeps,
  field: string,
  valueName: string,
  operatorCountryId: string | null,
  explicitSatelliteIds: string[],
): Promise<{
  affectedRows: number;
  errors?: string[];
  pending?: ResolutionPendingSelection[];
}> {
  if (field === "operator_country_id") {
    const ocs = await findOperatorCountriesByName(deps.db, valueName);
    if (ocs.length === 0) {
      return {
        affectedRows: 0,
        errors: [`Operator-country not found: ${valueName}`],
      };
    }
    if (ocs.length > 1) {
      return {
        affectedRows: 0,
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
    return updateSatellitesFk(
      deps,
      operatorCountryId,
      explicitSatelliteIds,
      field,
      ocs[0]!.id,
    );
  }

  const table =
    field === "orbit_regime_id" ? "orbit_regime" : "platform_class";
  const result = await deps.db.execute<{ id: bigint; name: string }>(
    sql`SELECT id, name FROM ${sql.identifier(table)}
        WHERE lower(unaccent(name)) = lower(unaccent(${valueName}))
        LIMIT 5`,
  );
  const matches = result.rows ?? [];
  if (matches.length === 0) {
    return { affectedRows: 0, errors: [`${table} not found: ${valueName}`] };
  }
  if (matches.length > 1) {
    return {
      affectedRows: 0,
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
  return updateSatellitesFk(
    deps,
    operatorCountryId,
    explicitSatelliteIds,
    field,
    matches[0]!.id,
  );
}

// ─── Handlers ────────────────────────────────────────────────────

function asResolutionResult(r: {
  affectedRows: number;
  errors?: string[];
  pending?: ResolutionPendingSelection[];
}): ResolutionHandlerResult {
  const ok = (r.errors?.length ?? 0) === 0 && (r.pending?.length ?? 0) === 0;
  return {
    ok,
    affectedRows: r.affectedRows,
    ...(r.errors?.length ? { errors: r.errors } : {}),
    ...(r.pending?.length ? { pending: r.pending } : {}),
  };
}

function operatorCountryIdFrom(ctx: ResolutionActionContext): string | null {
  const raw = ctx.domainContext?.operatorCountryId;
  if (raw == null) return null;
  return String(raw);
}

function selectorsFrom(
  ctx: ResolutionActionContext,
): Record<string, string | number> | undefined {
  const s = ctx.selectors;
  if (!s) return undefined;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(s)) {
    if (typeof v === "string" || typeof v === "number") out[k] = v;
  }
  return out;
}

export function createUpdateFieldHandler(
  deps: SsaHandlerDeps,
): ResolutionHandler {
  return {
    kind: "update_field",
    async handle(action, ctx): Promise<ResolutionHandlerResult> {
      const a = action as unknown as UpdateFieldAction;
      const operatorCountryId = operatorCountryIdFrom(ctx);
      const selections = selectorsFrom(ctx);
      const { field, value } = a;

      // nullScan payloads emit value=null — the reviewer acknowledged the
      // gap but we don't have a source value yet. Audit row is still
      // written by the engine's promotion step.
      if (value === null || value === undefined) {
        return { ok: true, affectedRows: 0 };
      }

      // FK fields: resolve name → id if value is a name string.
      if (
        field === "operator_country_id" ||
        field === "orbit_regime_id" ||
        field === "platform_class_id"
      ) {
        if (selections?.[field]) {
          const r = await updateSatellitesFk(
            deps,
            operatorCountryId,
            a.satelliteIds,
            field,
            BigInt(selections[field]!),
          );
          return asResolutionResult(r);
        }
        const r = await resolveAndUpdate(
          deps,
          field,
          String(value),
          operatorCountryId,
          a.satelliteIds,
        );
        return asResolutionResult(r);
      }

      // Direct value fields: scalar + telemetry scalars (sim-swarm inference).
      const fieldMap: Record<string, string> = {
        mass_kg: "massKg",
        launch_year: "launchYear",
        power_draw: "powerDraw",
        thermal_margin: "thermalMargin",
        pointing_accuracy: "pointingAccuracy",
        attitude_rate: "attitudeRate",
        link_budget: "linkBudget",
        data_rate: "dataRate",
        payload_duty: "payloadDuty",
        eclipse_ratio: "eclipseRatio",
      };
      const drizzleField = fieldMap[field] ?? field;
      const result = await updateSatellitesScalar(
        deps,
        operatorCountryId,
        a.satelliteIds,
        drizzleField,
        Number(value),
      );

      // Sim-provenance post-hook. Non-fatal.
      const provenance = (
        a as {
          provenance?: {
            source?: string;
            swarmId?: number;
            sourceClass?: string;
          };
        }
      ).provenance;
      if (
        result.affectedRows > 0 &&
        provenance?.source === "sim_swarm_telemetry" &&
        deps.onSimUpdateAccepted
      ) {
        const targetIds = await resolveSatelliteIds(
          deps.db,
          a.satelliteIds,
          operatorCountryId,
        );
        for (const satId of targetIds) {
          try {
            await deps.onSimUpdateAccepted({
              satelliteId: satId,
              field,
              value: Number(value),
              swarmId: provenance.swarmId ?? null,
              priorSourceClass:
                provenance.sourceClass ?? "SIM_UNCORROBORATED",
              nextSourceClass: "OSINT_CORROBORATED",
            });
          } catch {
            // Mirrors legacy: UPDATE stands regardless.
          }
        }
      }

      return asResolutionResult(result);
    },
  };
}

export function createLinkPayloadHandler(
  deps: SsaHandlerDeps,
): ResolutionHandler {
  return {
    kind: "link_payload",
    async handle(action, ctx): Promise<ResolutionHandlerResult> {
      const a = action as unknown as LinkPayloadAction;
      const operatorCountryId = operatorCountryIdFrom(ctx);
      const selections = selectorsFrom(ctx);

      let payloadId: bigint | null = null;
      if (selections?.payload) {
        payloadId = BigInt(selections.payload);
      } else {
        const payloads = await findPayloadsByName(deps.db, a.payloadName);
        if (payloads.length === 0) {
          return asResolutionResult({
            affectedRows: 0,
            errors: [`Payload not found: ${a.payloadName}`],
          });
        }
        if (payloads.length > 1) {
          return asResolutionResult({
            affectedRows: 0,
            pending: [
              {
                key: "payload",
                label: `Select payload: ${a.payloadName}`,
                options: payloads.map((p) => ({
                  value: p.id.toString(),
                  label: p.name,
                  detail: `ID ${p.id}`,
                })),
              },
            ],
          });
        }
        payloadId = payloads[0]!.id;
      }

      const satelliteIds = await resolveSatelliteIds(
        deps.db,
        a.satelliteIds,
        operatorCountryId,
      );
      if (satelliteIds.length === 0) {
        return asResolutionResult({
          affectedRows: 0,
          errors: ["No target satellites found"],
        });
      }

      let inserted = 0;
      for (const satelliteId of satelliteIds) {
        try {
          await deps.db.execute(
            sql`INSERT INTO satellite_payload (satellite_id, payload_id, role)
                VALUES (${satelliteId}, ${payloadId}, ${a.role ?? null})
                ON CONFLICT (satellite_id, payload_id) DO NOTHING`,
          );
          inserted++;
        } catch {
          // Non-fatal per-row — log is handled by upstream engine.
        }
      }
      return asResolutionResult({ affectedRows: inserted });
    },
  };
}

export function createUnlinkPayloadHandler(
  deps: SsaHandlerDeps,
): ResolutionHandler {
  return {
    kind: "unlink_payload",
    async handle(action, ctx): Promise<ResolutionHandlerResult> {
      const a = action as unknown as UnlinkPayloadAction;
      const operatorCountryId = operatorCountryIdFrom(ctx);

      const satelliteIds = await resolveSatelliteIds(
        deps.db,
        a.satelliteIds,
        operatorCountryId,
      );
      if (satelliteIds.length === 0) {
        return asResolutionResult({
          affectedRows: 0,
          errors: ["No target satellites found"],
        });
      }

      const payloads = await findPayloadsByName(deps.db, a.payloadName);
      if (payloads.length === 0) {
        return asResolutionResult({
          affectedRows: 0,
          errors: [`Payload not found: ${a.payloadName}`],
        });
      }
      const payloadIds = payloads.map((p) => p.id);

      let deleted = 0;
      for (const satelliteId of satelliteIds) {
        for (const payloadId of payloadIds) {
          const result = await deps.db.execute(
            sql`DELETE FROM satellite_payload WHERE satellite_id = ${satelliteId} AND payload_id = ${payloadId}`,
          );
          deleted += (result as { rowCount?: number }).rowCount ?? 0;
        }
      }
      return asResolutionResult({ affectedRows: deleted });
    },
  };
}

export function createReassignOperatorCountryHandler(
  deps: SsaHandlerDeps,
): ResolutionHandler {
  return {
    kind: "reassign_operator_country",
    async handle(action, ctx): Promise<ResolutionHandlerResult> {
      const a = action as unknown as ReassignOperatorCountryAction;
      const operatorCountryId = operatorCountryIdFrom(ctx);
      const selections = selectorsFrom(ctx);

      let targetOcId: bigint | null = null;
      if (selections?.operator_country) {
        targetOcId = BigInt(selections.operator_country);
      } else {
        const ocs = await findOperatorCountriesByName(deps.db, a.toName);
        if (ocs.length === 0) {
          return asResolutionResult({
            affectedRows: 0,
            errors: [`Operator-country not found: ${a.toName}`],
          });
        }
        if (ocs.length > 1) {
          return asResolutionResult({
            affectedRows: 0,
            pending: [
              {
                key: "operator_country",
                label: `Select operator-country: ${a.toName}`,
                options: ocs.map((o) => ({
                  value: o.id.toString(),
                  label: o.name,
                  detail: o.orbitRegime ?? undefined,
                })),
              },
            ],
          });
        }
        targetOcId = ocs[0]!.id;
      }

      const satelliteIds = await resolveSatelliteIds(
        deps.db,
        a.satelliteIds,
        operatorCountryId,
      );
      if (satelliteIds.length === 0) {
        return asResolutionResult({
          affectedRows: 0,
          errors: ["No target satellites found"],
        });
      }

      let updated = 0;
      for (const satelliteId of satelliteIds) {
        const result = await deps.db.execute(
          sql`UPDATE satellite SET operator_country_id = ${targetOcId}, updated_at = NOW()
              WHERE id = ${satelliteId}`,
        );
        if ((result as { rowCount?: number }).rowCount ?? 0 > 0) updated++;
      }
      return asResolutionResult({ affectedRows: updated });
    },
  };
}

export function createEnrichHandler(deps: SsaHandlerDeps): ResolutionHandler {
  return {
    kind: "enrich",
    async handle(action, ctx): Promise<ResolutionHandlerResult> {
      const a = action as unknown as EnrichAction;
      const operatorCountryId = operatorCountryIdFrom(ctx);

      const satelliteIds = await resolveSatelliteIds(
        deps.db,
        a.satelliteIds,
        operatorCountryId,
      );
      if (satelliteIds.length === 0) {
        return asResolutionResult({
          affectedRows: 0,
          errors: ["No target satellites found"],
        });
      }

      if (!deps.satelliteEnrichmentQueue) {
        return asResolutionResult({
          affectedRows: 0,
          errors: ["Enrichment queue not wired"],
        });
      }

      try {
        for (const satelliteId of satelliteIds) {
          await deps.satelliteEnrichmentQueue.add(
            "enrich-satellite",
            { satelliteId: satelliteId.toString() },
            {
              attempts: 3,
              backoff: { type: "exponential", delay: 5000 },
            },
          );
        }
        return asResolutionResult({ affectedRows: satelliteIds.length });
      } catch (err) {
        return asResolutionResult({
          affectedRows: 0,
          errors: [`Failed to queue enrichment: ${(err as Error).message}`],
        });
      }
    },
  };
}

// ─── Registry factory ─────────────────────────────────────────────

export function createSsaResolutionRegistry(
  deps: SsaHandlerDeps,
): ResolutionHandlerRegistry {
  const handlers: Record<string, ResolutionHandler> = {
    update_field: createUpdateFieldHandler(deps),
    link_payload: createLinkPayloadHandler(deps),
    unlink_payload: createUnlinkPayloadHandler(deps),
    reassign_operator_country: createReassignOperatorCountryHandler(deps),
    enrich: createEnrichHandler(deps),
  };
  return {
    get: (k) => handlers[k],
    list: () => Object.values(handlers),
  };
}
