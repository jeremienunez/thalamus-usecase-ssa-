import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { ThalamusEntry } from "./Entry";
import { WrapProviders, makeStubApi } from "../../../tests/wrap";

// sigma + graphology-layout-forceatlas2 are mocked globally in tests/setup.ts
// (they reach for WebGL/Canvas at import time, neither present in jsdom).

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
