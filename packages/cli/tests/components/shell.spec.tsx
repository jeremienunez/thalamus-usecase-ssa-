import React from "react";
import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";
import { Text } from "ink";
import { ScrollView } from "../../src/components/ScrollView";
import { StatusFooter } from "../../src/components/StatusFooter";

describe("ScrollView", () => {
  it("renders its children in a vertical stack", () => {
    const { lastFrame } = render(
      <ScrollView>
        {["alpha", "beta"].map((item) => (
          <Text key={item}>{item}</Text>
        ))}
      </ScrollView>,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("alpha");
    expect(frame).toContain("beta");
  });
});

describe("StatusFooter", () => {
  it("renders the session summary and last action when present", () => {
    const { lastFrame } = render(
      <StatusFooter
        sessionId="abcd1234"
        tokens={12_345}
        maxTokens={200_000}
        costUsd={1.234}
        lastAction="graph.neighbourhood"
        lastMs={2_250}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("session abcd");
    expect(frame).toContain("tokens 12.3k/200k");
    expect(frame).toContain("cost $1.234");
    expect(frame).toContain("last: graph.neighbourhood (2.3s)");
  });

  it("omits the last-action suffix when no action is available", () => {
    const { lastFrame } = render(
      <StatusFooter
        sessionId="wxyz9999"
        tokens={1_000}
        maxTokens={2_000}
        costUsd={0}
      />,
    );

    const frame = lastFrame() ?? "";
    expect(frame).toContain("session wxyz");
    expect(frame).not.toContain("last:");
  });

  it("falls back to 0.0s when an action exists without a duration", () => {
    const { lastFrame } = render(
      <StatusFooter
        sessionId="lmno1234"
        tokens={1}
        maxTokens={2}
        costUsd={0}
        lastAction="idle"
      />,
    );

    expect(lastFrame()).toContain("last: idle (0.0s)");
  });
});
