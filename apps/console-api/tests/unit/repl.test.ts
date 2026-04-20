import { describe, expect, it } from "vitest";
import { runTurn } from "../../src/repl";

describe("runTurn briefing ui actions", () => {
  it("adds autonomy and budget shortcuts when the query asks about config budgets", async () => {
    const result = await runTurn(
      "show autonomy budget config",
      { satellites: [], kgNodes: [], kgEdges: [], findings: [] },
      "sess-1",
    );

    expect(result.results[0]).toMatchObject({
      kind: "briefing",
      uiActions: [
        { kind: "open_feed", target: "autonomy", label: "Open autonomy FEED" },
        {
          kind: "open_config",
          domain: "console.autonomy",
          label: "Tune console.autonomy",
        },
        {
          kind: "open_config",
          domain: "thalamus.budgets",
          label: "Review thalamus.budgets",
        },
      ],
    });
  });
});
