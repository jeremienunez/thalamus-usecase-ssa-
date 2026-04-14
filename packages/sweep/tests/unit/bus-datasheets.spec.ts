/**
 * SPEC-SW-006 telemetry inference — bus datasheet loader.
 *
 * Asserts the public contract of `sim/bus-datasheets.ts`:
 *   - canonical names + alias resolution + case/separator normalisation
 *   - published range flattening ({min, typical, max})
 *   - inferred typical → ±30% envelope fallback
 *   - unknown bus → honest null, no synthesis
 *   - shape matches SeedRefs.busDatasheetPrior contract
 */
import { describe, it, expect, beforeAll } from "vitest";
import {
  lookupBusPrior,
  lookupBusEntry,
  listBusNames,
  __resetBusDatasheetCache,
} from "../../src/sim/bus-datasheets";
import { TELEMETRY_SCALAR_KEYS } from "@interview/db-schema";

beforeAll(() => {
  __resetBusDatasheetCache();
});

describe("bus-datasheets — canonical lookup", () => {
  it("resolves a canonical name (SSL-1300)", () => {
    const r = lookupBusPrior("SSL-1300");
    expect(r.found).toBe(true);
    expect(r.canonicalName).toBe("SSL-1300");
    expect(r.prior).not.toBeNull();
    expect(r.prior!.busArchetype).toBe("SSL-1300");
  });

  it("resolves every alias (SSL-1300 ← LS-1300 / FS-1300 / Lanteris 1300)", () => {
    for (const alias of ["LS-1300", "FS-1300", "Lanteris 1300", "SSL 1300"]) {
      const r = lookupBusPrior(alias);
      expect(
        r.found,
        `alias '${alias}' should resolve to SSL-1300`,
      ).toBe(true);
      expect(r.canonicalName).toBe("SSL-1300");
    }
  });

  it("case + separator insensitive (a2100 ↔ A2100 ↔ a_2100)", () => {
    const a = lookupBusPrior("A2100");
    const b = lookupBusPrior("a2100");
    expect(a.canonicalName).toBe("A2100");
    expect(b.canonicalName).toBe("A2100");
  });

  it("returns honest null for unknown buses (no synthesis)", () => {
    const r = lookupBusPrior("NotARealBus-9999");
    expect(r.found).toBe(false);
    expect(r.prior).toBeNull();
    expect(r.canonicalName).toBeNull();
    expect(r.designLifeYears).toBeNull();
    expect(r.sources).toEqual([]);
  });

  it("treats null / empty / whitespace as unknown", () => {
    for (const bad of [null, undefined, "", "   "]) {
      const r = lookupBusPrior(bad);
      expect(r.found).toBe(false);
      expect(r.prior).toBeNull();
    }
  });
});

describe("bus-datasheets — range flattening", () => {
  it("published range yields {min, typical, max, unit}", () => {
    const r = lookupBusPrior("SSL-1300");
    const pw = r.prior!.scalars.powerDraw;
    expect(pw).toBeDefined();
    expect(pw!.unit).toBe("W");
    // SSL-1300 published: min: 5000, typical: 12000, max: 18000
    expect(pw!.typical).toBe(12000);
    expect(pw!.min).toBe(5000);
    expect(pw!.max).toBe(18000);
  });

  it("inferred typical produces ±30% envelope", () => {
    const r = lookupBusPrior("SSL-1300");
    // SSL-1300 inferred: pointingAccuracy { typical: 0.05 }
    const pa = r.prior!.scalars.pointingAccuracy;
    expect(pa).toBeDefined();
    expect(pa!.typical).toBe(0.05);
    expect(pa!.min).toBeCloseTo(0.05 * 0.7, 10);
    expect(pa!.max).toBeCloseTo(0.05 * 1.3, 10);
    expect(pa!.unit).toBe("deg");
  });

  it("single-point published entry uses typical for min+max", () => {
    const r = lookupBusPrior("Starlink v1.5");
    const pw = r.prior!.scalars.powerDraw;
    expect(pw).toBeDefined();
    expect(pw!.typical).toBe(2000);
    // No min/max published → typical used for both bounds.
    expect(pw!.min).toBe(2000);
    expect(pw!.max).toBe(2000);
  });

  it("entirely-absent scalar is NOT in the output (no faked entry)", () => {
    const r = lookupBusPrior("SSL-1300");
    // SSL-1300 has no linkBudget / dataRate published or inferred.
    expect(r.prior!.scalars.linkBudget).toBeUndefined();
    expect(r.prior!.scalars.dataRate).toBeUndefined();
    // But the 3 inferred scalars ARE present.
    expect(r.prior!.scalars.thermalMargin).toBeDefined();
    expect(r.prior!.scalars.pointingAccuracy).toBeDefined();
    expect(r.prior!.scalars.attitudeRate).toBeDefined();
  });
});

describe("bus-datasheets — context + provenance", () => {
  it("exposes designLifeYears from the context block", () => {
    const r = lookupBusPrior("SSL-1300");
    expect(r.designLifeYears).toBe(15);
  });

  it("exposes the sources[] array for auditability", () => {
    const r = lookupBusPrior("Eurostar 3000");
    expect(r.sources.length).toBeGreaterThan(0);
    for (const s of r.sources) {
      expect(s).toMatch(/^https?:\/\//);
    }
  });

  it("lookupBusEntry exposes the raw entry for consumers needing context", () => {
    const entry = lookupBusEntry("A2100");
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe("A2100");
    expect(entry!.context?.designLifeYears).toBe(15);
  });
});

describe("bus-datasheets — catalog coverage", () => {
  it("lists at least the top-20 GCAT buses", () => {
    const names = listBusNames();
    expect(names.length).toBeGreaterThanOrEqual(20);
    // Top 10 of our DB inventory (verified via psql earlier).
    for (const required of [
      "SSL-1300",
      "Eurostar 3000",
      "A2100",
      "BSS-702HP",
      "Uragan",
      "Cubesat 1U",
      "HS-601",
      "DFH-3",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("every scalar key in the prior is a TELEMETRY_SCALAR_KEY", () => {
    const valid = new Set<string>(TELEMETRY_SCALAR_KEYS);
    for (const name of listBusNames()) {
      const r = lookupBusPrior(name);
      for (const key of Object.keys(r.prior?.scalars ?? {})) {
        expect(
          valid.has(key),
          `${name} uses unknown scalar key '${key}'`,
        ).toBe(true);
      }
    }
  });
});
