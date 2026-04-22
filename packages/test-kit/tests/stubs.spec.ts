import { describe, expect, it } from "vitest";
import { stubCortexLlm, stubLogger, stubNanoCaller } from "../src";

describe("@interview/test-kit stubs", () => {
  it("stubLogger returns self-childing spies that record calls", () => {
    const logger = stubLogger();

    logger.info({ cycleId: "cyc:1" }, "start");
    const child = logger.child({ scope: "planner" });

    expect(logger.info).toHaveBeenCalledWith({ cycleId: "cyc:1" }, "start");
    expect(logger.child).toHaveBeenCalledWith({ scope: "planner" });
    expect(child).toBe(logger);
  });

  it("stubNanoCaller returns an empty-wave default and exposes the underlying spy", async () => {
    const caller = stubNanoCaller();
    const items: Array<{ id: number }> = [{ id: 1 }];
    const rows = await caller.callWaves(items, (item: { id: number }) => ({
      instructions: `row:${item.id}`,
      input: "describe",
    }));

    expect(rows).toEqual([]);
    expect(caller._spy).toHaveBeenCalledWith([{ id: 1 }], expect.any(Function));
  });

  it("stubCortexLlm lazily creates named provider spies with deterministic rows", async () => {
    const provider = stubCortexLlm([{ name: "AQUA" }]);
    const rows = await provider.catalog({ noradId: 27424 });

    expect(rows).toEqual([{ name: "AQUA" }]);
    expect(provider._spies.get("catalog")).toBeDefined();
    expect(provider._spies.get("catalog")).toHaveBeenCalledWith({
      noradId: 27424,
    });
  });
});
