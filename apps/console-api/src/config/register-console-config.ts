import { z } from "zod";
import {
  type RuntimeConfigRegistrar,
  AUTONOMY_ACTION_CHOICES,
  DEFAULT_CONSOLE_AUTONOMY_CONFIG,
} from "@interview/shared/config";

const rotationChoices = AUTONOMY_ACTION_CHOICES as [string, ...string[]];
const rotationSchema = z.array(z.enum(rotationChoices)).max(16);

export function registerConsoleConfigDomains(
  r: RuntimeConfigRegistrar,
): void {
  r.registerDomain("console.autonomy", {
    defaults: DEFAULT_CONSOLE_AUTONOMY_CONFIG,
    schema: {
      intervalSec: "number",
      rotation: "string[]",
      dailyBudgetUsd: "number",
      monthlyBudgetUsd: "number",
      maxThalamusCyclesPerDay: "number",
      stopOnBudgetExhausted: "boolean",
    },
    validate: (merged) => {
      z.number().int().min(15).max(600).parse(merged.intervalSec);
      rotationSchema.parse(merged.rotation);
      z.number().min(0).max(1_000).parse(merged.dailyBudgetUsd);
      z.number().min(0).max(10_000).parse(merged.monthlyBudgetUsd);
      z.number().int().min(0).max(10_000).parse(merged.maxThalamusCyclesPerDay);
    },
  });
}
