import { describe, it, expect } from "vitest";
import { parseExplicitCommand } from "../../src/router/parser";

describe("parseExplicitCommand", () => {
  it("returns null for free text", () => {
    expect(parseExplicitCommand("tell me about starlink 3099")).toBeNull();
  });
  it("parses /query", () => {
    expect(parseExplicitCommand("/query riskiest conjunction this week"))
      .toEqual({ steps: [{ action: "query", q: "riskiest conjunction this week" }], confidence: 1 });
  });
  it("parses /telemetry with satId", () => {
    expect(parseExplicitCommand("/telemetry 25544"))
      .toEqual({ steps: [{ action: "telemetry", satId: "25544" }], confidence: 1 });
  });
  it("parses /logs with level + service flags", () => {
    const r = parseExplicitCommand("/logs level=warn service=thalamus");
    expect(r).toEqual({ steps: [{ action: "logs", level: "warn", service: "thalamus" }], confidence: 1 });
  });
  it("parses /logs bare", () => {
    expect(parseExplicitCommand("/logs")).toEqual({ steps: [{ action: "logs" }], confidence: 1 });
  });
  it("parses /graph", () => {
    expect(parseExplicitCommand("/graph SpaceX"))
      .toEqual({ steps: [{ action: "graph", entity: "SpaceX" }], confidence: 1 });
  });
  it("parses /accept", () => {
    expect(parseExplicitCommand("/accept SWEEP-428"))
      .toEqual({ steps: [{ action: "accept", suggestionId: "SWEEP-428" }], confidence: 1 });
  });
  it("parses /explain", () => {
    expect(parseExplicitCommand("/explain F-77"))
      .toEqual({ steps: [{ action: "explain", findingId: "F-77" }], confidence: 1 });
  });
  it("returns null for unknown verb", () => {
    expect(parseExplicitCommand("/unknown foo")).toBeNull();
  });
  it("returns null for missing required arg", () => {
    expect(parseExplicitCommand("/telemetry")).toBeNull();
    expect(parseExplicitCommand("/accept")).toBeNull();
  });
});
