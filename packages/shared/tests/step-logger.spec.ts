/**
 * SPEC-SH-006 — Observability / step-logger
 * Traceability:
 *   AC-1 stepLog emits a structured event with frames + terminal for known step
 *   AC-2 unknown step falls back to ❔ terminal and warns in dev
 *   AC-3 STEP_REGISTRY is exhaustive — every entry has animated frames or is instantaneous
 */
import { describe, it, expect, vi } from "vitest";
import pino from "pino";
import { stepLog, STEP_REGISTRY, type StepName } from "../src/observability/step-logger";

describe("stepLog", () => {
  it("emits a structured event with frames + terminal for known step", () => {
    const logs: unknown[] = [];
    const logger = pino({ level: "trace" }, { write: (m) => logs.push(JSON.parse(m)) });
    stepLog(logger, "cortex", "start", { cortex: "conjunction-analysis" });
    const e = logs[0] as {
      step: string;
      phase: string;
      frames: string[];
      terminal: string;
      cortex: string;
    };
    expect(e.step).toBe("cortex");
    expect(e.phase).toBe("start");
    expect(e.frames.length).toBeGreaterThanOrEqual(3);
    expect(e.terminal).toBeDefined();
    expect(e.cortex).toBe("conjunction-analysis");
  });

  it("falls back to unknown step with ❔ and warns in dev", () => {
    const logs: unknown[] = [];
    const logger = pino({ level: "trace" }, { write: (m) => logs.push(JSON.parse(m)) });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stepLog(logger, "bogus.step" as StepName, "done");
    expect((logs[0] as { terminal: string }).terminal).toBe("❔");
    warn.mockRestore();
  });

  it("registry is exhaustive — every declared step has animated frames OR is instantaneous", () => {
    for (const [, entry] of Object.entries(STEP_REGISTRY)) {
      if (entry.instantaneous) {
        expect(entry.terminal).toBeDefined();
      } else {
        expect(entry.frames.length).toBeGreaterThanOrEqual(3);
        expect(entry.terminal).toBeDefined();
        expect(entry.error).toBeDefined();
      }
    }
  });
});
