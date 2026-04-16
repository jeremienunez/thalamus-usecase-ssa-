/**
 * console-api — thin Fastify layer over the live Postgres + Redis stack.
 *
 * This module has zero import-time side effects. Use createApp() to get a
 * configured Fastify instance without listening, or startServer() to boot
 * on a port. Both return a `close()` that tears down the DB + Redis pool.
 */
import "./init"; // MUST be first — bumps process.setMaxListeners before imports register handlers
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { buildContainer } from "./container";
import { registerAllRoutes } from "./routes";

export type AppHandle = {
  app: FastifyInstance;
  close: () => Promise<void>;
  info: { databaseUrl: string; redisUrl: string; cortices: number };
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function animateSatellite(): Promise<void> {
  if (!process.stdout.isTTY) return;
  const y = C.yellow, c = C.cyan, g = C.green, gr = C.gray, r = C.reset;
  const frames: string[][] = [
    [
      `  ${y}┌──┐${r}  ${c}╔═══╗${r}  ${y}┌──┐${r}`,
      `  ${y}│${gr}░░${y}│${r}${gr}··${c}╣ ${gr}·${c} ╠${r}${gr}··${y}│${gr}░░${y}│${r}`,
      `  ${y}└──┘${r}  ${c}╚═╤═╝${r}  ${y}└──┘${r}`,
    ],
    [
      `  ${y}┌──┐${r}  ${c}╔═══╗${r}  ${y}┌──┐${r}`,
      `  ${y}│${gr}▒▒${y}│${r}${gr}══${c}╣ ${gr}◦${c} ╠${r}${gr}══${y}│${gr}▒▒${y}│${r}`,
      `  ${y}└──┘${r}  ${c}╚═╤═╝${r}  ${y}└──┘${r}`,
    ],
    [
      `  ${y}┌──┐${r}  ${c}╔═══╗${r}  ${y}┌──┐${r}`,
      `  ${y}│▓▓│${c}══╣ ${g}◉${c} ╠══${y}│▓▓│${r}`,
      `  ${y}└──┘${r}  ${c}╚═╤═╝${r}  ${y}└──┘${r}`,
    ],
  ];
  process.stdout.write("\n");
  for (let i = 0; i < frames.length; i++) {
    if (i > 0) process.stdout.write("\x1b[3A\r");
    process.stdout.write(frames[i].join("\n") + "\n");
    await sleep(160);
  }
  // twinkle pass
  const stars = [
    `        ${gr}·${r} ${gr}·${r}   ${gr}·${r}`,
    `       ${gr}·  ${r}${c}∴${r}${gr}   ·${r}`,
  ];
  const starsOff = [
    `        ${gr} ${r} ${gr}·${r}   ${gr} ${r}`,
    `       ${gr}·  ${r}${gr}·${r}${gr}   ·${r}`,
  ];
  for (let k = 0; k < 3; k++) {
    process.stdout.write((k % 2 === 0 ? stars : starsOff).join("\n") + "\n");
    await sleep(120);
    process.stdout.write("\x1b[2A\r");
  }
  process.stdout.write(stars.join("\n") + "\n");
}

function printBanner(port: number, info: { databaseUrl: string; redisUrl: string; cortices: number }): void {
  const mode = isProd ? "production" : "development";
  const c = C.cyan, g = C.green, gr = C.gray, b = C.bold, r = C.reset;
  const base = `http://localhost:${port}`;
  const header = [
    ``,
    `  ${b}${c}console-api${r} ${gr}·${r} ${g}ready${r} ${gr}on${r} ${b}${base}${r}`,
  ];
  const cfg = [
    `  ${gr}mode${r}      ${mode}`,
    `  ${gr}postgres${r}  ${info.databaseUrl}`,
    `  ${gr}redis${r}     ${info.redisUrl}`,
    `  ${gr}cortices${r}  ${info.cortices}`,
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
    header.join("\n") + "\n\n" + cfg.join("\n") + "\n\n" + hints.join("\n") + "\n\n",
  );
}

/** Builds + configures a Fastify app with CORS, container, and routes.
 *  Does NOT call listen. */
export async function createApp(): Promise<AppHandle> {
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

  app.addHook("onResponse", (req, reply, done) => {
    const url = req.url.split("?")[0];
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

  const container = buildContainer(app.log);
  registerAllRoutes(app, container.services);
  return {
    app,
    info: container.info,
    close: async () => {
      await app.close();
      await container.close();
    },
  };
}

export async function startServer(
  port: number = Number(process.env.PORT ?? 4000),
): Promise<ServerHandle> {
  if (!Number.isFinite(port) || port < 0) {
    throw new Error(`startServer: invalid port ${port}`);
  }
  await animateSatellite();
  const { app, close, info } = await createApp();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  printBanner(boundPort, info);
  return { app, port: boundPort, close, info };
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
