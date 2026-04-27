import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  ResearchCortex,
  ResearchFindingType,
  ResearchStatus,
  ResearchUrgency,
} from "@interview/shared/enum";
import { createResearchWriter } from "../../../src/services/research-write.service";
import {
  createIntegrationHarness,
  type IntegrationHarness,
} from "../_harness";

type ResearchWriter = ReturnType<typeof createResearchWriter>;
type CreateFindingInput = Parameters<ResearchWriter["createFinding"]>[0];

let harness: IntegrationHarness;
let writer: ResearchWriter;

beforeAll(async () => {
  harness = await createIntegrationHarness();
  writer = createResearchWriter(harness.db);
});

beforeEach(async () => {
  await harness.reset();
  await harness.db.execute(sql`
    INSERT INTO research_cycle (id, trigger_type, trigger_source, status, findings_count)
    VALUES (1, 'system', 'writer-integration', 'running', 0)
  `);
});

afterAll(async () => {
  if (harness) await harness.close();
});

describe("ResearchWriteService integration", () => {
  it("given a business writer finding DTO, when createFinding writes it, then the read repository can load the persisted row", async () => {
    const input: CreateFindingInput = {
      researchCycleId: 1n,
      cortex: ResearchCortex.OrbitalAnalyst,
      findingType: ResearchFindingType.Insight,
      status: ResearchStatus.Active,
      urgency: ResearchUrgency.Medium,
      title: "Inserted finding",
      summary: "Inserted summary",
      evidence: [{ url: "https://inserted" }],
      reasoning: "inserted reasoning",
      confidence: 0.77,
      impactScore: 0.5,
    };

    const row = await writer.createFinding(input);
    const inserted = await harness.db.execute<{
      id: string;
      title: string;
      summary: string;
      cortex: string;
      status: string;
    }>(sql`
      SELECT id::text, title, summary, cortex::text, status::text
      FROM research_finding
      WHERE id = ${row.id}
    `);

    expect(inserted.rows[0]).toEqual({
      id: row.id.toString(),
      title: "Inserted finding",
      summary: "Inserted summary",
      cortex: "orbital_analyst",
      status: "active",
    });
  });
});
