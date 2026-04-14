import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { BriefingRenderer } from "../../src/renderers/briefing";

describe("BriefingRenderer", () => {
  it("renders executive summary + bullets with source-class colored tags", () => {
    const findings = [
      { id: "F1", summary: "Risky conj", sourceClass: "FIELD" as const, confidence: 0.9, evidenceRefs: ["S1"] },
      { id: "F2", summary: "Media hint", sourceClass: "OSINT" as const, confidence: 0.4, evidenceRefs: ["S2"] },
    ];
    const { lastFrame } = render(
      <BriefingRenderer
        executiveSummary="Two candidates flagged."
        findings={findings}
        recommendedActions={["accept F1"]}
        followUpPrompts={["why F1?"]}
      />,
    );
    const f = lastFrame() ?? "";
    expect(f).toContain("Two candidates flagged.");
    expect(f).toContain("F1");
    expect(f).toContain("FIELD");
    expect(f).toContain("OSINT");
  });
});
