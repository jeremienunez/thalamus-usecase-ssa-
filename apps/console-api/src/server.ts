/**
 * console-api — thin Fastify layer over the live Postgres + Redis stack.
 *
 * This module has zero import-time side effects. Use createApp() to get a
 * configured Fastify instance without listening, or startServer() to boot
 * on a port. Both return a `close()` that tears down the DB + Redis pool.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import Redis from "ioredis";
import * as schema from "@interview/db-schema";
import { MetricsCollector } from "@interview/shared";
import {
  NullWebSearchAdapter,
  OpenAIWebSearchAdapter,
  type WebSearchPort,
} from "@interview/thalamus";
import { buildContainer, type ContainerConfig } from "./container";
import { createSimRouteTransport } from "./infra/sim-route-transport";
import { registerAllRoutes } from "./routes";
import type { HealthSnapshot } from "./infra/health-snapshot";

export interface ServerEnv {
  databaseUrl: string;
  redisUrl: string;
  openaiApiKey?: string;
  voyageApiKey?: string;
  simLlmMode?: "cloud" | "fixtures" | "record";
  simKernelSharedSecret?: string;
}

function readSimLlmMode(
  value: string | undefined,
): "cloud" | "fixtures" | "record" | undefined {
  return value === "cloud" || value === "fixtures" || value === "record"
    ? value
    : undefined;
}

export function readServerEnv(): ServerEnv {
  process.env.SIM_KERNEL_SHARED_SECRET ??= "interview-local-kernel-secret";
  return {
    databaseUrl:
      process.env.DATABASE_URL ??
      "postgres://thalamus:thalamus@localhost:5433/thalamus",
    redisUrl: process.env.REDIS_URL ?? "redis://localhost:6380",
    openaiApiKey: process.env.OPENAI_API_KEY,
    voyageApiKey: process.env.VOYAGE_API_KEY,
    simLlmMode: readSimLlmMode(process.env.SIM_LLM_MODE),
    simKernelSharedSecret: process.env.SIM_KERNEL_SHARED_SECRET,
  };
}

function buildInfra(env: ServerEnv): {
  config: ContainerConfig;
  close: () => Promise<void>;
  redactedUrls: { databaseUrl: string; redisUrl: string };
} {
  const pool = new Pool({ connectionString: env.databaseUrl });
  const db = drizzle(pool, { schema }) as unknown as NodePgDatabase<
    typeof schema
  >;
  const redis = new Redis(env.redisUrl, { maxRetriesPerRequest: null });
  const webSearch: WebSearchPort = env.openaiApiKey
    ? new OpenAIWebSearchAdapter(env.openaiApiKey, "gpt-5.4-mini")
    : new NullWebSearchAdapter();
  return {
    config: {
      db,
      redis,
      webSearch,
      voyageApiKey: env.voyageApiKey,
      simLlmMode: env.simLlmMode,
      simKernelSharedSecret: env.simKernelSharedSecret,
    },
    close: async () => {
      await pool.end();
      redis.disconnect();
    },
    redactedUrls: {
      databaseUrl: env.databaseUrl.replace(/:\/\/[^@]+@/, "://***@"),
      redisUrl: env.redisUrl,
    },
  };
}

export type AppHandle = {
  app: FastifyInstance;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
  snapshot: HealthSnapshot;
};

export type ServerHandle = AppHandle & { port: number };

const isProd = process.env.NODE_ENV === "production";
const isTest = process.env.NODE_ENV === "test" || process.env.VITEST === "true";

const POLL_ROUTES = new Set(["/api/autonomy/status", "/api/sweep/suggestions"]);

const C = {
  reset: "\x1b[0m", dim: "\x1b[2m", bold: "\x1b[1m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", cyan: "\x1b[36m", gray: "\x1b[90m",
};

function methodColor(m: string): string {
  switch (m) {
    case "GET": return C.cyan;
    case "POST": return C.green;
    case "PUT": case "PATCH": return C.yellow;
    case "DELETE": return C.red;
    default: return C.gray;
  }
}

function durationColor(ms: number): string {
  if (ms >= 500) return C.red;
  if (ms >= 100) return C.yellow;
  return C.gray;
}

/**
 * Print the shared satellite ASCII logo read from scripts/ui/satellite.txt.
 * Same glyph source as the bash `satellite_logo` helper used by the Makefile,
 * so changing the file updates both surfaces. Colors applied per-token to
 * match the bash rendering: yellow panels, cyan bus + antenna, green eye.
 */
function printSatelliteLogo(): void {
  const y = C.yellow, c = C.cyan, g = C.green, r = C.reset;
  const path = fileURLToPath(new URL("../../../scripts/ui/satellite.txt", import.meta.url));
  let raw: string;
  try {
    raw = readFileSync(path, "utf8").replace(/\n$/, "");
  } catch {
    // Cosmetic only — missing file (e.g. in a container image) must not crash boot.
    return;
  }
  const colored = raw
    .replace(/◉/g, `${g}◉${c}`)
    .replace(/┌──┐/g, `${y}┌──┐${r}`)
    .replace(/└──┘/g, `${y}└──┘${r}`)
    .replace(/│▓▓│/g, `${y}│▓▓│${r}`)
    .replace(/╔═══╗/g, `${c}╔═══╗${r}`)
    .replace(/╚═╤═╝/g, `${c}╚═╤═╝${r}`)
    .replace(/╣/g, `${c}╣`)
    .replace(/╠/g, `╠${r}`)
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
  process.stdout.write("\n" + colored + "\n");
}

function printBanner(
  port: number,
  info: { databaseUrl: string; redisUrl: string; cortices: number },
  snapshot: HealthSnapshot,
): void {
  const mode = isProd ? "production" : "development";
  const c = C.cyan, g = C.green, gr = C.gray, b = C.bold, r = C.reset;
  const base = `http://localhost:${port}`;
  const dot = (ok: boolean) => `${ok ? g : C.red}●${r}`;
  const header = [
    ``,
    `  ${b}${c}console-api${r} ${gr}·${r} ${g}ready${r} ${gr}on${r} ${b}${base}${r}`,
  ];
  const cfg = [
    `  ${gr}mode${r}      ${mode}`,
    `  ${gr}postgres${r}  ${info.databaseUrl}`,
    `  ${gr}redis${r}     ${info.redisUrl}`,
  ];
  const pad = (s: string | number | null, n: number) => String(s ?? "—").padEnd(n);
  const system = [
    `  ${b}System${r}`,
    `    ${dot(snapshot.postgres.ok)} postgres    ${pad(snapshot.postgres.pgvector ? `pgvector ${snapshot.postgres.pgvector}` : "pgvector —", 24)}`,
    `    ${dot(snapshot.redis.ok)} redis       ${pad(snapshot.redis.ok ? "ready" : "unreachable", 24)}`,
    `    ${dot(true)} cortices    ${pad(snapshot.cortices, 24)} ${gr}loaded${r}`,
    `    ${dot(snapshot.postgres.ok)} catalog     ${pad(snapshot.catalog.satellites, 6)} sats   ${pad(snapshot.catalog.regimes, 6)} regimes`,
  ];
  const hints = [
    `  ${b}Try this:${r}`,
    `  ${gr}›${r} ${c}curl${r} ${base}/api/cycles            ${gr}# recent enrichment cycles${r}`,
    `  ${gr}›${r} ${c}curl${r} ${base}/api/satellites         ${gr}# seeded catalog${r}`,
    `  ${gr}›${r} ${c}curl${r} "${base}/api/conjunctions?minPc=1e-8" ${gr}# close approaches${r}`,
    `  ${gr}›${r} ${c}curl${r} ${base}/api/findings           ${gr}# nano-research findings${r}`,
    `  ${gr}›${r} ${c}curl${r} ${base}/api/stats              ${gr}# KG counters${r}`,
    `  ${gr}›${r} ${c}curl -X POST${r} ${base}/api/repl/turn ${gr}-d '{"query":"LEO traffic"}'${r}`,
  ];
  process.stdout.write(
    header.join("\n") + "\n\n" +
    cfg.join("\n") + "\n\n" +
    system.join("\n") + "\n\n" +
    hints.join("\n") + "\n\n",
  );
}

/** Builds + configures a Fastify app with CORS, container, and routes.
 *  Does NOT call listen. */
export async function createApp(
  env: ServerEnv = readServerEnv(),
): Promise<AppHandle> {
  const app = Fastify({
    disableRequestLogging: true,
    logger: isProd || isTest
      ? { level: "info" }
      : {
          level: "info",
          transport: {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "HH:MM:ss",
              ignore: "pid,hostname,reqId,req,res,responseTime",
              singleLine: true,
              messageFormat: "{msg}",
            },
          },
        },
  });
  await app.register(cors, { origin: true });

  const metrics = new MetricsCollector({ serviceName: "console-api" });
  const httpDuration = metrics.createHistogram(
    "http_request_duration_seconds",
    "HTTP request duration in seconds",
    [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    ["method", "route", "status"],
  );
  const httpTotal = metrics.createCounter(
    "http_requests_total",
    "HTTP requests total",
    ["method", "route", "status"],
  );

  // Prometheus scrape endpoint. Served on the same port as the api (4000) to
  // avoid a second listener; the ServiceMonitor is configured accordingly.
  app.get("/metrics", async (_req, reply) => {
    reply.header("Content-Type", metrics.registry.contentType);
    return metrics.registry.metrics();
  });

  app.addHook("onResponse", (req, reply, done) => {
    const url = req.url.split("?")[0];
    const route = req.routeOptions?.url ?? url; // templated path, bounded cardinality
    const status = String(reply.statusCode);
    const seconds = reply.elapsedTime / 1000;
    httpDuration.labels(req.method, route, status).observe(seconds);
    httpTotal.labels(req.method, route, status).inc();

    if (POLL_ROUTES.has(url)) return done();
    const ms = reply.elapsedTime;
    const code = reply.statusCode;
    const codeColor = code >= 500 ? C.red : code >= 400 ? C.yellow : C.green;
    const mCol = methodColor(req.method);
    const dCol = durationColor(ms);
    const line =
      `${codeColor}${code}${C.reset} ` +
      `${mCol}${req.method.padEnd(6)}${C.reset}` +
      `${req.url} ` +
      `${dCol}${ms.toFixed(1)}ms${C.reset}`;
    app.log.info(line);
    done();
  });

  const infra = buildInfra(env);
  const simTransport = createSimRouteTransport(app);
  const container = await buildContainer(infra.config, app.log, simTransport);
  registerAllRoutes(app, container.services);

  // Clear interval-driven services on Fastify shutdown so tests (and hot-
  // reload) don't leak timers that tick against torn-down infra.
  app.addHook("onClose", async () => {
    container.services.mission.stop();
    container.services.autonomy.stop();
  });

  return {
    app,
    info: { ...infra.redactedUrls, cortices: container.info.cortices },
    snapshot: container.snapshot,
    close: async () => {
      await app.close();
      await infra.close();
    },
  };
}

export async function startServer(
  port: number = Number(process.env.PORT ?? 4000),
): Promise<ServerHandle> {
  if (!Number.isFinite(port) || port < 0) {
    throw new Error(`startServer: invalid port ${port}`);
  }
  printSatelliteLogo();
  const { app, close, info, snapshot } = await createApp();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  printBanner(boundPort, info, snapshot);
  return { app, port: boundPort, close, info, snapshot };
}

async function main(): Promise<void> {
  await startServer();
}

const isVitest =
  process.env.VITEST === "true" || process.env.NODE_ENV === "test";
if (!isVitest) {
  main().catch((err) => {
    console.error("boot failed", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
