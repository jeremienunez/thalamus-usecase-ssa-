export interface SpendEntry {
  at: number;
  usd: number;
  cycles: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30 * DAY_MS;

export class SpendLedger {
  private entries: SpendEntry[] = [];

  record(usd: number, cycles = 0, now: number = Date.now()): void {
    this.entries.push({ at: now, usd, cycles });
    const since = now - MONTH_MS;
    if (this.entries[0]?.at < since) {
      this.entries = this.entries.filter((entry) => entry.at >= since);
    }
  }

  dailyUsd(now: number = Date.now()): number {
    const since = now - DAY_MS;
    let total = 0;
    for (const entry of this.entries) {
      if (entry.at >= since) total += entry.usd;
    }
    return total;
  }

  monthlyUsd(now: number = Date.now()): number {
    const since = now - MONTH_MS;
    let total = 0;
    for (const entry of this.entries) {
      if (entry.at >= since) total += entry.usd;
    }
    return total;
  }

  cyclesInDay(now: number = Date.now()): number {
    const since = now - DAY_MS;
    let total = 0;
    for (const entry of this.entries) {
      if (entry.at >= since) total += entry.cycles;
    }
    return total;
  }

  reset(): void {
    this.entries = [];
  }
}
