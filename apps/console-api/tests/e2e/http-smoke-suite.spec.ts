import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";
import {
  cleanupHttpSmokeFixture,
  E2E_DATABASE_URL,
  HTTP_SMOKE_FINDING_ID,
  HTTP_SMOKE_SATELLITE_ID,
  seedHttpSmokeFixture,
} from "./helpers/db-fixtures";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
let pool: Pool;

beforeAll(async () => {
  pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    await seedHttpSmokeFixture(client);
  } finally {
    client.release();
  }
});

afterAll(async () => {
  const client = await pool.connect();
  try {
    await cleanupHttpSmokeFixture(client);
  } finally {
    client.release();
    await pool.end();
  }
});

describe("HTTP smoke suite", () => {
  it("serves health and stats endpoints", async () => {
    const health = await fetch(`${BASE}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({
      ok: true,
      ts: expect.any(String),
    });

    const stats = await fetch(`${BASE}/api/stats`);
    expect(stats.status).toBe(200);
    const body = (await stats.json()) as {
      satellites: number;
      findings: number;
      kgEdges: number;
      researchCycles: number;
    };
    expect(body.satellites).toBeGreaterThanOrEqual(1);
    expect(body.findings).toBeGreaterThanOrEqual(1);
    expect(body.kgEdges).toBeGreaterThanOrEqual(1);
    expect(body.researchCycles).toBeGreaterThanOrEqual(1);
  });

  it("serves findings and why routes for a seeded finding", async () => {
    const list = await fetch(`${BASE}/api/findings`);
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      items: Array<{ id: string; title: string; linkedEntityIds: string[] }>;
      count: number;
    };
    expect(listBody.count).toBeGreaterThanOrEqual(1);
    expect(listBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `f:${String(HTTP_SMOKE_FINDING_ID)}`,
          title: "Smoke Finding",
          linkedEntityIds: expect.arrayContaining([
            `sat:${String(HTTP_SMOKE_SATELLITE_ID)}`,
            "op:Smoke Operator",
            "regime:SMOKE-LEO",
          ]),
        }),
      ]),
    );

    const finding = await fetch(
      `${BASE}/api/findings/f:${String(HTTP_SMOKE_FINDING_ID)}`,
    );
    expect(finding.status).toBe(200);
    const findingBody = (await finding.json()) as {
      id: string;
      evidence: Array<{ kind: string; uri: string }>;
    };
    expect(findingBody.id).toBe(`f:${String(HTTP_SMOKE_FINDING_ID)}`);
    expect(findingBody.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "osint",
          uri: "https://example.org/smoke-finding",
        }),
      ]),
    );

    const why = await fetch(
      `${BASE}/api/why/f:${String(HTTP_SMOKE_FINDING_ID)}`,
    );
    expect(why.status).toBe(200);
    const whyBody = (await why.json()) as {
      id: string;
      kind: string;
      children: Array<{ kind: string; children: unknown[] }>;
    };
    expect(whyBody.id).toBe(`finding:${String(HTTP_SMOKE_FINDING_ID)}`);
    expect(whyBody.kind).toBe("finding");
    expect(whyBody.children).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "edge",
          children: expect.any(Array),
        }),
      ]),
    );
  });

  it("serves KG nodes, edges, and neighbourhood traversal", async () => {
    const nodes = await fetch(`${BASE}/api/kg/nodes`);
    expect(nodes.status).toBe(200);
    const nodesBody = (await nodes.json()) as {
      items: Array<{ id: string; label: string }>;
    };
    expect(nodesBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `sat:${String(HTTP_SMOKE_SATELLITE_ID)}`,
          label: "smoke-sat",
        }),
        expect.objectContaining({
          id: `finding:${String(HTTP_SMOKE_FINDING_ID)}`,
          label: "Smoke Finding",
        }),
      ]),
    );

    const edges = await fetch(`${BASE}/api/kg/edges`);
    expect(edges.status).toBe(200);
    const edgesBody = (await edges.json()) as {
      items: Array<{ source: string; target: string; relation: string }>;
    };
    expect(edgesBody.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: `finding:${String(HTTP_SMOKE_FINDING_ID)}`,
          target: `sat:${String(HTTP_SMOKE_SATELLITE_ID)}`,
          relation: "about",
        }),
      ]),
    );

    const graph = await fetch(
      `${BASE}/api/kg/graph/${encodeURIComponent(`satellite:${String(HTTP_SMOKE_SATELLITE_ID)}`)}`,
    );
    expect(graph.status).toBe(200);
    const graphBody = (await graph.json()) as {
      root: string;
      nodes: Array<{ id: string }>;
      edges: Array<{ source: string; target: string }>;
    };
    expect(graphBody.root).toBe(`sat:${String(HTTP_SMOKE_SATELLITE_ID)}`);
    expect(graphBody.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: `sat:${String(HTTP_SMOKE_SATELLITE_ID)}`,
        }),
        expect.objectContaining({
          id: `finding:${String(HTTP_SMOKE_FINDING_ID)}`,
        }),
      ]),
    );
    expect(graphBody.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: `finding:${String(HTTP_SMOKE_FINDING_ID)}`,
          target: `sat:${String(HTTP_SMOKE_SATELLITE_ID)}`,
        }),
      ]),
    );
  });
});
