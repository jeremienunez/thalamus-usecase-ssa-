import React from "react";
import { render } from "ink";
import { homedir } from "node:os";
import { join } from "node:path";
import pino from "pino";

import { App } from "./app";
import { EtaStore } from "./util/etaStore";
import { PinoRingBuffer } from "./util/pinoRingBuffer";
import { LogsAdapter } from "./adapters/logs";
import { interpret } from "./router/interpreter";
import type { Adapters } from "./router/dispatch";

export interface BootDeps {
  adapters: Adapters;
  nano: {
    call: (args: {
      system: string;
      user: string;
      temperature: number;
      responseFormat: "json";
    }) => Promise<{ content: string; costUsd: number }>;
  };
}

export async function main(deps?: Partial<BootDeps>): Promise<void> {
  const eta = new EtaStore(join(homedir(), ".cache/ssa-cli/eta.json"));
  process.on("exit", () => eta.flush());

  const ring = new PinoRingBuffer(1_000);
  const write = (s: string): void => {
    try {
      ring.push(JSON.parse(s));
    } catch {
      /* non-json ignored */
    }
  };
  const logger = pino({ level: "info" }, { write });

  const adapters: Adapters =
    deps?.adapters ?? (await buildRealAdapters({ logger, ring }));
  const nano = deps?.nano ?? makeStubNano();

  render(
    React.createElement(App, {
      adapters,
      interpret: (input, turns) =>
        interpret(
          {
            input,
            recentTurns: turns as never,
            availableEntityIds: [],
          },
          nano,
        ),
      etaEstimate: (k, s) => eta.estimate(k, s),
      etaRecord: (k, s, ms) => eta.record(k, s, ms),
    }),
  );
}

async function buildRealAdapters(ctx: {
  logger: pino.Logger;
  ring: PinoRingBuffer;
}): Promise<Adapters> {
  // TODO: wire real thalamus + sweep services. For now, stub with clear errors.
  // Exploration notes:
  //   - thalamus exports ThalamusService / ExplorerOrchestrator / ResearchGraphService
  //     but each requires DB + Redis + LLM transport wiring (see demo/cycle.ts).
  //   - sweep exports startTelemetrySwarm and SweepResolutionService, also
  //     DB/Redis-bound. A proper bootstrap belongs in a follow-up task.
  //   - Stubs below throw clear errors so CLI runs in "stub mode" for the demo;
  //     the e2e test injects mocked adapters via BootDeps.adapters.
  void ctx;
  const notWired = (name: string): never => {
    throw new Error(`adapter not wired: ${name}`);
  };
  return {
    thalamus: { runCycle: async () => notWired("thalamus.runCycle") },
    telemetry: { start: async () => notWired("telemetry.start") },
    logs: new LogsAdapter(ctx.ring),
    graph: { neighbourhood: async () => notWired("graph.neighbourhood") },
    resolution: { accept: async () => notWired("resolution.accept") },
    why: { build: async () => notWired("why.build") },
  };
}

function makeStubNano(): BootDeps["nano"] {
  return {
    call: async () => {
      throw new Error("nano caller not wired — CLI in stub mode");
    },
  };
}
