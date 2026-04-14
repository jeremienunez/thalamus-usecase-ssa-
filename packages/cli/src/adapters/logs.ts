import type { PinoRingBuffer, LogEvent } from "../util/pinoRingBuffer";

const LEVEL_MAP = { debug: 20, info: 30, warn: 40, error: 50 } as const;

export class LogsAdapter {
  constructor(private readonly ring: PinoRingBuffer) {}
  tail(q: {
    level?: keyof typeof LEVEL_MAP;
    service?: string;
    sinceMs?: number;
  }): LogEvent[] {
    const min = q.level ? LEVEL_MAP[q.level] : 0;
    const cutoff = q.sinceMs ? Date.now() - q.sinceMs : 0;
    return this.ring.snapshot().filter(
      (e) =>
        e.level >= min &&
        (!q.service || e.service === q.service) &&
        e.time >= cutoff,
    );
  }
}
