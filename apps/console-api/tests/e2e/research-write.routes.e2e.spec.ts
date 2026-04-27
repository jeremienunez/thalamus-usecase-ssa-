import Fastify, { type FastifyInstance } from "fastify";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  ResearchCortex,
  ResearchCycleStatus,
  ResearchCycleTrigger,
  ResearchEntityType,
  ResearchFindingType,
  ResearchRelation,
  ResearchStatus,
} from "@interview/shared/enum";
import { registerResearchWriteRoutes } from "../../src/routes/research-write.routes";
import { createResearchWriter } from "../../src/services/research-write.service";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../integration/_harness";

let harness: IntegrationHarness;
let app: FastifyInstance;

beforeAll(async () => {
  harness = await createIntegrationHarness();
});

beforeEach(async () => {
  await harness.reset();
  app = Fastify({ logger: false });
  registerResearchWriteRoutes(app, createResearchWriter(harness.db), {
    simKernelSharedSecret: "kernel-secret",
  });
});

afterAll(async () => {
  if (app) await app.close();
  if (harness) await harness.close();
});

describe("research write routes e2e", () => {
  it("writes a cycle through the kernel-only business DTO route", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/research/cycles",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        triggerType: ResearchCycleTrigger.System,
        triggerSource: "route-integration",
        status: ResearchCycleStatus.Running,
        findingsCount: 0,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ id: string }>();
    const rows = await harness.db.execute<{ trigger_source: string }>(sql`
      SELECT trigger_source
      FROM research_cycle
      WHERE id = ${BigInt(body.id)}
    `);
    expect(rows.rows).toEqual([{ trigger_source: "route-integration" }]);
  });

  it("writes a finding emission transaction through the business DTO route", async () => {
    const cycleRes = await app.inject({
      method: "POST",
      url: "/api/research/cycles",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        triggerType: ResearchCycleTrigger.System,
        triggerSource: "emission-route-integration",
        status: ResearchCycleStatus.Running,
      },
    });
    const cycleId = cycleRes.json<{ id: string }>().id;

    const res = await app.inject({
      method: "POST",
      url: "/api/research/finding-emissions",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        finding: {
          researchCycleId: cycleId,
          cortex: ResearchCortex.OrbitalAnalyst,
          findingType: ResearchFindingType.Insight,
          status: ResearchStatus.Active,
          title: "Route integration finding",
          summary: "Route integration summary",
          evidence: [{ source: "route" }],
          confidence: 0.82,
          dedupHash: "route-integration-finding",
        },
        link: { cycleId, iteration: 1 },
        edges: [
          {
            entityType: ResearchEntityType.Satellite,
            entityId: "77",
            relation: ResearchRelation.About,
            weight: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<{
      findingId: string;
      inserted: boolean;
      linked: boolean;
      edgeIds: string[];
    }>();
    expect(body).toMatchObject({
      inserted: true,
      linked: true,
      edgeIds: [expect.any(String)],
    });

    const rows = await harness.db.execute<{
      title: string;
      linked: string;
      edge_count: string;
    }>(sql`
      SELECT
        rf.title,
        rcf.research_finding_id::text AS linked,
        count(re.id)::text AS edge_count
      FROM research_finding rf
      JOIN research_cycle_finding rcf ON rcf.research_finding_id = rf.id
      LEFT JOIN research_edge re ON re.finding_id = rf.id
      WHERE rf.id = ${BigInt(body.findingId)}
      GROUP BY rf.title, rcf.research_finding_id
    `);

    expect(rows.rows).toEqual([
      {
        title: "Route integration finding",
        linked: body.findingId,
        edge_count: "1",
      },
    ]);
  });

  it("rolls back the finding emission when edge persistence fails", async () => {
    const cycleRes = await app.inject({
      method: "POST",
      url: "/api/research/cycles",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        triggerType: ResearchCycleTrigger.System,
        triggerSource: "rollback-route-integration",
        status: ResearchCycleStatus.Running,
      },
    });
    const cycleId = cycleRes.json<{ id: string }>().id;
    const dedupHash = "route-integration-rollback";

    const res = await app.inject({
      method: "POST",
      url: "/api/research/finding-emissions",
      headers: { "x-sim-kernel-secret": "kernel-secret" },
      payload: {
        finding: {
          researchCycleId: cycleId,
          cortex: ResearchCortex.OrbitalAnalyst,
          findingType: ResearchFindingType.Insight,
          status: ResearchStatus.Active,
          title: "Rollback finding",
          summary: "Rollback summary",
          evidence: [{ source: "route" }],
          confidence: 0.82,
          dedupHash,
        },
        link: { cycleId, iteration: 1 },
        edges: [
          {
            entityType: ResearchEntityType.Satellite,
            entityId: "9223372036854775808",
            relation: ResearchRelation.About,
            weight: 1,
          },
        ],
      },
    });

    expect(res.statusCode).toBe(500);

    const rows = await harness.db.execute<{
      finding_count: string;
      link_count: string;
    }>(sql`
      SELECT
        (SELECT count(*)::text FROM research_finding WHERE dedup_hash = ${dedupHash}) AS finding_count,
        (
          SELECT count(*)::text
          FROM research_cycle_finding rcf
          JOIN research_finding rf ON rf.id = rcf.research_finding_id
          WHERE rf.dedup_hash = ${dedupHash}
        ) AS link_count
    `);
    expect(rows.rows).toEqual([{ finding_count: "0", link_count: "0" }]);
  });
});
