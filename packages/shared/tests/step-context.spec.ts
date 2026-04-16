import { describe, it, expect } from "vitest";
import pino from "pino";
import { stepLog } from "../src/observability/step-logger";
import { stepContextStore, type StepContext } from "../src/observability/step-context";

describe("stepContextStore", () => {
  it("forwards stepLog events to the callback when inside run()", async () => {
    const events: unknown[] = [];
    const ctx: StepContext = { onStep: (e) => events.push(e) };
    const logger = pino({ level: "silent" });

    await stepContextStore.run(ctx, async () => {
      stepLog(logger, "cycle", "start", { cycleId: "cyc:1" });
      await Promise.resolve();
      stepLog(logger, "planner", "done");
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ step: "cycle", phase: "start", cycleId: "cyc:1" });
    expect(events[1]).toMatchObject({ step: "planner", phase: "done" });
  });

  it("does not forward when no context is active", () => {
    const logger = pino({ level: "silent" });
    expect(() => stepLog(logger, "cortex", "start")).not.toThrow();
  });
});
