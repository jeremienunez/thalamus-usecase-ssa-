/**
 * console-api — thin Fastify layer over the live Postgres + Redis stack.
 *
 * This module has zero import-time side effects. Use createApp() to get a
 * configured Fastify instance without listening, or startServer() to boot
 * on a port. Both return a `close()` that tears down the DB + Redis pool.
 */
import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { buildContainer } from "./container";
import { registerAllRoutes } from "./routes";

export type AppHandle = {
  app: FastifyInstance;
  close: () => Promise<void>;
};

export type ServerHandle = AppHandle & { port: number };

/** Builds + configures a Fastify app with CORS, container, and routes.
 *  Does NOT call listen. */
export async function createApp(): Promise<AppHandle> {
  const app = Fastify({ logger: { level: "info" } });
  await app.register(cors, { origin: true });
  const container = buildContainer(app.log);
  app.log.info(container.info, "backend containers booted");
  registerAllRoutes(app, container.services);
  return {
    app,
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
  const { app, close } = await createApp();
  const address = await app.listen({ port, host: "0.0.0.0" });
  const boundPort = (() => {
    const m = address.match(/:(\d+)$/);
    return m ? Number(m[1]) : port;
  })();
  app.log.info(`console-api listening on :${boundPort}`);
  return { app, port: boundPort, close };
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
