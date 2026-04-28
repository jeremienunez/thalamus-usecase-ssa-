#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadKelvinsRowsFromCsv,
  runKelvinsTemporalEvaluation,
} from "../apps/console-api/src/agent/ssa/temporal/kelvins-temporal-eval";
import type { STDPParams } from "@interview/temporal";

const DEFAULT_ZIP_PATH =
  "data/evals/ssa/esa-kelvins/Collision Avoidance Challenge - Dataset.zip";
const DEFAULT_INNER_PATH =
  "Collision Avoidance Challenge - Dataset/kelvins_competition_data/test_data.csv";

const DEFAULT_PARAMS: STDPParams = {
  pattern_window_ms: 5 * 86_400_000,
  pre_trace_decay_ms: 3 * 86_400_000,
  learning_rate: 0.1,
  activation_threshold: 0.01,
  min_support: 5,
  max_steps: 3,
  pattern_version: "temporal-kelvins-v0.1.0",
};

interface CliOptions {
  csv?: string;
  zip: string;
  inner: string;
  limitRows?: number;
  highRiskThresholdLog10: number;
  topK: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const csv = loadCsv(options);
  const rows = loadKelvinsRowsFromCsv(csv).slice(0, options.limitRows);
  const report = runKelvinsTemporalEvaluation(rows, {
    params: DEFAULT_PARAMS,
    targetOutcome: "high_risk",
    highRiskThresholdLog10: options.highRiskThresholdLog10,
    topK: options.topK,
  });

  console.log(JSON.stringify(report, null, 2));
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    zip: DEFAULT_ZIP_PATH,
    inner: DEFAULT_INNER_PATH,
    highRiskThresholdLog10: -5,
    topK: 10,
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;
    const value = args[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--csv" && value) {
      options.csv = value;
      index += 1;
    } else if (arg === "--zip" && value) {
      options.zip = value;
      index += 1;
    } else if (arg === "--inner" && value) {
      options.inner = value;
      index += 1;
    } else if (arg === "--limit-rows" && value) {
      options.limitRows = positiveInt(value, "--limit-rows");
      index += 1;
    } else if (arg === "--high-risk-threshold" && value) {
      options.highRiskThresholdLog10 = finiteNumber(value, "--high-risk-threshold");
      index += 1;
    } else if (arg === "--top-k" && value) {
      options.topK = positiveInt(value, "--top-k");
      index += 1;
    } else if (arg === "--help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  return options;
}

function loadCsv(options: CliOptions): string {
  if (options.csv) {
    const csvPath = resolve(process.cwd(), options.csv);
    if (!existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
    return readFileSync(csvPath, "utf8");
  }

  const zipPath = resolve(process.cwd(), options.zip);
  if (!existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
  return execFileSync("unzip", ["-p", zipPath, options.inner], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
}

function positiveInt(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function finiteNumber(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be numeric`);
  }
  return parsed;
}

function printHelp(): void {
  console.log(`Usage: pnpm evals:temporal:ssa [options]

Options:
  --csv <path>                    Read an extracted Kelvins CSV.
  --zip <path>                    Read a CSV from the Kelvins dataset zip.
  --inner <path>                  Inner CSV path inside the zip.
  --limit-rows <n>                Limit rows before projection.
  --high-risk-threshold <log10>   Final-risk threshold, default -5.
  --top-k <n>                     Number of top THL/baseline patterns, default 10.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
