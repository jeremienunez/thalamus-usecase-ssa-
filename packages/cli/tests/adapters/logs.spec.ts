import { describe, it, expect, vi, afterEach } from "vitest";
import { PinoRingBuffer } from "../../src/util/pinoRingBuffer";
import { LogsAdapter } from "../../src/adapters/logs";

describe("LogsAdapter", () => {
  afterEach(() => vi.useRealTimers());

  it("filters by level, service, and sinceMs", () => {
    vi.useFakeTimers();
    const now = 1_700_000_000_000;
    vi.setSystemTime(now);
    const ring = new PinoRingBuffer(10);
    ring.push({ time: now - 10_000, level: 30, service: "api", msg: "old info" });
    ring.push({ time: now - 1_000, level: 20, service: "api", msg: "recent debug" });
    ring.push({ time: now - 500, level: 40, service: "api", msg: "recent warn" });
    ring.push({ time: now - 500, level: 40, service: "worker", msg: "warn worker" });

    const adapter = new LogsAdapter(ring);
    const out = adapter.tail({ level: "warn", service: "api", sinceMs: 5_000 });
    expect(out).toHaveLength(1);
    expect(out[0].msg).toBe("recent warn");
  });
});
