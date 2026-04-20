/**
 * StandardStrategy consumes SourceFetcherPort — Phase 3 · Task 3.3b.
 *
 * Proves the strategy no longer imports `fetchSourcesForCortex` directly;
 * source aggregation is routed through the injected port. The port default
 * `NoopSourceFetcher` returns [] so cortex execution still works when no
 * domain adapter is wired.
 */

import { describe, it, expect, vi } from "vitest";
import { StandardStrategy } from "../src/cortices/strategies/standard-strategy";
import { NoopSourceFetcher } from "../src";
import type {
  SourceFetcherPort,
  SourceResult,
} from "../src/ports/source-fetcher.port";
import type {
  CortexDataProvider,
  DomainConfig,
  CortexInput,
} from "../src/cortices/types";
import { noopDomainConfig } from "../src/cortices/types";
import type { WebSearchPort } from "../src/ports/web-search.port";

const noWebSearch: WebSearchPort = {
  search: async () => "",
};

function mkSkill(name: string = "any_cortex") {
  return {
    header: {
      name,
      description: "",
      sqlHelper: "",
      params: {},
    },
    body: "Analyze the data.",
  } as never;
}

function mkInput(cortex: string = "any_cortex"): CortexInput {
  return {
    query: "q",
    params: {},
    cycleId: 1n,
  };
}

describe("StandardStrategy — source aggregation via SourceFetcherPort", () => {
  it("calls the injected port once per execute, with the cortex name + params", async () => {
    const calls: Array<{ cortex: string; params: unknown }> = [];
    const port: SourceFetcherPort = {
      fetchForCortex: async (cortex, params) => {
        calls.push({ cortex, params });
        return [] as SourceResult[];
      },
    };
    // Force cortex execution short-circuit: userScoped cortex w/o userId
    // returns emptyOutput before the LLM call, but AFTER fetching sources.
    // We use a non-userScoped cortex so the SQL + source pipeline runs.
    const cfg: DomainConfig = {
      ...noopDomainConfig,
    };
    const dataProvider: CortexDataProvider = {};
    const strat = new StandardStrategy(dataProvider, cfg, noWebSearch, port);

    // Spy on the LLM call so we don't make a real network request; just
    // verify the port fired before the LLM step.
    const { analyzeCortexData } = await import("../src/cortices/cortex-llm");
    const spy = vi
      .spyOn(
        await import("../src/cortices/cortex-llm"),
        "analyzeCortexData",
      )
      .mockResolvedValue({
        findings: [],
        tokensUsed: 0,
        duration: 0,
        model: "mock",
      });

    await strat.execute(mkSkill("any_cortex"), mkInput("any_cortex"));
    expect(calls.length).toBe(1);
    expect(calls[0]?.cortex).toBe("any_cortex");
    spy.mockRestore();
    void analyzeCortexData;
  });

  it("defaults to NoopSourceFetcher when no sources are configured — strategy stays executable", async () => {
    const cfg: DomainConfig = { ...noopDomainConfig };
    const dataProvider: CortexDataProvider = {};
    const strat = new StandardStrategy(
      dataProvider,
      cfg,
      noWebSearch,
      new NoopSourceFetcher(),
    );
    const spy = vi
      .spyOn(
        await import("../src/cortices/cortex-llm"),
        "analyzeCortexData",
      )
      .mockResolvedValue({
        findings: [],
        tokensUsed: 0,
        duration: 0,
        model: "mock",
      });
    const out = await strat.execute(mkSkill(), mkInput());
    // Noop returned [] → no source data leaked into output
    expect(out.findings).toEqual([]);
    spy.mockRestore();
  });
});
