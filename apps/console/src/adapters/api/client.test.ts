import { describe, it, expect, vi, beforeEach } from "vitest";
import { createFetchApiClient, type ApiFetcher } from "./client";

describe("createFetchApiClient", () => {
  const mockFetch = vi.fn();
  let client: ApiFetcher;

  beforeEach(() => {
    mockFetch.mockReset();
    client = createFetchApiClient({ fetch: mockFetch });
  });

  it("getJson returns parsed body on 2xx", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ hello: "world" }), { status: 200 }),
    );
    const res = await client.getJson<{ hello: string }>("/api/hello");
    expect(res).toEqual({ hello: "world" });
    expect(mockFetch).toHaveBeenCalledWith("/api/hello", undefined);
  });

  it("getJson throws with status code on non-2xx", async () => {
    mockFetch.mockResolvedValue(new Response("nope", { status: 500, statusText: "boom" }));
    await expect(client.getJson("/api/x")).rejects.toThrow("500 boom");
  });

  it("postJson sends JSON body and content-type", async () => {
    mockFetch.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await client.postJson<{ a: number }, { ok: boolean }>("/api/x", { a: 1 });
    expect(mockFetch).toHaveBeenCalledWith("/api/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ a: 1 }),
    });
  });

  it("postJson without body sends POST with no payload", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    await client.postJson("/api/trigger", undefined);
    expect(mockFetch).toHaveBeenCalledWith("/api/trigger", { method: "POST" });
  });

  it("honors baseUrl prefix", async () => {
    mockFetch.mockResolvedValue(new Response("{}", { status: 200 }));
    const c = createFetchApiClient({ fetch: mockFetch, baseUrl: "https://api.example" });
    await c.getJson("/api/x");
    expect(mockFetch).toHaveBeenCalledWith("https://api.example/api/x", undefined);
  });
});
