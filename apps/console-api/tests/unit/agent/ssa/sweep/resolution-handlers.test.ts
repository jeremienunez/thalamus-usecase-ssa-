import { describe, it, expect, vi } from "vitest";
import type { ResolutionActionContext } from "@interview/sweep";
import { fakePort, typedSpy } from "@interview/test-kit";
import {
  createUpdateFieldHandler,
  createLinkPayloadHandler,
  createUnlinkPayloadHandler,
  createReassignOperatorCountryHandler,
  createEnrichHandler,
  createSsaResolutionRegistry,
  type SsaHandlerDeps,
} from "../../../../../src/agent/ssa/sweep/resolution-handlers.ssa";

function fakeDb() {
  const executeSpy = vi.fn(
    async (
      _query: unknown,
    ): Promise<{ rows?: Record<string, unknown>[]; rowCount?: number }> => ({
    rows: [] as Record<string, unknown>[],
    rowCount: 0,
    }),
  );
  return {
    db: {
      execute: async <
        T extends Record<string, unknown> = Record<string, unknown>,
      >(query: unknown) => {
        const result = await executeSpy(query);
        return {
          ...(result.rows === undefined
            ? {}
            : { rows: result.rows as T[] }),
          rowCount: result.rowCount ?? undefined,
        };
      },
    } satisfies SsaHandlerDeps["db"],
    executeSpy,
  };
}

function fakeSatelliteRepo() {
  const updateFieldSpy = typedSpy<
    SsaHandlerDeps["satelliteRepo"]["updateField"]
  >().mockResolvedValue(undefined);
  return {
    satelliteRepo: fakePort<SsaHandlerDeps["satelliteRepo"]>({
      updateField: updateFieldSpy,
    }),
    updateFieldSpy,
  };
}

function baseCtx(
  domain: Record<string, unknown> = {},
): ResolutionActionContext {
  return {
    suggestionId: "sugg-1",
    reviewer: null as string | null,
    reviewerNote: null as string | null,
    domainContext: { operatorCountryId: "42", ...domain },
  };
}

describe("update_field handler", () => {
  it("calls satelliteRepo.update for a scalar field and reports affectedRows", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({
      rows: [{ id: 7n }, { id: 8n }],
      rowCount: 2,
    });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "mass_kg",
        value: 150,
        satelliteIds: [],
      },
      baseCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.affectedRows).toBe(2);
    expect(satelliteRepo.updateFieldSpy).toHaveBeenCalledTimes(2);
    // updateField(id, field, value) — field name maps mass_kg → massKg
    // via the handler's fieldMap lookup.
    expect(satelliteRepo.updateFieldSpy.mock.calls[0]?.[1]).toBe("massKg");
    expect(satelliteRepo.updateFieldSpy.mock.calls[0]?.[2]).toBe(150);
  });

  it("returns ok with affectedRows=0 when value is null (nullScan acknowledgement)", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "mass_kg",
        value: null,
        satelliteIds: [],
      },
      baseCtx(),
    );

    expect(result.ok).toBe(true);
    expect(result.affectedRows).toBe(0);
    expect(satelliteRepo.updateFieldSpy).not.toHaveBeenCalled();
    expect(db.executeSpy).not.toHaveBeenCalled();
  });

  it("fires onSimUpdateAccepted hook for sim_swarm_telemetry provenance", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const onSimUpdateAccepted = vi.fn().mockResolvedValue(undefined);
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
      onSimUpdateAccepted,
    });

    // Two lookups: resolveSatelliteIds (within updateSatellitesScalar) + the
    // re-resolve inside the sim-provenance block.
    db.executeSpy.mockResolvedValue({
      rows: [{ id: 99n }],
      rowCount: 1,
    });

    await handler.handle(
      {
        kind: "update_field",
        field: "power_draw",
        value: 450,
        satelliteIds: [],
        provenance: { source: "sim_swarm_telemetry", swarmId: 5 },
      },
      baseCtx(),
    );

    expect(onSimUpdateAccepted).toHaveBeenCalledTimes(1);
    expect(onSimUpdateAccepted.mock.calls[0]?.[0]).toMatchObject({
      field: "power_draw",
      value: 450,
      swarmId: 5,
      priorSourceClass: "SIM_UNCORROBORATED",
      nextSourceClass: "OSINT_CORROBORATED",
    });
  });

  it("uses a preselected FK target instead of reopening name resolution", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "operator_country_id",
        value: "France",
        satelliteIds: ["100"],
      },
      {
        ...baseCtx(),
        selectors: { operator_country_id: "20" },
      },
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(db.executeSpy).toHaveBeenCalledTimes(1);
    expect(satelliteRepo.updateFieldSpy).not.toHaveBeenCalled();
  });

  it("returns a no-target error when no explicit ids and no operator-country target exist", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "mass_kg",
        value: 150,
        satelliteIds: [],
      },
      baseCtx({ operatorCountryId: null }),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["No target satellites found"],
    });
    expect(db.executeSpy).not.toHaveBeenCalled();
    expect(satelliteRepo.updateFieldSpy).not.toHaveBeenCalled();
  });

  it("treats an operator-country lookup with no returned rows array as no target satellites", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "mass_kg",
        value: 150,
        satelliteIds: [],
      },
      baseCtx(),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["No target satellites found"],
    });
  });

  it("keeps the raw field name when no scalar mapping exists", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "custom_numeric_field",
        value: 7,
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(satelliteRepo.updateFieldSpy).toHaveBeenCalledWith(
      100n,
      "custom_numeric_field",
      7,
    );
  });

  it("counts only successful scalar updates when one satellite write fails", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    satelliteRepo.updateFieldSpy
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("unknown field"));
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "mass_kg",
        value: 150,
        satelliteIds: ["7", "8"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(satelliteRepo.updateFieldSpy).toHaveBeenCalledTimes(2);
  });

  it("resolves an orbit regime by name before updating satellites", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 11n, name: "LEO" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "orbit_regime_id",
        value: "LEO",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(db.executeSpy).toHaveBeenCalledTimes(2);
  });

  it("uses the platform-class column when a preselected platform class is supplied", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "platform_class_id",
        value: "communications",
        satelliteIds: ["100"],
      },
      {
        ...baseCtx(),
        selectors: { platform_class_id: "33" },
      },
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(db.executeSpy).toHaveBeenCalledTimes(1);
  });

  it("does not count a FK update when the database omits rowCount", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rows: [] });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "platform_class_id",
        value: "communications",
        satelliteIds: ["100"],
      },
      {
        ...baseCtx(),
        selectors: { platform_class_id: "33" },
      },
    );

    expect(result).toEqual({ ok: true, affectedRows: 0 });
  });

  it("resolves an operator-country by name before updating satellites", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 44n, name: "France", orbitRegime: "LEO" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "operator_country_id",
        value: "France",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 0 });
    expect(db.executeSpy).toHaveBeenCalledTimes(2);
  });

  it("returns an operator-country not-found error when the lookup returns no rows array", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "operator_country_id",
        value: "Nowhere",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["operator-country not found: Nowhere"],
    });
  });

  it("returns pending platform-class choices without detail when multiple classes match", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({
      rows: [
        { id: 1n, name: "Communications" },
        { id: 2n, name: "Science" },
      ],
      rowCount: 2,
    });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "platform_class_id",
        value: "C",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result.ok).toBe(false);
    expect(result.pending?.[0]).toMatchObject({
      key: "platform_class_id",
      label: "Select: C",
    });
    expect(result.pending?.[0]?.options[0]).not.toHaveProperty("detail");
  });

  it("ignores non-scalar selector values and falls back to name resolution", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 5n, name: "Science" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "platform_class_id",
        value: "Science",
        satelliteIds: ["100"],
      },
      {
        ...baseCtx(),
        selectors: { platform_class_id: { bad: true } },
      },
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(db.executeSpy).toHaveBeenCalledTimes(2);
  });

  it("returns a platform-class not-found error when the lookup returns no rows array", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "update_field",
        field: "platform_class_id",
        value: "Unknown",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["platform_class not found: Unknown"],
    });
  });

  it("passes sourceClass through the sim-accept hook and defaults swarmId to null", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const onSimUpdateAccepted = vi.fn().mockResolvedValue(undefined);
    const handler = createUpdateFieldHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
      onSimUpdateAccepted,
    });
    db.executeSpy.mockResolvedValue({
      rows: [{ id: 501n }],
      rowCount: 1,
    });

    await handler.handle(
      {
        kind: "update_field",
        field: "thermal_margin",
        value: 9,
        satelliteIds: [],
        provenance: {
          source: "sim_swarm_telemetry",
          sourceClass: "FIELD_LOW",
        },
      },
      baseCtx(),
    );

    expect(onSimUpdateAccepted).toHaveBeenCalledWith(
      expect.objectContaining({
        swarmId: null,
        priorSourceClass: "FIELD_LOW",
      }),
    );
  });
});

describe("link_payload handler", () => {
  it("returns pending when multiple payloads match the name", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createLinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    // findPayloadsByName returns 2 matches.
    db.executeSpy.mockResolvedValueOnce({
      rows: [
        { id: 1n, name: "CERES-A" },
        { id: 2n, name: "CERES-B" },
      ],
      rowCount: 2,
    });

    const result = await handler.handle(
      {
        kind: "link_payload",
        payloadName: "CERES",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result.ok).toBe(false);
    expect(result.pending).toHaveLength(1);
    expect(result.pending?.[0]).toMatchObject({
      key: "payload",
      label: expect.stringContaining("CERES"),
    });
    expect(result.pending?.[0]?.options).toHaveLength(2);
  });

  it("uses the UI-selected payload id without re-running payload lookup", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createLinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "link_payload",
        payloadName: "CERES",
        role: "primary",
        satelliteIds: ["100"],
      },
      {
        ...baseCtx(),
        selectors: { payload: 77 },
      },
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
    expect(db.executeSpy).toHaveBeenCalledTimes(1);
  });

  it("returns an error when the payload name resolves to no matches", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createLinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "link_payload",
        payloadName: "MISSING",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["Payload not found: MISSING"],
    });
  });

  it("returns a no-target error when the payload is known but no satellite target can be resolved", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createLinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({
      rows: [{ id: 77n, name: "CERES" }],
      rowCount: 1,
    });

    const result = await handler.handle(
      {
        kind: "link_payload",
        payloadName: "CERES",
        satelliteIds: [],
      },
      baseCtx({ operatorCountryId: null }),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["No target satellites found"],
    });
  });

  it("links a resolved payload even when no explicit role is supplied", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createLinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 77n, name: "CERES" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "link_payload",
        payloadName: "CERES",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
  });
});

describe("unlink_payload handler", () => {
  it("returns a no-target error when there is no explicit or contextual satellite target", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUnlinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "unlink_payload",
        payloadName: "CERES",
        satelliteIds: [],
      },
      baseCtx({ operatorCountryId: null }),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["No target satellites found"],
    });
  });

  it("returns an error when unlinking a payload that does not exist", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUnlinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "unlink_payload",
        payloadName: "MISSING",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["Payload not found: MISSING"],
    });
  });

  it("deletes every matching satellite-payload link and sums rowCount across pairs", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUnlinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [
          { id: 1n, name: "CERES-A" },
          { id: 2n, name: "CERES-B" },
        ],
        rowCount: 2,
      })
      .mockResolvedValue({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "unlink_payload",
        payloadName: "CERES",
        satelliteIds: ["100", "101"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 4 });
  });

  it("treats a missing delete rowCount as zero affected rows", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createUnlinkPayloadHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 1n, name: "CERES-A" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await handler.handle(
      {
        kind: "unlink_payload",
        payloadName: "CERES",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 0 });
  });
});

describe("reassign_operator_country handler", () => {
  it("returns pending when multiple operator-countries match", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createReassignOperatorCountryHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    db.executeSpy.mockResolvedValueOnce({
      rows: [
        { id: 10n, name: "France", orbitRegime: "LEO" },
        { id: 20n, name: "France", orbitRegime: "MEO" },
      ],
      rowCount: 2,
    });

    const result = await handler.handle(
      {
        kind: "reassign_operator_country",
        toName: "France",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result.ok).toBe(false);
    expect(result.pending?.[0]?.key).toBe("operator_country");
  });

  it("updates satellites immediately when the operator-country was preselected in the UI", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createReassignOperatorCountryHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({ rows: [], rowCount: 1 });

    const result = await handler.handle(
      {
        kind: "reassign_operator_country",
        toName: "France",
        satelliteIds: ["100"],
      },
      {
        ...baseCtx(),
        selectors: { operator_country: "20" },
      },
    );

    expect(result).toEqual({ ok: true, affectedRows: 1 });
  });

  it("counts only rows actually updated during operator-country reassignment", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createReassignOperatorCountryHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 20n, name: "France", orbitRegime: "LEO" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [], rowCount: 0 });

    const result = await handler.handle(
      {
        kind: "reassign_operator_country",
        toName: "France",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 0 });
  });

  it("returns a no-target error when operator-country reassignment has no satellite scope", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createReassignOperatorCountryHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy.mockResolvedValueOnce({
      rows: [{ id: 20n, name: "France", orbitRegime: "LEO" }],
      rowCount: 1,
    });

    const result = await handler.handle(
      {
        kind: "reassign_operator_country",
        toName: "France",
        satelliteIds: [],
      },
      baseCtx({ operatorCountryId: null }),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["No target satellites found"],
    });
  });

  it("treats a missing update rowCount as zero during operator-country reassignment", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createReassignOperatorCountryHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    db.executeSpy
      .mockResolvedValueOnce({
        rows: [{ id: 20n, name: "France", orbitRegime: "LEO" }],
        rowCount: 1,
      })
      .mockResolvedValueOnce({ rows: [] });

    const result = await handler.handle(
      {
        kind: "reassign_operator_country",
        toName: "France",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 0 });
  });
});

describe("enrich handler", () => {
  it("returns a no-target error when enrichment receives no satellite targets", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createEnrichHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "enrich",
        satelliteIds: [],
      },
      baseCtx({ operatorCountryId: null }),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["No target satellites found"],
    });
  });

  it("returns a non-fatal error when the enrichment queue is not wired", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const handler = createEnrichHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });

    const result = await handler.handle(
      {
        kind: "enrich",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result).toEqual({
      ok: false,
      affectedRows: 0,
      errors: ["Enrichment queue not wired"],
    });
  });

  it("queues one enrich job per satellite id and reports affectedRows", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const add = vi.fn().mockResolvedValue(undefined);
    const handler = createEnrichHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
      satelliteEnrichmentQueue: { add },
    });

    const result = await handler.handle(
      {
        kind: "enrich",
        satelliteIds: ["100", "101"],
      },
      baseCtx(),
    );

    expect(result).toEqual({ ok: true, affectedRows: 2 });
    expect(add).toHaveBeenCalledTimes(2);
    expect(add).toHaveBeenCalledWith(
      "enrich-satellite",
      { satelliteId: "100" },
      expect.objectContaining({ attempts: 3 }),
    );
  });

  it("surfaces a queue failure as a non-fatal resolution error", async () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const add = vi.fn().mockRejectedValue(new Error("queue offline"));
    const handler = createEnrichHandler({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
      satelliteEnrichmentQueue: { add },
    });

    const result = await handler.handle(
      {
        kind: "enrich",
        satelliteIds: ["100"],
      },
      baseCtx(),
    );

    expect(result.ok).toBe(false);
    expect(result.affectedRows).toBe(0);
    expect(result.errors?.[0]).toMatch(/queue offline/);
  });
});

describe("createSsaResolutionRegistry", () => {
  it("exposes all 5 SSA handlers", () => {
    const db = fakeDb();
    const satelliteRepo = fakeSatelliteRepo();
    const registry = createSsaResolutionRegistry({
      db: db.db,
      satelliteRepo: satelliteRepo.satelliteRepo,
    });
    expect(registry.get("update_field")).toBeDefined();
    expect(registry.get("link_payload")).toBeDefined();
    expect(registry.get("unlink_payload")).toBeDefined();
    expect(registry.get("reassign_operator_country")).toBeDefined();
    expect(registry.get("enrich")).toBeDefined();
    expect(registry.get("unknown_kind")).toBeUndefined();
    expect(registry.list()).toHaveLength(5);
  });
});
