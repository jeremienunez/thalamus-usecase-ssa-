import { describe, expect, it } from "vitest";
import {
  classify as classifyBaselineRegime,
  meanStd,
  parseGcatDate,
  weeklyCounts,
} from "../src/seed/baselines";
import {
  classifyExperimental,
  classifyRegime as classifyGapRegime,
  classifyTier,
} from "../src/seed/fill-catalog-gaps";
import {
  parseNumber,
  parseSatcatCsv,
  slugify,
  upsertBatch,
} from "../src/seed/populate-space-catalog";
import {
  classifyRegime as classifySeedRegime,
  guessCountry,
  guessOperator,
  parseTleBlock as parseSeedTleBlock,
  parseTleEpoch,
  toSlug,
} from "../src/seed/index";
import {
  formatEccentricity,
  pad,
  sigmaKmFor,
  synthesizeTLE,
  tleChecksum,
} from "../src/seed/conjunctions";
import { parseTleBlock as parseUpdateTleBlock } from "../src/seed/update-tle";

const SAMPLE_TLE_LINE_1 =
  "1 25544U 98067A   26113.50000000  .00001264  00000+0  29669-4 0  9995";
const SAMPLE_TLE_LINE_2 =
  "2 25544  51.6434  42.2123 0003050  91.7000  12.8000 15.49000000 00001";

function gapRow(
  overrides: Partial<Parameters<typeof classifyGapRegime>[0]> = {},
): Parameters<typeof classifyGapRegime>[0] {
  return {
    id: "1",
    name: "SAT-1",
    mass_kg: null,
    mean_motion: 15.5,
    eccentricity: 0,
    inclination_deg: 51.6,
    operator_name: "Commercial Operator",
    operator_country_name: "commercial",
    platform_name: "communications",
    ...overrides,
  };
}

describe("seed helpers — baselines", () => {
  it("classifies baseline regimes across leo, sso, meo, geo, gto, heo, and invalid inputs", () => {
    expect(classifyBaselineRegime(500, 550, 98)).toBe("sso");
    expect(classifyBaselineRegime(500, 550, 53)).toBe("leo");
    expect(classifyBaselineRegime(10_000, 12_000, 55)).toBe("meo");
    expect(classifyBaselineRegime(35_500, 35_900, 0)).toBe("geo");
    expect(classifyBaselineRegime(300, 18_000, 20)).toBe("gto");
    expect(classifyBaselineRegime(500, 30_000, 63)).toBe("heo");
    expect(classifyBaselineRegime(38_000, 39_000, 10)).toBeNull();
    expect(classifyBaselineRegime(Number.NaN, 500, 53)).toBeNull();
  });

  it("parses GCAT dates, strips question marks, defaults missing days, and rejects blanks", () => {
    expect(parseGcatDate("2024 Jan 15?")).toBe(new Date("Jan 15, 2024").getTime());
    expect(parseGcatDate("2024 Jan")).toBe(new Date("Jan 1, 2024").getTime());
    expect(parseGcatDate("2024 Jan 15 12:30")).toBe(new Date("Jan 15, 2024").getTime());
    expect(parseGcatDate("2024 Abc 15")).toBeNull();
    expect(parseGcatDate("-")).toBeNull();
    expect(parseGcatDate(undefined)).toBeNull();
    expect(parseGcatDate("not-a-date")).toBeNull();
  });

  it("buckets weekly counts inside the requested window and ignores null, old, and future dates", () => {
    const weekMs = 7 * 24 * 3_600_000;
    const now = Date.UTC(2026, 3, 23);
    const buckets = weeklyCounts(
      [
        now - weekMs * 3 + 1_000,
        now - weekMs * 2 + 1_000,
        now - weekMs + 1_000,
        null,
        Number.NaN,
        now + 1_000,
        now - weekMs * 5,
      ],
      4,
      now,
    );

    expect(buckets).toEqual([0, 1, 1, 1]);
  });

  it("computes rounded mean and std and handles the empty case", () => {
    expect(meanStd([1, 2, 3])).toEqual({ mean: 2, std: 0.816, samples: 3 });
    expect(meanStd([])).toEqual({ mean: 0, std: 0, samples: 0 });
  });
});

describe("seed helpers — fill catalog gaps", () => {
  it("classifies gap regimes from mean motion, eccentricity, and inclination", () => {
    expect(classifyGapRegime(gapRow({ mean_motion: null }))).toBeNull();
    expect(classifyGapRegime(gapRow({ mean_motion: 2.2, eccentricity: 0.4 }))).toBe("GTO");
    expect(classifyGapRegime(gapRow({ mean_motion: 8, eccentricity: 0.4 }))).toBe("HEO");
    expect(classifyGapRegime(gapRow({ mean_motion: 1.01, eccentricity: 0 }))).toBe("GEO");
    expect(classifyGapRegime(gapRow({ mean_motion: 2.1, eccentricity: 0 }))).toBe("MEO");
    expect(classifyGapRegime(gapRow({ mean_motion: 14, inclination_deg: 98 }))).toBe("SSO");
    expect(classifyGapRegime(gapRow({ mean_motion: 14, inclination_deg: 53 }))).toBe("LEO");
    expect(classifyGapRegime(gapRow({ mean_motion: 0.4, eccentricity: 0 }))).toBeNull();
  });

  it("classifies tiers from military, platform, dual-use, and default signals", () => {
    expect(classifyTier(gapRow({ operator_name: "United States Space Force" }))).toBe("restricted");
    expect(classifyTier(gapRow({ name: "Bundeswehr Relay", operator_name: null }))).toBe("restricted");
    expect(classifyTier(gapRow({ platform_name: "sigint" }))).toBe("restricted");
    expect(classifyTier(gapRow({ operator_name: "NASA" }))).toBe("sensitive");
    expect(
      classifyTier(
        gapRow({
          platform_name: "earth_observation",
          operator_country_name: "France",
        }),
      ),
    ).toBe("sensitive");
    expect(
      classifyTier(
        gapRow({
          platform_name: "navigation",
          operator_country_name: "other / unknown",
        }),
      ),
    ).toBe("unclassified");
    expect(
      classifyTier(
        gapRow({
          platform_name: "navigation",
          operator_country_name: "commercial",
        }),
      ),
    ).toBe("unclassified");
    expect(
      classifyTier(
        gapRow({
          name: null,
          operator_name: null,
        }),
      ),
    ).toBe("unclassified");
    expect(classifyTier(gapRow())).toBe("unclassified");
  });

  it("classifies experimental rows from mass, platform, name hints, and non-experimental fallbacks", () => {
    expect(classifyExperimental(gapRow({ mass_kg: 5 }))).toBe(true);
    expect(classifyExperimental(gapRow({ platform_name: "cubesat bus" }))).toBe(true);
    expect(classifyExperimental(gapRow({ name: "Pathfinder DemoSat" }))).toBe(true);
    expect(classifyExperimental(gapRow({ name: null, platform_name: null }))).toBe(false);
    expect(classifyExperimental(gapRow({ mass_kg: 500, name: "GEO-COMM-1" }))).toBe(false);
  });
});

describe("seed helpers — SATCAT parsing", () => {
  it("parses numeric fields and treats blanks or NaN as null", () => {
    expect(parseNumber("12.5")).toBe(12.5);
    expect(parseNumber("")).toBeNull();
    expect(parseNumber("NaN")).toBeNull();
  });

  it("parses SATCAT CSV rows, filters decayed objects, and applies fallbacks", () => {
    const csv = [
      "OBJECT_NAME,OBJECT_ID,NORAD_CAT_ID,OBJECT_TYPE,OPS_STATUS_CODE,OWNER,LAUNCH_DATE,DECAY_DATE,PERIOD,INCLINATION,APOGEE,PERIGEE,RCS",
      "ISS,1998-067A,25544,PAY,O,US,1998-11-20,,92.9,51.6,420,418,10.5",
      "DECAYED,1999-001A,10000,DEB,D,US,1999-01-01,2000-01-01,90,45,500,480,1.5",
      "BROKEN,2020-001B,bad,PAY,O,US,2020-01-01,,95,50,600,580,2.5",
      ",2020-001A,20000,XXX,,EU,not-a-date,,100.2,97.4,800,760,",
      ",,30000",
    ].join("\n");

    const rows = parseSatcatCsv(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({
      noradId: 25544,
      name: "ISS",
      objectClass: "payload",
      ownerCode: "US",
      launchYear: 1998,
      opsStatus: "O",
    });
    expect(rows[1]).toMatchObject({
      noradId: 20000,
      name: "NORAD 20000",
      objectClass: "unknown",
      launchYear: null,
      inclinationDeg: 97.4,
      rcsM2: null,
    });
    expect(rows[2]).toMatchObject({
      noradId: 30000,
      name: "NORAD 30000",
      intldes: "",
      objectClass: "unknown",
      ownerCode: null,
      launchYear: null,
      launchDate: null,
      opsStatus: null,
    });
  });

  it("skips blank SATCAT lines and falls back cleanly when optional headers are missing", () => {
    const csv = [
      "NORAD_CAT_ID,DECAY_DATE",
      "",
      "40000,",
      "bad,",
    ].join("\n");

    expect(parseSatcatCsv(csv)).toEqual([
      {
        noradId: 40000,
        name: "NORAD 40000",
        intldes: "",
        objectClass: "unknown",
        ownerCode: null,
        launchYear: null,
        launchDate: null,
        decayDate: null,
        periodMin: null,
        inclinationDeg: null,
        apogeeKm: null,
        perigeeKm: null,
        rcsM2: null,
        opsStatus: null,
      },
    ]);
  });

  it("slugifies names and falls back to a NORAD-only slug when the source is empty", () => {
    expect(slugify("ISS (ZARYA) / TEST", 25544)).toBe("iss-zarya-test-25544");
    expect(slugify("!!!", 5)).toBe("norad-5");
  });

  it("counts inserted versus updated rows during SATCAT upserts", async () => {
    let calls = 0;
    const db = {
      execute: async () => {
        calls++;
        return { rows: [{ inserted: calls === 1 }] };
      },
    } satisfies Parameters<typeof upsertBatch>[0];

    const result = await upsertBatch(db, [
      {
        noradId: 25544,
        name: "ISS",
        intldes: "1998-067A",
        objectClass: "payload",
        ownerCode: "US",
        launchYear: 1998,
        launchDate: "1998-11-20",
        decayDate: null,
        periodMin: 92.9,
        inclinationDeg: 51.6,
        apogeeKm: 420,
        perigeeKm: 418,
        rcsM2: 10.5,
        opsStatus: "O",
      },
      {
        noradId: 20000,
        name: "NORAD 20000",
        intldes: "2020-001A",
        objectClass: "unknown",
        ownerCode: null,
        launchYear: null,
        launchDate: null,
        decayDate: null,
        periodMin: null,
        inclinationDeg: 97.4,
        apogeeKm: 800,
        perigeeKm: 760,
        rcsM2: null,
        opsStatus: null,
      },
    ]);

    expect(calls).toBe(2);
    expect(result).toEqual({ inserted: 1, updated: 1 });
  });
});

describe("seed helpers — seed index TLE and operator logic", () => {
  it("parses TLE epochs and rejects missing or invalid epoch fields", () => {
    expect(parseTleEpoch(SAMPLE_TLE_LINE_1)).toBe("2026-04-23T12:00:00.000Z");
    expect(
      parseTleEpoch(
        SAMPLE_TLE_LINE_1.replace("26113.50000000", "99113.50000000"),
      ),
    ).toBe("1999-04-23T12:00:00.000Z");
    expect(parseTleEpoch("1 25544U 98067A                    ")).toBeNull();
    expect(parseTleEpoch("1 25544U 98067A   XXBAD.EPOCH0000")).toBeNull();
    expect(
      Reflect.apply(parseTleEpoch, null, [
        {
          slice() {
            throw new Error("slice exploded");
          },
        },
      ]),
    ).toBeNull();
  });

  it("parses seed TLE blocks and derives launch year from the intl designator", () => {
    expect(parseSeedTleBlock("ISS", SAMPLE_TLE_LINE_1, SAMPLE_TLE_LINE_2)).toMatchObject({
      name: "ISS",
      noradId: 25544,
      inclination: 51.6434,
      eccentricity: 0.000305,
      meanMotion: 15.49,
      launchYear: 1998,
      epoch: "2026-04-23T12:00:00.000Z",
    });
    expect(
      parseSeedTleBlock(
        "NO-LAUNCH-YEAR",
        "1 25544U AA067A   26113.50000000  .00001264  00000+0  29669-4 0  9995",
        SAMPLE_TLE_LINE_2,
      ),
    ).toMatchObject({
      launchYear: null,
    });
    expect(
      parseSeedTleBlock(
        "BAD-MM",
        SAMPLE_TLE_LINE_1,
        SAMPLE_TLE_LINE_2.replace("15.49000000", "XX.INVALID "),
      ),
    ).toBeNull();
    expect(
      parseSeedTleBlock(
        "MODERN",
        "1 25544U 24067A   26113.50000000  .00001264  00000+0  29669-4 0  9995",
        SAMPLE_TLE_LINE_2,
      ),
    ).toMatchObject({
      launchYear: 2024,
    });
    expect(parseSeedTleBlock("BROKEN", "bad", SAMPLE_TLE_LINE_2)).toBeNull();
    expect(
      Reflect.apply(parseSeedTleBlock, null, [
        "EXPLODED",
        {
          slice() {
            throw new Error("slice exploded");
          },
        },
        SAMPLE_TLE_LINE_2,
      ]),
    ).toBeNull();
  });

  it("classifies seed-index TLE regimes from eccentricity, period, and inclination", () => {
    const base = {
      name: "SAT",
      noradId: 1,
      meanMotion: 15.5,
      inclination: 51.6,
      eccentricity: 0,
      launchYear: null,
      line1: SAMPLE_TLE_LINE_1,
      line2: SAMPLE_TLE_LINE_2,
      epoch: null,
    } satisfies NonNullable<ReturnType<typeof parseSeedTleBlock>>;

    expect(classifySeedRegime({ ...base, eccentricity: 0.3, meanMotion: 2.2 })).toBe("gto");
    expect(classifySeedRegime({ ...base, eccentricity: 0.3, meanMotion: 1.1 })).toBe("heo");
    expect(classifySeedRegime({ ...base, meanMotion: 1.002 })).toBe("geo");
    expect(classifySeedRegime({ ...base, meanMotion: 2.0 })).toBe("meo");
    expect(classifySeedRegime({ ...base, meanMotion: 14.9, inclination: 98.2 })).toBe("sso");
    expect(classifySeedRegime(base)).toBe("leo");
  });

  it("guesses operators from prefixes, substrings, and unknown names", () => {
    expect(guessOperator("STARLINK-1000")).toBe("spacex");
    expect(guessOperator("COSMOS 2550")).toBe("roscosmos");
    expect(guessOperator("MY ISS DEMO")).toBe("nasa");
    expect(guessOperator("UNKNOWN SAT")).toBe("other");
  });

  it("maps operator slugs to countries and falls back to other", () => {
    expect(guessCountry("STARLINK-1000", "spacex")).toBe("us");
    expect(guessCountry("ESA-SAT", "esa")).toBe("eu");
    expect(guessCountry("COSMOS", "roscosmos")).toBe("ru");
    expect(guessCountry("BEIDOU", "cnsa")).toBe("cn");
    expect(guessCountry("GSAT", "isro")).toBe("in");
    expect(guessCountry("QZS", "jaxa")).toBe("jp");
    expect(guessCountry("ONEWEB-1", "oneweb")).toBe("eu");
    expect(guessCountry("AIRBUS", "airbus-ds")).toBe("eu");
    expect(guessCountry("EUTELSAT", "eutelsat")).toBe("eu");
    expect(guessCountry("INTELSAT-1", "intelsat")).toBe("us");
    expect(guessCountry("IRIDIUM-1", "iridium")).toBe("us");
    expect(guessCountry("SES-1", "ses")).toBe("eu");
    expect(guessCountry("IMAGESAT", "imagesat")).toBe("il");
    expect(guessCountry("MYSTERY", "other")).toBe("other");
  });

  it("slugifies seed names by collapsing punctuation", () => {
    expect(toSlug("ISS (ZARYA)")).toBe("iss-zarya");
    expect(toSlug("STARLINK 1000 / ALPHA")).toBe("starlink-1000-alpha");
  });
});

describe("seed helpers — update-tle parsing", () => {
  it("parses update-tle blocks with epoch, angles, and mean motion", () => {
    expect(parseUpdateTleBlock(SAMPLE_TLE_LINE_1, SAMPLE_TLE_LINE_2)).toMatchObject({
      noradId: 25544,
      inclination: 51.6434,
      raan: 42.2123,
      eccentricity: 0.000305,
      argPerigee: 91.7,
      meanAnomaly: 12.8,
      meanMotion: 15.49,
      epoch: "2026-04-23T12:00:00.000Z",
    });
    expect(
      parseUpdateTleBlock(
        SAMPLE_TLE_LINE_1.replace("26113.50000000", "99113.50000000"),
        SAMPLE_TLE_LINE_2,
      )?.epoch,
    ).toBe("1999-04-23T12:00:00.000Z");
    expect(parseUpdateTleBlock("bad", SAMPLE_TLE_LINE_2)).toBeNull();
    expect(
      parseUpdateTleBlock(
        SAMPLE_TLE_LINE_1,
        SAMPLE_TLE_LINE_2.replace("15.49000000", "XX.INVALID "),
      ),
    ).toBeNull();
    expect(
      Reflect.apply(parseUpdateTleBlock, null, [SAMPLE_TLE_LINE_1, undefined]),
    ).toBeNull();
  });
});

describe("seed helpers — conjunction TLE synthesis", () => {
  it("scales sigma by regime and clamps negative propagation days", () => {
    expect(sigmaKmFor("LEO", 0, 2)).toBe(0.8);
    expect(sigmaKmFor("SSO", 0, 2)).toBe(0.8);
    expect(sigmaKmFor("MEO", 0, 2)).toBe(1.1);
    expect(sigmaKmFor("GTO", 0, 2)).toBe(2.2);
    expect(sigmaKmFor("HEO", 0, 2)).toBe(2.7);
    expect(sigmaKmFor("GEO", 0, 10)).toBe(4.2);
    expect(sigmaKmFor("", 0, 1)).toBe(1.1);
    expect(sigmaKmFor("unknown", 0, -5)).toBe(1);
  });

  it("pads integers, computes TLE checksums, and formats eccentricity bounds", () => {
    expect(pad(42, 5)).toBe("00042");
    expect(tleChecksum("1 00005U 58002B   24001.00000000  .00000000  00000-0  00000-0 0  999")).toBe(7);
    expect(formatEccentricity(0.000305)).toBe("0003050");
    expect(formatEccentricity(5)).toBe("9999999");
    expect(formatEccentricity(-1)).toBe("0000000");
  });

  it("synthesizes valid-looking TLE lines with checksums and deterministic orbital fields", () => {
    const [line1, line2] = synthesizeTLE(
      {
        id: 1n,
        name: "STARLINK-1000",
        noradId: 25544,
        meanMotion: 15.49,
        inclination: 51.6434,
        eccentricity: 0.000305,
        regime: "LEO",
      },
      new Date("2026-04-23T12:00:00.000Z"),
    );

    expect(line1).toHaveLength(69);
    expect(line2).toHaveLength(69);
    expect(line1.startsWith("1 25544U")).toBe(true);
    expect(line2.startsWith("2 25544")).toBe(true);
    expect(line2).toContain("0003050");
    expect(line2).toContain("15.49000000");
    expect(Number(line1[68])).toBe(tleChecksum(line1));
    expect(Number(line2[68])).toBe(tleChecksum(line2));
  });
});
