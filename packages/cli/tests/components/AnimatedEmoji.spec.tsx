import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { AnimatedEmoji } from "../../src/components/AnimatedEmoji";
import { STEP_REGISTRY } from "@interview/shared";

describe("AnimatedEmoji", () => {
  it("renders terminal emoji when phase=done", () => {
    const { lastFrame } = render(<AnimatedEmoji step="cortex" phase="done" />);
    expect(lastFrame()).toContain(STEP_REGISTRY.cortex.terminal);
  });
  it("renders first frame when phase=start and _tickOverride=0", () => {
    const cortex = STEP_REGISTRY.cortex;
    if (cortex.instantaneous) throw new Error("test assumption broken");
    const { lastFrame } = render(<AnimatedEmoji step="cortex" phase="start" _tickOverride={0} />);
    expect(lastFrame()).toContain(cortex.frames[0]);
  });
});
