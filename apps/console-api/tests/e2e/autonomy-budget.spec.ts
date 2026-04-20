import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BASE = process.env.CONSOLE_API_URL ?? "http://localhost:4000";
const RUN_LLM = !!process.env.RUN_LLM_E2E;

async function patchAutonomy(body: Record<string, unknown>) {
  const res = await fetch(`${BASE}/api/config/runtime/console.autonomy`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
  return res.json();
}

async function resetAutonomy() {
  await fetch(`${BASE}/api/autonomy/stop`, { method: "POST" });
  await fetch(`${BASE}/api/autonomy/reset`, { method: "POST" });
  await fetch(`${BASE}/api/config/runtime/console.autonomy`, { method: "DELETE" });
}

async function readStatus() {
  const res = await fetch(`${BASE}/api/autonomy/status`);
  expect(res.status).toBe(200);
  return res.json();
}

async function waitForStop(reason: string, deadlineMs: number) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const status = await readStatus();
    if (!status.running && status.stoppedReason === reason) return status;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`autonomy did not stop with reason ${reason}`);
}

describe.skipIf(!RUN_LLM)("AutonomyService budget caps (RUN_LLM_E2E=1)", () => {
  beforeEach(async () => {
    await resetAutonomy();
  });

  afterEach(async () => {
    await resetAutonomy();
  });

  it(
    "auto-stops with daily_budget_exhausted once spend crosses the cap",
    async () => {
      await patchAutonomy({
        intervalSec: 15,
        rotation: ["thalamus"],
        dailyBudgetUsd: 0.01,
        stopOnBudgetExhausted: true,
      });

      const startRes = await fetch(`${BASE}/api/autonomy/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(startRes.status).toBe(200);

      const final = await waitForStop("daily_budget_exhausted", 90_000);
      expect(final.running).toBe(false);
      expect(final.dailySpendUsd).toBeGreaterThanOrEqual(0.01);
    },
    120_000,
  );

  it(
    "auto-stops with max_thalamus_cycles_per_day",
    async () => {
      await patchAutonomy({
        intervalSec: 15,
        rotation: ["thalamus"],
        dailyBudgetUsd: 0,
        monthlyBudgetUsd: 0,
        maxThalamusCyclesPerDay: 1,
        stopOnBudgetExhausted: true,
      });

      const startRes = await fetch(`${BASE}/api/autonomy/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(startRes.status).toBe(200);

      const final = await waitForStop("max_thalamus_cycles_per_day", 90_000);
      expect(final.running).toBe(false);
      expect(final.thalamusCyclesToday).toBeGreaterThanOrEqual(1);
    },
    120_000,
  );
});
