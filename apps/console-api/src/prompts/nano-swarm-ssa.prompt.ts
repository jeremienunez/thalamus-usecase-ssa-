// apps/console-api/src/prompts/nano-swarm-ssa.prompt.ts
//
// SSA domain profile for the nano swarm: 50 researcher lenses, keyword
// routing, and the call instructions/input templates. Injected into the
// (agnostic) thalamus package at boot via setNanoSwarmProfile().

import type {
  Lens,
  NanoSwarmProfile,
} from "@interview/thalamus/prompts/nano-swarm.prompt";
import type { ExplorationQuery } from "@interview/thalamus/explorer/scout";

const SSA_LENSES: readonly Lens[] = [
  // 1-5: Replacement cost & procurement intelligence
  {
    id: "cost-prime-contractor",
    lens: "prime contractor bus pricing, ex-factory cost, procurement contracts",
  },
  {
    id: "cost-launch",
    lens: "launch service auction results, ride-share slot pricing, payload-kg estimates",
  },
  {
    id: "cost-insurance",
    lens: "launch insurance premiums, on-orbit coverage rates, underwriter pricing",
  },
  {
    id: "cost-futures",
    lens: "forward launch manifest pricing, campaign pricing, new-build vs refurbished platforms",
  },
  {
    id: "cost-index",
    lens: "SpaceNews index, commercial space indices, transponder rates, market benchmarks",
  },

  // 6-10: Advisory & assessment tracking
  {
    id: "advisory-18scs",
    lens: "18th SDS conjunction data messages, CSpOC advisories, screening thresholds",
  },
  {
    id: "advisory-leolabs",
    lens: "LeoLabs conjunction assessments, top risk events, regime reports",
  },
  {
    id: "advisory-esa",
    lens: "ESA Space Debris Office assessments, DISCOS records, regime evaluation",
  },
  {
    id: "advisory-aerospace",
    lens: "Aerospace Corp CORDS analyses, reentry panels, regional reports",
  },
  {
    id: "advisory-consensus",
    lens: "advisory consensus, aggregate Pc scores, rating comparisons across providers",
  },

  // 11-15: Market intelligence
  {
    id: "market-brycetech",
    lens: "BryceTech market data, top operators, broker sentiment, bid/ask spreads",
  },
  {
    id: "market-volumes",
    lens: "launch cadence, market liquidity, operator demand, transaction data",
  },
  {
    id: "market-trends",
    lens: "market momentum, capacity appreciation, outperforming orbital regimes",
  },
  {
    id: "market-asia",
    lens: "Asian space market, China India Japan demand, import data, operator trends",
  },
  {
    id: "market-us-eu",
    lens: "US EU launch market, provider pricing, euro dollar space trade",
  },

  // 16-20: Orbital regime & launch-year context
  {
    id: "regime-space-weather",
    lens: "space weather conditions, Kp index, geomagnetic storms, SWPC reports",
  },
  {
    id: "regime-yield",
    lens: "orbit insertion success, deployment quantities, anomaly damage reports",
  },
  {
    id: "regime-structure",
    lens: "orbit regime analysis, debris density studies, surveillance surveys, precision tracking",
  },
  {
    id: "regime-sustainable",
    lens: "sustainable operators, IADC certification, space sustainability",
  },
  {
    id: "regime-innovation",
    lens: "platform innovation, technology adoption, station-keeping techniques",
  },

  // 21-25: Investment analysis
  {
    id: "invest-roi",
    lens: "satellite investment returns, ROI analysis, launch-year comparison, performance",
  },
  {
    id: "invest-undervalued",
    lens: "undervalued satellites, value picks, emerging operator countries, sleeper assets",
  },
  {
    id: "invest-portfolio",
    lens: "fleet strategy, diversification, asset allocation, risk",
  },
  {
    id: "invest-forecast",
    lens: "pricing forecast, capacity appreciation, investment outlook 2025 2026",
  },
  {
    id: "invest-fund",
    lens: "space investment funds, managed fleets, collective investment performance",
  },

  // 26-30: News & editorial
  {
    id: "news-press",
    lens: "space press coverage, industry news, trade publications, breaking news",
  },
  {
    id: "news-blog",
    lens: "space blogs, independent analyses, operator opinions, expert columns",
  },
  {
    id: "news-podcast",
    lens: "space podcast transcripts, audio content, expert interviews",
  },
  {
    id: "news-social",
    lens: "space community discussion, social media sentiment, trending topics",
  },
  {
    id: "news-regulation",
    lens: "ITU filings, FCC rules, EU policy, spectrum coordination agreements",
  },

  // 31-35: Operator expertise
  {
    id: "operator-spacex",
    lens: "SpaceX specific: Starlink, Falcon 9, Dragon, constellation phases",
  },
  {
    id: "operator-oneweb",
    lens: "OneWeb / Eutelsat specific: Gen1 fleet, gateway network, polar shells",
  },
  {
    id: "operator-planet",
    lens: "Planet Labs specific: Dove SuperDove, SkySat, Pelican, imaging cadence",
  },
  {
    id: "operator-intelsat",
    lens: "Intelsat / SES specific: GEO fleet, HTS, prestige orbital slots, EOL",
  },
  {
    id: "operator-chinese",
    lens: "Chinese operators: Guowang, Qianfan, Yaogan, Beidou, experimental sats",
  },

  // 36-40: Geo scouts
  {
    id: "geo-leo",
    lens: "LEO regime, sun-sync cru shells, mega-constellations, debris flux",
  },
  {
    id: "geo-meo",
    lens: "MEO regime, navigation shells, Galileo GPS, GLONASS, regime diversity",
  },
  {
    id: "geo-heo",
    lens: "HEO / Molniya orbits, Tundra, early warning, oxidative environment trend",
  },
  {
    id: "geo-geo",
    lens: "GEO belt, graveyard orbits, emerging slots, collocation clusters",
  },
  {
    id: "geo-cislunar",
    lens: "cislunar investment assets: NRHO, Lagrange points, TLI, EML1, DRO",
  },

  // 41-45: Trend detection
  {
    id: "trend-emerging",
    lens: "emerging operator countries, new ITU filings, rising stars, discovery",
  },
  {
    id: "trend-rideshare",
    lens: "rideshare movement, low-cost access, smallsat aggregation, Transporter missions",
  },
  {
    id: "trend-climate",
    lens: "space-weather impact on orbits, adaptation strategies, new shells",
  },
  {
    id: "trend-consumer",
    lens: "end-user behavior shifts, demographics, millennials Gen Z direct-to-device",
  },
  {
    id: "trend-tech",
    lens: "space tech, AI on-orbit, blockchain provenance, digital twin tools",
  },

  // 46-50: Data mining
  {
    id: "data-academic",
    lens: "academic orbit research, astrodynamics papers, space surveillance studies, AIAA",
  },
  {
    id: "data-statistics",
    lens: "satellite population statistics, UCS data, launch numbers, active counts",
  },
  {
    id: "data-fraud",
    lens: "satellite spoofing detection, authentication, counterfeit signals, provenance",
  },
  {
    id: "data-storage",
    lens: "on-orbit storage, station-keeping budgets, optimal disposal, EOL tracking",
  },
  {
    id: "data-pairing",
    lens: "payload host-platform pairing research, rideshare compatibility, integrator insights",
  },
] as const;

const SSA_KEYWORD_MAP: Record<string, string[]> = {
  spacex: ["operator-spacex", "cost-futures", "advisory-18scs"],
  starlink: ["operator-spacex", "cost-launch", "advisory-leolabs"],
  oneweb: ["operator-oneweb", "cost-launch", "advisory-leolabs"],
  intelsat: ["operator-intelsat", "cost-index", "trend-consumer"],
  ses: ["operator-intelsat", "advisory-18scs", "regime-space-weather"],
  rideshare: ["cost-launch", "trend-rideshare", "advisory-consensus"],
  auction: ["cost-launch", "market-brycetech", "invest-roi"],
  brycetech: ["market-brycetech", "market-volumes", "cost-index"],
  investissement: ["invest-roi", "invest-undervalued", "invest-forecast"],
  investment: ["invest-roi", "invest-undervalued", "invest-forecast"],
  "space weather": ["regime-space-weather", "trend-climate", "regime-yield"],
  swpc: ["regime-space-weather", "trend-climate", "regime-yield"],
  sustainable: ["regime-sustainable", "trend-rideshare", "trend-consumer"],
  iadc: ["regime-sustainable", "trend-rideshare", "trend-consumer"],
  heo: ["geo-heo", "trend-rideshare", "trend-emerging"],
  meo: ["geo-meo", "regime-structure", "trend-emerging"],
  leo: ["geo-leo", "trend-rideshare", "trend-emerging"],
  china: ["operator-chinese", "geo-cislunar", "cost-launch"],
  chine: ["operator-chinese", "geo-cislunar", "cost-launch"],
};

function pickSsaLenses(sq: ExplorationQuery): Lens[] {
  const q = sq.query.toLowerCase();
  const picked: Lens[] = [];

  // Type-based priority
  if (sq.type === "market") {
    picked.push(
      ...SSA_LENSES.filter(
        (l) =>
          l.id.startsWith("cost-") ||
          l.id.startsWith("market-") ||
          l.id.startsWith("invest-"),
      ).slice(0, 6),
    );
  } else if (sq.type === "academic") {
    picked.push(
      ...SSA_LENSES.filter(
        (l) =>
          l.id.startsWith("data-") ||
          l.id.startsWith("regime-") ||
          l.id.startsWith("trend-"),
      ).slice(0, 6),
    );
  }

  // Keyword-based enrichment
  const usedIds = new Set<string>(picked.map((l) => l.id));
  for (const [kw, lensIds] of Object.entries(SSA_KEYWORD_MAP)) {
    if (q.includes(kw)) {
      for (const id of lensIds) {
        if (!usedIds.has(id)) {
          const lens = SSA_LENSES.find((l) => l.id === id);
          if (lens) {
            picked.push(lens);
            usedIds.add(id);
          }
        }
      }
    }
  }

  // Always include at least one news + one trend lens for coverage
  for (const prefix of ["news-", "trend-"]) {
    if (!picked.some((l) => l.id.startsWith(prefix))) {
      const fallback = SSA_LENSES.find(
        (l) => l.id.startsWith(prefix) && !usedIds.has(l.id),
      );
      if (fallback) picked.push(fallback);
    }
  }

  return picked.slice(0, 8);
}

export const SSA_NANO_SWARM_PROFILE: NanoSwarmProfile = {
  lenses: SSA_LENSES,
  pickLenses: pickSsaLenses,
  buildCallInstructions(lens) {
    return `You are a specialized space-situational-awareness research nano-agent.
Your expertise: ${lens}
Search the web and return structured findings.
IMPORTANT: Always mention specific payload types (optical imager, SAR, multispectral, hyperspectral, Ka-band transponder, Ku-band, L-band nav, etc.), orbital regimes (LEO sun-sync, MEO, GEO, HEO Molniya, cislunar, etc.), operator countries, launch vehicles, and space-weather data when relevant. Use their full names, never abbreviate.
Be concise but data-rich. Global space market focus.`;
  },
  buildCallInput(microQuery) {
    return `Search: ${microQuery}

For each source found, return:
- URL
- Title
- 120-word summary that MUST include:
  * Specific payload types mentioned (e.g. optical imager, SAR, Ka-band transponder)
  * Specific orbit regimes (e.g. LEO 550 km SSO, GEO 75°E, MEO Galileo shell, cislunar NRHO)
  * Operator countries (e.g. USA, France, China, Japan)
  * Any numbers: prices in USD, Pc values, inclination in °, altitude in km, mass in kg
  * Regime / space-weather details if available (Kp index, debris flux, solar F10.7)
Return at least 2 sources.`;
  },
};
