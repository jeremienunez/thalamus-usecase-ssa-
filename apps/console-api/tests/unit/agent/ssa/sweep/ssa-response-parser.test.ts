import { describe, it, expect, vi, afterEach } from "vitest";
import {
  parseLlmSuggestions,
  validCategory,
  validSeverity,
  type OperatorCountryLookup,
} from "../../../../../src/agent/ssa/sweep/ssa-response-parser.ssa";

const ocs: OperatorCountryLookup[] = [
  { id: 42n, name: "Testland" },
  { id: 99n, name: "Otherland" },
];

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validCategory / validSeverity", () => {
  it("passes through whitelisted categories", () => {
    expect(validCategory("mass_anomaly")).toBe("mass_anomaly");
    expect(validCategory("briefing_angle")).toBe("briefing_angle");
  });

  it("coerces an unknown category to 'enrichment'", () => {
    // Why: unknown values from the LLM must never hit the DB as-is, or they
    // break the indexedFields filter in ssaFindingSchema.
    expect(validCategory("not_a_real_category")).toBe("enrichment");
  });

  it("coerces an unknown severity to 'info'", () => {
    // Why: same rationale as category. `info` is the safest/lowest level
    // so a bad LLM output doesn't get promoted to `critical`.
    expect(validSeverity("LOW")).toBe("info");
    expect(validSeverity("")).toBe("info");
  });

  it("passes through valid severities", () => {
    expect(validSeverity("critical")).toBe("critical");
    expect(validSeverity("warning")).toBe("warning");
    expect(validSeverity("info")).toBe("info");
  });
});

describe("parseLlmSuggestions: robust to bad LLM output", () => {
  it("returns [] when the text contains no JSON array", () => {
    // Why: the regex `/\[[\s\S]*\]/` matches nothing. Before this fix the
    // function would have returned `[].map(...)` which is fine, but a
    // regression to direct JSON.parse on the whole text would throw.
    expect(parseLlmSuggestions("just some prose here", ocs)).toEqual([]);
  });

  it("returns [] when the bracket region is malformed JSON", () => {
    // Why: the LLM occasionally emits `[not valid json]` — a JSON.parse
    // without try/catch would abort the whole wave. This test pins the
    // defensive try/catch.
    expect(parseLlmSuggestions("[not, valid,,, json]", ocs)).toEqual([]);
  });

  it("returns [] when the parsed value is not an array", () => {
    // Why: `Array.isArray(parsed)` is the last guard before `.filter(...)`.
    // We force the parse seam to yield a non-array object so the branch is
    // exercised directly instead of relying on malformed JSON.
    vi.spyOn(JSON, "parse").mockReturnValueOnce({ results: [] });
    const text = `[{"operatorCountry":"Testland","category":"missing_data","title":"T"}]`;

    expect(parseLlmSuggestions(text, ocs)).toEqual([]);
  });

  it("returns [] for an explicitly empty JSON array", () => {
    expect(parseLlmSuggestions("[]", ocs)).toEqual([]);
  });
});

describe("parseLlmSuggestions: filtering + coercion", () => {
  it("drops items missing operatorCountry, category, or title", () => {
    // Why: these three are required to render a reviewer card. Without
    // them the finding is unusable, so we skip silently rather than emit
    // garbage.
    const text = JSON.stringify([
      { category: "missing_data", title: "no oc" }, // no operatorCountry
      { operatorCountry: "Testland", title: "no cat" }, // no category
      { operatorCountry: "Testland", category: "missing_data" }, // no title
      {
        operatorCountry: "Testland",
        category: "missing_data",
        title: "OK",
      },
    ]);

    const result = parseLlmSuggestions(text, ocs);

    expect(result).toHaveLength(1);
    expect(result[0]!.domainFields.title).toBe("OK");
  });

  it("coerces invalid category and severity inside the candidate", () => {
    // Why: even when required fields are present, the LLM may emit off-
    // vocabulary enums. The parser must rescue the candidate by coercing
    // to `enrichment` / `info` rather than dropping it (loses an insight).
    const text = JSON.stringify([
      {
        operatorCountry: "Testland",
        category: "🚀_not_a_cat",
        severity: "apocalyptic",
        title: "T",
      },
    ]);

    const [c] = parseLlmSuggestions(text, ocs);

    expect(c!.domainFields.category).toBe("enrichment");
    expect(c!.domainFields.severity).toBe("info");
  });

  it("truncates title to 200, description to 1000, suggestedAction to 500", () => {
    // Why: defensive cap against runaway LLM output blowing up Redis
    // payload size. The exact numbers match the contract agreed with the
    // reviewer UI — changing them is a breaking change.
    const big = "x".repeat(5000);
    const text = JSON.stringify([
      {
        operatorCountry: "Testland",
        category: "missing_data",
        title: big,
        description: big,
        suggestedAction: big,
      },
    ]);

    const [c] = parseLlmSuggestions(text, ocs);

    expect((c!.domainFields.title as string).length).toBe(200);
    expect((c!.domainFields.description as string).length).toBe(1000);
    expect((c!.domainFields.suggestedAction as string).length).toBe(500);
  });

  it("resolves operatorCountryId via case-insensitive name lookup", () => {
    // Why: the LLM sometimes lowercases/titlecases country names
    // inconsistently. Without case-insensitive matching, ids come back
    // null and the reviewer UI can't link back to the entity.
    const text = JSON.stringify([
      {
        operatorCountry: "TESTLAND",
        category: "missing_data",
        title: "T",
      },
    ]);

    const [c] = parseLlmSuggestions(text, ocs);

    expect(c!.domainFields.operatorCountryId).toBe(42n);
  });

  it("leaves operatorCountryId as null when no lookup row matches", () => {
    // Why: unknown operator-country from LLM must not crash the cycle. It
    // simply has no id to link — reviewer sees a candidate without a
    // navigation target.
    const text = JSON.stringify([
      {
        operatorCountry: "Nowhereland",
        category: "missing_data",
        title: "T",
      },
    ]);

    const [c] = parseLlmSuggestions(text, ocs);

    expect(c!.domainFields.operatorCountryId).toBeNull();
  });

  it("defaults operatorCountryName to an empty string if a prefiltered parsed item reaches mapping without one", () => {
    const parsedItems: Record<string, unknown>[] = [
      {
        operatorCountry: undefined,
        category: "missing_data",
        title: "T",
      },
    ];
    Object.defineProperty(parsedItems, "filter", {
      value: () => parsedItems,
    });
    vi.spyOn(JSON, "parse").mockReturnValueOnce(parsedItems);

    const [c] = parseLlmSuggestions(
      '[{"operatorCountry":"placeholder","category":"missing_data","title":"T"}]',
      ocs,
    );

    expect(c!.domainFields.operatorCountryName).toBe("");
  });
});

describe("parseLlmSuggestions: resolutionPayload Zod boundary", () => {
  it("stringifies a valid resolutionPayload", () => {
    // Why: the parser runs Zod on the LLM-supplied payload and stores the
    // validated+serialised form. Without this step the reviewer would act
    // on unvalidated instructions.
    const text = JSON.stringify([
      {
        operatorCountry: "Testland",
        category: "missing_data",
        title: "T",
        resolutionPayload: {
          actions: [
            {
              kind: "update_field",
              field: "mass_kg",
              value: null,
              satelliteIds: ["1", "2"],
            },
          ],
        },
      },
    ]);

    const [c] = parseLlmSuggestions(text, ocs);

    expect(c!.resolutionPayload).not.toBeNull();
    const parsed = JSON.parse(c!.resolutionPayload!);
    expect(parsed.actions[0].kind).toBe("update_field");
  });

  it("keeps the candidate but sets resolutionPayload=null when Zod rejects", () => {
    // Why: an invalid payload should NOT nuke the whole candidate — the
    // domain fields are still a valid finding. Reviewer just loses the
    // one-click action. The OPPOSITE behavior (dropping the candidate)
    // would be more destructive than the bug.
    const text = JSON.stringify([
      {
        operatorCountry: "Testland",
        category: "missing_data",
        title: "T",
        resolutionPayload: {
          actions: [{ kind: "INVALID_KIND", field: "mass_kg" }],
        },
      },
    ]);

    const [c] = parseLlmSuggestions(text, ocs);

    expect(c).toBeDefined();
    expect(c!.resolutionPayload).toBeNull();
  });
});
