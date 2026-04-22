/**
 * BDD — ThalamusHttpClient routes CLI cycles through console-api HTTP.
 *
 * These tests describe the contract the CLI now expects from
 * `POST /api/cycles/run`:
 *   - request body: { kind: "thalamus", query }
 *   - response: { cycle: { findings, costUsd, ... } }
 *   - errors: server-emitted 500 + `cycle.error` should surface as thrown.
 *
 * We stub `globalThis.fetch` rather than spin a server; the e2e assertion
 * that the real route returns the new shape lives in the console-api e2e
 * test suite (cycles-run-findings.e2e.spec.ts).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThalamusHttpClient } from "../../src/adapters/thalamus.http";

function stubFetch(
  res: Partial<Response> & { jsonBody: unknown },
): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify(res.jsonBody), {
      status: res.status ?? (res.ok === false ? 500 : 200),
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("ThalamusHttpClient.runCycle", () => {
  it("given a query, when runCycle is called, then POST /api/cycles/run is invoked with kind=thalamus", async () => {
    const fetchStub = stubFetch({
      ok: true,
      jsonBody: {
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "",
          completedAt: "",
          findingsEmitted: 1,
          cortices: ["strategist"],
          findings: [
            {
              id: "f1",
              title: "t",
              summary: "s",
              sourceClass: "KG",
              confidence: 0.9,
              evidenceRefs: [],
            },
          ],
          costUsd: 0.042,
        },
      },
    });

    const client = new ThalamusHttpClient("http://api.local");
    const out = await client.runCycle({ query: "screen geo", traceId: "t-1" });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(url).toBe("http://api.local/api/cycles/run");
    expect(init.method).toBe("POST");
    expect(init.headers["content-type"]).toBe("application/json");
    expect(init.headers["x-trace-id"]).toBe("t-1");
    expect(JSON.parse(init.body as string)).toEqual({
      kind: "thalamus",
      query: "screen geo",
    });

    expect(out.findings).toHaveLength(1);
    expect(out.findings[0]!.id).toBe("f1");
    expect(out.costUsd).toBeCloseTo(0.042);
  });

  it("given an auth token, when runCycle is called, then Authorization Bearer is set", async () => {
    const fetchStub = stubFetch({
      ok: true,
      jsonBody: {
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "",
          completedAt: "",
          findingsEmitted: 0,
          cortices: [],
          findings: [],
          costUsd: 0,
        },
      },
    });

    const client = new ThalamusHttpClient("http://api.local", "secret-token");
    await client.runCycle({ query: "q" });
    const [, init] = fetchStub.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(init.headers.authorization).toBe("Bearer secret-token");
  });

  it("given missing findings + cost fields, when runCycle is called, then defaults to [] and 0", async () => {
    stubFetch({
      ok: true,
      jsonBody: {
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "",
          completedAt: "",
          findingsEmitted: 0,
          cortices: [],
        },
      },
    });
    const client = new ThalamusHttpClient("http://api.local");
    const out = await client.runCycle({ query: "q" });
    expect(out.findings).toEqual([]);
    expect(out.costUsd).toBe(0);
  });

  it("given a 500 with cycle.error, when runCycle is called, then it throws with the server error", async () => {
    stubFetch({
      ok: false,
      status: 500,
      jsonBody: {
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "",
          completedAt: "",
          findingsEmitted: 0,
          cortices: [],
          error: "planner empty DAG",
        },
        error: "planner empty DAG",
      },
    });
    const client = new ThalamusHttpClient("http://api.local");
    await expect(client.runCycle({ query: "q" })).rejects.toThrow(
      /planner empty DAG/,
    );
  });

  it("given a 200 with cycle.error, when runCycle is called, then it also throws", async () => {
    stubFetch({
      ok: true,
      jsonBody: {
        cycle: {
          id: "c1",
          kind: "thalamus",
          startedAt: "",
          completedAt: "",
          findingsEmitted: 0,
          cortices: [],
          error: "downstream unavailable",
        },
      },
    });
    const client = new ThalamusHttpClient("http://api.local");
    await expect(client.runCycle({ query: "q" })).rejects.toThrow(
      /downstream unavailable/,
    );
  });
});

describe("ThalamusHttpClient.getGraphNeighbourhood", () => {
  it("given a graph response, when getGraphNeighbourhood is called, then it maps nodes+edges to levels", async () => {
    const fetchStub = stubFetch({
      ok: true,
      jsonBody: {
        root: "finding:4",
        nodes: [
          { id: "finding:4" },
          { id: "sat:3" },
          { id: "op:ESA" },
          { id: "regime:LEO" },
        ],
        edges: [
          { id: "10", source: "finding:4", target: "sat:3" },
          { id: "11", source: "finding:4", target: "op:ESA" },
          { id: "12", source: "sat:3", target: "regime:LEO" },
        ],
      },
    });

    const client = new ThalamusHttpClient("http://api.local");
    const out = await client.getGraphNeighbourhood({
      entity: "finding:4",
      depth: 3,
    });

    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url, init] = fetchStub.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://api.local/api/kg/graph/finding%3A4?depth=3",
    );
    expect(init.headers).toEqual({});
    expect(out).toEqual({
      root: "finding:4",
      levels: [
        { depth: 0, nodes: ["finding:4"] },
        { depth: 1, nodes: ["sat:3", "op:ESA"] },
        { depth: 2, nodes: ["regime:LEO"] },
      ],
    });
  });

  it("given a failing graph response, when getGraphNeighbourhood is called, then it throws with the server error", async () => {
    stubFetch({
      ok: false,
      status: 404,
      jsonBody: { error: "graph not found" },
    });

    const client = new ThalamusHttpClient("http://api.local");
    await expect(
      client.getGraphNeighbourhood({ entity: "missing:1" }),
    ).rejects.toThrow(/graph not found/);
  });
});
