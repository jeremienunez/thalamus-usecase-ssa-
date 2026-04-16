/**
 * console-api — thin Fastify layer over the live Postgres + Redis stack.
 *
 * Every endpoint is backed by real data. This file only wires Fastify +
 * container + routes + CORS; business logic lives in services/, SQL in
 * repositories/, HTTP glue in controllers/ + routes/.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import { buildContainer } from "./container";
import { registerAllRoutes } from "./routes";

const app = Fastify({ logger: { level: "info" } });
const container = buildContainer(app.log);
app.log.info(container.info, "backend containers booted");
registerAllRoutes(app, container.services);

let corsRegistered = false;
async function ensureCors(): Promise<void> {
  if (corsRegistered) return;
  await app.register(cors, { origin: true });
  corsRegistered = true;
}

export { app };

export async function startServer(
  port: number = Number(process.env.PORT ?? 4000),
): Promise<{ app: typeof app; port: number; close: () => Promise<void> }> {
  await ensureCors();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  app.log.info(`console-api listening on :${boundPort}`);
  return {
    app,
    port: boundPort,
    close: async () => {
      await app.close();
      await container.close();
    },
  };
}

async function main(): Promise<void> {
  await startServer();
}

const isVitest =
  process.env.VITEST === "true" || process.env.NODE_ENV === "test";
if (!isVitest) {
  main().catch((err) => {
    app.log.error(
      { err: err instanceof Error ? err.message : String(err) },
      "boot failed",
    );
    process.exit(1);
  });
}
