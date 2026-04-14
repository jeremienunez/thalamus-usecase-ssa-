import { describe, it, expect } from "vitest";
import { CostMeter } from "../../src/util/costMeter";

describe("CostMeter", () => {
  it("tracks per-turn and session totals", () => {
    const m = new CostMeter();
    m.beginTurn();
    m.add(0.01);
    m.add(0.02);
    expect(m.currentTurn()).toBeCloseTo(0.03);
    expect(m.session()).toBeCloseTo(0.03);
    m.endTurn();
    m.beginTurn();
    m.add(0.05);
    expect(m.currentTurn()).toBeCloseTo(0.05);
    expect(m.session()).toBeCloseTo(0.08);
  });
});
