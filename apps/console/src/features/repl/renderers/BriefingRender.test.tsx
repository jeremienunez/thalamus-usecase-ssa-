import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { BriefingRender } from "./BriefingRender";

describe("BriefingRender", () => {
  it("emits operator shortcut actions", async () => {
    const user = userEvent.setup();
    const onUiAction = vi.fn();

    render(
      <BriefingRender
        r={{
          kind: "briefing",
          executiveSummary: "summary",
          findings: [],
          recommendedActions: [],
          followUpPrompts: [],
          uiActions: [
            {
              kind: "open_feed",
              target: "autonomy",
              label: "Open autonomy FEED",
            },
          ],
          costUsd: 0.02,
        }}
        onFollowUp={vi.fn()}
        onUiAction={onUiAction}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Open autonomy FEED/i }));

    expect(onUiAction).toHaveBeenCalledWith({
      kind: "open_feed",
      target: "autonomy",
      label: "Open autonomy FEED",
    });
  });
});
