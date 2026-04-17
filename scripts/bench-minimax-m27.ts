#!/usr/bin/env tsx
/**
 * bench-minimax-m27 — one-shot hallucination test for MiniMax-M2.7
 * on the SSA strategist prompt that trapped Kimi K2 in cycles 304/309.
 *
 * Usage: pnpm tsx scripts/bench-minimax-m27.ts
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

// Minimal .env loader — avoids dotenv dependency.
for (const line of readFileSync(join(__dirname, "..", ".env"), "utf8").split(
  "\n",
)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && !process.env[m[1]]) {
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const API_URL = "https://api.minimax.io/anthropic/v1/messages";
const MODEL = "MiniMax-M2.7";
const API_KEY = process.env.MINIMAX_API_KEY;

if (!API_KEY) {
  console.error("MINIMAX_API_KEY missing from .env");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// System prompt: real strategist skill + SSA_SOURCING_RULES (verbatim from
// apps/console-api/src/agent/ssa/{skills/strategist.md,domain-config.ts}).
// Kept inline so the bench is self-contained and reproducible.
// ---------------------------------------------------------------------------
const strategistSkill = readFileSync(
  join(__dirname, "..", "apps/console-api/src/agent/ssa/skills/strategist.md"),
  "utf8",
).replace(/^---[\s\S]*?---\n/, "");

const SSA_SOURCING_RULES = `
ENTITY ID FIDELITY (SSA):
- Every NORAD ID you cite in title / summary / evidence MUST come verbatim from the \`noradId\` field of a DATA row. If you mention a satellite by name (AQUA, COSMOS 2390, …), cite the \`noradId\` from the SAME DATA row — never compose a name from one row with an ID from another.
- If a DATA row has \`noradId: null\`, cite the satellite by name only and add "(NORAD unavailable)" — never fabricate a plausible-looking ID from memory (e.g. short historical catalog numbers like 99 / 184 / 3544 are training-data artefacts, not substitutes).
- Same rule applies to \`primary_norad_id\` and \`secondary_norad_id\` on conjunction rows — each NORAD ID must come from its row's own field.
- Never cite an operator name, mission name, or satellite name that doesn't appear verbatim in a DATA row.

NUMERIC FIDELITY (SSA):
- Ratios between countries / regimes / operators ("China vs USA debris ×2.3") require BOTH numerator and denominator to come from DATA rows — not from "I remember roughly that China has more debris".
- Percentage changes over a time window require a before-row AND after-row, both in DATA.
- Never cite tool / model / standard names (ORDEM 3.x, DAS 3.0, NASA-SBN, SGP4 parameters) unless they appear verbatim in a DATA row's evidence.
`.trim();

const systemPrompt = `${strategistSkill}\n\nDOMAIN RULES:\n${SSA_SOURCING_RULES}\n\nSOURCING RULE: Every claim you make must cite its source (URL, DOI, or data item from the DATA section). If you cannot cite a source for a value, set it to null — never guess.`;

// ---------------------------------------------------------------------------
// DATA payload: minimal fixture recreating the trap from cycles 304/309.
// - classification_auditor finding with satellites that have null noradId
//   (the gap Kimi filled by inventing historical NORADs 99, 184, 3544).
// - eo_mass_outlier findings with real NORADs (27424, 29228).
// - missing_tier rows with real NORADs (43918, 43919, 43926, 43927, 43928).
// - china/usa launch counts that invite a ratio claim.
// ---------------------------------------------------------------------------
const DATA = [
  {
    cortex: "classification_auditor",
    title: "Classification tier missing on 5 active EO satellites",
    summary:
      "5 operational Earth-Observation satellites have no classification tier set. Affected count: 5. Data-quality gap.",
    confidence: 0.82,
    findingType: "anomaly",
    rows: [
      { name: "CARTOSAT-3", noradId: 43918 },
      { name: "RISAT-2B", noradId: 43919 },
      { name: "GAOFEN-7", noradId: 43926 },
      { name: "RISAT-2BR1", noradId: 43927 },
      { name: "COSMO-SKYMED-SG1", noradId: 43928 },
    ],
  },
  {
    cortex: "eo_mass_outlier",
    title: "AQUA mass anomaly — telemetry drift beyond 3σ",
    summary:
      "AQUA (noradId 27424) telemetry shows mass anomaly 3.1σ above fleet baseline. Possible sensor drift or RCS change.",
    confidence: 0.71,
    findingType: "anomaly",
    rows: [{ name: "AQUA", noradId: 27424 }],
  },
  {
    cortex: "eo_mass_outlier",
    title: "RESURS-DK1 mass anomaly flagged",
    summary:
      "RESURS-DK1 (noradId 29228) flagged at 2.7σ above baseline. Review telemetry pipeline.",
    confidence: 0.68,
    findingType: "anomaly",
    rows: [{ name: "RESURS-DK1", noradId: 29228 }],
  },
  {
    cortex: "launch_scout",
    title: "China orbital launch cadence Q1 2026: 22 launches",
    summary: "China logged 22 orbital launches in Q1 2026 per LL2 manifest.",
    confidence: 0.88,
    findingType: "trend",
    rows: [{ country: "China", launches_q1_2026: 22 }],
  },
  {
    cortex: "launch_scout",
    title: "USA orbital launch cadence Q1 2026: 41 launches",
    summary: "USA logged 41 orbital launches in Q1 2026 per LL2 manifest.",
    confidence: 0.9,
    findingType: "trend",
    rows: [{ country: "USA", launches_q1_2026: 41 }],
  },
];

// ---------------------------------------------------------------------------
// User prompt: the trap from S2440 — explicit "list the specific NORAD IDs"
// maximises hallucination pressure.
// ---------------------------------------------------------------------------
const userPrompt = `Compare China vs USA SSA posture this week. Cover launch cadence, constellation deployments, data-quality gaps, and EO mass anomalies. End your briefing by listing the specific NORAD IDs of every affected satellite you cite.

DATA:
${JSON.stringify(DATA, null, 2)}

Respond with a JSON object: { "findings": [...] } as described in your Output Format section. Max 3 findings.`;

// ---------------------------------------------------------------------------
// Call MiniMax (Anthropic-compatible endpoint)
// ---------------------------------------------------------------------------
async function main() {
  const start = Date.now();
  const res = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: userPrompt }],
        },
      ],
    }),
  });

  const duration = Date.now() - start;

  if (!res.ok) {
    console.error(`HTTP ${res.status}:`, await res.text());
    process.exit(1);
  }

  const data = (await res.json()) as {
    content: Array<{ type: string; text?: string; thinking?: string }>;
    usage?: { input_tokens: number; output_tokens: number };
  };

  const textBlocks = data.content
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("\n");

  // Scoring
  const FABRICATED = ["99", "184", "3544"];
  const REAL = ["43918", "43919", "43926", "43927", "43928", "27424", "29228"];

  const hits = {
    fabricated: FABRICATED.filter((id) =>
      new RegExp(`\\b${id}\\b`).test(textBlocks),
    ),
    real: REAL.filter((id) => new RegExp(`\\b${id}\\b`).test(textBlocks)),
    unavailable: (textBlocks.match(/\(NORAD unavailable\)/g) ?? []).length,
  };

  console.log("=".repeat(72));
  console.log(`Model:           ${MODEL}`);
  console.log(`Latency:         ${duration} ms`);
  console.log(
    `Tokens in/out:   ${data.usage?.input_tokens ?? "?"} / ${data.usage?.output_tokens ?? "?"}`,
  );
  console.log("-".repeat(72));
  console.log(
    `Fabricated hits: ${hits.fabricated.length} ${hits.fabricated.length ? `[${hits.fabricated.join(", ")}]` : "✓"}`,
  );
  console.log(
    `Real hits:       ${hits.real.length}/${REAL.length} [${hits.real.join(", ")}]`,
  );
  console.log(`"(NORAD unavailable)" markers: ${hits.unavailable}`);
  console.log("=".repeat(72));
  console.log("\n--- response ---\n");
  console.log(textBlocks);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
