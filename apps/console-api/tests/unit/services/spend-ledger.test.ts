import { describe, expect, it } from "vitest";
import { SpendLedger } from "../../../src/services/spend-ledger";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("SpendLedger", () => {
  it("tracks rolling daily and monthly spend independently", () => {
    const ledger = new SpendLedger();
    const now = Date.UTC(2026, 3, 20, 12, 0, 0);

    ledger.record(0.02, 0, now - DAY_MS - HOUR_MS);
    ledger.record(0.03, 0, now - HOUR_MS);
    ledger.record(0.05, 0, now);

    expect(ledger.dailyUsd(now)).toBeCloseTo(0.08, 5);
    expect(ledger.monthlyUsd(now)).toBeCloseTo(0.1, 5);
  });

  it("counts only rolling 24h thalamus cycles", () => {
    const ledger = new SpendLedger();
    const now = Date.UTC(2026, 3, 20, 12, 0, 0);

    ledger.record(0, 3, now - DAY_MS - 1);
    ledger.record(0, 1, now - HOUR_MS);
    ledger.record(0, 2, now);

    expect(ledger.cyclesInDay(now)).toBe(3);
  });

  it("reset() drops all entries", () => {
    const ledger = new SpendLedger();

    ledger.record(0.05, 1);
    ledger.record(0.05, 1);

    expect(ledger.dailyUsd()).toBeCloseTo(0.1, 5);
    ledger.reset();
    expect(ledger.dailyUsd()).toBe(0);
    expect(ledger.monthlyUsd()).toBe(0);
    expect(ledger.cyclesInDay()).toBe(0);
  });
});
