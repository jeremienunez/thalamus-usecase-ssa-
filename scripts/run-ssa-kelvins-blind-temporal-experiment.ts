#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  limitKelvinsRowsToCompleteEvents,
  loadKelvinsRowsFromCsv,
  runKelvinsBlindTemporalExperiment,
} from "../apps/console-api/src/agent/ssa/temporal/kelvins-temporal-eval";
import { createConsoleEtaReporter } from "./eval-telemetry";
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
  pattern_version: "temporal-kelvins-blind-v0.1.0",
};

interface CliOptions {
  csv?: string;
  zip: string;
  inner: string;
  limitEvents?: number;
  highRiskThresholdLog10: number;
  riskEscalationDeltaLog10: number;
  targetOutcome: "high_risk" | "risk_escalation";
  minLeadTimeDays: number;
  maxCandidatePatterns: number;
  experimentVariant: "default" | "risk_features_removed" | "physics_only";
  generatedAt: string;
  progress: boolean;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const source = loadCsv(options);
  const allRows = loadKelvinsRowsFromCsv(source.csv);
  const rows =
    options.limitEvents == null
      ? allRows
      : limitKelvinsRowsToCompleteEvents(allRows, options.limitEvents);
  const report = runKelvinsBlindTemporalExperiment(rows, {
    params: DEFAULT_PARAMS,
    targetOutcome: options.targetOutcome,
    highRiskThresholdLog10: options.highRiskThresholdLog10,
    riskEscalationDeltaLog10: options.riskEscalationDeltaLog10,
    minLeadTimeDays: options.minLeadTimeDays,
    maxCandidatePatterns: options.maxCandidatePatterns,
    experimentVariant: options.experimentVariant,
    generatedAt: options.generatedAt,
    progress: createConsoleEtaReporter({ enabled: options.progress }),
    sourceArtifactHash: source.sourceArtifactHash,
    sourceArtifactDescription: source.sourceArtifactDescription,
    evalCommand: buildEvalCommand(),
    gitCommit: readGitCommit(),
    sampleEventLimit: options.limitEvents,
  });

  console.log(
    JSON.stringify(
      {
        dataset: report.dataset,
        targetOutcome: report.targetOutcome,
        popperManifest: report.popperManifest,
        blindPolicy: report.blindPolicy,
        splitPolicy: report.splitPolicy,
        rowCount: report.manifest.rowCount,
        eventIdCount: report.manifest.eventIdCount,
        inputHash: report.manifest.inputHash,
        sourceArtifactHash: report.manifest.sourceArtifactHash,
        sourceArtifactDescription: report.manifest.sourceArtifactDescription,
        evalCommand: report.manifest.evalCommand,
        gitCommit: report.manifest.gitCommit,
        splitLock: report.manifest.splitLock,
        evaluationWarnings: report.manifest.evaluationWarnings,
        outcomeCounts: report.manifest.outcomeCounts,
        splitCounts: report.manifest.splitCounts,
        trainPatternCount: report.trainPatternCount,
        candidatePatternCount: report.candidatePatternCount,
        selectedPatternCount: report.selectedPatternCount,
        selectedPatternScoreThreshold: report.selectedPatternScoreThreshold,
        validationMetrics: report.validationMetrics,
        testMetrics: report.testMetrics,
        baselineReports: report.baselineReports.map((baseline) => ({
          name: baseline.name,
          validationMetrics: baseline.validationMetrics,
          testMetrics: baseline.testMetrics,
          selectedScoreThreshold: baseline.selectedScoreThreshold,
          selectedEventSignatures: baseline.selectedEventSignatures?.slice(0, 10),
          selectedEpisodeSignatures: baseline.selectedEpisodeSignatures?.slice(
            0,
            10,
          ),
          selectedPatternIds: baseline.selectedPatternIds?.slice(0, 10),
        })),
        popperVerdict: report.popperVerdict,
        selectedPatterns: report.selectedPatterns.slice(0, 10).map((pattern) => ({
          patternId: pattern.pattern_id,
          score: pattern.pattern_score,
          support: pattern.support_count,
          negativeSupport: pattern.negative_support_count,
          patternRate: pattern.pattern_rate,
          lift: pattern.lift,
          bestComponentSignature: pattern.best_component_signature,
          bestComponentRate: pattern.best_component_rate,
          sequenceLiftOverBestComponent:
            pattern.sequence_lift_over_best_component,
          leadTimeMsAvg: pattern.lead_time_ms_avg,
          leadTimeMsP50: pattern.lead_time_ms_p50,
          leadTimeMsP95: pattern.lead_time_ms_p95,
          temporalOrderQuality: pattern.temporal_order_quality,
          containsTargetProxy: pattern.contains_target_proxy,
          containsSingletonOnly: pattern.contains_singleton_only,
          sequence: pattern.sequence.map((step) => step.event_signature),
        })),
        hypothesisOnly: report.hypothesisOnly,
        kgWriteAttempted: report.kgWriteAttempted,
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
    highRiskThresholdLog10: -6,
    riskEscalationDeltaLog10: 1,
    targetOutcome: "high_risk",
    minLeadTimeDays: 0,
    maxCandidatePatterns: 50,
    experimentVariant: "default",
    generatedAt: new Date().toISOString(),
    progress: true,
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
    } else if (arg === "--risk-escalation-delta" && value) {
      options.riskEscalationDeltaLog10 = finiteNumber(
        value,
        "--risk-escalation-delta",
      );
      index += 1;
    } else if (arg === "--target-outcome" && value) {
      if (!["high_risk", "risk_escalation"].includes(value)) {
        throw new Error("--target-outcome must be high_risk or risk_escalation");
      }
      options.targetOutcome = value as CliOptions["targetOutcome"];
      index += 1;
    } else if (arg === "--min-lead-days" && value) {
      options.minLeadTimeDays = finiteNumber(value, "--min-lead-days");
      index += 1;
    } else if (arg === "--max-candidate-patterns" && value) {
      options.maxCandidatePatterns = positiveInt(
        value,
        "--max-candidate-patterns",
      );
      index += 1;
    } else if (arg === "--experiment" && value) {
      if (!["default", "risk_features_removed", "physics_only"].includes(value)) {
        throw new Error(
          "--experiment must be default, risk_features_removed, or physics_only",
        );
      }
      options.experimentVariant = value as CliOptions["experimentVariant"];
      index += 1;
    } else if (arg === "--generated-at" && value) {
      options.generatedAt = value;
      index += 1;
    } else if (arg === "--no-progress") {
      options.progress = false;
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
  console.log(`Usage: pnpm evals:temporal:ssa:blind [options]

Options:
  --csv <path>                    Read an extracted Kelvins CSV.
  --zip <path>                    Read a CSV from the Kelvins dataset zip.
  --inner <path>                  Inner CSV path inside the zip.
  --limit-events <n>              Limit complete event_id groups for smoke runs.
  --target-outcome <name>         high_risk or risk_escalation, default high_risk.
  --high-risk-threshold <log10>   Final-risk threshold, default -6.
  --risk-escalation-delta <log10> Initial-to-final risk increase, default 1.
  --min-lead-days <n>             Minimum lead time before final CDM, default 0.
  --max-candidate-patterns <n>    Max train patterns considered by validation, default 50.
  --experiment <name>             default, risk_features_removed, or physics_only.
  --generated-at <iso>            Freeze manifest timestamp for reproducibility.
  --no-progress                   Disable ETA/progress telemetry on stderr.
`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
