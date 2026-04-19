import { describe, expect, it, vi } from "vitest";
import { ReplFollowUpService } from "../../../src/services/repl-followup.service";
import { CycleStreamPump } from "../../../src/services/cycle-stream-pump.service";
import { CycleSummariser } from "../../../src/services/cycle-summariser.service";
import {
  SsaReplFollowUpExecutor,
  SsaReplFollowUpPolicy,
} from "../../../src/agent/ssa/followup";

function buildService(edges: Array<{ finding_id: string; entity_type: string; entity_id: string }> = []) {
  const deps = {
    thalamusService: {
      runCycle: vi.fn(async () => ({ id: "cyc:child" })),
    },
    findingRepo: {
      findByCycleId: vi.fn(async () => []),
    },
    edgeRepo: {
      findByFindingIds: vi.fn(async () => edges),
    },
    sim: {
      preflight: {
        canStartTelemetry: vi.fn(async () => true),
        canStartPc: vi.fn(async () => true),
      },
    },
    sweep: {
      nanoSweepService: {
        sweep: vi.fn(async () => ({ suggestionsStored: 1, wallTimeMs: 5 })),
      },
    },
  };
  return new ReplFollowUpService(
    new SsaReplFollowUpPolicy(deps),
    new SsaReplFollowUpExecutor(
      deps,
      new CycleStreamPump(),
      {
        summarise: vi.fn(async () => ({ text: "summary", provider: "kimi" })),
      } as unknown as CycleSummariser,
    ),
  );
}

describe("ReplFollowUpService.plan", () => {
  it("auto-launches at most one 30d child and one proof child", async () => {
    const service = buildService();

    const plan = await service.plan({
      query: "Analyse la flotte active",
      parentCycleId: "415",
      verification: {
        needsVerification: true,
        reasonCodes: [
          "horizon_insufficient",
          "needs_monitoring",
          "data_gap",
        ],
        confidence: 0.72,
        targetHints: [
          {
            entityType: "conjunction_event",
            entityId: "41",
            sourceCortex: "strategist",
            sourceTitle: "Verify conjunction",
            confidence: 0.8,
          },
          {
            entityType: "satellite",
            entityId: "7",
            sourceCortex: "data_auditor",
            sourceTitle: "Telemetry gap",
            confidence: 0.7,
          },
        ],
      },
      findings: [],
    });

    expect(plan.autoLaunched).toHaveLength(2);
    expect(plan.autoLaunched.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "deep_research_30d",
        "sim_pc_verification",
      ]),
    );
    expect(plan.proposed.some((item) => item.kind === "sim_telemetry_verification")).toBe(true);
  });

  it("does not enqueue a 30d child when the parent query already asked for 30 days", async () => {
    const service = buildService();

    const plan = await service.plan({
      query: "Dresse un brief SSA priorisé par opérateur sur les 30 jours à venir",
      parentCycleId: "416",
      verification: {
        needsVerification: true,
        reasonCodes: ["horizon_insufficient", "needs_monitoring"],
        confidence: 0.8,
        targetHints: [],
      },
      findings: [],
    });

    expect(
      [...plan.autoLaunched, ...plan.proposed, ...plan.dropped].some(
        (item) => item.kind === "deep_research_30d",
      ),
    ).toBe(false);
  });

  it("auto-launches a targeted sweep only when operator_country is explicit", async () => {
    const service = buildService();

    const plan = await service.plan({
      query: "Analyse les trous de catalogage",
      parentCycleId: "417",
      verification: {
        needsVerification: true,
        reasonCodes: ["data_gap"],
        confidence: 0.76,
        targetHints: [
          {
            entityType: "operator_country",
            entityId: "5",
            sourceCortex: "data_auditor",
            sourceTitle: "Operator-country gap",
            confidence: 0.8,
          },
        ],
      },
      findings: [],
    });

    expect(plan.autoLaunched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "sweep_targeted_audit",
          target: expect.objectContaining({
            entityType: "operator_country",
            entityId: "5",
          }),
        }),
      ]),
    );
  });

  it("downgrades telemetry verification to proposed when the target is not launchable", async () => {
    const deps = {
      thalamusService: {
        runCycle: vi.fn(async () => ({ id: "cyc:child" })),
      },
      findingRepo: {
        findByCycleId: vi.fn(async () => []),
      },
      edgeRepo: {
        findByFindingIds: vi.fn(async () => []),
      },
      sim: {
        preflight: {
          canStartTelemetry: vi.fn(async () => false),
          canStartPc: vi.fn(async () => true),
        },
      },
    };
    const service = new ReplFollowUpService(
      new SsaReplFollowUpPolicy(deps),
      new SsaReplFollowUpExecutor(
        deps,
        new CycleStreamPump(),
        {
          summarise: vi.fn(async () => ({ text: "summary", provider: "kimi" })),
        } as unknown as CycleSummariser,
      ),
    );

    const plan = await service.plan({
      query: "Analyse les trous de telemetrie",
      parentCycleId: "418",
      verification: {
        needsVerification: true,
        reasonCodes: ["data_gap", "needs_monitoring"],
        confidence: 0.76,
        targetHints: [
          {
            entityType: "satellite",
            entityId: "27424",
            sourceCortex: "data_auditor",
            sourceTitle: "Telemetry gap",
            confidence: 0.8,
          },
        ],
      },
      findings: [],
    });

    expect(
      plan.autoLaunched.some(
        (item) => item.kind === "sim_telemetry_verification",
      ),
    ).toBe(false);
    expect(plan.proposed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "sim_telemetry_verification",
          target: expect.objectContaining({
            entityType: "satellite",
            entityId: "27424",
          }),
        }),
      ]),
    );
    expect(plan.proposed[0]?.rationale).toContain(
      "Auto-launch held back because the target is not currently launchable.",
    );
  });
});
