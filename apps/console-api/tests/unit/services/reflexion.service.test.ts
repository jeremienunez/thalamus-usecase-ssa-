import { describe, expect, it, vi } from "vitest";
import {
  ReflexionService,
  type CyclesPort,
  type EdgesWritePort,
  type FindingsWritePort,
  type ReflexionReadPort,
} from "../../../src/services/reflexion.service";
import type {
  CoplaneRow,
  BeltRow,
  MilRow,
  ReflexionTarget,
} from "../../../src/types/reflexion.types";
import { HttpError } from "../../../src/utils/http-error";

function typedSpy<Fn extends (...args: never[]) => unknown>() {
  return vi.fn<Parameters<Fn>, ReturnType<Fn>>();
}

function target(overrides: Partial<ReflexionTarget> = {}): ReflexionTarget {
  return {
    id: "42",
    name: "FENGYUN 3A",
    norad_id: 32958,
    object_class: "payload",
    operator_country: "China",
    classification_tier: "restricted",
    platform_name: "Imaging",
    inc: 98.5,
    raan: 122.2,
    mm: 14.2,
    ma: 180,
    apogee: 840,
    perigee: 820,
    ...overrides,
  };
}

function strictRow(overrides: Partial<CoplaneRow> = {}): CoplaneRow {
  return {
    id: "101",
    norad_id: "50001",
    name: "YAOGAN-101",
    operator_country: "China",
    tier: "restricted",
    object_class: "payload",
    platform: "ISR",
    d_inc: 0.1234,
    d_raan: 1.234,
    lag_min: 15.67,
    ...overrides,
  };
}

function beltRow(overrides: Partial<BeltRow> = {}): BeltRow {
  return {
    country: "China",
    tier: "restricted",
    object_class: "payload",
    n: "3",
    ...overrides,
  };
}

function milRow(overrides: Partial<MilRow> = {}): MilRow {
  return {
    id: "201",
    norad_id: "60001",
    name: "YAOGAN-201",
    country: "China",
    tier: "restricted",
    d_inc: 0.0456,
    ...overrides,
  };
}

function mockRepo() {
  const findTarget = typedSpy<ReflexionReadPort["findTarget"]>();
  const findStrictCoplane = typedSpy<ReflexionReadPort["findStrictCoplane"]>();
  const findInclinationBelt = typedSpy<ReflexionReadPort["findInclinationBelt"]>();
  const findMilLineagePeers = typedSpy<ReflexionReadPort["findMilLineagePeers"]>();

  return {
    repo: {
      findTarget,
      findStrictCoplane,
      findInclinationBelt,
      findMilLineagePeers,
    } satisfies ReflexionReadPort,
    findTarget,
    findStrictCoplane,
    findInclinationBelt,
    findMilLineagePeers,
  };
}

function mockCycles() {
  const getOrCreate = typedSpy<CyclesPort["getOrCreate"]>();

  return {
    cycles: { getOrCreate } satisfies CyclesPort,
    getOrCreate,
  };
}

function mockFindings() {
  const insert = typedSpy<FindingsWritePort["insert"]>();

  return {
    findings: { insert } satisfies FindingsWritePort,
    insert,
  };
}

function mockEdges() {
  const insert = typedSpy<EdgesWritePort["insert"]>();
  insert.mockResolvedValue(undefined);

  return {
    edges: { insert } satisfies EdgesWritePort,
    insert,
  };
}

describe("ReflexionService.runPass", () => {
  it("throws notFound when the target satellite is missing", async () => {
    const { repo, findTarget } = mockRepo();
    findTarget.mockResolvedValue(null);

    await expect(
      new ReflexionService(
        repo,
        mockCycles().cycles,
        mockFindings().findings,
        mockEdges().edges,
    ).runPass({
        noradId: 32958,
        dIncMax: 0.3,
        dRaanMax: 5,
        dMmMax: 0.05,
      }),
    ).rejects.toMatchObject({
      statusCode: 404,
      message: "satellite not found",
    } satisfies Partial<HttpError>);
  });

  it("throws badRequest when the target lacks orbital elements", async () => {
    const { repo, findTarget } = mockRepo();
    findTarget.mockResolvedValue(target({ inc: null }));

    await expect(
      new ReflexionService(
        repo,
        mockCycles().cycles,
        mockFindings().findings,
        mockEdges().edges,
    ).runPass({
        noradId: 32958,
        dIncMax: 0.3,
        dRaanMax: 5,
        dMmMax: 0.05,
      }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: "target missing orbital elements",
    } satisfies Partial<HttpError>);
  });

  it("returns formatted reflexion data without emitting a finding when there is no anomaly trigger", async () => {
    const { repo, findTarget, findStrictCoplane, findInclinationBelt, findMilLineagePeers } =
      mockRepo();
    const { cycles, getOrCreate } = mockCycles();
    const { findings, insert: insertFinding } = mockFindings();
    const { edges, insert: insertEdge } = mockEdges();
    findTarget.mockResolvedValue(target({ operator_country: "France" }));
    findStrictCoplane.mockResolvedValue([
      strictRow(),
    ]);
    findInclinationBelt.mockResolvedValue([
      beltRow({ country: "France", n: "2" }),
      beltRow({ country: "Germany", n: "1" }),
    ]);
    findMilLineagePeers.mockResolvedValue([]);

    const result = await new ReflexionService(
      repo,
      cycles,
      findings,
      edges,
    ).runPass({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });

    expect(result).toEqual({
      target: {
        noradId: 32958,
        name: "FENGYUN 3A",
        declared: {
          operator_country: "France",
          classification_tier: "restricted",
          object_class: "payload",
          platform: "Imaging",
        },
        orbital: {
          inclinationDeg: 98.5,
          raanDeg: 122.2,
          meanMotionRevPerDay: 14.2,
          apogeeKm: 840,
          perigeeKm: 820,
        },
      },
      strictCoplane: [
        {
          noradId: 50001,
          name: "YAOGAN-101",
          country: "China",
          tier: "restricted",
          class: "payload",
          platform: "ISR",
          dInc: 0.123,
          dRaan: 1.23,
          lagMin: 15.7,
        },
      ],
      beltByCountry: [
        {
          country: "France",
          tier: "restricted",
          class: "payload",
          n: 2,
        },
        {
          country: "Germany",
          tier: "restricted",
          class: "payload",
          n: 1,
        },
      ],
      milLineagePeers: [],
      findingId: null,
    });
    expect(findStrictCoplane).toHaveBeenCalledWith(
      32958,
      expect.objectContaining({
        inc: 98.5,
        raan: 122.2,
        mm: 14.2,
        ma: 180,
      }),
      0.3,
      5,
      0.05,
    );
    expect(findInclinationBelt).toHaveBeenCalledWith(32958, 98.5, 0.3);
    expect(findMilLineagePeers).toHaveBeenCalledWith(32958, 98.5, 0.3);
    expect(getOrCreate).not.toHaveBeenCalled();
    expect(insertFinding).not.toHaveBeenCalled();
    expect(insertEdge).not.toHaveBeenCalled();
  });

  it("emits a high-urgency finding when MIL-lineage peers are present", async () => {
    const { repo, findTarget, findStrictCoplane, findInclinationBelt, findMilLineagePeers } =
      mockRepo();
    const { cycles, getOrCreate } = mockCycles();
    const { findings, insert: insertFinding } = mockFindings();
    const { edges, insert: insertEdge } = mockEdges();
    findTarget.mockResolvedValue(target());
    findStrictCoplane.mockResolvedValue([
      strictRow(),
      strictRow({ id: "102", norad_id: "50002", name: "YAOGAN-102", d_inc: 0.2, d_raan: 2.2, lag_min: 20.1 }),
    ]);
    findInclinationBelt.mockResolvedValue([
      beltRow({ country: "China", n: "4" }),
    ]);
    findMilLineagePeers.mockResolvedValue([
      milRow(),
    ]);
    getOrCreate.mockResolvedValue(77n);
    insertFinding.mockResolvedValue(501n);

    const result = await new ReflexionService(
      repo,
      cycles,
      findings,
      edges,
    ).runPass({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });

    expect(result.findingId).toBe("501");
    expect(insertFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        cycleId: 77n,
        cortex: "classification_auditor",
        findingType: "anomaly",
        urgency: "high",
        title:
          "Orbital anomaly · FENGYUN 3A shares inclination with 1 military-lineage peer(s)",
        confidence: 0.8,
        impactScore: 0.7,
      }),
    );
    expect(insertEdge).toHaveBeenCalledTimes(4);
    expect(insertEdge).toHaveBeenNthCalledWith(1, {
      findingId: 501n,
      entityType: "satellite",
      entityId: 42n,
      relation: "about",
      weight: 1,
      context: {
        noradId: 32958,
        declared: {
          operator_country: "China",
          tier: "restricted",
          object_class: "payload",
        },
      },
    });
    expect(insertEdge).toHaveBeenNthCalledWith(2, {
      findingId: 501n,
      entityType: "satellite",
      entityId: 201n,
      relation: "similar_to",
      weight: 0.9,
      context: { role: "mil_lineage_peer", dInc: 0.046 },
    });
  });

  it("emits a medium-urgency finding when the inclination belt is dominated by another country", async () => {
    const { repo, findTarget, findStrictCoplane, findInclinationBelt, findMilLineagePeers } =
      mockRepo();
    const { cycles, getOrCreate } = mockCycles();
    const { findings, insert: insertFinding } = mockFindings();
    const { edges, insert: insertEdge } = mockEdges();
    findTarget.mockResolvedValue(target({ operator_country: "France" }));
    findStrictCoplane.mockResolvedValue([]);
    findInclinationBelt.mockResolvedValue([
      beltRow({ country: "China", n: "5" }),
      beltRow({ country: "France", n: "1" }),
    ]);
    findMilLineagePeers.mockResolvedValue([]);
    getOrCreate.mockResolvedValue(77n);
    insertFinding.mockResolvedValue(601n);

    const result = await new ReflexionService(
      repo,
      cycles,
      findings,
      edges,
    ).runPass({
      noradId: 32958,
      dIncMax: 0.3,
      dRaanMax: 5,
      dMmMax: 0.05,
    });

    expect(result.findingId).toBe("601");
    expect(insertFinding).toHaveBeenCalledWith(
      expect.objectContaining({
        urgency: "medium",
        title:
          "Orbital anomaly · FENGYUN 3A inclination-belt dominated by China (declared France)",
      }),
    );
    expect(insertEdge).toHaveBeenCalledTimes(1);
    expect(insertEdge).toHaveBeenCalledWith(
      expect.objectContaining({
        findingId: 601n,
        relation: "about",
        entityId: 42n,
      }),
    );
  });
});
