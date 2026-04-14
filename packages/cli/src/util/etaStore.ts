import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const MAX_WINDOW = 20;
const MIN_SAMPLES = 3;

type Key = `${string}:${string}`;
interface Persisted {
  [key: string]: number[];
}

export type Estimate =
  | { status: "estimating" }
  | { status: "estimating-soon"; samples: number }
  | { status: "known"; p50Ms: number; p95Ms: number; samples: number };

export class EtaStore {
  private readonly data: Map<Key, number[]> = new Map();
  constructor(private readonly path: string) {
    if (existsSync(path)) {
      const raw = JSON.parse(readFileSync(path, "utf8")) as Persisted;
      for (const [k, v] of Object.entries(raw)) this.data.set(k as Key, v);
    }
  }
  record(kind: string, subject: string, durationMs: number): void {
    const key: Key = `${kind}:${subject}`;
    const arr = this.data.get(key) ?? [];
    arr.push(durationMs);
    if (arr.length > MAX_WINDOW) arr.shift();
    this.data.set(key, arr);
  }
  estimate(kind: string, subject: string): Estimate {
    const arr = this.data.get(`${kind}:${subject}`);
    if (!arr || arr.length === 0) return { status: "estimating" };
    if (arr.length < MIN_SAMPLES) return { status: "estimating-soon", samples: arr.length };
    const sorted = [...arr].sort((a, b) => a - b);
    const p = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return { status: "known", p50Ms: p(0.5), p95Ms: p(0.95), samples: arr.length };
  }
  flush(): void {
    mkdirSync(dirname(this.path), { recursive: true });
    writeFileSync(this.path, JSON.stringify(Object.fromEntries(this.data)));
  }
}
