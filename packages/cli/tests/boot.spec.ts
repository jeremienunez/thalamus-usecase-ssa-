import type IORedis from "ioredis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const consoleApiEnvKey = ["CONSOLE", "API", "URL"].join("_");
const redisEnvKey = ["REDIS", "URL"].join("_");
const defaultApiBaseUrl = ["http://", "localhost", ":4000"].join("");

function makeRedisDouble(): IORedis {
  return {
    quit: vi.fn().mockResolvedValue(undefined),
  } as IORedis;
}

const state = vi.hoisted(() => ({
  appProps: [] as unknown[],
  pinoCalls: [] as unknown[],
  httpCtorArgs: [] as Array<{ baseUrl: string; auth?: string }>,
  redisCtorArgs: [] as unknown[],
  redisQuits: [] as ReturnType<typeof vi.fn>[],
  logsAdapterRings: [] as unknown[],
  etaInstances: [] as Array<{
    path: string;
    flush: ReturnType<typeof vi.fn>;
    estimate: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;
  }>,
  ringInstances: [] as Array<{
    cap: number;
    push: ReturnType<typeof vi.fn>;
  }>,
  logger: {
    warn: vi.fn(),
  },
  render: vi.fn(),
  waitUntilExit: vi.fn(),
  buildSweepContainer: vi.fn(),
  sweepRepoReview: vi.fn(),
  resolutionResolve: vi.fn(),
  callNanoWithMode: vi.fn(),
  interpret: vi.fn(),
  httpRunCycle: vi.fn(),
  httpGetGraph: vi.fn(),
  httpGetWhy: vi.fn(),
}));

vi.mock("ink", () => ({
  render: (element: { type?: unknown; props?: unknown }) => state.render(element),
}));

vi.mock("../src/app", () => ({
  App: (props: unknown) => {
    state.appProps.push(props);
    return null;
  },
}));

vi.mock("pino", () => ({
  default: (...args: unknown[]) => {
    state.pinoCalls.push(args);
    return state.logger;
  },
}));

vi.mock("ioredis", () => ({
  default: class MockRedis {
    quit: ReturnType<typeof vi.fn>;

    constructor(...args: unknown[]) {
      state.redisCtorArgs.push(args);
      this.quit = vi.fn().mockResolvedValue(undefined);
      state.redisQuits.push(this.quit);
    }
  },
}));

vi.mock("../src/adapters", () => ({
  LogsAdapter: class MockLogsAdapter {
    tail = vi.fn(() => []);

    constructor(ring: unknown) {
      state.logsAdapterRings.push(ring);
    }
  },
}));

vi.mock("../src/adapters/thalamus.http", () => ({
  ThalamusHttpClient: class MockThalamusHttpClient {
    constructor(baseUrl: string, auth?: string) {
      state.httpCtorArgs.push({ baseUrl, auth });
    }

    runCycle(args: unknown) {
      return state.httpRunCycle(args);
    }

    getGraphNeighbourhood(args: unknown) {
      return state.httpGetGraph(args);
    }

    getWhyTree(args: unknown) {
      return state.httpGetWhy(args);
    }
  },
}));

vi.mock("../src/util/etaStore", () => ({
  EtaStore: class MockEtaStore {
    path: string;
    flush: ReturnType<typeof vi.fn>;
    estimate: ReturnType<typeof vi.fn>;
    record: ReturnType<typeof vi.fn>;

    constructor(path: string) {
      this.path = path;
      this.flush = vi.fn();
      this.estimate = vi.fn(() => ({ status: "estimating" as const }));
      this.record = vi.fn();
      state.etaInstances.push(this);
    }
  },
}));

vi.mock("../src/util/pinoRingBuffer", () => ({
  PinoRingBuffer: class MockPinoRingBuffer {
    cap: number;
    push: ReturnType<typeof vi.fn>;

    constructor(cap: number) {
      this.cap = cap;
      this.push = vi.fn();
      state.ringInstances.push(this);
    }
  },
}));

vi.mock("../src/router/interpreter", () => ({
  interpret: (...args: unknown[]) => state.interpret(...args),
}));

vi.mock("@interview/thalamus", () => ({
  callNanoWithMode: (...args: unknown[]) => state.callNanoWithMode(...args),
}));

vi.mock("@interview/sweep", () => ({
  buildSweepContainer: (...args: unknown[]) => state.buildSweepContainer(...args),
}));

vi.mock("node:os", async () => {
  const actual = await vi.importActual<typeof import("node:os")>("node:os");
  return {
    ...actual,
    homedir: () => "/home/test",
  };
});

async function loadBoot() {
  vi.resetModules();
  return import("../src/boot");
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
}

describe("boot", () => {
  beforeEach(() => {
    state.appProps = [];
    state.pinoCalls = [];
    state.httpCtorArgs = [];
    state.redisCtorArgs = [];
    state.redisQuits = [];
    state.logsAdapterRings = [];
    state.etaInstances = [];
    state.ringInstances = [];
    state.logger.warn.mockReset();
    state.render.mockReset();
    state.render.mockImplementation((element: { type?: unknown; props?: unknown }) => {
      if (typeof element.type === "function") {
        element.type(element.props);
      }
      return {
        waitUntilExit: state.waitUntilExit,
      };
    });
    state.waitUntilExit.mockReset();
    state.waitUntilExit.mockResolvedValue(undefined);
    state.buildSweepContainer.mockReset();
    state.sweepRepoReview.mockReset();
    state.resolutionResolve.mockReset();
    state.buildSweepContainer.mockReturnValue({
      sweepRepo: { review: state.sweepRepoReview },
      resolutionService: { resolve: state.resolutionResolve },
    });
    state.callNanoWithMode.mockReset();
    state.interpret.mockReset();
    state.httpRunCycle.mockReset();
    state.httpGetGraph.mockReset();
    state.httpGetWhy.mockReset();
    delete process.env[consoleApiEnvKey];
    delete process.env[redisEnvKey];
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("closes owned redis quietly when quit succeeds", async () => {
    const { closeOwnedRedis } = await loadBoot();
    const redis = {
      quit: vi.fn().mockResolvedValue(undefined),
    };
    const logger = {
      warn: vi.fn(),
    };

    await closeOwnedRedis(redis, logger);

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("logs redis shutdown failures instead of swallowing them silently", async () => {
    const { closeOwnedRedis } = await loadBoot();
    const closeError = new Error("redis close failed");
    const redis = {
      quit: vi.fn().mockRejectedValue(closeError),
    };
    const logger = {
      warn: vi.fn(),
    };

    await closeOwnedRedis(redis, logger);

    expect(redis.quit).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      { err: closeError },
      "cli shutdown: failed to close redis",
    );
  });

  it("makeFixtureAwareNano forwards to callNanoWithMode and returns the text payload", async () => {
    const { makeFixtureAwareNano } = await loadBoot();
    state.callNanoWithMode.mockResolvedValue({
      ok: true,
      text: "{\"steps\":[],\"confidence\":1}",
    });

    const nano = makeFixtureAwareNano();
    const out = await nano.call({
      system: "system prompt",
      user: "user prompt",
      temperature: 0,
      responseFormat: "json",
    });

    expect(state.callNanoWithMode).toHaveBeenCalledWith({
      instructions: "system prompt",
      input: "user prompt",
      enableWebSearch: false,
    });
    expect(out).toEqual({
      content: "{\"steps\":[],\"confidence\":1}",
      costUsd: 0,
    });
  });

  it("makeFixtureAwareNano falls back to an empty router plan on soft or hard failures", async () => {
    const { makeFixtureAwareNano } = await loadBoot();
    const nano = makeFixtureAwareNano();

    state.callNanoWithMode.mockResolvedValueOnce({ ok: false });
    await expect(
      nano.call({
        system: "system prompt",
        user: "user prompt",
        temperature: 0,
        responseFormat: "json",
      }),
    ).resolves.toEqual({
      content: "{\"steps\":[],\"confidence\":0}",
      costUsd: 0,
    });

    state.callNanoWithMode.mockRejectedValueOnce(new Error("network down"));
    await expect(
      nano.call({
        system: "system prompt",
        user: "user prompt",
        temperature: 0,
        responseFormat: "json",
      }),
    ).resolves.toEqual({
      content: "{\"steps\":[],\"confidence\":0}",
      costUsd: 0,
    });
  });

  it("makeStubNano hard-fails when no transport is wired", async () => {
    const { makeStubNano } = await loadBoot();

    await expect(
      makeStubNano().call({
        system: "system prompt",
        user: "user prompt",
        temperature: 0,
        responseFormat: "json",
      }),
    ).rejects.toThrow(/stub mode/);
  });

  it("buildRealAdapters wires HTTP clients, sweep resolution, stubbed telemetry, and candidate fetches", async () => {
    const { PinoRingBuffer } = await import("../src/util/pinoRingBuffer");
    const pino = (await import("pino")).default;
    const { buildRealAdapters } = await loadBoot();

    state.httpRunCycle.mockResolvedValue({ findings: [{ id: "F-1" }], costUsd: 0.2 });
    state.httpGetGraph.mockResolvedValue({ root: "entity:1", levels: [] });
    state.httpGetWhy.mockResolvedValue({ id: "F-1", children: [] });
    state.sweepRepoReview.mockResolvedValue(undefined);
    state.resolutionResolve.mockResolvedValue({
      status: "partial",
      affectedRows: 3,
      errors: ["warn"],
    });
    process.env[consoleApiEnvKey] = "http://env.api";
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ candidateNoradId: 100 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const adapters = await buildRealAdapters({
      logger: pino(),
      ring: new PinoRingBuffer(10),
      redis: makeRedisDouble(),
      apiBaseUrl: "http://ctx.api",
      cliAuth: "secret-token",
    });

    expect(state.httpCtorArgs).toContainEqual({
      baseUrl: "http://ctx.api",
      auth: "secret-token",
    });
    expect(state.logsAdapterRings).toHaveLength(1);

    const [sweepArgs] = state.buildSweepContainer.mock.calls[0] ?? [];
    await expect(sweepArgs.ports.audit.runAudit()).rejects.toThrow(/audit is disabled/);
    await expect(sweepArgs.ports.promotion.promote()).rejects.toThrow(/promotion is disabled/);
    expect(sweepArgs.ports.resolutionHandlers.get("missing")).toBeUndefined();
    expect(sweepArgs.ports.resolutionHandlers.list()).toEqual([]);

    await expect(
      adapters.thalamus.runCycle({ query: "screen debris", cycleId: "cycle-9" }),
    ).resolves.toEqual({
      findings: [{ id: "F-1" }],
      costUsd: 0.2,
    });
    expect(state.httpRunCycle).toHaveBeenCalledWith({
      query: "screen debris",
      traceId: "cycle-9",
    });

    await expect(adapters.telemetry.start({ satId: "25544" })).rejects.toThrow(
      /disabled until Plan 3/,
    );
    await expect(adapters.graph.neighbourhood("entity:1")).resolves.toEqual({
      root: "entity:1",
      levels: [],
    });
    expect(state.httpGetGraph).toHaveBeenCalledWith({ entity: "entity:1" });

    await expect(adapters.why.build("F-1")).resolves.toEqual({
      id: "F-1",
      children: [],
    });
    expect(state.httpGetWhy).toHaveBeenCalledWith({ findingId: "F-1" });

    await expect(adapters.resolution.accept("S-1")).resolves.toEqual({
      ok: true,
      delta: {
        status: "partial",
        affectedRows: 3,
        errors: ["warn"],
      },
    });
    expect(state.sweepRepoReview).toHaveBeenCalledWith("S-1", true, "cli:local");
    expect(state.resolutionResolve).toHaveBeenCalledWith("S-1");

    await expect(
      adapters.pcEstimator.estimate("conj-1"),
    ).resolves.toMatchObject({
      conjunctionId: "conj-1",
      fishCount: 0,
      severity: "info",
      methodology: "swarm-pc-estimator",
    });

    await expect(
      adapters.candidates.propose({
        targetNoradId: 25544,
        objectClass: "debris",
        limit: 7,
      }),
    ).resolves.toEqual([{ candidateNoradId: 100 }]);
    expect(fetchStub).toHaveBeenCalledTimes(1);
    const [url] = fetchStub.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      "http://env.api/api/conjunctions/knn-candidates?targetNoradId=25544&knnK=300&limit=7&marginKm=20&excludeSameFamily=true&objectClass=debris",
    );
  });

  it("buildRealAdapters falls back to localhost, returns ok=false for failed resolutions, and surfaces candidate fetch errors", async () => {
    const { PinoRingBuffer } = await import("../src/util/pinoRingBuffer");
    const pino = (await import("pino")).default;
    const { buildRealAdapters } = await loadBoot();

    state.resolutionResolve.mockResolvedValue({
      status: "failed",
      affectedRows: 0,
      errors: ["boom"],
    });
    const fetchStub = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "knn unavailable" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchStub);

    const adapters = await buildRealAdapters({
      logger: pino(),
      ring: new PinoRingBuffer(5),
      redis: makeRedisDouble(),
    });

    expect(state.httpCtorArgs).toContainEqual({
      baseUrl: defaultApiBaseUrl,
      auth: undefined,
    });

    await expect(adapters.resolution.accept("S-2")).resolves.toEqual({
      ok: false,
      delta: {
        status: "failed",
        affectedRows: 0,
        errors: ["boom"],
      },
    });

    await expect(
      adapters.candidates.propose({ targetNoradId: 25544 }),
    ).rejects.toThrow(/knn-candidates 503/);
    const [url] = fetchStub.mock.calls[0] ?? [];
    expect(String(url)).toBe(
      `${defaultApiBaseUrl}/api/conjunctions/knn-candidates?targetNoradId=25544&knnK=300&limit=25&marginKm=20&excludeSameFamily=true`,
    );
  });

  it("main reuses injected adapters, wires the eta store, and delegates interpret through the provided nano", async () => {
    const processOn = vi.spyOn(process, "on").mockReturnValue(process);
    const { main } = await loadBoot();
    const adapters = {
      thalamus: { runCycle: vi.fn() },
      telemetry: { start: vi.fn() },
      logs: { tail: vi.fn(() => []) },
      graph: { neighbourhood: vi.fn() },
      resolution: { accept: vi.fn() },
      why: { build: vi.fn() },
      pcEstimator: { estimate: vi.fn() },
      candidates: { propose: vi.fn() },
    };
    const nano = {
      call: vi.fn().mockResolvedValue({
        content: "{\"steps\":[],\"confidence\":0.9}",
        costUsd: 0.01,
      }),
    };
    state.interpret.mockResolvedValue({
      plan: { steps: [], confidence: 0.9 },
      costUsd: 0.01,
    });

    await main({
      adapters,
      nano,
    });

    expect(state.redisCtorArgs).toHaveLength(0);
    expect(state.appProps).toHaveLength(1);
    expect(state.etaInstances).toHaveLength(1);
    expect(state.etaInstances[0]?.path).toBe("/home/test/.cache/ssa-cli/eta.json");

    const [[eventName, exitHandler]] = processOn.mock.calls;
    expect(eventName).toBe("exit");
    expect(typeof exitHandler).toBe("function");
    if (typeof exitHandler === "function") {
      exitHandler();
    }
    expect(state.etaInstances[0]?.flush).toHaveBeenCalledTimes(1);

    const [appProps] = state.appProps;
    expect(appProps).toMatchObject({ adapters });
    await expect(
      appProps.interpret("search debris", [{ role: "user", content: "hi" }]),
    ).resolves.toEqual({
      plan: { steps: [], confidence: 0.9 },
      costUsd: 0.01,
    });
    expect(state.interpret).toHaveBeenCalledWith(
      {
        input: "search debris",
        recentTurns: [{ role: "user", content: "hi" }],
        availableEntityIds: [],
      },
      nano,
    );

    expect(appProps.etaEstimate("cortex", "query")).toEqual({
      status: "estimating",
    });
    appProps.etaRecord("cortex", "query", 123);
    expect(state.etaInstances[0]?.record).toHaveBeenCalledWith(
      "cortex",
      "query",
      123,
    );
  });

  it("main creates and closes an owned redis client when no wiring is injected", async () => {
    const processOn = vi.spyOn(process, "on").mockReturnValue(process);
    const { main } = await loadBoot();
    process.env[redisEnvKey] = "redis://cache.internal:6380";

    await main();
    await flushMicrotasks();

    expect(processOn).toHaveBeenCalledWith("exit", expect.any(Function));
    expect(state.redisCtorArgs).toContainEqual([
      "redis://cache.internal:6380",
      { maxRetriesPerRequest: null },
    ]);
    expect(state.redisQuits).toHaveLength(1);
    expect(state.redisQuits[0]).toHaveBeenCalledTimes(1);

    const [, destination] = state.pinoCalls[0] ?? [];
    destination.write("{\"msg\":\"hello\",\"level\":30}");
    destination.write("not-json");
    expect(state.ringInstances[0]?.push).toHaveBeenCalledWith({
      msg: "hello",
      level: 30,
    });
  });

  it("main falls back to the default redis url when the env override is unset", async () => {
    vi.spyOn(process, "on").mockReturnValue(process);
    const { main } = await loadBoot();

    await main();
    await flushMicrotasks();

    expect(state.redisCtorArgs).toContainEqual([
      "redis://localhost:6380",
      { maxRetriesPerRequest: null },
    ]);
  });

  it("main uses injected wiring without creating or closing a second redis client", async () => {
    const processOn = vi.spyOn(process, "on").mockReturnValue(process);
    const { main } = await loadBoot();

    const redis = makeRedisDouble();
    state.redisCtorArgs = [];
    state.redisQuits = [];

    await main({
      wiring: { redis },
    });
    await flushMicrotasks();

    expect(processOn).toHaveBeenCalledWith("exit", expect.any(Function));
    expect(state.redisCtorArgs).toHaveLength(0);
    expect(state.redisQuits).toHaveLength(0);
    expect(state.appProps).toHaveLength(1);
  });
});
