import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/explorer/nano-caller", () => ({
  callNanoWithMode: vi.fn(),
}));

import {
  NanoSwarm,
  setEntityExtractor,
  setNanoSwarmConfigProvider,
  setNanoSwarmProfile,
} from "../src";
import { DEFAULT_NANO_SWARM_PROFILE, type NanoSwarmProfile } from "../src/prompts";
import { callNanoWithMode } from "../src/explorer/nano-caller";
import {
  DEFAULT_NANO_SWARM_CONFIG,
  StaticConfigProvider,
} from "@interview/shared/config";

const profile: NanoSwarmProfile = {
  lenses: [
    { id: "news", lens: "recent news and published articles" },
    { id: "data", lens: "quantitative data and benchmarks" },
    { id: "market", lens: "market intelligence and pricing" },
  ],
  pickLenses() {
    return [this.lenses[0]!, this.lenses[1]!];
  },
  buildCallInstructions(lens) {
    return `instructions:${lens}`;
  },
  buildCallInput(microQuery) {
    return `input:${microQuery}`;
  },
};

beforeEach(() => {
  vi.clearAllMocks();
  setNanoSwarmProfile(profile);
  setNanoSwarmConfigProvider(
    new StaticConfigProvider({
      ...DEFAULT_NANO_SWARM_CONFIG,
      maxMicroQueries: 3,
      waveSize: 10,
      waveDelayMs: 0,
    }),
  );
  setEntityExtractor((text) => ({
    entities: { preview: text.slice(0, 80) },
    dataPoints: [],
  }));
});

afterEach(() => {
  setNanoSwarmProfile(DEFAULT_NANO_SWARM_PROFILE);
  setNanoSwarmConfigProvider(
    new StaticConfigProvider(DEFAULT_NANO_SWARM_CONFIG),
  );
  setEntityExtractor(() => ({ entities: {}, dataPoints: [] }));
});

describe("NanoSwarm.crawl", () => {
  it("bounds decomposition by priority and maxMicroQueries", async () => {
    let index = 0;
    vi.mocked(callNanoWithMode).mockImplementation(async () => {
      index += 1;
      return {
        ok: true,
        text: `Source ${index} reports Starlink-1234 at 550 km for 12 days.`,
        urls: [`https://example.com/${index}`],
        latencyMs: 5,
      };
    });

    const swarm = new NanoSwarm();
    const result = await swarm.crawl([
      {
        query: "high priority query",
        type: "web",
        signal: "finding",
        priority: 9,
        maxDepth: 1,
      },
      {
        query: "lower priority query",
        type: "web",
        signal: "finding",
        priority: 4,
        maxDepth: 1,
      },
    ]);

    const inputs = vi
      .mocked(callNanoWithMode)
      .mock.calls.map((call) => String(call[0].input));
    expect(inputs).toHaveLength(3);
    expect(inputs[0]).toContain("high priority query");
    expect(inputs[1]).toContain("high priority query");
    expect(inputs[2]).toContain("lower priority query");
    expect(result.stats).toMatchObject({
      totalCalls: 3,
      successCalls: 3,
      failedCalls: 0,
    });
  });

  it("normalizes duplicate URLs and strips markdown before extraction", async () => {
    setNanoSwarmConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_NANO_SWARM_CONFIG,
        maxMicroQueries: 2,
        waveSize: 10,
        waveDelayMs: 0,
      }),
    );
    const extracted: string[] = [];
    setEntityExtractor((text) => {
      extracted.push(text);
      return { entities: { cleaned: true }, dataPoints: [] };
    });
    vi.mocked(callNanoWithMode)
      .mockResolvedValueOnce({
        ok: true,
        text: "## Report\n**Starlink-1234** reached 550 km after maneuver.",
        urls: ["https://Example.com/path/?utm_source=test"],
        latencyMs: 5,
      })
      .mockResolvedValueOnce({
        ok: true,
        text: "## Report\n**Starlink-1234** reached 550 km after maneuver.",
        urls: ["https://example.com/path"],
        latencyMs: 6,
      });

    const swarm = new NanoSwarm();
    const result = await swarm.crawl([
      {
        query: "duplicate urls",
        type: "web",
        signal: "finding",
        priority: 9,
        maxDepth: 1,
      },
    ]);

    expect(result.articles).toHaveLength(1);
    expect(result.urlsCrawled).toBe(1);
    expect(extracted[0]).not.toContain("**");
    expect(extracted[0]).toContain("Starlink-1234");
  });

  it("emits synthetic nano articles when text exists without URLs and reports stats honestly", async () => {
    setNanoSwarmConfigProvider(
      new StaticConfigProvider({
        ...DEFAULT_NANO_SWARM_CONFIG,
        maxMicroQueries: 2,
        waveSize: 10,
        waveDelayMs: 0,
      }),
    );
    vi.mocked(callNanoWithMode)
      .mockResolvedValueOnce({
        ok: true,
        text: "Starlink-1234 summary ".repeat(20),
        urls: [],
        latencyMs: 7,
      })
      .mockResolvedValueOnce({
        ok: false,
        text: "",
        urls: [],
        latencyMs: 4,
        error: "timeout",
      });

    const swarm = new NanoSwarm();
    const result = await swarm.crawl([
      {
        query: "no url result",
        type: "web",
        signal: "finding",
        priority: 9,
        maxDepth: 1,
      },
    ]);

    expect(result.articles).toHaveLength(1);
    expect(result.articles[0]?.url).toBe("nano://news");
    expect(result.stats).toMatchObject({
      totalCalls: 2,
      successCalls: 1,
      failedCalls: 1,
      totalUrls: 0,
    });
  });
});
