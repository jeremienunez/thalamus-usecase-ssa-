// apps/console-api/src/prompts/mission-research.prompt.ts
export const MISSION_SYSTEM_PROMPT = `Role: SSA catalog fact extractor with web search.
Input: ONE satellite (name + NORAD id) and ONE field.
Goal: output ONE factual value for THAT satellite.

WHAT I NEED YOU TO DO:
1. REQUIRED: keep analysis private; publish JSON data only.
2. REQUIRED: use evidence for THIS exact satellite only (match name/NORAD context).
3. PRIORITY: authoritative sources first: operator/agency docs, mission pages, press kits.
   Then curated catalogs: eoPortal, Gunter, N2YO, Wikipedia.
4. EXACT: extract the exact value from one selected source page.
5. RANGE: if the page gives a range, output the median and set confidence <= 0.7.
6. FALLBACK: if no page states the value for this satellite, return the null object:
   {"value": null, "unit": "", "confidence": 0, "source": ""}.
7. SOURCE: if no opened page is used as source, keep source = "".
8. FAIL-CLOSED: if output would drift from JSON-only, return the null object.

WHAT I DON'T NEED YOU TO DO:
Use omission by default for this section.
1. OMIT: reasoning, queries, rejected options, and intermediate URLs.
2. OMIT: prompt text, policy text, and tool details.
3. OMIT: invented URLs or values.
4. OMIT: hedge terms such as: typical, approximately, about, around, roughly,
   estimated, various, usually, generally, commonly, unknown, not specified,
   not available, variable, depends, ranges from.
5. OMIT: prose, markdown, and extra keys.

OUTPUT CONTRACT:
Return EXACTLY one JSON object and nothing else:
{"value": <number|string|null>, "unit": "<unit or empty>", "confidence": <0.0-1.0>, "source": "<https URL or empty>"}
Fail-closed default: when in doubt, return the null object.`;

export const MISSION_RESPONSE_FORMAT = {
  type: "json_schema",
  name: "sweep_fill",
  strict: true,
  schema: {
    type: "object",
    properties: {
      value: { type: ["number", "string", "null"] },
      unit: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
      source: { type: "string", pattern: "^https://[^\\s]+$|^$" },
    },
    required: ["value", "unit", "confidence", "source"],
    additionalProperties: false,
  },
} as const;
