import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { ApiClientProvider, useApiClient } from "./ApiClientContext";
import { makeStubApi } from "../../../tests/wrap";

const stub = makeStubApi();

describe("ApiClientContext", () => {
  it("useApiClient returns the provided client", () => {
    const { result } = renderHook(() => useApiClient(), {
      wrapper: ({ children }) => <ApiClientProvider value={stub}>{children}</ApiClientProvider>,
    });
    expect(result.current).toBe(stub);
  });

  it("throws when used outside ApiClientProvider", () => {
    expect(() => renderHook(() => useApiClient())).toThrow(/ApiClientProvider/);
  });
});
