import { describe, it, expect } from "vitest";
import {
  gcatStrategy,
  celestrakStrategy,
  privateTelemetryStrategy,
  defaultFallbackStrategy,
  CompositeCitationResolver,
  createDefaultCitationResolver,
  type CitationStrategy,
} from "../../../../../src/agent/ssa/sweep/citation-resolver.ssa";

describe("gcatStrategy", () => {
  it("returns a GCAT citation for mass_kg", () => {
    // Why: mass is authoritatively sourced from GCAT. Regressing this string
    // would make reviewers dismiss valid suggestions as unsourced.
    expect(gcatStrategy.resolve("mass_kg")).toMatch(/GCAT/);
  });

  it("returns null for a column it does not own (contract: composite passthrough)", () => {
    // Why: strategies MUST return null when they don't match so the
    // composite can try the next one. Returning a generic string here
    // would short-circuit every subsequent strategy.
    expect(gcatStrategy.resolve("power_draw")).toBeNull();
    expect(gcatStrategy.resolve("totally_unknown_column")).toBeNull();
  });
});

describe("celestrakStrategy", () => {
  it("handles only platform_class_id", () => {
    // Why: CelesTrak's contribution is narrow (platform class inference).
    // Tests pin the scope so a refactor doesn't accidentally widen it.
    expect(celestrakStrategy.resolve("platform_class_id")).toMatch(/CelesTrak/);
    expect(celestrakStrategy.resolve("mass_kg")).toBeNull();
    expect(celestrakStrategy.resolve("power_draw")).toBeNull();
  });
});

describe("privateTelemetryStrategy", () => {
  it("flags an operator-private column with sim-fish + SIM_UNCORROBORATED", () => {
    // Why: telemetry must be marked unverified so simulated values never
    // look like facts downstream.
    const citation = privateTelemetryStrategy.resolve("power_draw");
    expect(citation).toMatch(/sim-fish/);
    expect(citation).toMatch(/SIM_UNCORROBORATED/);
  });

  it("returns null for a public column", () => {
    // Why: mass is public; routing it to sim-fish would tag authoritative
    // data as unverified. This test prevents the set being accidentally
    // extended.
    expect(privateTelemetryStrategy.resolve("mass_kg")).toBeNull();
  });
});

describe("defaultFallbackStrategy", () => {
  it("always returns an operator-ingest citation mentioning the column", () => {
    // Why: the fallback is the last line of defense — it must ALWAYS return
    // a non-null string so the composite never fails to cite. Including the
    // column name forces reviewers to notice unmapped columns.
    const citation = defaultFallbackStrategy.resolve("some_new_column");
    expect(citation).not.toBeNull();
    expect(citation).toMatch(/operator ingest/);
    expect(citation).toContain("some_new_column");
  });
});

describe("CompositeCitationResolver", () => {
  it("uses the first strategy whose resolve returns non-null (order matters)", () => {
    // Why: OCP payoff — extending the resolver means prepending/appending
    // strategies, not editing the chain logic. This test pins that the
    // earlier strategy wins.
    const winner: CitationStrategy = { resolve: () => "WINNER" };
    const loser: CitationStrategy = { resolve: () => "LOSER" };
    const composite = new CompositeCitationResolver([winner, loser]);

    expect(composite.resolve("anything")).toBe("WINNER");
  });

  it("skips strategies that return null and falls through to the next one", () => {
    // Why: without this fall-through behavior, the composite would return
    // null on the first uninterested strategy and the fallback would never
    // be reached.
    const skip: CitationStrategy = { resolve: () => null };
    const hit: CitationStrategy = { resolve: () => "HIT" };
    const composite = new CompositeCitationResolver([skip, hit]);

    expect(composite.resolve("whatever")).toBe("HIT");
  });

  it("uses the defensive operator-ingest fallback when the strategy chain is empty", () => {
    const composite = new CompositeCitationResolver([]);

    expect(composite.resolve("orphan_column")).toContain("orphan_column");
  });
});

describe("createDefaultCitationResolver (integration)", () => {
  const resolver = createDefaultCitationResolver();

  it("routes mass_kg to GCAT (gcatStrategy precedes fallback)", () => {
    expect(resolver.resolve("mass_kg")).toMatch(/GCAT/);
  });

  it("routes platform_class_id to CelesTrak", () => {
    expect(resolver.resolve("platform_class_id")).toMatch(/CelesTrak/);
  });

  it("routes power_draw to sim-fish (private telemetry strategy wins)", () => {
    expect(resolver.resolve("power_draw")).toMatch(/sim-fish/);
  });

  it("falls back to operator ingest for an unknown column", () => {
    // Why: end-to-end guarantee — an unmapped column never returns null or
    // bleeds into a specialised source citation.
    const citation = resolver.resolve("brand_new_column_z");
    expect(citation).toMatch(/operator ingest/);
    expect(citation).not.toMatch(/GCAT|CelesTrak|sim-fish/);
  });
});
