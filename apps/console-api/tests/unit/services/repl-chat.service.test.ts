import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReplStreamEvent } from "@interview/shared";
import { stepLog } from "@interview/shared";
import { typedSpy } from "@interview/test-kit";
import { ReplChatService } from "../../../src/services/repl-chat.service";
import { ReplFollowUpService } from "../../../src/services/repl-followup.service";
import { IntentClassifier } from "../../../src/services/intent-classifier.service";
import { ChatReplyService } from "../../../src/services/chat-reply.service";
import { CycleStreamPump } from "../../../src/services/cycle-stream-pump.service";
import { CycleSummariser } from "../../../src/services/cycle-summariser.service";
import { ReplBriefingAggregator } from "../../../src/services/repl-briefing-aggregator.service";
import type { LlmTransportFactory } from "../../../src/services/llm-transport.port";
import {
  CLASSIFIER_SYSTEM_PROMPT,
  CONSOLE_CHAT_SYSTEM_PROMPT,
  summariserPrompt,
} from "../../../src/prompts/repl-chat.prompt";
import {
  SsaReplFollowUpExecutor,
  SsaReplFollowUpPolicy,
  type SsaReplFollowUpDeps,
} from "../../../src/agent/ssa/followup";

type FakeLlmState = {
  classifierContent: string;
  summariserContent: string;
  aggregateContent: string;
  chatContent: string;
  prompts: string[];
  summariserQueries: string[];
  summariserPayloads: string[];
  aggregateQueries: string[];
  aggregatePayloads: string[];
  callSignals: Array<AbortSignal | undefined>;
  lastSummariserPayload: string;
};

type ReplChatDeps = ConstructorParameters<typeof ReplChatService>[0];
type ReplFindingRow = Awaited<
  ReturnType<ReplChatDeps["findingRepo"]["findByCycleId"]>
>[number];

const SUMMARISER_PROMPT_PREFIX =
  'Role: SSA final synthesis briefer. Executed research query: "';
const AGGREGATE_PROMPT_PREFIX =
  'Role: SSA terminal briefing aggregator. Executed research query: "';

function parsePromptQuery(systemPrompt: string, prefix: string): string | null {
  if (!systemPrompt.startsWith(prefix)) return null;
  const start = prefix.length;
  const end = systemPrompt.indexOf('"\n', start);
  return end === -1 ? null : systemPrompt.slice(start, end);
}

function makeFakeFactory(state: FakeLlmState): LlmTransportFactory {
  return {
    create(systemPrompt: string) {
      state.prompts.push(systemPrompt);
      return {
        async call(input: string, options?: { signal?: AbortSignal }) {
          state.callSignals.push(options?.signal);
          if (systemPrompt === CLASSIFIER_SYSTEM_PROMPT) {
            return { content: state.classifierContent, provider: "kimi" };
          }
          if (systemPrompt === CONSOLE_CHAT_SYSTEM_PROMPT) {
            return { content: state.chatContent, provider: "kimi" };
          }
          const summariserQuery = parsePromptQuery(
            systemPrompt,
            SUMMARISER_PROMPT_PREFIX,
          );
          if (summariserQuery !== null) {
            state.summariserQueries.push(summariserQuery);
            state.summariserPayloads.push(input);
            state.lastSummariserPayload = input;
            return { content: state.summariserContent, provider: "kimi" };
          }
          const aggregateQuery = parsePromptQuery(
            systemPrompt,
            AGGREGATE_PROMPT_PREFIX,
          );
          if (aggregateQuery !== null) {
            state.aggregateQueries.push(aggregateQuery);
            state.aggregatePayloads.push(input);
            return { content: state.aggregateContent, provider: "kimi" };
          }
          throw new Error(`unexpected system prompt in test: ${systemPrompt.slice(0, 80)}`);
        },
      };
    },
  };
}

function buildReplChat(
  llm: LlmTransportFactory,
  deps: ConstructorParameters<typeof ReplChatService>[0],
  followUps?: ConstructorParameters<typeof ReplChatService>[5],
  briefingAggregator?: ConstructorParameters<typeof ReplChatService>[6],
): ReplChatService {
  return new ReplChatService(
    deps,
    new IntentClassifier(llm),
    new ChatReplyService(llm),
    new CycleStreamPump(),
    new CycleSummariser(llm),
    followUps,
    briefingAggregator,
  );
}

async function drain(
  gen: AsyncGenerator<ReplStreamEvent>,
): Promise<ReplStreamEvent[]> {
  const out: ReplStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

function findingRow(
  overrides: Partial<ReplFindingRow> = {},
): ReplFindingRow {
  return {
    id: "1",
    title: "Conjonction serrée",
    summary: "Pc=1.2e-08 for AQUA and BEESAT-1",
    cortex: "catalog",
    findingType: "alert",
    urgency: "medium",
    confidence: 0.82,
    ...overrides,
  };
}

describe("ReplChatService.handleStream — chat branch", () => {
  let llmState: FakeLlmState;

  beforeEach(() => {
    llmState = {
      classifierContent: JSON.stringify({ action: "chat" }),
      summariserContent: "summary",
      aggregateContent: JSON.stringify({
        title: "Synthese finale",
        summary: "Synthese agregee",
        sections: [{ title: "Resultat", body: "ok", bullets: [] }],
        nextActions: [],
      }),
      chatContent: "echo:bonjour",
      prompts: [],
      summariserQueries: [],
      summariserPayloads: [],
      aggregateQueries: [],
      aggregatePayloads: [],
      callSignals: [],
      lastSummariserPayload: "",
    };
  });

  it("emits classified → chat.complete → done when classifier routes to chat", async () => {
    const deps = {
      thalamusService: {
        runCycle: vi.fn(async () => ({ id: "cyc:unused" })),
      },
      findingRepo: {
        findByCycleId: vi.fn(async (): Promise<ReplFindingRow[]> => []),
      },
    } satisfies ReplChatDeps;
    const svc = buildReplChat(makeFakeFactory(llmState), deps);

    const events = await drain(svc.handleStream("bonjour"));
    expect(events.map((e) => e.event)).toEqual([
      "classified",
      "chat.complete",
      "done",
    ]);
    expect(events[0]).toMatchObject({
      event: "classified",
      data: { action: "chat" },
    });
    expect(events[1]).toMatchObject({
      event: "chat.complete",
      data: { text: "echo:bonjour", provider: "kimi" },
    });
    expect(events[2]).toMatchObject({
      event: "done",
      data: { findingsCount: 0, provider: "kimi" },
    });
    expect(llmState.prompts).toEqual([
      CLASSIFIER_SYSTEM_PROMPT,
      CONSOLE_CHAT_SYSTEM_PROMPT,
    ]);
  });

  it("passes the client AbortSignal to classifier and chat reply calls", async () => {
    const deps = {
      thalamusService: {
        runCycle: vi.fn(async () => ({ id: "cyc:unused" })),
      },
      findingRepo: {
        findByCycleId: vi.fn(async (): Promise<ReplFindingRow[]> => []),
      },
    } satisfies ReplChatDeps;
    const svc = buildReplChat(makeFakeFactory(llmState), deps);
    const controller = new AbortController();

    await drain(svc.handleStream("bonjour", undefined, controller.signal));

    expect(llmState.callSignals).toEqual([
      controller.signal,
      controller.signal,
    ]);
  });
});

describe("CLASSIFIER_SYSTEM_PROMPT", () => {
  it("frames recap and briefing requests as executable research intent for the LLM router", () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("recap");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("récap");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain("15 prochains jours");
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain(
      "Do not ask for confirmation when the user directly asks for the output",
    );
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain(
      "let the research planner decide the DAG",
    );
  });
});

describe("ReplChatService.handleStream — run_cycle branch", () => {
  let llmState: FakeLlmState;

  beforeEach(() => {
    llmState = {
      classifierContent: JSON.stringify({
        action: "run_cycle",
        query: "conjonctions",
      }),
      summariserContent: "n=1 finding resume",
      aggregateContent: JSON.stringify({
        title: "Synthese finale",
        summary: "Synthese agregee",
        sections: [{ title: "Resultat", body: "ok", bullets: ["#2"] }],
        nextActions: ["Surveiller les confirmations"],
      }),
      chatContent: "chat unused",
      prompts: [],
      summariserQueries: [],
      summariserPayloads: [],
      aggregateQueries: [],
      aggregatePayloads: [],
      callSignals: [],
      lastSummariserPayload: "",
    };
  });

  it("emits classified → cycle.start → step* → finding* → summary.complete → done", async () => {
    const runCycle = vi.fn(async () => {
      const logger = { info: () => {} } satisfies Parameters<typeof stepLog>[0];
      stepLog(logger, "cycle", "start", { cycleId: "cyc:42" });
      await Promise.resolve();
      stepLog(logger, "planner", "start");
      stepLog(logger, "planner", "done");
      stepLog(logger, "cortex", "done", { cortex: "catalog" });
      return { id: "cyc:42" };
    });

    const deps = {
      thalamusService: { runCycle },
      findingRepo: {
        findByCycleId: async () => [findingRow()],
      },
    } satisfies ReplChatDeps;
    const svc = buildReplChat(makeFakeFactory(llmState), deps);

    const events = await drain(svc.handleStream("scan conjonctions", 7n));
    const types = events.map((e) => e.event);
    expect(types[0]).toBe("classified");
    expect(types[1]).toBe("cycle.start");
    expect(types.filter((t) => t === "step").length).toBeGreaterThanOrEqual(3);
    expect(types.filter((t) => t === "finding")).toHaveLength(1);
    expect(types.at(-2)).toBe("summary.complete");
    expect(types.at(-1)).toBe("done");

    expect(runCycle).toHaveBeenCalledWith({
      query: "conjonctions",
      userId: 7n,
      triggerType: "user",
      triggerSource: "console-chat",
    });
    expect(llmState.prompts).toContain(CLASSIFIER_SYSTEM_PROMPT);
    expect(llmState.prompts).toContain(summariserPrompt("conjonctions"));

    const payload = JSON.parse(llmState.lastSummariserPayload) as {
      cycleId: string;
      findings: Array<{ summary: string | null; findingType: string | null }>;
    };
    expect(payload.cycleId).toBe("cyc:42");
    expect(payload.findings).toHaveLength(1);
    expect(payload.findings[0]).toMatchObject({
      summary: "Pc=1.2e-08 for AQUA and BEESAT-1",
      findingType: "alert",
    });
    expect(llmState.summariserQueries).toEqual(["conjonctions"]);
  });

  it("emits a terminal briefing even when no follow-up is launched", async () => {
    const llm = makeFakeFactory(llmState);
    const runCycle = vi.fn(async () => ({ id: "cyc:42" }));
    const deps = {
      thalamusService: { runCycle },
      findingRepo: {
        findByCycleId: async () => [findingRow()],
      },
    } satisfies ReplChatDeps;
    const svc = buildReplChat(
      llm,
      deps,
      undefined,
      new ReplBriefingAggregator(llm),
    );

    const events = await drain(svc.handleStream("scan conjonctions", 7n));
    const types = events.map((evt) => evt.event);

    expect(types).toEqual(
      expect.arrayContaining([
        "summary.complete",
        "briefing.complete",
        "done",
      ]),
    );
    expect(types.indexOf("summary.complete")).toBeLessThan(
      types.indexOf("briefing.complete"),
    );
    expect(types.at(-1)).toBe("done");
    expect(llmState.aggregateQueries).toEqual(["conjonctions"]);
    expect(JSON.parse(llmState.aggregatePayloads[0] ?? "{}")).toMatchObject({
      parentCycleId: "cyc:42",
      parent: {
        findings: [expect.objectContaining({ id: "1" })],
      },
      followUps: [],
    });
  });

  it("auto-launches a real 30d follow-up after the parent summary when verification requires monitoring", async () => {
    const llm = makeFakeFactory(llmState);
    const runCycle = typedSpy<ReplChatDeps["thalamusService"]["runCycle"]>();
    runCycle
      .mockImplementationOnce(async () => ({
        id: "cyc:42",
        verification: {
          needsVerification: true,
          reasonCodes: ["needs_monitoring"],
          confidence: 0.7,
          targetHints: [],
        },
      }))
      .mockImplementationOnce(async () => ({ id: "cyc:child" }));
    const findByCycleId = typedSpy<ReplChatDeps["findingRepo"]["findByCycleId"]>();
    findByCycleId.mockImplementation(async (id) =>
      String(id) === "cyc:child"
        ? [
            findingRow({
              id: "2",
              title: "Extended monitoring window",
              summary: "30d horizon keeps operator risk under review",
              cortex: "strategist",
              findingType: "brief",
              confidence: 0.9,
            }),
          ]
        : [findingRow()],
    );
    const findById = typedSpy<
      NonNullable<SsaReplFollowUpDeps["findingRepo"]["findById"]>
    >();
    findById.mockResolvedValue(null);
    const findByFindingIds = typedSpy<
      SsaReplFollowUpDeps["edgeRepo"]["findByFindingIds"]
    >();
    findByFindingIds.mockResolvedValue([]);
    const followUpDeps: SsaReplFollowUpDeps = {
      thalamusService: { runCycle },
      findingRepo: {
        findByCycleId,
        findById,
      },
      edgeRepo: {
        findByFindingIds,
      },
    };
    const followUps = new ReplFollowUpService(
      new SsaReplFollowUpPolicy(followUpDeps),
      new SsaReplFollowUpExecutor(
        followUpDeps,
        new CycleStreamPump(),
        new CycleSummariser(llm),
      ),
    );
    const deps = {
      thalamusService: { runCycle },
      findingRepo: { findByCycleId },
    } satisfies ReplChatDeps;
    const svc = buildReplChat(
      llm,
      deps,
      followUps,
      new ReplBriefingAggregator(llm),
    );

    const controller = new AbortController();
    const events = await drain(
      svc.handleStream("scan conjonctions", 7n, controller.signal),
    );
    const types = events.map((evt) => evt.event);
    expect(types).toEqual(
      expect.arrayContaining([
        "summary.complete",
        "followup.plan",
        "followup.started",
        "followup.finding",
        "followup.summary",
        "followup.done",
        "briefing.complete",
        "done",
      ]),
    );
    expect(types.indexOf("summary.complete")).toBeLessThan(
      types.indexOf("followup.plan"),
    );
    expect(types.indexOf("followup.plan")).toBeLessThan(
      types.indexOf("followup.started"),
    );
    expect(types.indexOf("followup.done")).toBeLessThan(
      types.indexOf("briefing.complete"),
    );
    expect(types.at(-1)).toBe("done");

    const followupPlan = events.find(
      (evt): evt is Extract<ReplStreamEvent, { event: "followup.plan" }> =>
        evt.event === "followup.plan",
    );
    expect(followupPlan?.data.autoLaunched).toEqual([
      expect.objectContaining({
        kind: "deep_research_30d",
        auto: true,
        reasonCodes: ["needs_monitoring"],
      }),
    ]);
    expect(followupPlan?.data.proposed).toEqual([]);
    expect(findByFindingIds).toHaveBeenCalledWith([1n]);

    expect(runCycle).toHaveBeenNthCalledWith(1, {
      query: "conjonctions",
      userId: 7n,
      triggerType: "user",
      triggerSource: "console-chat",
      signal: controller.signal,
    });
    expect(runCycle).toHaveBeenNthCalledWith(2, {
      query: expect.stringContaining(
        "Verification follow-up for parent cycle cyc:42.",
      ),
      userId: 7n,
      triggerType: "user",
      triggerSource: "console-followup:30d:cyc:42",
      signal: controller.signal,
    });
    expect(runCycle.mock.calls[1]?.[0].query).toContain("conjonctions");
    expect(runCycle.mock.calls[1]?.[0].query).toContain(
      "Keep the follow-up focused on conjunction/collision risk",
    );

    expect(llmState.summariserQueries).toHaveLength(2);
    expect(llmState.callSignals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
    expect(llmState.summariserQueries[0]).toBe("conjonctions");
    expect(llmState.summariserQueries[1]).toContain(
      "Verification follow-up for parent cycle cyc:42.",
    );

    const childPayload = JSON.parse(llmState.summariserPayloads[1] ?? "{}") as {
      cycleId: string;
      findings: Array<{ id: string; title: string; findingType: string | null }>;
    };
    expect(childPayload.cycleId).toBe("cyc:child");
    expect(childPayload.findings).toEqual([
      expect.objectContaining({
        id: "2",
        title: "Extended monitoring window",
        findingType: "brief",
      }),
    ]);
    expect(llmState.aggregateQueries).toEqual(["conjonctions"]);
    const aggregatePayload = JSON.parse(llmState.aggregatePayloads[0] ?? "{}") as {
      parentCycleId: string;
      followUps: Array<{ title: string; findings: Array<{ id: string }> }>;
    };
    expect(aggregatePayload.parentCycleId).toBe("cyc:42");
    expect(aggregatePayload.followUps[0]).toMatchObject({
      title: "Extend conjunction verification to 30 days",
      findings: [{ id: "2" }],
    });
    expect(
      events.find(
        (evt): evt is Extract<ReplStreamEvent, { event: "briefing.complete" }> =>
          evt.event === "briefing.complete",
      )?.data,
    ).toMatchObject({
      title: "Synthese finale",
      evidence: expect.arrayContaining([
        expect.objectContaining({ id: "2", source: "followup" }),
      ]),
    });
  });
});
