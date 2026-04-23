import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { BriefingRenderer } from "../../src/renderers/briefing";
import { CandidatesRenderer } from "../../src/renderers/candidates";
import { ClarifyRenderer } from "../../src/renderers/clarify";
import { GraphTreeRenderer } from "../../src/renderers/graphTree";
import { LogTailRenderer } from "../../src/renderers/logTail";
import { PcEstimatorRenderer } from "../../src/renderers/pcEstimator";
import { TelemetryRenderer } from "../../src/renderers/telemetry";
import { WhyTreeRenderer } from "../../src/renderers/whyTree";

describe("BriefingRenderer", () => {
  it("renders findings, actions, and follow-up prompts", () => {
    const { lastFrame } = render(
      <BriefingRenderer
        executiveSummary="Two candidates flagged."
        findings={[
          {
            id: "F1",
            summary: "Risky conj",
            sourceClass: "FIELD",
            confidence: 0.9,
            evidenceRefs: ["S1"],
          },
          {
            id: "F2",
            summary: "Media hint",
            sourceClass: "OSINT",
            confidence: 0.4,
            evidenceRefs: ["S2"],
          },
          {
            id: "F3",
            summary: "Simulation drift",
            sourceClass: "SIM",
            confidence: 0.1,
            evidenceRefs: ["S3"],
          },
        ]}
        recommendedActions={["accept F1"]}
        followUpPrompts={["why F1?"]}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Two candidates flagged.");
    expect(frame).toContain("F1");
    expect(frame).toContain("FIELD");
    expect(frame).toContain("OSINT");
    expect(frame).toContain("SIM");
    expect(frame).toContain("accept F1");
    expect(frame).toContain("why F1?");
  });

  it("omits optional sections when there are no actions or prompts", () => {
    const { lastFrame } = render(
      <BriefingRenderer
        executiveSummary="Nothing further."
        findings={[]}
        recommendedActions={[]}
        followUpPrompts={[]}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Nothing further.");
    expect(frame).not.toContain("Recommended actions:");
    expect(frame).not.toContain("Try next:");
  });
});

describe("ClarifyRenderer", () => {
  it("renders the question, numbered options, and reply hint", () => {
    const { lastFrame } = render(
      <ClarifyRenderer
        question="Which satellite?"
        options={["ISS", "STARLINK-1"]}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Which satellite?");
    expect(frame).toContain("1. ISS");
    expect(frame).toContain("2. STARLINK-1");
    expect(frame).toContain("/<action>");
  });
});

describe("GraphTreeRenderer", () => {
  it("renders a null graph placeholder", () => {
    const { lastFrame } = render(<GraphTreeRenderer tree={null} />);
    expect(lastFrame()).toContain("(no graph)");
  });

  it("renders graph levels and nodes", () => {
    const { lastFrame } = render(
      <GraphTreeRenderer
        tree={{
          root: "sat:25544",
          levels: [
            { depth: 1, nodes: ["operator:nasa"] },
            { depth: 2, nodes: ["event:launch", "event:maneuver"] },
          ],
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Graph: sat:25544");
    expect(frame).toContain("depth 1 (1)");
    expect(frame).toContain("operator:nasa");
    expect(frame).toContain("depth 2 (2)");
    expect(frame).toContain("event:maneuver");
  });
});

describe("LogTailRenderer", () => {
  it("renders step-aware and plain log events", () => {
    const { lastFrame } = render(
      <LogTailRenderer
        events={[
          {
            time: Date.UTC(2026, 0, 1, 12, 0, 0),
            level: 30,
            service: "thalamus",
            msg: "cycle done",
            step: "cortex",
            phase: "done",
          },
          {
            time: Date.UTC(2026, 0, 1, 12, 0, 1),
            level: 20,
            msg: "plain event",
            phase: "progress",
          },
          {
            time: Date.UTC(2026, 0, 1, 12, 0, 2),
            level: 50,
            service: "thalamus",
            msg: undefined,
            step: "planner",
            phase: "error",
          },
        ]}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Logs (3)");
    expect(frame).toContain("12:00:00");
    expect(frame).toContain("thalamus");
    expect(frame).toContain("cycle done");
    expect(frame).toContain("12:00:01");
    expect(frame).toContain("plain event");
    expect(frame).toContain("12:00:02");
  });
});

describe("CandidatesRenderer", () => {
  it("renders an empty-state explanation when there are no rows", () => {
    const { lastFrame } = render(
      <CandidatesRenderer targetNoradId={25544} rows={[]} />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("KNN candidates · target NORAD 25544");
    expect(frame).toContain("no semantic neighbors");
  });

  it("renders candidate rows across classes and altitude fallbacks", () => {
    const { lastFrame } = render(
      <CandidatesRenderer
        targetNoradId={25544}
        rows={[
          {
            candidateName: "DEBRIS-A",
            candidateNoradId: 1,
            candidateClass: "debris",
            cosDistance: 0.25,
            overlapKm: 12,
            apogeeKm: 520,
            perigeeKm: 500,
            regime: "LEO",
          },
          {
            candidateName: "ROCKET-B",
            candidateNoradId: 2,
            candidateClass: "rocket_stage",
            cosDistance: 0.35,
            overlapKm: 6,
            apogeeKm: null,
            perigeeKm: null,
            regime: "MEO",
          },
          {
            candidateName: "PAYLOAD-C",
            candidateNoradId: 3,
            candidateClass: "payload",
            cosDistance: 0.45,
            overlapKm: 3,
            apogeeKm: 36_000,
            perigeeKm: 35_800,
            regime: "GEO",
          },
          {
            candidateName: "UNKNOWN-D",
            candidateNoradId: null,
            candidateClass: null,
            cosDistance: 0.55,
            overlapKm: 1,
            apogeeKm: 1_000,
            perigeeKm: 900,
            regime: "HEO",
          },
        ]}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("4 survivors");
    expect(frame).toContain("DEBRIS-A");
    expect(frame).toContain("500x520");
    expect(frame).toContain("ROCKET-B");
    expect(frame).toContain("—");
    expect(frame).toContain("PAYLOAD-C");
    expect(frame).toContain("UNKNOWN-D");
    expect(frame).toContain("(3)");
    expect(frame).not.toContain("(null)");
  });
});

describe("TelemetryRenderer", () => {
  it("renders a null distribution placeholder", () => {
    const { lastFrame } = render(
      <TelemetryRenderer satId="25544" distribution={null} />,
    );

    expect(lastFrame()).toContain("(no distribution returned)");
  });

  it("renders telemetry scalars with ranges, optional units, and envelope warnings", () => {
    const { lastFrame } = render(
      <TelemetryRenderer
        satId="25544"
        distribution={{
          satId: "25544",
          scalars: [
            {
              name: "mean-motion",
              unit: "rev/day",
              median: 15.5,
              p5: 15.1,
              p95: 15.9,
              withinEnvelope: false,
            },
            {
              name: "inclination",
              median: 51.6,
              p5: 51.5,
              p95: 51.7,
            },
          ],
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Telemetry · sat 25544");
    expect(frame).toContain("mean-motion");
    expect(frame).toContain("15.50 rev/day");
    expect(frame).toContain("[15.10..15.90]");
    expect(frame).toContain("out-of-envelope");
    expect(frame).toContain("inclination");
    expect(frame).toContain("51.60");
  });
});

describe("PcEstimatorRenderer", () => {
  it("renders the disabled placeholder when no fish results exist", () => {
    const { lastFrame } = render(
      <PcEstimatorRenderer conjunctionId="conj-1" estimate={null} />,
    );

    expect(lastFrame()).toContain("no fish results");
  });

  it("renders histogram bins, dissent clusters, and accept hints", () => {
    const { lastFrame } = render(
      <PcEstimatorRenderer
        conjunctionId="conj-1"
        estimate={{
          conjunctionId: "conj-1",
          medianPc: 1.2e-4,
          sigmaPc: 3.3e-5,
          p5Pc: 8e-5,
          p95Pc: 2e-4,
          fishCount: 8,
          clusters: [
            { mode: "cautious", flags: ["wide-cov"], pcRange: [1e-5, 1e-4], fishCount: 2 },
            { mode: "fast", flags: [], pcRange: [2e-4, 3e-4], fishCount: 1 },
          ],
          samples: [1e-7, 5e-6, 2e-4, 4e-4, 8e-3],
          severity: "high",
          suggestionId: "SUG-9",
          methodology: "swarm",
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Pc estimate · conj-1");
    expect(frame).toContain("median=");
    expect(frame).toContain("[high]");
    expect(frame).toContain("distribution (log10(Pc))");
    expect(frame).toContain("dissent clusters");
    expect(frame).toContain("cautious (2f)");
    expect(frame).toContain("flags: wide-cov");
    expect(frame).toContain("fast (1f)");
    expect(frame).toContain("/accept SUG-9");
  });

  it("renders non-high severities without dissent extras", () => {
    const { lastFrame } = render(
      <PcEstimatorRenderer
        conjunctionId="conj-2"
        estimate={{
          conjunctionId: "conj-2",
          medianPc: 2e-6,
          sigmaPc: 1e-6,
          p5Pc: 1e-6,
          p95Pc: 3e-6,
          fishCount: 3,
          clusters: [],
          samples: [1e-6, 2e-6, 3e-6],
          severity: "medium",
          methodology: "swarm",
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Pc estimate · conj-2");
    expect(frame).toContain("[medium]");
    expect(frame).not.toContain("dissent clusters");
    expect(frame).not.toContain("/accept");
  });

  it("renders info severity in the fallback color path", () => {
    const { lastFrame } = render(
      <PcEstimatorRenderer
        conjunctionId="conj-3"
        estimate={{
          conjunctionId: "conj-3",
          medianPc: 9e-8,
          sigmaPc: 2e-8,
          p5Pc: 5e-8,
          p95Pc: 1.2e-7,
          fishCount: 2,
          clusters: [],
          samples: [5e-8, 9e-8],
          severity: "info",
          methodology: "swarm",
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Pc estimate · conj-3");
    expect(frame).toContain("[info]");
    expect(frame).not.toContain("dissent clusters");
  });
});

describe("WhyTreeRenderer", () => {
  it("renders a null provenance placeholder", () => {
    const { lastFrame } = render(<WhyTreeRenderer tree={null} />);
    expect(lastFrame()).toContain("(no provenance)");
  });

  it("renders provenance stats, sha prefixes, and source classes", () => {
    const { lastFrame } = render(
      <WhyTreeRenderer
        tree={{
          id: "finding-1",
          label: "High-risk conjunction",
          kind: "finding",
          children: [
            {
              id: "edge-1",
              label: "supports",
              kind: "edge",
              sha256: "1234567890abcdef",
              sourceClass: "field",
              children: [
                {
                  id: "source-1",
                  label: "sensor hit",
                  kind: "source_item",
                  sha256: "abcdef1234567890",
                  sourceClass: "osint",
                  children: [],
                },
              ],
            },
            {
              id: "edge-2",
              label: "simulation cross-check",
              kind: "edge",
              sourceClass: "sim",
              children: [],
            },
            {
              id: "edge-3",
              label: "derived edge",
              kind: "edge",
              sourceClass: "derived",
              children: [],
            },
          ],
        }}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("Why: High-risk conjunction");
    expect(frame).toContain("3 edges · 1 source_items");
    expect(frame).toContain("FIELD=1");
    expect(frame).toContain("OSINT=1");
    expect(frame).toContain("SIM=1");
    expect(frame).toContain("EDGE supports");
    expect(frame).toContain("[sha256:12345678]");
    expect(frame).toContain("sensor hit");
    expect(frame).toContain("[OSINT]");
    expect(frame).toContain("simulation cross-check");
  });
});
