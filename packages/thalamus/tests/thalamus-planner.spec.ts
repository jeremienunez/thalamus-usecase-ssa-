import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_THALAMUS_CORTEX_CONFIG,
  DEFAULT_THALAMUS_PLANNER_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";
import { CortexRegistry } from "../src/cortices/registry";
import type { DAGPlan } from "../src/cortices/types";
import {
  setCortexConfigProvider,
  setPlannerConfigProvider,
} from "../src/config/runtime-config";

const mocks = vi.hoisted(() => ({
  callMock: vi.fn(),
  createLlmTransportMock: vi.fn(),
}));

vi.mock("../src/transports/llm-chat", () => ({
  createLlmTransport: mocks.createLlmTransportMock,
}));

import { ThalamusPlanner } from "../src/services/thalamus-planner.service";

function mkRegistry(
  knownNames: string[] = ["alpha", "beta", "user_scope", "strategist"],
): CortexRegistry {
  const names = [...knownNames];
  const known = new Set(names);
  const registry = new CortexRegistry("/tmp/test-thalamus-planner");
  registry.getHeadersForPlanner = () =>
    names.map((name) => `- **${name}**: ${name} header [sql: ]`).join("\n");
  registry.names = () => names;
  registry.has = (name: string) => known.has(name);
  return registry;
}

beforeEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG));
  mocks.callMock.mockReset();
  mocks.createLlmTransportMock.mockReset();
  mocks.createLlmTransportMock.mockReturnValue({
    call: mocks.callMock,
  });
});

afterEach(() => {
  setPlannerConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_PLANNER_CONFIG),
  );
  setCortexConfigProvider(new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG));
  vi.restoreAllMocks();
});

describe("ThalamusPlanner.plan", () => {
  it("filters unknown disabled and user-scoped cortices while preserving a recognized preferred provider", async () => {
    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        provider: "openai",
        model: "gpt-test",
        maxOutputTokens: 321,
        temperature: 0.2,
        reasoningEffort: "high",
        verbosity: "low",
        thinking: true,
        reasoningFormat: "deepseek",
        reasoningSplit: true,
        mandatoryStrategist: false,
        forcedCortices: ["strategist"],
        disabledCortices: ["disabled"],
      }),
    );
    setCortexConfigProvider(
      new StaticConfigProvider({
        overrides: {
          beta: { enabled: false },
        },
      }),
    );

    const planner = new ThalamusPlanner(mkRegistry(), {
      userScopedCortices: new Set(["user_scope"]),
    });

    mocks.callMock.mockResolvedValue({
      content: `Plan draft:
{
  "intent": "Probe the corridor",
  "complexity": "deep",
  "nodes": [
    { "cortex": "alpha", "params": { "pass": 1 }, "dependsOn": [] },
    { "cortex": "unknown", "params": {}, "dependsOn": [] },
    { "cortex": "beta", "params": {}, "dependsOn": ["alpha"] },
    { "cortex": "user_scope", "params": {}, "dependsOn": ["alpha"] }
  ]
}`,
      provider: "openai",
    });

    const plan = await planner.plan("Probe the corridor", {
      hasUser: false,
    });

    expect(mocks.createLlmTransportMock).toHaveBeenCalledWith(
      expect.stringContaining("- **alpha**: alpha header [sql: ]"),
      {
        preferredProvider: "openai",
        overrides: {
          model: "gpt-test",
          maxOutputTokens: 321,
          temperature: 0.2,
          reasoningEffort: "high",
          verbosity: "low",
          thinking: true,
          reasoningFormat: "deepseek",
          reasoningSplit: true,
        },
      },
    );
    expect(mocks.callMock).toHaveBeenCalledWith(
      'Research query: "Probe the corridor"\n\nProduce the optimal DAG plan.',
    );
    expect(plan).toEqual({
      intent: "Probe the corridor",
      complexity: "deep",
      nodes: [
        {
          cortex: "alpha",
          params: { pass: 1 },
          dependsOn: [],
        },
        {
          cortex: "strategist",
          params: {},
          dependsOn: [],
        },
      ],
    });
  });

  it("falls back when post-filters empty the DAG and leaves preferredProvider undefined for unknown providers", async () => {
    const fallbackPlan: DAGPlan = {
      intent: "fallback corridor",
      complexity: "simple",
      nodes: [{ cortex: "strategist", params: {}, dependsOn: [] }],
    };

    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        provider: "anthropic-compatible",
        mandatoryStrategist: false,
        disabledCortices: ["alpha"],
      }),
    );

    const planner = new ThalamusPlanner(mkRegistry(["alpha", "strategist"]), {
      fallbackPlan: () => fallbackPlan,
      userScopedCortices: new Set(["user_scope"]),
    });

    mocks.callMock.mockResolvedValue({
      content: JSON.stringify({
        intent: "Probe the corridor",
        complexity: "simple",
        nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
      }),
      provider: "other",
    });

    const plan = await planner.plan("Probe the corridor");

    expect(mocks.createLlmTransportMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        preferredProvider: undefined,
      }),
    );
    expect(plan).toBe(fallbackPlan);
  });

  it("falls back when the LLM response does not contain JSON", async () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]), {
      fallbackCortices: ["alpha"],
    });

    mocks.callMock.mockResolvedValue({
      content: "No machine-readable DAG here.",
      provider: "kimi",
    });

    const plan = await planner.plan("Recover the plan");

    expect(plan).toEqual({
      intent: "Recover the plan",
      complexity: "moderate",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });

  it("falls back when the transport rejects", async () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]), {
      fallbackCortices: ["alpha"],
    });

    mocks.callMock.mockRejectedValue("planner transport down");

    const plan = await planner.plan("Recover after transport failure");

    expect(plan).toEqual({
      intent: "Recover after transport failure",
      complexity: "moderate",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });
});

describe("ThalamusPlanner.getDaemonDag", () => {
  it("returns null for unknown daemon jobs", () => {
    const planner = new ThalamusPlanner(mkRegistry());

    expect(planner.getDaemonDag("missing-job")).toBeNull();
  });

  it("strips user-scoped daemon nodes and prunes their dependencies", () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha", "user_scope"]), {
      daemonDags: {
        "daily-refresh": {
          intent: "refresh",
          complexity: "moderate",
          nodes: [
            { cortex: "alpha", params: {}, dependsOn: [] },
            { cortex: "user_scope", params: {}, dependsOn: ["alpha"] },
            { cortex: "alpha", params: { secondPass: true }, dependsOn: ["user_scope"] },
          ],
        },
      },
      userScopedCortices: new Set(["user_scope"]),
    });

    const dag = planner.getDaemonDag("daily-refresh");

    expect(dag).toEqual({
      intent: "refresh",
      complexity: "moderate",
      nodes: [
        { cortex: "alpha", params: {}, dependsOn: [] },
        { cortex: "alpha", params: { secondPass: true }, dependsOn: [] },
      ],
    });
  });

  it("leaves daemon DAGs untouched when no user-scoped cortices are configured", () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]), {
      daemonDags: {
        heartbeat: {
          intent: "heartbeat",
          complexity: "simple",
          nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
        },
      },
    });

    expect(planner.getDaemonDag("heartbeat")).toEqual({
      intent: "heartbeat",
      complexity: "simple",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });

  it("leaves daemon DAGs untouched when user-scoped cortices exist but none are present in the plan", () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]), {
      daemonDags: {
        heartbeat: {
          intent: "heartbeat",
          complexity: "simple",
          nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
        },
      },
      userScopedCortices: new Set(["user_scope"]),
    });

    expect(planner.getDaemonDag("heartbeat")).toEqual({
      intent: "heartbeat",
      complexity: "simple",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });
});
