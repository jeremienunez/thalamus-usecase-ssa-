import { describe, expect, it } from "vitest";
import * as satelliteJs from "satellite.js";
import {
  broadPhase,
  classifyRegime as classifyBroadphaseRegime,
  loadObjects as loadBroadphaseObjects,
} from "../src/seed/screen-broadphase";
import {
  broadPhaseTopK,
  classifyRegime as classifyNarrowRegime,
  computePc,
  findClosestApproach,
  loadObjects as loadNarrowObjects,
} from "../src/seed/screen-narrow-phase";

const SAMPLE_TLE_LINE_1 =
  "1 25544U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995";
const SAMPLE_TLE_LINE_2 =
  "2 25544  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001";

function broadphaseObj(
  overrides: Partial<Parameters<typeof broadPhase>[0][number]> = {},
): Parameters<typeof broadPhase>[0][number] {
  return {
    id: "1",
    name: "OBJ-1",
    objectClass: "payload",
    perigeeKm: 400,
    apogeeKm: 500,
    inclinationDeg: 53,
    regime: "leo",
    ...overrides,
  };
}

function narrowObj(
  overrides: Partial<Parameters<typeof broadPhaseTopK>[0][number]> = {},
): Parameters<typeof broadPhaseTopK>[0][number] {
  return {
    id: "1",
    name: "OBJ-1",
    noradId: 1,
    objectClass: "payload",
    perigeeKm: 400,
    apogeeKm: 500,
    regime: "leo",
    ...overrides,
  };
}

describe("seed screening — broad-phase", () => {
  it("classifies broad-phase regimes by mean altitude boundaries", () => {
    expect(classifyBroadphaseRegime(400, 500)).toBe("leo");
    expect(classifyBroadphaseRegime(10_000, 12_000)).toBe("meo");
    expect(classifyBroadphaseRegime(35_500, 35_900)).toBe("geo");
    expect(classifyBroadphaseRegime(40_000, 41_000)).toBe("heo");
  });

  it("counts only same-regime overlaps and keeps the tightest top-K pairs", () => {
    const result = broadPhase(
      [
        broadphaseObj({ id: "a", name: "A", objectClass: "payload", perigeeKm: 400, apogeeKm: 500 }),
        broadphaseObj({ id: "b", name: "B", objectClass: "debris", perigeeKm: 450, apogeeKm: 550 }),
        broadphaseObj({ id: "c", name: "C", objectClass: "payload", perigeeKm: 490, apogeeKm: 492 }),
        broadphaseObj({ id: "d", name: "D", objectClass: "payload", perigeeKm: 800, apogeeKm: 850 }),
        broadphaseObj({ id: "e", name: "E", objectClass: "payload", perigeeKm: 10_000, apogeeKm: 11_000, regime: "meo" }),
      ],
      0,
      2,
    );

    expect(result.totalCandidates).toBe(3);
    expect(result.perRegime.get("leo")).toBe(3);
    expect(result.classMix.get("debris×payload")).toBe(2);
    expect(result.topK.map((pair) => pair.overlapKm)).toEqual([2, 2]);
  });

  it("replaces looser heap entries, keeps tighter ones, and drains expired actives", () => {
    const result = broadPhase(
      [
        broadphaseObj({ id: "a", name: "A", perigeeKm: 100, apogeeKm: 300 }),
        broadphaseObj({ id: "b", name: "B", perigeeKm: 150, apogeeKm: 250 }),
        broadphaseObj({ id: "c", name: "C", perigeeKm: 240, apogeeKm: 250 }),
        broadphaseObj({ id: "d", name: "D", perigeeKm: 260, apogeeKm: 280 }),
        broadphaseObj({ id: "e", name: "E", perigeeKm: 500, apogeeKm: 510 }),
      ],
      0,
      2,
    );

    expect(result.totalCandidates).toBe(4);
    expect(result.perRegime.get("leo")).toBe(4);
    expect(result.topK.map((pair) => pair.overlapKm)).toEqual([10, 10]);
    expect(result.topK.map((pair) => [pair.aId, pair.bId])).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("heap-orders candidates across regimes when a later pair is looser then tighter", () => {
    const result = broadPhase(
      [
        broadphaseObj({ id: "l1", regime: "leo", perigeeKm: 100, apogeeKm: 110 }),
        broadphaseObj({ id: "l2", regime: "leo", perigeeKm: 100, apogeeKm: 120 }),
        broadphaseObj({ id: "m1", regime: "meo", perigeeKm: 10_000, apogeeKm: 10_100 }),
        broadphaseObj({ id: "m2", regime: "meo", perigeeKm: 10_000, apogeeKm: 10_200 }),
        broadphaseObj({ id: "g1", regime: "geo", perigeeKm: 35_000, apogeeKm: 35_005 }),
        broadphaseObj({ id: "g2", regime: "geo", perigeeKm: 35_000, apogeeKm: 35_010 }),
      ],
      0,
      2,
    );

    expect(result.totalCandidates).toBe(3);
    expect(result.topK.map((pair) => pair.overlapKm)).toEqual([5, 10]);
    expect(result.topK.map((pair) => pair.regime)).toEqual(["geo", "leo"]);
  });

  it("can sink a replaced heap root past both children when the right child is larger", () => {
    const result = broadPhase(
      [
        broadphaseObj({ id: "l1", regime: "leo", perigeeKm: 100, apogeeKm: 110 }),
        broadphaseObj({ id: "l2", regime: "leo", perigeeKm: 100, apogeeKm: 120 }),
        broadphaseObj({ id: "m1", regime: "meo", perigeeKm: 10_000, apogeeKm: 10_100 }),
        broadphaseObj({ id: "m2", regime: "meo", perigeeKm: 10_000, apogeeKm: 10_200 }),
        broadphaseObj({ id: "g1", regime: "geo", perigeeKm: 35_000, apogeeKm: 35_050 }),
        broadphaseObj({ id: "g2", regime: "geo", perigeeKm: 35_000, apogeeKm: 35_100 }),
        broadphaseObj({ id: "h1", regime: "heo", perigeeKm: 40_000, apogeeKm: 40_005 }),
        broadphaseObj({ id: "h2", regime: "heo", perigeeKm: 40_000, apogeeKm: 40_010 }),
      ],
      0,
      3,
    );

    expect(result.totalCandidates).toBe(4);
    expect(result.topK.map((pair) => pair.overlapKm)).toEqual([5, 10, 50]);
    expect(result.topK.map((pair) => pair.regime)).toEqual(["heo", "leo", "geo"]);
  });

  it("drops pairs whose orbital bands only touch at a zero-width boundary", () => {
    const result = broadPhase(
      [
        broadphaseObj({ id: "a", perigeeKm: 100, apogeeKm: 200 }),
        broadphaseObj({ id: "b", perigeeKm: 200, apogeeKm: 300 }),
      ],
      0,
      5,
    );

    expect(result.totalCandidates).toBe(0);
    expect(result.topK).toEqual([]);
  });

  it("loads only valid broad-phase objects from db rows", async () => {
    const db = {
      execute: async () => ({
        rows: [
          { id: "1", name: "A", object_class: "payload", perigee: 400, apogee: 500, inc: 53 },
          { id: "2", name: "B", object_class: "payload", perigee: Number.NaN, apogee: 500, inc: 53 },
          { id: "3", name: "C", object_class: "payload", perigee: 600, apogee: 550, inc: null },
        ],
      }),
    } satisfies Parameters<typeof loadBroadphaseObjects>[0];

    const rows = await loadBroadphaseObjects(db);

    expect(rows).toEqual([
      {
        id: "1",
        name: "A",
        objectClass: "payload",
        perigeeKm: 400,
        apogeeKm: 500,
        inclinationDeg: 53,
        regime: "leo",
      },
    ]);
  });
});

describe("seed screening — narrow-phase", () => {
  it("classifies narrow-phase regimes and keeps the tightest overlaps", () => {
    expect(classifyNarrowRegime(400, 500)).toBe("leo");
    expect(classifyNarrowRegime(10_000, 12_000)).toBe("meo");
    expect(classifyNarrowRegime(35_500, 35_900)).toBe("geo");
    expect(classifyNarrowRegime(40_000, 41_000)).toBe("heo");

    const pairs = broadPhaseTopK(
      [
        narrowObj({ id: "a", name: "A", noradId: 1, perigeeKm: 400, apogeeKm: 500 }),
        narrowObj({ id: "b", name: "B", noradId: 2, objectClass: "debris", perigeeKm: 450, apogeeKm: 550 }),
        narrowObj({ id: "c", name: "C", noradId: 3, perigeeKm: 490, apogeeKm: 492 }),
        narrowObj({ id: "d", name: "D", noradId: 4, perigeeKm: 800, apogeeKm: 850 }),
      ],
      0,
      2,
    );

    expect(pairs).toHaveLength(2);
    expect(pairs.map((pair) => pair.overlapKm)).toEqual([2, 2]);
  });

  it("replaces looser narrow-phase heap entries and drains expired actives", () => {
    const pairs = broadPhaseTopK(
      [
        narrowObj({ id: "a", noradId: 1, perigeeKm: 100, apogeeKm: 300 }),
        narrowObj({ id: "b", noradId: 2, perigeeKm: 150, apogeeKm: 250 }),
        narrowObj({ id: "c", noradId: 3, perigeeKm: 240, apogeeKm: 250 }),
        narrowObj({ id: "d", noradId: 4, perigeeKm: 260, apogeeKm: 280 }),
        narrowObj({ id: "e", noradId: 5, perigeeKm: 500, apogeeKm: 510 }),
      ],
      0,
      2,
    );

    expect(pairs).toHaveLength(2);
    expect(pairs.map((pair) => pair.overlapKm)).toEqual([10, 10]);
    expect(pairs.map((pair) => [pair.a.id, pair.b.id])).toEqual([
      ["a", "c"],
      ["b", "c"],
    ]);
  });

  it("heap-orders narrow-phase candidates across regimes and drops zero-width overlaps", () => {
    const pairs = broadPhaseTopK(
      [
        narrowObj({ id: "l1", noradId: 11, regime: "leo", perigeeKm: 100, apogeeKm: 110 }),
        narrowObj({ id: "l2", noradId: 12, regime: "leo", perigeeKm: 100, apogeeKm: 120 }),
        narrowObj({ id: "m1", noradId: 21, regime: "meo", perigeeKm: 10_000, apogeeKm: 10_100 }),
        narrowObj({ id: "m2", noradId: 22, regime: "meo", perigeeKm: 10_000, apogeeKm: 10_200 }),
        narrowObj({ id: "g1", noradId: 31, regime: "geo", perigeeKm: 35_000, apogeeKm: 35_050 }),
        narrowObj({ id: "g2", noradId: 32, regime: "geo", perigeeKm: 35_000, apogeeKm: 35_100 }),
        narrowObj({ id: "h1", noradId: 41, regime: "heo", perigeeKm: 40_000, apogeeKm: 40_005 }),
        narrowObj({ id: "h2", noradId: 42, regime: "heo", perigeeKm: 40_000, apogeeKm: 40_010 }),
        narrowObj({ id: "z1", noradId: 51, regime: "leo", perigeeKm: 100, apogeeKm: 200 }),
        narrowObj({ id: "z2", noradId: 52, regime: "leo", perigeeKm: 200, apogeeKm: 300 }),
      ],
      0,
      3,
    );

    expect(pairs.map((pair) => pair.overlapKm)).toEqual([5, 10, 10]);
    expect(pairs.map((pair) => [pair.a.id, pair.b.id, pair.a.regime])).toEqual([
      ["h1", "h2", "heo"],
      ["l1", "z1", "leo"],
      ["l1", "l2", "leo"],
    ]);
  });

  it("can sink a replaced narrow-phase heap root past both children when the right child is larger", () => {
    const pairs = broadPhaseTopK(
      [
        narrowObj({ id: "l1", noradId: 11, regime: "leo", perigeeKm: 100, apogeeKm: 110 }),
        narrowObj({ id: "l2", noradId: 12, regime: "leo", perigeeKm: 100, apogeeKm: 120 }),
        narrowObj({ id: "m1", noradId: 21, regime: "meo", perigeeKm: 10_000, apogeeKm: 10_100 }),
        narrowObj({ id: "m2", noradId: 22, regime: "meo", perigeeKm: 10_000, apogeeKm: 10_200 }),
        narrowObj({ id: "g1", noradId: 31, regime: "geo", perigeeKm: 35_000, apogeeKm: 35_050 }),
        narrowObj({ id: "g2", noradId: 32, regime: "geo", perigeeKm: 35_000, apogeeKm: 35_100 }),
        narrowObj({ id: "h1", noradId: 41, regime: "heo", perigeeKm: 40_000, apogeeKm: 40_005 }),
        narrowObj({ id: "h2", noradId: 42, regime: "heo", perigeeKm: 40_000, apogeeKm: 40_010 }),
      ],
      0,
      3,
    );

    expect(pairs.map((pair) => pair.overlapKm)).toEqual([5, 10, 50]);
    expect(pairs.map((pair) => pair.a.regime)).toEqual(["heo", "leo", "geo"]);
  });

  it("loads only valid narrow-phase objects with NORAD ids from db rows", async () => {
    const db = {
      execute: async () => ({
        rows: [
          {
            id: "1",
            name: "A",
            norad_id: 25544,
            object_class: "payload",
            perigee: 400,
            apogee: 500,
          },
          {
            id: "2",
            name: "B",
            norad_id: 20000,
            object_class: "payload",
            perigee: 600,
            apogee: 550,
          },
        ],
      }),
    } satisfies Parameters<typeof loadNarrowObjects>[0];

    const rows = await loadNarrowObjects(db);

    expect(rows).toEqual([
      {
        id: "1",
        name: "A",
        noradId: 25544,
        objectClass: "payload",
        perigeeKm: 400,
        apogeeKm: 500,
        regime: "leo",
      },
    ]);
  });

  it("finds the closest approach for identical satrecs and returns a plausible structure", () => {
    const sat = satelliteJs.twoline2satrec(SAMPLE_TLE_LINE_1, SAMPLE_TLE_LINE_2);
    const start = new Date("2026-04-23T12:00:00.000Z");

    const closest = findClosestApproach(sat, sat, start, 1, 60);

    expect(closest).not.toBeNull();
    expect(closest?.minRangeKm).toBeCloseTo(0, 6);
    expect(closest?.tca.toISOString()).toBe(start.toISOString());
    expect(closest?.relVelKmps).toBe(0);
    expect(closest?.daysFromEpoch).toBe(0);
  });

  it("returns null when propagation cannot produce both positions", () => {
    const start = new Date("2026-04-23T12:00:00.000Z");
    const broken = satelliteJs.twoline2satrec(SAMPLE_TLE_LINE_1, SAMPLE_TLE_LINE_2);
    broken.no = 0;

    expect(findClosestApproach(broken, broken, start, 1, 60)).toBeNull();
  });

  it("computes higher collision probability for tighter approaches and larger hard bodies", () => {
    const farther = computePc(5, 1, 10);
    const closer = computePc(1, 1, 10);
    const largerBody = computePc(1, 1, 20);

    expect(closer).toBeGreaterThan(farther);
    expect(largerBody).toBeGreaterThan(closer);
    expect(computePc(1, 1, 10)).toBeGreaterThanOrEqual(0);
  });
});
