#!/usr/bin/env tsx
/**
 * SSA REPL — conversational driver over the Thalamus + Sweep stack.
 *
 * Non-technical reviewer runs free-form SSA queries; the REPL plans, dispatches,
 * interprets via the `analyst_briefing` cortex, and hands back an operator-
 * readable page with provenance inline.
 *
 * Commands:
 *   > <any text>                 → Thalamus runCycle + analyst_briefing
 *   > telemetry <satId>          → startTelemetrySwarm + briefing of 8 scalars
 *   > accept <suggestionId>      → resolve a pending suggestion (fires audit + promote)
 *   > graph <entityName>         → research_edge neighbourhood
 *   > findings [limit]           → last N findings across all cycles
 *   > help                       → this list
 *   > quit / exit                → bye
 *
 * Usage:
 *   THALAMUS_MODE=cloud    pnpm --filter @interview/thalamus ssa
 *   THALAMUS_MODE=fixtures pnpm --filter @interview/thalamus ssa
 */

import readline from "node:readline";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@interview/db-schema";
import type { Database } from "@interview/db-schema";
import { ResearchCycleTrigger } from "@interview/shared/enum";
import IORedis from "ioredis";
import { buildThalamusContainer } from "../config/container";
import { createLlmTransportWithMode } from "../transports/factory";
import {
  loadCycleFindings,
  loadRecentFindings,
  loadGraphNeighbourhood,
  loadFindingDetail,
  loadFindingEdges,
} from "../cortices/queries/repl-inspection";

const COLOR = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  grey: "\x1b[90m",
  magenta: "\x1b[35m",
} as const;

function banner(text: string, color: keyof typeof COLOR = "cyan"): void {
  const line = "═".repeat(Math.min(70, text.length + 4));
  console.log(`\n${COLOR[color]}╔${line}╗`);
  console.log(`║  ${COLOR.bold}${text}${COLOR.reset}${COLOR[color]}${" ".repeat(Math.max(0, line.length - text.length - 2))}║`);
  console.log(`╚${line}╝${COLOR.reset}`);
}

interface SessionState {
  totalCostUsd: number;
  cyclesRun: number;
  telemetrySwarmsRun: number;
  lastCycleId: bigint | null;
  lastFindings: Array<{
    id: bigint;
    title: string;
    cortex: string;
    urgency: string | null;
    confidence: number;
  }>;
}

async function main(): Promise<void> {
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgres://thalamus:thalamus@localhost:5433/thalamus";
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6380";
  const mode = (process.env.THALAMUS_MODE ?? "cloud") as
    | "cloud"
    | "fixtures"
    | "record";

  banner("SSA REPL — Thalamus + Sweep", "cyan");
  console.log(`${COLOR.grey}mode=${mode}  db=${redact(databaseUrl)}  redis=${redact(redisUrl)}${COLOR.reset}`);

  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  const redis = new IORedis(redisUrl, { maxRetriesPerRequest: null });

  const c = buildThalamusContainer({ db });
  console.log(
    `${COLOR.dim}[registry] ${c.registry.size()} cortex skills discovered${COLOR.reset}`,
  );
  if (!c.registry.get("analyst_briefing")) {
    console.warn(
      `${COLOR.yellow}[warn] analyst_briefing skill not found — briefings will be skipped${COLOR.reset}`,
    );
  }

  const state: SessionState = {
    totalCostUsd: 0,
    cyclesRun: 0,
    telemetrySwarmsRun: 0,
    lastCycleId: null,
    lastFindings: [],
  };

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `\n${COLOR.cyan}ssa>${COLOR.reset} `,
  });

  let shuttingDown = false;

  printHelp();
  rl.prompt();

  let queue: Promise<void> = Promise.resolve();
  rl.on("line", (rawLine) => {
    queue = queue.then(() => handleLine(rawLine));
  });

  async function handleLine(rawLine: string): Promise<void> {
    const line = rawLine.trim();
    if (!line) {
      if (!shuttingDown) rl.prompt();
      return;
    }
    try {
      const [cmd, ...rest] = line.split(/\s+/);
      const arg = rest.join(" ");

      if (cmd === "quit" || cmd === "exit" || cmd === ".q") {
        await shutdown();
        return;
      }
      if (cmd === "help" || cmd === "?") {
        printHelp();
      } else if (cmd === "telemetry") {
        await handleTelemetry(arg, { db, redis, c, state });
      } else if (cmd === "accept") {
        await handleAccept(arg, { redis, state });
      } else if (cmd === "graph") {
        await handleGraph(arg, { db });
      } else if (cmd === "findings") {
        await handleFindings(arg, { db, state });
      } else if (cmd === "why") {
        await handleWhy(arg, { db });
      } else if (cmd === "stats") {
        printStats(state);
      } else if (cmd === "chat" || cmd === "ask") {
        await handleChat(arg || line, { state });
      } else {
        // Anything else = free-form query.
        await handleQuery(line, { c, db, state });
      }
    } catch (err) {
      console.error(`${COLOR.red}[error] ${(err as Error).message}${COLOR.reset}`);
    } finally {
      if (!shuttingDown) {
        printStatus(state);
        rl.prompt();
      }
    }
  }

  rl.on("close", shutdown);

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n${COLOR.grey}Session ran ${state.cyclesRun} cycle(s) + ${state.telemetrySwarmsRun} telemetry swarm(s), total $${state.totalCostUsd.toFixed(3)}.${COLOR.reset}`);
    try {
      await redis.quit();
    } catch {
      // ignore
    }
    await pool.end();
    process.exit(0);
  }
}

// ─── Commands ────────────────────────────────────────────────────────

function printHelp(): void {
  console.log(`
${COLOR.bold}Commands${COLOR.reset}
  ${COLOR.cyan}<any text>${COLOR.reset}            run a Thalamus research cycle + briefing
  ${COLOR.cyan}telemetry <satId>${COLOR.reset}     K-fish telemetry inference on a satellite
  ${COLOR.cyan}accept <suggId>${COLOR.reset}       accept a pending sweep_suggestion (fires audit + promote)
  ${COLOR.cyan}graph <entity>${COLOR.reset}        show research_edge neighbourhood of an entity
  ${COLOR.cyan}findings [limit]${COLOR.reset}      list last N findings across cycles
  ${COLOR.cyan}why <findingId>${COLOR.reset}       trace provenance of a finding
  ${COLOR.cyan}chat <text>${COLOR.reset}           direct conversation with the SSA assistant (no cycle)
  ${COLOR.cyan}stats${COLOR.reset}                 session totals (cycles, cost, swarms)
  ${COLOR.cyan}help${COLOR.reset}                  this list
  ${COLOR.cyan}quit${COLOR.reset}                  goodbye
`);
}

function printStatus(state: SessionState): void {
  process.stdout.write(
    `${COLOR.grey}[session ${state.cyclesRun}c/${state.telemetrySwarmsRun}t  $${state.totalCostUsd.toFixed(3)}]${COLOR.reset}\n`,
  );
}

function printStats(state: SessionState): void {
  console.log(`
${COLOR.bold}Session${COLOR.reset}
  cycles run:        ${state.cyclesRun}
  telemetry swarms:  ${state.telemetrySwarmsRun}
  total cost:        $${state.totalCostUsd.toFixed(3)}
  last cycle id:     ${state.lastCycleId ?? "—"}
  last findings:     ${state.lastFindings.length}
`);
}

async function handleQuery(
  query: string,
  deps: {
    c: ReturnType<typeof buildThalamusContainer>;
    db: Database;
    state: SessionState;
  },
): Promise<void> {
  const t0 = Date.now();
  console.log(`${COLOR.dim}[planner] dispatching...${COLOR.reset}`);
  const cycle = await deps.c.thalamusService.runCycle({
    query,
    triggerType: ResearchCycleTrigger.User,
    lang: "en",
    mode: "audit",
    minConfidence: 0.5,
  });
  const elapsedMs = Date.now() - t0;
  deps.state.cyclesRun++;
  deps.state.lastCycleId = cycle.id;
  const cost = Number(cycle.totalCost ?? 0);
  deps.state.totalCostUsd += cost;

  console.log(
    `${COLOR.grey}[cycle ${cycle.id}] status=${cycle.status}  findings=${cycle.findingsCount ?? 0}  cost=$${cost.toFixed(3)}  elapsed=${(elapsedMs / 1000).toFixed(1)}s${COLOR.reset}`,
  );

  // Findings for THIS cycle only — filter by cycle id via SQL.
  const findings = await loadCycleFindings(deps.db, cycle.id, 10);
  deps.state.lastFindings = findings.map((f) => ({
    id: f.id,
    title: f.title ?? "",
    cortex: f.cortex ?? "",
    urgency: f.urgency ?? null,
    confidence: f.confidence ?? 0,
  }));

  if (findings.length === 0) {
    console.log(`${COLOR.grey}[cycle] no findings — falling back to direct chat${COLOR.reset}`);
    await handleChat(query, { state: deps.state });
    return;
  }

  // Hand to analyst_briefing for interpretation.
  const briefing = await briefFindings(deps.c, query, cycle.id, findings, {
    iterations: 1,
    cost,
    elapsedMs,
  });

  banner(`BRIEFING — ${truncate(query, 50)}`, "green");
  console.log(briefing);
}


const CHAT_SYSTEM_PROMPT = `You are the SSA mission-operator assistant inside the Thalamus + Sweep REPL.
You talk to a non-technical reviewer. Keep answers under 120 words, in the reviewer's language.
You CAN explain: catalog contents, conjunction concepts, sim-fish swarms, confidence bands (FIELD/OSINT/SIM), findings, what each REPL command does (query, telemetry, graph, findings, why, accept, stats).
You CANNOT run actions yourself — if the user wants data, suggest the exact REPL command that would fetch it.
Never invent satellite numbers or Pc values. If the user asks for a specific datum, direct them to \`query\`, \`telemetry\`, or \`findings\`.`;

async function handleChat(
  query: string,
  deps: { state: SessionState },
): Promise<void> {
  const t0 = Date.now();
  const transport = createLlmTransportWithMode(CHAT_SYSTEM_PROMPT);
  const response = await transport.call(query);
  const elapsedMs = Date.now() - t0;
  banner("CHAT", "magenta");
  console.log(response.content || `${COLOR.grey}(empty response)${COLOR.reset}`);
  console.log(
    `${COLOR.grey}provider=${response.provider} elapsed=${(elapsedMs / 1000).toFixed(1)}s${COLOR.reset}`,
  );
  void deps;
}

async function handleTelemetry(
  arg: string,
  _deps: {
    db: Database;
    redis: IORedis;
    c: ReturnType<typeof buildThalamusContainer>;
    state: SessionState;
  },
): Promise<void> {
  const satId = Number(arg);
  if (!Number.isFinite(satId) || satId <= 0) {
    console.log(`${COLOR.red}usage: telemetry <satelliteId>${COLOR.reset}`);
    return;
  }
  console.log(
    `${COLOR.yellow}[telemetry] sim-fish swarm is wired in @interview/sweep — run from there:${COLOR.reset}`,
  );
  console.log(
    `${COLOR.dim}  SATELLITE_ID=${satId} pnpm --filter @interview/sweep demo-telemetry${COLOR.reset}`,
  );
}

async function handleAccept(
  arg: string,
  deps: { redis: IORedis; state: SessionState },
): Promise<void> {
  if (!arg) {
    console.log(`${COLOR.red}usage: accept <suggestionId>${COLOR.reset}`);
    return;
  }
  const h = await deps.redis.hgetall(`sweep:suggestions:${arg}`);
  if (!h.id) {
    console.log(`${COLOR.red}[accept] suggestion ${arg} not found${COLOR.reset}`);
    return;
  }
  console.log(`${COLOR.yellow}[accept] accept path lives in sweep/resolution.service — route via API:${COLOR.reset}`);
  console.log(`${COLOR.dim}  POST /admin/sweep/resolve/${arg}  { accepted: true }${COLOR.reset}`);
  console.log(`${COLOR.dim}  suggestion title: ${h.title}${COLOR.reset}`);
}

async function handleGraph(
  arg: string,
  deps: { db: Database },
): Promise<void> {
  if (!arg) {
    console.log(`${COLOR.red}usage: graph <entityName>${COLOR.reset}`);
    return;
  }
  const rows = await loadGraphNeighbourhood(deps.db, arg);
  if (rows.length === 0) {
    console.log(`${COLOR.grey}[graph] no edges touching "${arg}"${COLOR.reset}`);
    return;
  }
  console.log(`${COLOR.bold}${rows.length} edge(s) touching "${arg}"${COLOR.reset}`);
  for (const r of rows) {
    console.log(
      `  ${r.from_name} [${r.from_type}] --${COLOR.cyan}${r.relation}${COLOR.reset}--> ${r.to_name} [${r.to_type}] ${COLOR.grey}(conf ${r.confidence?.toFixed(2) ?? "—"})${COLOR.reset}`,
    );
  }
}

async function handleFindings(
  arg: string,
  deps: {
    db: Database;
    state: SessionState;
  },
): Promise<void> {
  const limit = Math.max(1, Math.min(50, Number(arg) || 10));
  const rows = await loadRecentFindings(deps.db, limit);
  if (rows.length === 0) {
    console.log(`${COLOR.grey}[findings] none yet — run a query first${COLOR.reset}`);
    return;
  }
  deps.state.lastFindings = rows.map((r) => ({
    id: BigInt(r.id),
    title: r.title,
    cortex: r.cortex,
    urgency: r.urgency,
    confidence: r.confidence ?? 0,
  }));
  console.log(`${COLOR.bold}Last ${rows.length} findings${COLOR.reset}`);
  for (const f of rows) {
    const severityColor =
      f.urgency === "critical" ? COLOR.red :
      f.urgency === "high" ? COLOR.yellow :
      f.urgency === "medium" ? COLOR.cyan : COLOR.grey;
    console.log(
      `  ${COLOR.grey}#${f.id}${COLOR.reset}  ${severityColor}[${(f.urgency ?? "?").padEnd(8)}]${COLOR.reset} ${truncate(f.title, 60)} ${COLOR.grey}(${f.cortex}, conf ${f.confidence?.toFixed(2) ?? "—"})${COLOR.reset}`,
    );
  }
}

async function handleWhy(
  arg: string,
  deps: { db: Database },
): Promise<void> {
  const findingId = arg.replace(/^#/, "");
  if (!/^\d+$/.test(findingId)) {
    console.log(`${COLOR.red}usage: why <findingId>${COLOR.reset}`);
    return;
  }
  const f = await loadFindingDetail(deps.db, BigInt(findingId));
  if (!f) {
    console.log(`${COLOR.red}[why] finding ${findingId} not found${COLOR.reset}`);
    return;
  }
  console.log(`${COLOR.bold}#${f.id} — ${f.title}${COLOR.reset}`);
  console.log(`${COLOR.grey}cortex=${f.cortex} urgency=${f.urgency} confidence=${f.confidence?.toFixed(2) ?? "—"}${COLOR.reset}`);
  console.log(`\n${f.summary}\n`);
  const evidence = Array.isArray(f.evidence) ? f.evidence : [];
  if (evidence.length > 0) {
    console.log(`${COLOR.bold}Evidence (${evidence.length}):${COLOR.reset}`);
    for (const e of evidence as Array<{ source?: string; weight?: number; data?: unknown }>) {
      const data = JSON.stringify(e.data).slice(0, 120);
      console.log(`  • ${e.source ?? "?"} (w=${e.weight ?? 1.0}) ${COLOR.grey}${data}${COLOR.reset}`);
    }
  }
  const edges = await loadFindingEdges(deps.db, BigInt(findingId));
  if (edges.length > 0) {
    console.log(`${COLOR.bold}Edges:${COLOR.reset}`);
    for (const e of edges) {
      console.log(`  • ${e.from_name} --${e.relation}--> ${e.to_name}`);
    }
  }
}

// ─── Briefing post-processing ─────────────────────────────────────────

async function briefFindings(
  c: ReturnType<typeof buildThalamusContainer>,
  query: string,
  cycleId: bigint,
  findings: Array<{
    id: bigint;
    title: string | null;
    summary: string | null;
    cortex: string | null;
    urgency: string | null;
    confidence: number | null;
    evidence?: unknown;
  }>,
  meta: { iterations: number; cost: number; elapsedMs: number },
): Promise<string> {
  if (!c.registry.get("analyst_briefing")) {
    return renderFallbackBriefing(findings);
  }
  const payload = JSON.stringify(
    {
      cycleQuery: query,
      cycleMetadata: {
        cycleId: String(cycleId),
        iterations: meta.iterations,
        cost: meta.cost,
        elapsedMs: meta.elapsedMs,
      },
      findings: findings.map((f) => ({
        id: String(f.id),
        title: f.title,
        summary: f.summary,
        cortex: f.cortex,
        urgency: f.urgency,
        confidence: f.confidence,
      })),
    },
    null,
    0,
  );

  try {
    const { content } = await c.executor.runSkillFreeform(
      "analyst_briefing",
      payload,
      { enableWebSearch: false, maxRetries: 1 },
    );
    // The skill is JSON-structured: { findings: [{ summary: "markdown", ... }] }
    // Extract summary; fall back to raw content on parse failure.
    try {
      const parsed = JSON.parse(content) as {
        findings?: Array<{ summary?: string }>;
      };
      const body = parsed.findings?.[0]?.summary;
      if (body) return body;
    } catch {
      // not JSON — probably pure markdown
    }
    return content || renderFallbackBriefing(findings);
  } catch (err) {
    console.warn(`${COLOR.yellow}[briefing] failed: ${(err as Error).message} — falling back${COLOR.reset}`);
    return renderFallbackBriefing(findings);
  }
}

function renderFallbackBriefing(
  findings: Array<{
    id: bigint;
    title: string | null;
    urgency: string | null;
    confidence: number | null;
    cortex: string | null;
  }>,
): string {
  const lines: string[] = [
    "## Key findings (raw — no LLM briefing available)",
  ];
  for (const f of findings) {
    const sev =
      f.urgency === "critical" ? "[!!]" :
      f.urgency === "high" ? "[HIGH]" :
      f.urgency === "medium" ? "[MED]" : "[INFO]";
    lines.push(`- ${sev} #${f.id} ${f.title ?? ""} (${f.cortex}, conf ${f.confidence?.toFixed(2) ?? "—"})`);
  }
  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function redact(url: string): string {
  return url.replace(/\/\/[^@]+@/, "//***@");
}

main().catch((err) => {
  console.error(`${COLOR.red}fatal:${COLOR.reset}`, err);
  process.exit(1);
});
