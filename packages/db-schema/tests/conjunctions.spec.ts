import { afterEach, describe, expect, it, vi } from "vitest";

interface SeedRow {
  id: string;
  name: string;
  telemetry_summary: Record<string, unknown>;
}

function buildTleLines(noradId: number): [string, string] {
  const norad = String(noradId).padStart(5, "0");
  return [
    `1 ${norad}U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995`,
    `2 ${norad}  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001`,
  ];
}

function makeRow({
  eccentricity = 0.001,
  id,
  inclination = 51.6,
  meanMotion = 15.49,
  name = `SAT-${id}`,
  noradId,
  regime,
  tleStored = true,
}: {
  eccentricity?: number;
  id: string;
  inclination?: number;
  meanMotion?: number;
  name?: string;
  noradId: number;
  regime: string;
  tleStored?: boolean;
}): SeedRow {
  const [line1, line2] = buildTleLines(noradId);
  return {
    id,
    name,
    telemetry_summary: {
      noradId,
      meanMotion,
      inclination,
      eccentricity,
      regime,
      ...(tleStored ? { tleLine1: line1, tleLine2: line2 } : {}),
    },
  };
}

async function loadConjunctionsModule() {
  vi.resetModules();

  const conjunctionEvent = { table: "conjunctionEvent" };

  const twoline2satrec = vi.fn((line1: string) => {
    const noradId = Number(line1.slice(2, 7).trim());
    if (noradId === 201) throw new Error("bad tle");
    if (noradId === 200) return { error: 1, noradId };
    return { noradId };
  });

  const propagate = vi.fn((rec: { noradId: number }, time: Date) => {
    const step = Math.round(
      (time.getTime() - new Date("2026-04-23T12:00:00.000Z").getTime()) / 300_000,
    );

    switch (rec.noradId) {
      case 100:
        return {
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 1, y: 0, z: 0 },
        };
      case 101:
        return {
          position: { x: 100, y: 0, z: 0 },
          velocity: { x: -1, y: 0, z: 0 },
        };
      case 300:
        return {
          position: { x: 20, y: 0, z: 0 },
          velocity: { x: 1, y: 0, z: 0 },
        };
      case 500:
        return {
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 2, y: 0, z: 0 },
        };
      case 501:
        return {
          position: { x: step === 0 ? 30 : 10, y: 0, z: 0 },
          velocity: { x: -2, y: 0, z: 0 },
        };
      case 600:
        return {
          position: { x: 0, y: 0, z: 0 },
          velocity: false,
        };
      case 601:
        return {
          position: { x: step === 0 ? 5 : 1, y: 0, z: 0 },
          velocity: false,
        };
      case 700:
        return {
          position: false,
          velocity: false,
        };
      case 701:
        return {
          position: { x: 2, y: 0, z: 0 },
          velocity: { x: 1, y: 0, z: 0 },
        };
      case 800:
        return {
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 3, y: 0, z: 0 },
        };
      case 801:
        return {
          position: { x: step === 0 ? 25 : 5, y: 0, z: 0 },
          velocity: { x: -3, y: 0, z: 0 },
        };
      default:
        return {
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 0, y: 0, z: 0 },
        };
    }
  });

  vi.doMock("satellite.js", () => ({
    default: {
      twoline2satrec,
      propagate,
    },
    twoline2satrec,
    propagate,
  }));
  vi.doMock("../src/schema/conjunction", () => ({
    conjunctionEvent,
  }));

  const mod = await import("../src/seed/conjunctions");
  return { conjunctionEvent, mod };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("seedConjunctions", () => {
  it("screens regimes, skips invalid pairs, inserts valid conjunctions, and survives insert failures", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));

    const dateNowValues = [0, 0, 100, 1_000, 1_100, 2_000, 2_100, 3_000];
    let dateNowIndex = 0;
    vi.spyOn(Date, "now").mockImplementation(
      () => dateNowValues[dateNowIndex++] ?? 10_000 + dateNowIndex * 1_000,
    );

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { conjunctionEvent, mod } = await loadConjunctionsModule();

    const execute = vi.fn(async () => ({
      rows: [
        makeRow({ id: "10", noradId: 100, regime: "LEO", tleStored: false }),
        makeRow({ id: "11", noradId: 101, regime: "LEO" }),
        makeRow({ id: "12", noradId: 102, regime: "LEO" }),
        makeRow({ id: "19", noradId: 202, regime: "GEO" }),
        makeRow({ id: "20", noradId: 200, regime: "GEO" }),
        makeRow({ id: "21", noradId: 201, regime: "OPS" }),
        makeRow({ id: "30", noradId: 300, regime: "MEO" }),
        makeRow({ id: "31", noradId: 300, regime: "MEO", name: "SAT-31" }),
        makeRow({ id: "50", noradId: 500, regime: "HEO" }),
        makeRow({ id: "40", noradId: 501, regime: "HEO" }),
        makeRow({ id: "60", noradId: 600, regime: "SSO" }),
        makeRow({ id: "61", noradId: 601, regime: "SSO" }),
        makeRow({ id: "70", noradId: 700, regime: "GTO" }),
        makeRow({ id: "71", noradId: 701, regime: "GTO" }),
        makeRow({ id: "80", noradId: 800, regime: "TEST" }),
        makeRow({ id: "81", noradId: 801, regime: "TEST" }),
      ],
    }));

    const insertedValues: Array<Record<string, unknown>> = [];
    const insert = vi.fn((table: object) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          expect(table).toBe(conjunctionEvent);
          insertedValues.push(row);
          if (row.primarySatelliteId === 80n && row.secondarySatelliteId === 81n) {
            throw new Error("duplicate conjunction");
          }
        },
      }),
    }));

    const db = { execute, insert };

    const result = await mod.seedConjunctions(db, {
      logIntervalMs: 500,
      maxPerRegime: 2,
      stepSeconds: 300,
      thresholdKm: 50,
      windowDays: 600 / 86_400,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      screened: 5,
      candidates: 2,
      inserted: 1,
    });
    expect(insertedValues).toHaveLength(2);
    expect(insertedValues[0]).toMatchObject({
      primarySatelliteId: 40n,
      secondarySatelliteId: 50n,
      minRangeKm: 10,
      relativeVelocityKmps: 4,
      pcMethod: "foster-gaussian-1d",
    });
    expect(insertedValues[0]?.metadata).toMatchObject({
      regime: "HEO",
      stepSeconds: 300,
      windowDays: 600 / 86_400,
      synth: false,
    });
    expect(insertedValues[1]).toMatchObject({
      primarySatelliteId: 80n,
      secondarySatelliteId: 81n,
    });
    expect(
      logSpy.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("tested, candidates=") &&
          message.includes("so far"),
      ),
    ).toBe(true);
    expect(
      logSpy.mock.calls.some(
        ([message]) =>
          typeof message === "string" &&
          message.includes("[conj] regime=HEO done: sats=2 pairs=1 candidates=1"),
      ),
    ).toBe(true);
    expect(logSpy).toHaveBeenCalledWith("[conj] inserted 1 conjunction_event rows");
    expect(warnSpy).toHaveBeenCalledWith("[conj] insert failed:", "duplicate conjunction");
  });

  it("clamps very small collision probabilities and records synthesized TLE metadata", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.spyOn(Date, "now").mockReturnValue(0);

    const { conjunctionEvent, mod } = await loadConjunctionsModule();
    const execute = vi.fn(async () => ({
      rows: [
        makeRow({
          eccentricity: 0.4,
          id: "90",
          meanMotion: 2.2,
          noradId: 900,
          regime: "GTO",
          tleStored: false,
        }),
        makeRow({
          eccentricity: 0.4,
          id: "91",
          meanMotion: 2.2,
          noradId: 901,
          regime: "GTO",
          tleStored: false,
        }),
      ],
    }));

    const insertedValues: Array<Record<string, unknown>> = [];
    const insert = vi.fn((table: object) => ({
      values: (row: Record<string, unknown>) => ({
        onConflictDoNothing: async () => {
          expect(table).toBe(conjunctionEvent);
          insertedValues.push(row);
        },
      }),
    }));

    const satelliteModule = await import("satellite.js");
    vi.mocked(satelliteModule.twoline2satrec).mockImplementation((line1: string) => {
      const noradId = Number(line1.slice(2, 7).trim());
      return { noradId };
    });
    vi.mocked(satelliteModule.propagate).mockImplementation((rec: { noradId: number }, time: Date) => {
      const step = Math.round(
        (time.getTime() - new Date("2026-04-23T12:00:00.000Z").getTime()) / 300_000,
      );
      if (rec.noradId === 900) {
        return {
          position: { x: 0, y: 0, z: 0 },
          velocity: { x: 1, y: 0, z: 0 },
        };
      }
      return {
        position: { x: step === 0 ? 1_000 : 49, y: 0, z: 0 },
        velocity: { x: -1, y: 0, z: 0 },
      };
    });

    const result = await mod.seedConjunctions(
      { execute, insert },
      {
        logIntervalMs: 10_000,
        maxPerRegime: 10,
        stepSeconds: 300,
        thresholdKm: 50,
        windowDays: 600 / 86_400,
      },
    );

    expect(result).toEqual({
      screened: 1,
      candidates: 1,
      inserted: 1,
    });
    expect(insertedValues[0]).toMatchObject({
      primarySatelliteId: 90n,
      secondarySatelliteId: 91n,
      probabilityOfCollision: 1e-12,
    });
    expect(insertedValues[0]?.metadata).toMatchObject({
      regime: "GTO",
      synth: true,
    });
  });

  it("uses default option values when no overrides are provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-23T12:00:00.000Z"));
    vi.spyOn(Date, "now").mockReturnValue(0);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { mod } = await loadConjunctionsModule();

    const execute = vi.fn(async () => ({
      rows: [],
    }));
    const insert = vi.fn(() => ({
      values: () => ({
        onConflictDoNothing: async () => undefined,
      }),
    }));

    const result = await mod.seedConjunctions({ execute, insert });

    expect(result).toEqual({
      screened: 0,
      candidates: 0,
      inserted: 0,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith("[conj] loaded 0 satellites");
    expect(logSpy).toHaveBeenCalledWith("[conj] inserted 0 conjunction_event rows");
  });
});
