import { describe, expect, it } from "vitest";
import * as sweep from "../../src";
import * as internal from "../../src/internal";

describe("@interview/sweep barrel split", () => {
  it("keeps sim execution internals off the root barrel", () => {
    expect("SimOrchestrator" in sweep).toBe(false);
    expect("SwarmService" in sweep).toBe(false);
    expect("AggregatorService" in sweep).toBe(false);
    expect("createSwarmFishWorker" in sweep).toBe(false);
    expect("createSwarmAggregateWorker" in sweep).toBe(false);
    expect("simTurnQueue" in sweep).toBe(false);
    expect("closeQueues" in sweep).toBe(false);
    expect("isKgPromotable" in sweep).toBe(false);
  });

  it("re-exports those internals from the dedicated internal barrel", () => {
    expect("SimOrchestrator" in internal).toBe(true);
    expect("SwarmService" in internal).toBe(true);
    expect("AggregatorService" in internal).toBe(true);
    expect("createSwarmFishWorker" in internal).toBe(true);
    expect("createSwarmAggregateWorker" in internal).toBe(true);
    expect("simTurnQueue" in internal).toBe(true);
    expect("closeQueues" in internal).toBe(true);
    expect("isKgPromotable" in internal).toBe(true);
  });
});
