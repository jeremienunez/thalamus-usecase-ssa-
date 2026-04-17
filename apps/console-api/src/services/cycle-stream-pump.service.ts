// apps/console-api/src/services/cycle-stream-pump.service.ts
//
// Queue/waker pump that interleaves step events emitted inside a running
// cycle with the single terminal cycle result. The caller runs `runCycle`
// through the `pump.pump(run)` generator: every `stepLog()` triggered
// inside the AsyncLocalStorage scope pushes a `StepData` into the pending
// queue and wakes the generator, which yields it. When the run settles,
// the generator returns `{ result, err }` so the caller can decide the
// next event (findings+summary on success, error on failure).
import { stepContextStore } from "@interview/shared";
import type { ReplStreamEvent } from "@interview/shared";

type StepData = Extract<ReplStreamEvent, { event: "step" }>["data"];

export class CycleStreamPump {
  async *pump<T>(
    run: () => Promise<T>,
  ): AsyncGenerator<StepData, { result: T | null; err: Error | null }, void> {
    const pending: StepData[] = [];
    let waiter: (() => void) | null = null;
    const wake = (): void => {
      const w = waiter;
      waiter = null;
      if (w) w();
    };

    const t1 = Date.now();
    const onStep = (
      e: { step: string; phase: string; terminal: string } & Record<
        string,
        unknown
      >,
    ): void => {
      pending.push({
        step: e.step as StepData["step"],
        phase: e.phase as StepData["phase"],
        terminal: e.terminal,
        elapsedMs: Date.now() - t1,
        extra: e,
      });
      wake();
    };

    let done = false;
    let result: T | null = null;
    let err: Error | null = null;

    const p = stepContextStore
      .run({ onStep }, run)
      .then((r) => {
        result = r;
      })
      .catch((e: unknown) => {
        err = e instanceof Error ? e : new Error(String(e));
      })
      .finally(() => {
        done = true;
        wake();
      });

    while (!done || pending.length > 0) {
      if (pending.length > 0) {
        yield pending.shift()!;
        continue;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        waiter = resolve;
      });
    }
    await p;

    return { result, err };
  }
}
