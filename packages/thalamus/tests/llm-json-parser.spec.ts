import { describe, expect, it } from "vitest";

import { safeParseJson } from "../src/cortices/cortex-llm";
import { extractJsonObject } from "../src/utils/llm-json-parser";

describe("llm-json-parser", () => {
  it("recovers the first balanced JSON object from concatenated outputs", () => {
    const parsed = extractJsonObject('{"findings":[]}\n{"findings":[]}');

    expect(parsed).toEqual({ findings: [] });
  });

  it("preserves findings when the LLM duplicates the same top-level object", () => {
    const raw =
      '{"findings":[{"title":"MANEUVER: accept candidate","summary":"Source findings align.","findingType":"strategy","urgency":"high","confidence":0.8,"impactScore":8,"evidence":[{"source":"synthesis","weight":1}],"edges":[]}]}'
      + "\n"
      + '{"findings":[{"title":"MANEUVER: accept candidate","summary":"Source findings align.","findingType":"strategy","urgency":"high","confidence":0.8,"impactScore":8,"evidence":[{"source":"synthesis","weight":1}],"edges":[]}]}';

    const parsed = safeParseJson(raw);

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.title).toBe("MANEUVER: accept candidate");
  });
});
