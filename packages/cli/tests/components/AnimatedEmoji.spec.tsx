import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "ink-testing-library";
import React from "react";
import { AnimatedEmoji } from "../../src/components/AnimatedEmoji";
import { STEP_REGISTRY } from "@interview/shared";

describe("AnimatedEmoji", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("renders fallback terminal glyphs for instantaneous and error phases", () => {
    const { lastFrame, rerender } = render(
      <AnimatedEmoji step="suggestion.emit" phase="start" />,
    );

    expect(lastFrame()).toContain(STEP_REGISTRY["suggestion.emit"].terminal);

    rerender(<AnimatedEmoji step="suggestion.emit" phase="error" />);
    expect(lastFrame()).toContain(STEP_REGISTRY["suggestion.emit"].terminal);
  });

  it("renders a question mark for unknown steps", () => {
    const badStep = "not-a-step" as React.ComponentProps<typeof AnimatedEmoji>["step"];
    const { lastFrame } = render(
      <AnimatedEmoji step={badStep} phase="start" _tickOverride={0} />,
    );
    expect(lastFrame()).toContain("❔");
  });

  it("advances frames over time when no override is provided", async () => {
    vi.useFakeTimers();
    const cortex = STEP_REGISTRY.cortex;
    if (cortex.instantaneous) throw new Error("test assumption broken");

    const { lastFrame } = render(<AnimatedEmoji step="cortex" phase="start" />);
    expect(lastFrame()).toContain(cortex.frames[0]);

    await vi.advanceTimersByTimeAsync(170);
    expect(lastFrame()).toContain(cortex.frames[1]);
  });
});
