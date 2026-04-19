import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import { ApiClientProvider, useApiClient } from "./ApiClientContext";
import type { ApiClient } from "./index";

const stub: ApiClient = {
  satellites: { list: async () => ({ items: [], count: 0 }) },
  conjunctions: { list: async () => ({ items: [], count: 0 }) },
  kg: {
    listNodes: async () => ({ items: [] }),
    listEdges: async () => ({ items: [] }),
  },
  findings: {
    list: async () => ({ items: [], count: 0 }),
    findById: async () => ({}) as never,
    decide: async () => ({}) as never,
  },
  stats: { get: async () => ({}) as never },
  cycles: { list: async () => ({ items: [] }), run: async () => ({}) as never },
  sweep: {
    listSuggestions: async () => ({ items: [], count: 0 }),
    review: async () => ({}) as never,
  },
  mission: {
    status: async () => ({}) as never,
    start: async () => ({}) as never,
    stop: async () => ({}) as never,
  },
  autonomy: {
    status: async () => ({}) as never,
    start: async () => ({}) as never,
    stop: async () => ({}) as never,
  },
};

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
