import { describe, expect, it, vi } from "vitest";
import type { ReplStreamEvent } from "@interview/shared";
import { typedSpy } from "@interview/test-kit";
import { ReplFollowUpService } from "../../../src/services/repl-followup.service";
import { CycleStreamPump } from "../../../src/services/cycle-stream-pump.service";
import { CycleSummariser } from "../../../src/services/cycle-summariser.service";
import type { LlmTransportFactory } from "../../../src/services/llm-transport.port";
import {
  SsaReplFollowUpExecutor,
  SsaReplFollowUpPolicy,
  type SsaReplFollowUpDeps,
} from "../../../src/agent/ssa/followup";
import type { EdgeRow } from "../../../src/types/finding.types";

type SimDeps = NonNullable<SsaReplFollowUpDeps["sim"]>;
type SweepDeps = NonNullable<SsaReplFollowUpDeps["sweep"]>;

function buildSummariser(
  text = "summary",
  provider = "kimi",
): CycleSummariser {
  const llm: LlmTransportFactory = {
    create() {
      return {
        async call() {
          return { content: text, provider };
        },
      };
    },
  };
  return new CycleSummariser(llm);
}

function buildService(edges: EdgeRow[] = []) {
  const runCycle = typedSpy<SsaReplFollowUpDeps["thalamusService"]["runCycle"]>();
  runCycle.mockResolvedValue({ id: "cyc:child" });
  const findByCycleId = typedSpy<
    SsaReplFollowUpDeps["findingRepo"]["findByCycleId"]
  >();
  findByCycleId.mockResolvedValue([]);
  const findById = typedSpy<
    NonNullable<SsaReplFollowUpDeps["findingRepo"]["findById"]>
  >();
  findById.mockResolvedValue(null);
  const findByFindingIds = typedSpy<
    SsaReplFollowUpDeps["edgeRepo"]["findByFindingIds"]
  >();
  findByFindingIds.mockImplementation(async () => edges);
  const canStartTelemetry = typedSpy<
    NonNullable<SimDeps["preflight"]>["canStartTelemetry"]
  >();
  canStartTelemetry.mockResolvedValue(true);
  const canStartPc = typedSpy<
    NonNullable<SimDeps["preflight"]>["canStartPc"]
  >();
  canStartPc.mockResolvedValue(true);
  const startTelemetry = typedSpy<SimDeps["launcher"]["startTelemetry"]>();
  startTelemetry.mockImplementation(async ({ satelliteId, fishCount }) => ({
    swarmId: satelliteId,
    fishCount: fishCount ?? 25,
  }));
  const startPc = typedSpy<SimDeps["launcher"]["startPc"]>();
  startPc.mockImplementation(async ({ conjunctionId, fishCount }) => ({
    swarmId: conjunctionId,
    fishCount: fishCount ?? 25,
    conjunctionId,
  }));
  const findSwarmById = typedSpy<SimDeps["swarm"]["findById"]>();
  findSwarmById.mockResolvedValue({
    status: "done",
    outcomeReportFindingId: null,
    suggestionId: null,
  });
  const countFishByStatus = typedSpy<SimDeps["swarm"]["countFishByStatus"]>();
  countFishByStatus.mockResolvedValue({
    done: 12,
    failed: 0,
    running: 0,
    pending: 0,
    paused: 0,
  });
  const sweep = typedSpy<SweepDeps["nanoSweepService"]["sweep"]>();
  sweep.mockResolvedValue({ suggestionsStored: 1, wallTimeMs: 5 });

  const deps: SsaReplFollowUpDeps = {
    thalamusService: {
      runCycle,
    },
    findingRepo: {
      findByCycleId,
      findById,
    },
    edgeRepo: {
      findByFindingIds,
    },
    sim: {
      preflight: {
        canStartTelemetry,
        canStartPc,
      },
      launcher: {
        startTelemetry,
        startPc,
      },
      swarm: {
        findById: findSwarmById,
        countFishByStatus,
      },
    },
    sweep: {
      nanoSweepService: {
        sweep,
      },
    },
  };

  const service = new ReplFollowUpService(
    new SsaReplFollowUpPolicy(deps),
    new SsaReplFollowUpExecutor(
      deps,
      new CycleStreamPump(),
      buildSummariser(),
    ),
  );

  return {
    service,
    runCycle,
    findByCycleId,
    findById,
    findByFindingIds,
    canStartTelemetry,
    canStartPc,
    startTelemetry,
    startPc,
    findSwarmById,
    countFishByStatus,
    sweep,
  };
}

describe("ReplFollowUpService.plan", () => {
  it("auto-launches at most one 30d child and one proof child", async () => {
    const { service } = buildService();

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
    const { service } = buildService();

    const plan = await service.plan({
      query: "Dresse un brief SSA priorisé par opérateur sur les 30 prochains jours",
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

  it("does not keep proposing the same auto 30d branch for the same query signature", async () => {
    const { service } = buildService();
    const request: Parameters<typeof service.plan>[0] = {
      query: "rapport des launch pour les prochains jours",
      parentCycleId: "416",
      verification: {
        needsVerification: true,
        reasonCodes: ["horizon_insufficient", "needs_monitoring"],
        confidence: 0.8,
        targetHints: [],
      },
      findings: [],
    };

    const first = await service.plan(request);
    const second = await service.plan({
      ...request,
      parentCycleId: "417",
    });

    expect(first.autoLaunched).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "deep_research_30d",
          title: "Corroborate launch report over 30 days",
        }),
      ]),
    );
    expect(
      [...second.autoLaunched, ...second.proposed, ...second.dropped].some(
        (item) => item.kind === "deep_research_30d",
      ),
    ).toBe(false);
  });

  it("auto-launches a targeted sweep only when operator_country is explicit", async () => {
    const { service } = buildService();

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
    const { service, canStartTelemetry } = buildService();
    canStartTelemetry.mockResolvedValue(false);

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

  it("derives follow-ups from evidence edges and skips finding ids that are not BigInt-parsable", async () => {
    const { service, findByFindingIds } = buildService([
      {
        finding_id: "12",
        entity_type: "satellite",
        entity_id: "27424",
      },
      {
        finding_id: "12",
        entity_type: "operator_country",
        entity_id: "5",
      },
    ]);

    const plan = await service.plan({
      query: "Analyse les trous de telemetrie",
      parentCycleId: "420",
      verification: {
        needsVerification: true,
        reasonCodes: ["data_gap"],
        confidence: 0.76,
        targetHints: [],
      },
      findings: [
        {
          id: "12",
          title: "Telemetry gap",
          summary: null,
          cortex: "data_auditor",
          findingType: "anomaly",
          urgency: "medium",
          confidence: 0.81,
        },
        {
          id: "f:ui-only",
          title: "Decorative id",
          summary: null,
          cortex: "ui",
          findingType: "note",
          urgency: "low",
          confidence: 0.2,
        },
      ],
    });

    expect(findByFindingIds).toHaveBeenCalledWith([12n]);
    expect([...plan.autoLaunched, ...plan.proposed]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "sim_telemetry_verification",
          rationale: "Derived from #12: Telemetry gap.",
          target: expect.objectContaining({
            entityType: "satellite",
            entityId: "27424",
          }),
        }),
        expect.objectContaining({
          kind: "sweep_targeted_audit",
          rationale: "Derived from #12: Telemetry gap.",
          target: expect.objectContaining({
            entityType: "operator_country",
            entityId: "5",
          }),
        }),
      ]),
    );
  });
});

describe("ReplFollowUpService.executeSelected", () => {
  it("streams a manually selected follow-up with auto=false", async () => {
    const { service, runCycle } = buildService();

    const events: ReplStreamEvent[] = [];
    for await (const event of service.executeSelected({
      item: {
        followupId: "fu-manual",
        kind: "deep_research_30d",
        auto: false,
        title: "Extend verification horizon to 30 days",
        rationale: "Needs monitoring",
        score: 0.7,
        gateScore: 0.8,
        costClass: "medium",
        reasonCodes: ["needs_monitoring"],
        target: null,
      },
      query: "Analyse la flotte active",
      parentCycleId: "419",
    })) {
      events.push(event);
    }

    expect(events[0]).toMatchObject({
      event: "followup.started",
      data: {
        followupId: "fu-manual",
        kind: "deep_research_30d",
        auto: false,
      },
    });
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          event: "followup.summary",
        }),
        expect.objectContaining({
          event: "followup.done",
          data: expect.objectContaining({
            followupId: "fu-manual",
            auto: false,
          }),
        }),
      ]),
    );
    expect(runCycle).toHaveBeenCalledWith({
      query: expect.stringContaining(
        "Verification follow-up for parent cycle 419. Extend the evidence horizon to 30 days for the same user objective.",
      ),
      userId: undefined,
      triggerType: "user",
      triggerSource: "console-followup:30d:419",
    });
    expect(runCycle.mock.calls[0]?.[0].query).toContain(
      "Do not switch to fleet inventory or operator portfolio analysis",
    );
  });

  it("runs a targeted sweep with the real runtime payload", async () => {
    const { service, sweep } = buildService();
    sweep.mockResolvedValue({ suggestionsStored: 3, wallTimeMs: 7 });

    const events: ReplStreamEvent[] = [];
    for await (const event of service.executeSelected({
      item: {
        followupId: "fu-sweep",
        kind: "sweep_targeted_audit",
        auto: false,
        title: "Run a targeted audit on operator_country 5",
        rationale: "Derived from #12: Telemetry gap.",
        score: 0.75,
        gateScore: 0.76,
        costClass: "low",
        reasonCodes: ["data_gap"],
        target: {
          entityType: "operator_country",
          entityId: "5",
          refs: null,
        },
      },
      query: "Analyse les trous de telemetrie",
      parentCycleId: "421",
    })) {
      events.push(event);
    }

    expect(sweep).toHaveBeenCalledWith(1, "nullScan", {
      entityType: "operator_country",
      entityIds: ["5"],
      reasonCodes: ["data_gap"],
      parentCycleId: "421",
    });
    expect(events).toEqual([
      {
        event: "followup.started",
        data: {
          parentCycleId: "421",
          followupId: "fu-sweep",
          kind: "sweep_targeted_audit",
          auto: false,
          title: "Run a targeted audit on operator_country 5",
        },
      },
      {
        event: "followup.summary",
        data: {
          parentCycleId: "421",
          followupId: "fu-sweep",
          kind: "sweep_targeted_audit",
          auto: false,
          text: "Targeted sweep audit stored 3 suggestion(s) for operator_country 5.",
          provider: "system",
        },
      },
      {
        event: "followup.done",
        data: {
          parentCycleId: "421",
          followupId: "fu-sweep",
          kind: "sweep_targeted_audit",
          auto: false,
          provider: "system",
          tookMs: expect.any(Number),
          status: "completed",
        },
      },
    ]);
  });
});
