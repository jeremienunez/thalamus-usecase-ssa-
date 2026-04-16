import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { RouterPlanSchema, type RouterPlan } from "./schema";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = resolve(
  __dirname,
  "../../../../apps/console-api/src/agent/ssa/skills/interpreter.md",
);

export interface NanoCaller {
  call: (args: { system: string; user: string; temperature: number; responseFormat: "json" })
    => Promise<{ content: string; costUsd: number }>;
}

export interface InterpretInput {
  input: string;
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  availableEntityIds: string[];
}

export async function interpret(
  input: InterpretInput,
  nano: NanoCaller,
): Promise<{ plan: RouterPlan; costUsd: number }> {
  const system = readFileSync(SKILL_PATH, "utf8");
  const user = JSON.stringify({
    input: input.input,
    recentTurns: input.recentTurns.slice(-10),
    availableEntityIds: input.availableEntityIds.slice(0, 100),
  });
  const res = await nano.call({ system, user, temperature: 0, responseFormat: "json" });
  const parsed = JSON.parse(res.content);
  const plan = RouterPlanSchema.parse(parsed);
  return { plan, costUsd: res.costUsd };
}
