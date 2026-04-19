import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { ThalamusEntry } from "./Entry";
import { WrapProviders, makeStubApi } from "../../../tests/wrap";

// Sigma + graphology-layout-forceatlas2 use WebGL / canvas features absent
// in jsdom. Stub both so the feature tree mounts and we can assert it
// doesn't crash when adapters return empty data. This is a structural
// smoke test; visual behaviour is verified manually in the browser.
vi.mock("sigma", () => ({
  default: vi.fn().mockImplementation(() => ({
    kill: vi.fn(),
    on: vi.fn(),
    getCamera: () => ({ animate: vi.fn(), getState: () => ({}), setState: vi.fn() }),
    getGraph: () => ({
      nodes: () => [],
      edges: () => [],
      forEachNode: vi.fn(),
    }),
    getContainer: () => ({ clientWidth: 800, clientHeight: 600 }),
    refresh: vi.fn(),
    setSetting: vi.fn(),
  })),
}));

vi.mock("graphology-layout-forceatlas2", () => ({
  default: {
    assign: vi.fn(),
    inferSettings: vi.fn(() => ({})),
  },
}));

describe("ThalamusEntry smoke", () => {
  it("renders without throwing with empty KG", () => {
    const api = makeStubApi();
    expect(() =>
      render(<ThalamusEntry />, {
        wrapper: ({ children }) => <WrapProviders deps={{ api }}>{children}</WrapProviders>,
      }),
    ).not.toThrow();
  });
});
