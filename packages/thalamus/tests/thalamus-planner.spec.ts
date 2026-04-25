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
  setCortexConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG),
  );
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
  setCortexConfigProvider(
    new StaticConfigProvider(DEFAULT_THALAMUS_CORTEX_CONFIG),
  );
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
    expect(plan).toEqual(fallbackPlan);
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

  it("applies runtime and user filters to fallback DAGs", async () => {
    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        mandatoryStrategist: false,
        disabledCortices: ["beta"],
      }),
    );
    const planner = new ThalamusPlanner(mkRegistry(["alpha", "beta", "user_scope"]), {
      fallbackCortices: ["alpha", "beta", "user_scope"],
      userScopedCortices: new Set(["user_scope"]),
    });

    mocks.callMock.mockResolvedValue({
      content: "No machine-readable DAG here.",
      provider: "kimi",
    });

    const plan = await planner.plan("Recover filtered fallback", {
      hasUser: false,
    });

    expect(plan.nodes.map((n) => n.cortex)).toEqual(["alpha"]);
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

  it("passes AbortSignal to the planner LLM and does not convert aborts into fallback DAGs", async () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]), {
      fallbackCortices: ["alpha"],
    });
    const controller = new AbortController();
    const abort = new Error("planner cancelled");
    abort.name = "AbortError";
    mocks.callMock.mockRejectedValue(abort);

    await expect(
      planner.plan("Abort planner", { signal: controller.signal }),
    ).rejects.toThrow("planner cancelled");
    expect(mocks.callMock).toHaveBeenCalledWith(
      'Research query: "Abort planner"\n\nProduce the optimal DAG plan.',
      { signal: controller.signal },
    );
  });
});

describe("ThalamusPlanner.getDaemonDag", () => {
  it("returns null for unknown daemon jobs", async () => {
    const planner = new ThalamusPlanner(mkRegistry());

    await expect(planner.getDaemonDag("missing-job")).resolves.toBeNull();
  });

  it("strips user-scoped daemon nodes and prunes their dependencies", async () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha", "user_scope"]), {
      daemonDags: {
        "daily-refresh": {
          intent: "refresh",
          complexity: "moderate",
          nodes: [
            { cortex: "alpha", params: {}, dependsOn: [] },
            { cortex: "user_scope", params: {}, dependsOn: ["alpha"] },
            {
              cortex: "alpha",
              params: { secondPass: true },
              dependsOn: ["user_scope"],
            },
          ],
        },
      },
      userScopedCortices: new Set(["user_scope"]),
    });

    const dag = await planner.getDaemonDag("daily-refresh");

    expect(dag).toEqual({
      intent: "refresh",
      complexity: "moderate",
      nodes: [
        { cortex: "alpha", params: {}, dependsOn: [] },
        { cortex: "alpha", params: { secondPass: true }, dependsOn: [] },
      ],
    });
  });

  it("leaves daemon DAGs untouched when no user-scoped cortices are configured", async () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]), {
      daemonDags: {
        heartbeat: {
          intent: "heartbeat",
          complexity: "simple",
          nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
        },
      },
    });

    await expect(planner.getDaemonDag("heartbeat")).resolves.toEqual({
      intent: "heartbeat",
      complexity: "simple",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });

  it("leaves daemon DAGs untouched when user-scoped cortices exist but none are present in the plan", async () => {
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

    await expect(planner.getDaemonDag("heartbeat")).resolves.toEqual({
      intent: "heartbeat",
      complexity: "simple",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });

  it("applies runtime filters to daemon DAGs", async () => {
    setPlannerConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_THALAMUS_PLANNER_CONFIG,
        mandatoryStrategist: false,
        disabledCortices: ["beta"],
      }),
    );
    const planner = new ThalamusPlanner(mkRegistry(["alpha", "beta"]), {
      daemonDags: {
        refresh: {
          intent: "refresh",
          complexity: "moderate",
          nodes: [
            { cortex: "alpha", params: {}, dependsOn: [] },
            { cortex: "beta", params: {}, dependsOn: ["alpha"] },
          ],
        },
      },
    });

    await expect(planner.getDaemonDag("refresh")).resolves.toEqual({
      intent: "refresh",
      complexity: "moderate",
      nodes: [{ cortex: "alpha", params: {}, dependsOn: [] }],
    });
  });
});

describe("ThalamusPlanner.finalizePlan", () => {
  it("rejects caller-supplied DAG nodes that reference unknown cortices", async () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]));

    await expect(
      planner.finalizePlan({
        intent: "caller supplied",
        complexity: "moderate",
        nodes: [
          { cortex: "alpha", params: {}, dependsOn: [] },
          { cortex: "ghost", params: {}, dependsOn: [] },
        ],
      }),
    ).rejects.toMatchObject({
      name: "DagValidationError",
      code: "unknown_cortex",
      details: { cortex: "ghost" },
    });
  });
});

describe("ThalamusPlanner.buildManualDag", () => {
  it("builds a flat manual DAG from known cortex names and deduplicates repeats", () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha", "beta"]));

    expect(
      planner.buildManualDag("Manual run", ["alpha", "beta", "alpha", " "]),
    ).toEqual({
      intent: "Manual run",
      complexity: "moderate",
      nodes: [
        { cortex: "alpha", params: {}, dependsOn: [] },
        { cortex: "beta", params: {}, dependsOn: [] },
      ],
    });
  });

  it("rejects unknown manual cortex names", () => {
    const planner = new ThalamusPlanner(mkRegistry(["alpha"]));

    expect(() =>
      planner.buildManualDag("Manual run", ["alpha", "ghost"]),
    ).toThrow("Unknown manual cortex name(s): ghost");
  });
});
