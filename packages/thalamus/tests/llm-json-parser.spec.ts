import { describe, expect, it } from "vitest";
import { safeParseJson } from "../src/cortices/cortex-llm";
import { extractJsonObject } from "@interview/shared/utils";

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

  it("strips markdown code fences around a JSON object", () => {
    const raw = '```json\n{"findings":[{"title":"t"}]}\n```';

    const parsed = safeParseJson(raw);

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.title).toBe("t");
  });

  it("recovers a JSON object preceded by prose", () => {
    const raw = 'Here is my analysis.\n{"findings":[]}';

    const parsed = extractJsonObject(raw);

    expect(parsed).toEqual({ findings: [] });
  });

  it("returns empty findings when a trailing comma leaves the payload invalid", () => {
    const raw = '{"findings":[],}';

    expect(safeParseJson(raw)).toEqual({ findings: [] });
  });

  it("returns empty findings when the JSON string is unterminated", () => {
    const raw = '{"findings":[{"title":"unfinished';

    expect(safeParseJson(raw)).toEqual({ findings: [] });
  });

  it("preserves escaped newlines inside string values", () => {
    const raw = '{"findings":[{"title":"line\\nbreak"}]}';

    const parsed = safeParseJson(raw);

    expect(parsed.findings[0]?.title).toBe("line\nbreak");
  });

  it("prefers the first complete JSON object when concatenated outputs differ", () => {
    const raw = '{"findings":[{"title":"first"}]}\n{"findings":[{"title":"second"}]}';

    const parsed = safeParseJson(raw);

    expect(parsed.findings).toHaveLength(1);
    expect(parsed.findings[0]?.title).toBe("first");
  });
});
