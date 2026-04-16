import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/repl", () => ({
  runTurn: vi.fn(),
}));

import { runTurn } from "../../../src/repl";
import { ReplTurnService } from "../../../src/services/repl-turn.service";

describe("ReplTurnService.handle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates to runTurn with the default empty context", async () => {
    vi.mocked(runTurn).mockResolvedValue({
      plan: { steps: [{ action: "query", q: "status leo" }], confidence: 1 },
      results: [],
    } as never);

    const result = await new ReplTurnService().handle("status leo", "sess-1");

    expect(runTurn).toHaveBeenCalledWith(
      "status leo",
      {
        satellites: [],
        kgNodes: [],
        kgEdges: [],
        findings: [],
      },
      "sess-1",
    );
    expect(result).toEqual({
      plan: { steps: [{ action: "query", q: "status leo" }], confidence: 1 },
      results: [],
    });
  });

  it("passes through an explicit context unchanged", async () => {
    const context = {
      satellites: [{ id: 42, name: "SAT-42" }],
      kgNodes: [{ id: "sat:42", label: "SAT-42" }],
      kgEdges: [{ id: "e1", source: "finding:1", target: "sat:42", relation: "about" }],
      findings: [{ id: "f:1", title: "Finding 1" }],
    };
    vi.mocked(runTurn).mockResolvedValue({ ok: true } as never);

    await new ReplTurnService().handle("explain f:1", "sess-2", context as never);

    expect(runTurn).toHaveBeenCalledWith("explain f:1", context, "sess-2");
  });
});
