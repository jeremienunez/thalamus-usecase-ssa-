import { describe, expect, it } from "vitest";
import { ReplTurnService } from "../../../src/services/repl-turn.service";

describe("ReplTurnService.handle", () => {
  it("uses a real fixture-backed context by default so accept routes do not crash", async () => {
    const result = await new ReplTurnService().handle("/accept f:1", "sess-1");

    expect(result.results[0]).toMatchObject({
      kind: "resolution",
      suggestionId: "f:1",
      delta: { findingId: "f:1" },
    });
  });

  it("honours an explicit context instead of falling back to generated fixtures", async () => {
    const context: NonNullable<Parameters<ReplTurnService["handle"]>[2]> = {
      satellites: [],
      kgNodes: [],
      kgEdges: [],
      findings: [
        {
          id: "f:custom",
          title: "Custom finding",
          summary: "Manual context should win over default fixtures.",
          cortex: "catalog",
          status: "pending" as const,
          priority: 10,
          createdAt: "2026-04-21T00:00:00.000Z",
          linkedEntityIds: [],
          evidence: [],
        },
      ],
    };

    const result = await new ReplTurnService().handle(
      "/accept f:custom",
      "sess-2",
      context,
    );

    expect(result.results[0]).toMatchObject({
      kind: "resolution",
      suggestionId: "f:custom",
      delta: { findingId: "f:custom" },
    });
    expect(context.findings[0]?.status).toBe("accepted");
  });
});
