import React, { useState, useCallback } from "react";
import { Box, Text } from "ink";
import { randomUUID } from "node:crypto";
import { Prompt } from "./components/Prompt";
import { StatusFooter } from "./components/StatusFooter";
import { ScrollView } from "./components/ScrollView";
import { SatelliteLoader } from "./components/SatelliteLoader";
import { ConversationBuffer } from "./memory/buffer";
import { CostMeter } from "./util/costMeter";
import { parseExplicitCommand } from "./router/parser";
import { dispatch, type DispatchResult, type Adapters } from "./router/dispatch";
import type { RouterPlan } from "./router/schema";
import type { Estimate } from "./util/etaStore";
import { BriefingRenderer } from "./renderers/briefing";
import { TelemetryRenderer } from "./renderers/telemetry";
import { LogTailRenderer } from "./renderers/logTail";
import { GraphTreeRenderer } from "./renderers/graphTree";
import { WhyTreeRenderer } from "./renderers/whyTree";
import { ClarifyRenderer } from "./renderers/clarify";

export interface AppProps {
  adapters: Adapters;
  interpret: (input: string, turns: readonly unknown[]) => Promise<{ plan: RouterPlan; costUsd: number }>;
  etaEstimate: (kind: string, subject: string) => Estimate;
  etaRecord: (kind: string, subject: string, ms: number) => void;
}

export function App(p: AppProps): React.JSX.Element {
  const [sessionId] = useState(() => randomUUID());
  const [buffer] = useState(() => new ConversationBuffer({ maxTokens: 200_000 }));
  const [cost] = useState(() => new CostMeter());
  const [busy, setBusy] = useState<null | { kind: string; subject: string; start: number }>(null);
  const [results, setResults] = useState<DispatchResult[]>([]);
  const [lastAction, setLastAction] = useState<{ name: string; ms: number } | undefined>();

  const onSubmit = useCallback(async (input: string) => {
    const text = input.trim();
    if (!text) return;
    buffer.append({ role: "user", content: text });
    cost.beginTurn();
    try {
      const explicit = parseExplicitCommand(text);
      const plan = explicit ?? (await p.interpret(text, buffer.turns())).plan;
      const cycleId = randomUUID();
      for (const step of plan.steps) {
        const started = Date.now();
        setBusy({ kind: "cortex", subject: step.action, start: started });
        const r = await dispatch(step, { adapters: p.adapters, cycleId });
        const ms = Date.now() - started;
        p.etaRecord("cortex", step.action, ms);
        if (r.kind === "briefing") cost.add(r.costUsd);
        setResults((arr) => [...arr, r]);
        setLastAction({ name: step.action, ms });
      }
    } finally {
      setBusy(null);
      cost.endTurn();
    }
  }, [buffer, cost, p]);

  return (
    <Box flexDirection="column">
      <ScrollView>
        {results.map((r, i) => {
          switch (r.kind) {
            case "briefing":
              return (
                <BriefingRenderer key={i}
                  executiveSummary={`Research cycle produced ${r.findings.length} finding(s). Cost $${r.costUsd.toFixed(3)}.`}
                  findings={r.findings as never}
                  recommendedActions={[]}
                  followUpPrompts={[]}
                />
              );
            case "telemetry":
              return <TelemetryRenderer key={i} satId={r.satId} distribution={r.distribution} />;
            case "logs":
              return <LogTailRenderer key={i} events={r.events as never} />;
            case "graph":
              return <GraphTreeRenderer key={i} tree={r.tree} />;
            case "resolution":
              return (
                <Box key={i} marginY={1}>
                  <Text color={r.ok ? "green" : "red"}>
                    {r.ok ? "✓" : "✗"} accepted {r.suggestionId}
                  </Text>
                </Box>
              );
            case "why":
              return <WhyTreeRenderer key={i} tree={r.tree} />;
            case "clarify":
              return <ClarifyRenderer key={i} question={r.question} options={r.options} />;
          }
        })}
      </ScrollView>
      {busy && (
        <SatelliteLoader
          kind={busy.kind}
          subject={busy.subject}
          etaEstimate={p.etaEstimate(busy.kind, busy.subject)}
          elapsedMs={Date.now() - busy.start}
          costUsd={cost.currentTurn()}
        />
      )}
      <Prompt onSubmit={onSubmit} busy={!!busy} />
      <StatusFooter
        sessionId={sessionId}
        tokens={buffer.totalTokens()}
        maxTokens={200_000}
        costUsd={cost.session()}
        lastAction={lastAction?.name}
        lastMs={lastAction?.ms}
      />
    </Box>
  );
}
