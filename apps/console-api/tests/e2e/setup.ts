/**
 * Vitest global setup for console-api integration tests.
 *
 * Boots the real Fastify app on an ephemeral port and exposes the URL via
 * `CONSOLE_API_URL` so every spec's `fetch(${BASE}/...)` hits a live instance.
 * No external `pnpm dev` required.
 */
import { startServer } from "../../src/server";

let handle: Awaited<ReturnType<typeof startServer>> | undefined;

export async function setup(): Promise<void> {
  handle = await startServer(0); // port 0 → OS-assigned ephemeral port
  process.env.CONSOLE_API_URL = `http://127.0.0.1:${handle.port}`;
}

export async function teardown(): Promise<void> {
  if (handle) await handle.close();
}
