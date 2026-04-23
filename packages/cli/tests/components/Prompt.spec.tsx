import React from "react";
import { render } from "ink-testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prompt } from "../../src/components/Prompt";

type PromptKey = {
  return?: boolean;
  backspace?: boolean;
  delete?: boolean;
  ctrl?: boolean;
  meta?: boolean;
};

const state = vi.hoisted(() => ({
  onInput: null as null | ((input: string, key: PromptKey) => void),
}));

vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink");
  return {
    ...actual,
    useInput: (handler: (input: string, key: PromptKey) => void) => {
      state.onInput = handler;
    },
  };
});

async function flushRender(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("Prompt", () => {
  beforeEach(() => {
    state.onInput = null;
  });

  it("captures text, submits on return, and clears the input", async () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<Prompt onSubmit={onSubmit} busy={false} />);

    state.onInput?.("h", {});
    state.onInput?.("i", {});
    await flushRender();
    expect(lastFrame()).toContain("› hi");

    state.onInput?.("", { return: true });
    await flushRender();

    expect(onSubmit).toHaveBeenCalledWith("hi");
    expect(lastFrame()).toContain("›");
    expect(lastFrame()).not.toContain("hi");
  });

  it("handles backspace/delete and ignores ctrl/meta shortcuts", async () => {
    const { lastFrame } = render(<Prompt onSubmit={() => {}} busy={false} />);

    state.onInput?.("a", {});
    state.onInput?.("b", {});
    state.onInput?.("", { backspace: true });
    await flushRender();
    expect(lastFrame()).toContain("› a");

    state.onInput?.("c", {});
    state.onInput?.("", { delete: true });
    state.onInput?.("x", { ctrl: true });
    state.onInput?.("y", { meta: true });
    await flushRender();

    expect(lastFrame()).toContain("› a");
  });

  it("ignores all input while busy", async () => {
    const onSubmit = vi.fn();
    const { lastFrame } = render(<Prompt onSubmit={onSubmit} busy />);

    state.onInput?.("x", {});
    state.onInput?.("", { return: true });
    await flushRender();

    expect(onSubmit).not.toHaveBeenCalled();
    expect(lastFrame()).toContain("…");
    expect(lastFrame()).not.toContain("x");
  });
});
