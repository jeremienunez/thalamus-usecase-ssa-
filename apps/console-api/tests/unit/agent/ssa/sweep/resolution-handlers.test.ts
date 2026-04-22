import { describe, it, expect, vi } from "vitest";
import type { ResolutionActionContext } from "@interview/sweep";
import { fakePort, typedSpy } from "@interview/test-kit";
import {
  createUpdateFieldHandler,
  createLinkPayloadHandler,
  createReassignOperatorCountryHandler,
  createSsaResolutionRegistry,
  type SsaHandlerDeps,
} from "../../../../../src/agent/ssa/sweep/resolution-handlers.ssa";

function fakeDb() {
  const executeSpy = vi.fn(async (_query: unknown) => ({
    rows: [] as Record<string, unknown>[],
    rowCount: 0,
  }));
  return {
    db: {
      execute: async <
        T extends Record<string, unknown> = Record<string, unknown>,
      >(query: unknown) => {
        const result = await executeSpy(query);
        return {
          rows: (result.rows ?? []) as T[],
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
