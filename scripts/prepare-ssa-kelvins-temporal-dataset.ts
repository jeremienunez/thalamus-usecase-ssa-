#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  limitKelvinsRowsToCompleteEvents,
  loadKelvinsRowsFromCsv,
  prepareKelvinsTemporalDataset,
  type KelvinsTemporalSplitName,
  type KelvinsTemporalSplitRatios,
} from "../apps/console-api/src/agent/ssa/temporal/kelvins-temporal-eval";

const DEFAULT_ZIP_PATH =
  "data/evals/ssa/esa-kelvins/Collision Avoidance Challenge - Dataset.zip";
const DEFAULT_INNER_PATH =
  "Collision Avoidance Challenge - Dataset/kelvins_competition_data/test_data.csv";
const DEFAULT_OUT_DIR = "data/evals/derived/ssa-kelvins-temporal";
const SPLITS: KelvinsTemporalSplitName[] = ["train", "validation", "test"];

interface CliOptions {
  csv?: string;
  zip: string;
  inner: string;
  outDir: string;
  limitEvents?: number;
  highRiskThresholdLog10: number;
  minLeadTimeDays: number;
  eventGapDays: number;
  splitSeed: string;
  splitRatios: KelvinsTemporalSplitRatios;
  generatedAt: string;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const source = loadCsv(options);
  const allRows = loadKelvinsRowsFromCsv(source.csv);
  const rows =
    options.limitEvents == null
      ? allRows
      : limitKelvinsRowsToCompleteEvents(allRows, options.limitEvents);
  const dataset = prepareKelvinsTemporalDataset(rows, {
    highRiskThresholdLog10: options.highRiskThresholdLog10,
    minLeadTimeDays: options.minLeadTimeDays,
    eventGapMs: options.eventGapDays * 86_400_000,
    splitSeed: options.splitSeed,
    splitRatios: options.splitRatios,
    generatedAt: options.generatedAt,
    projectionRunId: "ssa-kelvins-temporal-dataset",
    sourceArtifactHash: source.sourceArtifactHash,
    sourceArtifactDescription: source.sourceArtifactDescription,
    evalCommand: buildEvalCommand(),
    gitCommit: readGitCommit(),
    sampleEventLimit: options.limitEvents,
  });

  const outDir = resolve(process.cwd(), options.outDir);
  mkdirSync(outDir, { recursive: true });
  writeJson(join(outDir, "manifest.json"), dataset.manifest);
  writeJson(join(outDir, "splits.json"), dataset.splits);

  for (const split of SPLITS) {
    writeJsonl(
      join(outDir, `${split}.events.jsonl`),
      dataset.precursorEventsBySplit[split],
    );
    writeJsonl(
      join(outDir, `${split}.outcomes.jsonl`),
      dataset.outcomesBySplit[split],
    );
  }

  console.log(
    JSON.stringify(
      {
        outDir,
        rowCount: dataset.manifest.rowCount,
        eventIdCount: dataset.manifest.eventIdCount,
        temporalEventCount: dataset.manifest.temporalEventCount,
        outcomeCounts: dataset.manifest.outcomeCounts,
        splitCounts: dataset.manifest.splitCounts,
        inputHash: dataset.manifest.inputHash,
        sourceArtifactHash: dataset.manifest.sourceArtifactHash,
        sourceArtifactDescription: dataset.manifest.sourceArtifactDescription,
        evalCommand: dataset.manifest.evalCommand,
        gitCommit: dataset.manifest.gitCommit,
        splitLock: dataset.manifest.splitLock,
        evaluationWarnings: dataset.manifest.evaluationWarnings,
      },
      null,
      2,
    ),
  );
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {
    zip: DEFAULT_ZIP_PATH,
    inner: DEFAULT_INNER_PATH,
    outDir: DEFAULT_OUT_DIR,
    highRiskThresholdLog10: -6,
    minLeadTimeDays: 0,
    eventGapDays: 30,
    splitSeed: "temporal-kelvins-v0.1.0",
    splitRatios: { train: 0.6, validation: 0.2, test: 0.2 },
    generatedAt: new Date().toISOString(),
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
    } else if (arg === "--out-dir" && value) {
      options.outDir = value;
      index += 1;
    } else if (arg === "--limit-rows") {
      throw new Error(
        "--limit-rows was removed because it can truncate event histories; use --limit-events instead.",
      );
    } else if (arg === "--limit-events" && value) {
      options.limitEvents = positiveInt(value, "--limit-events");
      index += 1;
    } else if (arg === "--high-risk-threshold" && value) {
      options.highRiskThresholdLog10 = finiteNumber(
        value,
        "--high-risk-threshold",
      );
      index += 1;
    } else if (arg === "--min-lead-days" && value) {
      options.minLeadTimeDays = finiteNumber(value, "--min-lead-days");
      index += 1;
    } else if (arg === "--event-gap-days" && value) {
      options.eventGapDays = finiteNumber(value, "--event-gap-days");
      index += 1;
    } else if (arg === "--split-seed" && value) {
      options.splitSeed = value;
      index += 1;
    } else if (arg === "--split-ratios" && value) {
      options.splitRatios = parseSplitRatios(value);
      index += 1;
    } else if (arg === "--generated-at" && value) {
      options.generatedAt = value;
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

function loadCsv(options: CliOptions): {
  csv: string;
  sourceArtifactHash: string;
  sourceArtifactDescription: string;
} {
  if (options.csv) {
    const csvPath = resolve(process.cwd(), options.csv);
    if (!existsSync(csvPath)) throw new Error(`CSV not found: ${csvPath}`);
    const csv = readFileSync(csvPath, "utf8");
    return {
      csv,
      sourceArtifactHash: sha256(csv),
      sourceArtifactDescription: `csv:${csvPath}`,
    };
  }

  const zipPath = resolve(process.cwd(), options.zip);
  if (!existsSync(zipPath)) throw new Error(`Zip not found: ${zipPath}`);
  const csv = execFileSync("unzip", ["-p", zipPath, options.inner], {
    encoding: "utf8",
    maxBuffer: 512 * 1024 * 1024,
  });
  return {
    csv,
    sourceArtifactHash: sha256(csv),
    sourceArtifactDescription: `zip:${zipPath}::${options.inner}`,
  };
}

function buildEvalCommand(): string {
  return process.argv.map((arg) => JSON.stringify(arg)).join(" ");
}

function readGitCommit(): string {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "unknown";
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeJsonl(path: string, values: unknown[]): void {
  const text = values.map((value) => JSON.stringify(value)).join("\n");
  writeFileSync(path, text.length > 0 ? `${text}\n` : "", "utf8");
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

function parseSplitRatios(value: string): KelvinsTemporalSplitRatios {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 3 || parts.some((part) => !Number.isFinite(part))) {
    throw new Error("--split-ratios must use train,validation,test numbers");
  }
  return {
    train: parts[0]!,
    validation: parts[1]!,
    test: parts[2]!,
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm evals:prepare:temporal:ssa [options]

Options:
  --csv <path>                    Read an extracted Kelvins CSV.
  --zip <path>                    Read a CSV from the Kelvins dataset zip.
  --inner <path>                  Inner CSV path inside the zip.
  --out-dir <path>                Artifact directory, default ${DEFAULT_OUT_DIR}.
  --limit-events <n>              Limit complete event_id groups for smoke runs.
  --high-risk-threshold <log10>   Final-risk threshold, default -6.
  --min-lead-days <n>             Minimum lead time before final CDM, default 0.
  --event-gap-days <n>            Synthetic gap between event_ids, default 30.
  --split-seed <seed>             Stable event_id split seed.
  --split-ratios <a,b,c>          Train,validation,test ratios, default 0.6,0.2,0.2.
  --generated-at <iso>            Freeze manifest timestamp for reproducibility.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
