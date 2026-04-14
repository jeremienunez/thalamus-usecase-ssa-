/**
 * SPEC-SH-004 — Domain Normalizer
 * Examples intentionally drawn from the SSA domain (satellite / debris names)
 * to keep the tests aligned with the repo's CortAIx framing. The normalizer
 * itself is domain-agnostic.
 *
 * Traceability:
 *   AC-1 default options fold case, whitespace, diacritics
 *   AC-2 normalization is idempotent
 *   AC-3 separator variants collapse to canonical separator
 *   AC-4 non-folded characters remain distinguishing
 *   AC-5 empty and whitespace-only inputs return empty canonical
 *   AC-6 stripDiacritics=false preserves accents
 *   AC-7 original field round-trips the input
 *   (AC-8 is a bench, covered in .bench.ts)
 */
import { describe, it, expect } from "vitest";
import {
  normalizeDomain,
  canonical,
} from "../src/utils/domain-normalizer";

describe("SPEC-SH-004 normalizeDomain — defaults", () => {
  it("AC-1 folds case, trims, strips diacritics, normalizes separator", () => {
    const r = normalizeDomain("  Sentinel-2A  ");
    expect(r.canonical).toBe("sentinel-2a");
    expect(r.strippedDiacritics).toBe(false);
  });

  it("AC-1 strips Latin diacritics (NFD) by default", () => {
    const r = normalizeDomain("Élégant Spöt");
    expect(r.canonical).toBe("elegant-spot");
    expect(r.strippedDiacritics).toBe(true);
  });

  it("AC-1 keeps digits as part of the token", () => {
    const r = normalizeDomain("Cosmos 2553");
    expect(r.canonical).toBe("cosmos-2553");
  });

  it("AC-3 separator variants collapse to canonical '-'", () => {
    expect(canonical("foo bar")).toBe("foo-bar");
    expect(canonical("foo_bar")).toBe("foo-bar");
    expect(canonical("foo--bar")).toBe("foo-bar");
    expect(canonical("foo  \t  bar")).toBe("foo-bar");
    expect(canonical("foo - _ bar")).toBe("foo-bar");
  });

  it("AC-3 all variants collapse to the same canonical form", () => {
    const variants = [
      "ISS ZARYA",
      "iss zarya",
      "ISS_ZARYA",
      "iss--zarya",
      "  ISS  zarya  ",
    ];
    const canonicals = variants.map((v) => canonical(v));
    expect(new Set(canonicals).size).toBe(1);
    expect(canonicals[0]).toBe("iss-zarya");
  });

  it("AC-4 non-folded characters (digits, distinct letters) stay distinguishing", () => {
    expect(canonical("cosmos-2553")).not.toBe(canonical("cosmos-2554"));
    expect(canonical("sentinel-2a")).not.toBe(canonical("sentinel-2b"));
  });
});

describe("SPEC-SH-004 normalizeDomain — idempotence & originality", () => {
  it("AC-2 idempotent: canonical(canonical(s)) === canonical(s)", () => {
    const inputs = [
      "  Élégant Spöt  ",
      "ISS (Zarya)",
      "foo___bar   baz",
      "  ---  ",
      "Cosmos 2553",
      "",
    ];
    for (const s of inputs) {
      const once = canonical(s);
      const twice = canonical(once);
      expect(twice).toBe(once);
    }
  });

  it("AC-7 result.original always equals the input verbatim", () => {
    const inputs = [
      "  Sentinel-2A  ",
      "ENVISAT",
      "",
      "   ",
      "Élégant",
    ];
    for (const s of inputs) {
      const r = normalizeDomain(s);
      expect(r.original).toBe(s);
    }
  });
});

describe("SPEC-SH-004 normalizeDomain — pathological inputs", () => {
  it("AC-5 empty string returns empty canonical, no throw", () => {
    expect(() => normalizeDomain("")).not.toThrow();
    expect(normalizeDomain("").canonical).toBe("");
  });

  it("AC-5 whitespace-only returns empty canonical", () => {
    expect(normalizeDomain("   ").canonical).toBe("");
    expect(normalizeDomain("\t\n\r").canonical).toBe("");
  });

  it("AC-5 punctuation/separator-only returns empty canonical", () => {
    expect(normalizeDomain("---").canonical).toBe("");
    expect(normalizeDomain("___").canonical).toBe("");
    expect(normalizeDomain(" - _ - ").canonical).toBe("");
  });

  it("does not throw on very long input (≤100k chars)", () => {
    const big = "a".repeat(100_000);
    expect(() => normalizeDomain(big)).not.toThrow();
    expect(normalizeDomain(big).canonical.length).toBe(100_000);
  });
});

describe("SPEC-SH-004 normalizeDomain — options", () => {
  it("AC-6 stripDiacritics=false preserves accents", () => {
    const r = normalizeDomain("Élégant", { stripDiacritics: false });
    expect(r.canonical).toBe("élégant");
    expect(r.strippedDiacritics).toBe(false);
  });

  it("separator='_' replaces runs with underscore", () => {
    expect(canonical("foo bar baz", { separator: "_" })).toBe("foo_bar_baz");
    expect(canonical("foo-bar", { separator: "_" })).toBe("foo_bar");
  });

  it("separator='' removes separators entirely", () => {
    expect(canonical("foo bar baz", { separator: "" })).toBe("foobarbaz");
    expect(canonical("foo-bar_baz", { separator: "" })).toBe("foobarbaz");
  });

  it("lowercase=false preserves case", () => {
    const r = normalizeDomain("ISS Zarya", { lowercase: false });
    expect(r.canonical).toBe("ISS-Zarya");
  });
});
