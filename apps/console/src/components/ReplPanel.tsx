import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { clsx } from "clsx";
import { CheckCircle2, ChevronDown, X, Terminal } from "lucide-react";
import {
  postTurn,
  isSlashCommand,
  type DispatchResult,
  type BriefingFinding,
  type TelemetryEntry,
  type LogEvent,
  type GraphNode,
  type WhyNode,
  type TurnResponse,
} from "../lib/repl";
import { postChatStream } from "../lib/repl-stream";
import { AnimatedStepBadge } from "./AnimatedStepBadge";
import { CycleLoader, type CycleStep } from "./CycleLoader";
import type { ReplStreamEvent } from "@interview/shared";

// ---------- Context ----------
export type TurnPhase =
  | "classifying"
  | "chatting"
  | "cycle-running"
  | "done"
  | "error";

type FindingData = Extract<ReplStreamEvent, { event: "finding" }>["data"];

export type Turn = {
  id: string;
  input: string;
  phase: TurnPhase;
  startedAt: number;
  // slash-command path
  response?: TurnResponse;
  error?: string;
  // chat/streaming path
  cycleId?: string;
  currentStep?: CycleStep;
  steps: CycleStep[];
  findings: FindingData[];
  chatText: string;
  summaryText: string;
  provider?: string;
  tookMs?: number;
};

type ReplCtx = {
  open: boolean;
  setOpen: (v: boolean) => void;
  turns: Turn[];
  busy: boolean;
  sendTurn: (input: string) => void;
};

const Ctx = createContext<ReplCtx | null>(null);

export function useRepl(): ReplCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useRepl must be used inside <ReplProvider>");
  return v;
}

export function ReplProvider({ children }: { children: ReactNode }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessionIdRef = useRef<string>(`sess-${Math.random().toString(36).slice(2, 9)}`);

  const sendTurn = useCallback((input: string) => {
    const trimmed = input.trim();
    if (!trimmed) return;
    const id = `t-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const startedAt = Date.now();
    const base: Turn = {
      id,
      input: trimmed,
      phase: "classifying",
      startedAt,
      steps: [],
      findings: [],
      chatText: "",
      summaryText: "",
    };
    setTurns((t) => [...t, base]);
    setOpen(true);
    setBusy(true);

    const patch = (fn: (t: Turn) => Turn): void => {
      setTurns((ts) => ts.map((x) => (x.id === id ? fn(x) : x)));
    };

    if (isSlashCommand(trimmed)) {
      postTurn(trimmed, sessionIdRef.current)
        .then((response) => {
          patch((t) => ({
            ...t,
            phase: "done",
            response,
            tookMs: response.tookMs,
          }));
        })
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          patch((t) => ({ ...t, phase: "error", error: msg }));
        })
        .finally(() => setBusy(false));
      return;
    }

    postChatStream(trimmed, (evt) => {
      switch (evt.event) {
        case "classified":
          patch((t) => ({
            ...t,
            phase: evt.data.action === "chat" ? "chatting" : "cycle-running",
          }));
          break;
        case "cycle.start":
          patch((t) => ({ ...t, cycleId: evt.data.cycleId }));
          break;
        case "step": {
          const cs: CycleStep = {
            name: evt.data.step,
            phase: evt.data.phase,
            terminal: evt.data.terminal,
            elapsedMs: evt.data.elapsedMs,
          };
          patch((t) => {
            // "start" marks a new in-flight step; "done"/"error" pushes into trail.
            if (cs.phase === "start") return { ...t, currentStep: cs };
            const cleared =
              t.currentStep?.name === cs.name ? undefined : t.currentStep;
            return { ...t, currentStep: cleared, steps: [...t.steps, cs] };
          });
          break;
        }
        case "finding":
          patch((t) => ({ ...t, findings: [...t.findings, evt.data] }));
          break;
        case "chat.complete":
          patch((t) => ({
            ...t,
            chatText: evt.data.text,
            provider: evt.data.provider,
          }));
          break;
        case "summary.complete":
          patch((t) => ({
            ...t,
            summaryText: evt.data.text,
            provider: evt.data.provider,
          }));
          break;
        case "done":
          patch((t) => ({
            ...t,
            phase: "done",
            provider: evt.data.provider,
            tookMs: evt.data.tookMs,
          }));
          break;
        case "error":
          patch((t) => ({ ...t, phase: "error", error: evt.data.message }));
          break;
      }
    })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        patch((t) => ({ ...t, phase: "error", error: msg }));
      })
      .finally(() => setBusy(false));
  }, []);

  const value = useMemo<ReplCtx>(
    () => ({ open, setOpen, turns, busy, sendTurn }),
    [open, turns, busy, sendTurn],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

// ---------- Panel ----------
export function ReplPanel() {
  const { open, setOpen, turns, busy, sendTurn } = useRepl();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  if (!open) return null;

  const submit = () => {
    if (!input.trim()) return;
    sendTurn(input);
    setInput("");
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    });
  };

  return (
    <div
      className="fixed inset-x-0 bottom-0 z-30 border-t border-hairline-hot bg-panel"
      style={{ height: "40vh", animation: "repl-slide-up 240ms cubic-bezier(0.2,0,0,1)" }}
    >
      <style>{`
        @keyframes repl-slide-up {
          from { transform: translateY(100%); }
          to { transform: translateY(0); }
        }
      `}</style>
      {/* header */}
      <div className="flex h-9 items-center gap-3 border-b border-hairline px-3">
        <Terminal size={13} strokeWidth={1.5} className="text-muted" />
        <span className="mono text-caption uppercase tracking-wider text-muted">REPL</span>
        {busy && (
          <span className="mono text-caption text-cyan">
            <AnimatedStepBadge step="cycle" phase="progress" /> running
          </span>
        )}
        <span className="ml-auto mono text-caption text-dim">{turns.length} turn(s)</span>
        <button
          onClick={() => setOpen(false)}
          className="text-muted hover:text-primary"
          aria-label="Close REPL"
        >
          <ChevronDown size={14} />
        </button>
        <button onClick={() => setOpen(false)} className="text-muted hover:text-primary">
          <X size={14} />
        </button>
      </div>
      {/* body */}
      <div ref={scrollRef} className="h-[calc(40vh-72px)] overflow-y-auto px-3 py-2">
        {turns.length === 0 && (
          <div className="mono text-caption text-dim">
            Enter a slash command (e.g. <code>/query riskiest conjunction</code>) or a natural-language prompt.
          </div>
        )}
        {turns.map((t) => (
          <TurnView key={t.id} turn={t} onFollowUp={sendTurn} />
        ))}
      </div>
      {/* input */}
      <div className="flex h-8 items-center gap-2 border-t border-hairline px-3">
        <span className="mono text-caption text-cyan">&gt;</span>
        <input
          autoFocus
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); submit(); }
            if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
          }}
          placeholder="type a slash command or free-text prompt..."
          className="mono h-full w-full bg-transparent text-caption text-primary placeholder:text-dim focus:outline-none"
        />
        <span className="mono text-caption text-dim">↵ run · ESC close</span>
      </div>
    </div>
  );
}

// ---------- Turn view ----------
function TurnView({
  turn,
  onFollowUp,
}: {
  turn: Turn;
  onFollowUp: (input: string) => void;
}) {
  const elapsed = Date.now() - turn.startedAt;
  return (
    <div className="mb-3 border-l border-hairline pl-3">
      <div className="mono mb-1 text-caption text-cyan">
        &gt; <span className="text-primary">{turn.input}</span>
      </div>

      {turn.phase === "classifying" && (
        <div className="mono text-caption text-muted">
          <AnimatedStepBadge step="planner" phase="progress" /> classifying…
        </div>
      )}

      {turn.phase === "chatting" && (
        <div className="mono text-caption text-muted">
          <AnimatedStepBadge step="nano.call" phase="progress" /> chat…
        </div>
      )}

      {turn.phase === "cycle-running" && (
        <CycleLoader
          cycleId={turn.cycleId ?? "…"}
          current={turn.currentStep}
          trail={turn.steps}
          elapsedMs={elapsed}
        />
      )}

      {turn.phase === "error" && (
        <div className="mono text-caption text-hot">error: {turn.error}</div>
      )}

      {/* slash-command response (done) */}
      {turn.phase === "done" && turn.response && (
        <div className="flex flex-col gap-2">
          {turn.response.results.map((r, i) => (
            <ResultView key={i} result={r} onFollowUp={onFollowUp} />
          ))}
          <div className="mono text-caption text-dim">
            cost=${turn.response.costUsd.toFixed(4)} · {turn.response.tookMs}ms
          </div>
        </div>
      )}

      {/* streamed response (done) */}
      {turn.phase === "done" && !turn.response && (
        <div className="flex flex-col gap-2">
          {turn.chatText && (
            <div className="border-l-2 border-cyan pl-3">
              <div className="whitespace-pre-wrap text-body text-primary">
                {turn.chatText}
              </div>
              <div className="mt-1 mono text-caption text-dim">
                assistant · {turn.provider}
              </div>
            </div>
          )}
          {turn.findings.length > 0 && (
            <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
              <div className="mono text-caption text-muted">
                findings · {turn.findings.length}
              </div>
              {turn.findings.map((f) => (
                <div
                  key={f.id}
                  className="mono flex items-center gap-2 text-caption"
                >
                  <span className="text-primary">{f.id}</span>
                  <span className="text-muted">{f.title}</span>
                  {f.cortex && (
                    <span className="text-dim">[{f.cortex}]</span>
                  )}
                </div>
              ))}
            </div>
          )}
          {turn.summaryText && (
            <div className="border-l-2 border-cold pl-3">
              <div className="whitespace-pre-wrap text-body text-primary">
                {turn.summaryText}
              </div>
            </div>
          )}
          {turn.tookMs != null && (
            <div className="mono text-caption text-dim">
              {turn.provider ? `${turn.provider} · ` : ""}
              {turn.tookMs}ms
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultView({
  result,
  onFollowUp,
}: {
  result: DispatchResult;
  onFollowUp: (input: string) => void;
}) {
  switch (result.kind) {
    case "briefing":
      return <BriefingRender r={result} onFollowUp={onFollowUp} />;
    case "telemetry":
      return <TelemetryRender r={result} />;
    case "logs":
      return <LogTailRender r={result} />;
    case "graph":
      return <GraphTreeRender r={result} />;
    case "why":
      return <WhyTreeRender r={result} />;
    case "clarify":
      return <ClarifyRender r={result} onFollowUp={onFollowUp} />;
    case "resolution":
      return <ResolutionRender r={result} />;
    case "pc":
      return <PcEstimatorRender r={result} onFollowUp={onFollowUp} />;
    case "chat":
      return <ChatRender r={result} />;
  }
}

function ChatRender({ r }: { r: Extract<DispatchResult, { kind: "chat" }> }) {
  return (
    <div className="border-l-2 border-cyan pl-3">
      <div className="whitespace-pre-wrap text-body text-primary">{r.text}</div>
      <div className="mt-1 mono text-caption text-dim">assistant · {r.provider}</div>
    </div>
  );
}

// ---------- Renderers ----------

const DOT_COLOR: Record<BriefingFinding["sourceClass"], string> = {
  field: "text-cold",
  osint: "text-amber",
  derived: "text-dim",
};

function confidenceBar(v: number) {
  const chars = "▁▂▃▄▅▆▇█";
  const n = Math.max(0, Math.min(1, v));
  // 8-char sparkline
  const len = 8;
  let out = "";
  for (let i = 0; i < len; i++) {
    const t = (i + 1) / len;
    out += chars[t <= n ? chars.length - 1 : Math.max(0, Math.floor(((n - i / len) * len) * chars.length))] ?? "▁";
  }
  return out;
}

function BriefingRender({
  r,
  onFollowUp,
}: {
  r: Extract<DispatchResult, { kind: "briefing" }>;
  onFollowUp: (input: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2 border border-hairline bg-elevated p-2">
      <div className="border-l-2 border-cyan pl-2 text-caption text-muted italic">
        {r.executiveSummary}
      </div>
      <div className="flex flex-col gap-1">
        {r.findings.map((f) => (
          <div key={f.id} className="mono flex items-center gap-2 text-caption">
            <span className={clsx(DOT_COLOR[f.sourceClass])}>●</span>
            <span className="text-primary">{f.id}</span>
            <span className={clsx(DOT_COLOR[f.sourceClass])}>{f.sourceClass}</span>
            <span className={clsx(DOT_COLOR[f.sourceClass])}>{confidenceBar(f.confidence)}</span>
            <span className="text-muted">{f.summary}</span>
            <span className="text-dim">({f.evidenceRefs.join(", ")})</span>
          </div>
        ))}
      </div>
      {r.recommendedActions.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="mono text-caption text-cyan">Recommended actions</div>
          {r.recommendedActions.map((a, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(a)}
              className="mono text-left text-caption text-primary hover:text-cyan"
            >
              → {a}
            </button>
          ))}
        </div>
      )}
      {r.followUpPrompts.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="mono text-caption text-dim">Try next</div>
          {r.followUpPrompts.map((q, i) => (
            <button
              key={i}
              onClick={() => onFollowUp(q)}
              className="mono text-left text-caption text-muted hover:text-primary"
            >
              • {q}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function TelemetryRender({ r }: { r: Extract<DispatchResult, { kind: "telemetry" }> }) {
  const max = Math.max(...r.distribution.map((d) => Math.abs(d.p95 - d.p5))) || 1;
  return (
    <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">
        telemetry · {r.satName} <span className="text-dim">· NORAD {r.satId}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {r.distribution.map((e: TelemetryEntry) => {
          const spread = Math.abs(e.p95 - e.p5);
          const barLen = Math.max(1, Math.round((spread / max) * 24));
          return (
            <div key={e.name} className="mono grid grid-cols-[260px_1fr_100px_160px] gap-2 text-caption">
              <span className="text-primary">{e.name}</span>
              <span className="text-cyan">{"█".repeat(barLen)}</span>
              <span className="text-numeric">
                {e.median} <span className="text-dim">{e.unit}</span>
              </span>
              <span className="text-dim">
                [{e.p5} .. {e.p95}]
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const LEVEL_COLOR: Record<LogEvent["level"], string> = {
  debug: "text-dim",
  info: "text-muted",
  warn: "text-amber",
  error: "text-hot",
};

function LogTailRender({ r }: { r: Extract<DispatchResult, { kind: "logs" }> }) {
  return (
    <div className="flex flex-col gap-0.5 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">logs · {r.events.length} events</div>
      {r.events.map((e, i) => (
        <div key={i} className="mono flex items-center gap-2 text-caption">
          {e.step ? <AnimatedStepBadge step={e.step} phase={e.phase ?? "progress"} /> : <span className="w-5" />}
          <span className="text-dim">{e.time.slice(11, 19)}</span>
          <span className={clsx(LEVEL_COLOR[e.level], "uppercase")}>{e.level}</span>
          <span className="text-field">{e.service}</span>
          <span className="text-primary">{e.msg}</span>
        </div>
      ))}
    </div>
  );
}

function GraphTreeRender({ r }: { r: Extract<DispatchResult, { kind: "graph" }> }) {
  const rows: { depth: number; node: GraphNode }[] = [];
  const walk = (n: GraphNode, d: number) => {
    rows.push({ depth: d, node: n });
    n.children.forEach((c) => walk(c, d + 1));
  };
  walk(r.tree, 0);
  return (
    <div className="flex flex-col gap-0.5 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">graph · root {r.root}</div>
      {rows.map((row, i) => (
        <div key={i} className="mono text-caption">
          <span className="text-dim">{"  ".repeat(row.depth)}{row.depth === 0 ? "◆" : "└"} </span>
          <span className="text-primary">{row.node.label}</span>
          <span className="text-dim"> [{row.node.class}]</span>
        </div>
      ))}
    </div>
  );
}

// Source-class palette — aligned with BriefingRender: FIELD=cold, OSINT=amber, SIM=dim.
const WHY_CLASS_COLOR: Record<"field" | "osint" | "sim" | "derived", string> = {
  field: "text-cold",
  osint: "text-amber",
  sim: "text-dim",
  derived: "text-dim",
};

// Kind color — finding=cyan, edge=amber (yellow-ish), source_item=dim white.
const WHY_KIND_COLOR: Record<WhyNode["kind"], string> = {
  finding: "text-cyan",
  edge: "text-amber",
  source_item: "text-muted",
  evidence: "text-dim",
};

type WhyLine = { prefix: string; branch: string; node: WhyNode };

function flattenWhy(n: WhyNode, prefix: string, isLast: boolean, isRoot: boolean): WhyLine[] {
  const branch = isRoot ? "" : (isLast ? "└── " : "├── ");
  const out: WhyLine[] = [{ prefix, branch, node: n }];
  const nextPrefix = isRoot ? "" : prefix + (isLast ? "    " : "│   ");
  n.children.forEach((c, i, arr) => {
    out.push(...flattenWhy(c, nextPrefix, i === arr.length - 1, false));
  });
  return out;
}

function WhyTreeRender({ r }: { r: Extract<DispatchResult, { kind: "why" }> }) {
  const lines = flattenWhy(r.tree, "", true, true);
  const s = r.stats;
  return (
    <div className="flex flex-col gap-0.5 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">why · {r.findingId}</div>
      <div className="mono text-caption text-dim">
        {s.edges} edges · {s.sourceItems} source_items · source_classes:{" "}
        <span className="text-cold">FIELD={s.byClass.field}</span>{" "}
        <span className="text-amber">OSINT={s.byClass.osint}</span>{" "}
        <span className="text-dim">SIM={s.byClass.sim}</span>
      </div>
      {lines.map((l, i) => (
        <div key={i} className="mono text-caption whitespace-pre">
          <span className="text-dim">{l.prefix}{l.branch}</span>
          <span className={clsx(WHY_KIND_COLOR[l.node.kind], "uppercase")}>{l.node.kind}</span>
          <span className="text-dim"> </span>
          <span
            className={clsx(
              l.node.sourceClass
                ? WHY_CLASS_COLOR[l.node.sourceClass]
                : l.node.kind === "finding"
                  ? "text-primary"
                  : "text-muted",
            )}
          >
            {l.node.label}
          </span>
          {l.node.sha256 && (l.node.kind === "edge" || l.node.kind === "source_item") && (
            <span className="ml-1 border border-hairline px-1 text-dim">
              sha256:{l.node.sha256.slice(0, 8)}
            </span>
          )}
          {l.node.sourceClass && l.node.kind !== "finding" && (
            <span className={clsx("ml-1", WHY_CLASS_COLOR[l.node.sourceClass])}>
              [{l.node.sourceClass.toUpperCase()}]
            </span>
          )}
          {l.node.detail && <span className="text-dim"> · {l.node.detail}</span>}
        </div>
      ))}
    </div>
  );
}

function ClarifyRender({
  r,
  onFollowUp,
}: {
  r: Extract<DispatchResult, { kind: "clarify" }>;
  onFollowUp: (input: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-amber">? {r.question}</div>
      <div className="flex flex-wrap gap-2">
        {r.options.map((opt) => (
          <button
            key={opt}
            onClick={() => onFollowUp(`/${opt} `)}
            className="mono border border-hairline bg-hover px-2 py-1 text-caption text-primary hover:border-cyan"
          >
            /{opt}
          </button>
        ))}
      </div>
    </div>
  );
}

function PcEstimatorRender({
  r,
  onFollowUp,
}: {
  r: Extract<DispatchResult, { kind: "pc" }>;
  onFollowUp: (input: string) => void;
}) {
  const e = r.estimate;
  const sevClass =
    e.severity === "high" ? "text-hot" : e.severity === "medium" ? "text-amber" : "text-cold";
  const sevLabel =
    e.severity === "high" ? "HIGH" : e.severity === "medium" ? "MEDIUM" : "INFO";
  const maxCount = Math.max(1, ...e.histogramBins.map((b) => b.count));
  const fmtSci = (v: number): string => v.toExponential(2);
  return (
    <div className="flex flex-col gap-2 border border-hairline bg-elevated p-2">
      <div className="mono text-caption text-muted">
        pc · conjunction {r.conjunctionId} · n={e.fishCount}
      </div>
      <div className="mono flex items-center gap-3 text-caption">
        <span className={clsx(sevClass, "uppercase")}>[{sevLabel}]</span>
        <span className="text-primary">
          median Pc = <span className="text-numeric">{fmtSci(e.medianPc)}</span>
        </span>
        <span className="text-dim">
          σ(log10)={e.sigmaPc.toFixed(3)} · p5={fmtSci(e.p5Pc)} · p95={fmtSci(e.p95Pc)}
        </span>
      </div>
      <div className="flex flex-col gap-0.5">
        <div className="mono text-caption text-muted">log10(Pc) histogram</div>
        {e.histogramBins.map((b, i) => {
          const barLen = Math.round((b.count / maxCount) * 28);
          return (
            <div key={i} className="mono grid grid-cols-[80px_1fr_40px] gap-2 text-caption">
              <span className="text-dim">{b.log10Pc.toFixed(2)}</span>
              <span className={clsx(sevClass)}>{"█".repeat(barLen) || "·"}</span>
              <span className="text-numeric">{b.count}</span>
            </div>
          );
        })}
      </div>
      {e.clusters.length > 0 && (
        <div className="flex flex-col gap-0.5">
          <div className="mono text-caption text-cyan">Dissent clusters</div>
          {e.clusters.map((c, i) => (
            <div key={i} className="mono grid grid-cols-[180px_1fr_160px_40px] gap-2 text-caption">
              <span className="text-primary">{c.mode}</span>
              <span className="text-dim">{c.flags.join(", ")}</span>
              <span className="text-muted">
                [{fmtSci(c.pcRange[0])} .. {fmtSci(c.pcRange[1])}]
              </span>
              <span className="text-numeric">{c.fishCount}</span>
            </div>
          ))}
        </div>
      )}
      {e.suggestionId && (
        <button
          onClick={() => onFollowUp(`/accept ${e.suggestionId}`)}
          className="mono text-left text-caption text-primary hover:text-cyan"
        >
          → /accept {e.suggestionId}
        </button>
      )}
    </div>
  );
}

function ResolutionRender({ r }: { r: Extract<DispatchResult, { kind: "resolution" }> }) {
  return (
    <div className="flex items-center gap-2 border border-hairline bg-elevated p-2">
      <CheckCircle2 size={14} className={r.ok ? "text-cold" : "text-hot"} />
      <span className="mono text-caption text-primary">{r.suggestionId}</span>
      <span className="mono text-caption text-cold">accepted</span>
      <span className="mono text-caption text-dim">delta.findingId = {r.delta.findingId}</span>
    </div>
  );
}
