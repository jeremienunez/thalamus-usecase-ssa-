import { describe, it, expect } from "vitest";
import { RouterPlanSchema } from "../../src/router/schema";

describe("RouterPlanSchema", () => {
  it("accepts a valid single-step plan", () => {
    const p = { steps: [{ action: "query", q: "x" }], confidence: 0.9 };
    expect(() => RouterPlanSchema.parse(p)).not.toThrow();
  });
  it("rejects empty steps", () => {
    expect(() => RouterPlanSchema.parse({ steps: [], confidence: 1 })).toThrow();
  });
  it("rejects confidence out of range", () => {
    expect(() => RouterPlanSchema.parse({ steps: [{ action: "query", q: "x" }], confidence: 1.5 })).toThrow();
  });
  it("accepts clarify step", () => {
    const p = { steps: [{ action: "clarify", question: "which?", options: ["query", "telemetry"] }], confidence: 0.4 };
    expect(() => RouterPlanSchema.parse(p)).not.toThrow();
  });
  it("caps steps at 8", () => {
    const many = Array.from({ length: 9 }, () => ({ action: "query", q: "x" }));
    expect(() => RouterPlanSchema.parse({ steps: many, confidence: 0.9 })).toThrow();
  });
});
