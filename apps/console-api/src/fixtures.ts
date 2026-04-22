/**
 * Deterministic fixtures for the demo.
 * Swap to real Postgres queries later by replacing this module.
 */

// Seeded PRNG — Mulberry32
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type Regime = "LEO" | "MEO" | "GEO" | "HEO";
export type SourceClass = "osint" | "field" | "derived";
export type FindingStatus = "pending" | "accepted" | "rejected" | "in-review";
export type EntityClass =
  | "Satellite"
  | "Debris"
  | "Operator"
  | "Payload"
  | "OrbitRegime"
  | "ConjunctionEvent"
  | "Maneuver";

export type SatelliteDto = {
  id: number;
  name: string;
  noradId: number;
  regime: Regime;
  operator: string;
  country: string;
  inclinationDeg: number;
  semiMajorAxisKm: number;
  eccentricity: number;
  raanDeg: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  epoch: string;
  massKg: number;
  classificationTier: "unclassified" | "sensitive" | "restricted";
  opacityScore?: number | null;
  opacityDeficitReasons?: string[];
};

export type ConjunctionDto = {
  id: number;
  primaryId: number;
  secondaryId: number;
  primaryName: string;
  secondaryName: string;
  epoch: string;
  minRangeKm: number;
  relativeVelocityKmps: number;
  probabilityOfCollision: number;
  combinedSigmaKm: number;
  hardBodyRadiusM: number;
  pcMethod: "foster-gaussian" | "alfano" | "chan";
  sourceClass: SourceClass;
  corroborated: boolean;
};

export type KgNodeDto = {
  id: string;
  label: string;
  class: EntityClass;
  degree: number;
  x: number;
  y: number;
  cortex: string;
};

export type KgEdgeDto = {
  id: string;
  source: string;
  target: string;
  relation: string;
  confidence: number;
  sourceClass: SourceClass;
};

export type FindingDto = {
  id: string;
  title: string;
  summary: string;
  cortex: string;
  status: FindingStatus;
  priority: number;
  createdAt: string;
  linkedEntityIds: string[];
  evidence: { kind: SourceClass; uri: string; snippet: string }[];
  swarmConsensus?: { accept: number; reject: number; abstain: number; k: number };
  decisionReason?: string;
};

const OPERATORS = [
  { name: "SpaceX", country: "USA" },
  { name: "Airbus DS", country: "FRA" },
  { name: "Thales Alenia Space", country: "FRA" },
  { name: "ESA", country: "EU" },
  { name: "NASA", country: "USA" },
  { name: "JAXA", country: "JPN" },
  { name: "CNSA", country: "CHN" },
  { name: "ISRO", country: "IND" },
  { name: "Roscosmos", country: "RUS" },
  { name: "Planet Labs", country: "USA" },
  { name: "OneWeb", country: "GBR" },
  { name: "CNES", country: "FRA" },
];

const CORTICES = [
  "catalog",
  "observations",
  "conjunction-analysis",
  "correlation",
  "maneuver-planning",
];

function regimeFromMeanMotion(mm: number): Regime {
  if (mm > 11.25) return "LEO";
  if (mm > 2) return "MEO";
  if (mm > 0.9 && mm < 1.1) return "GEO";
  return "HEO";
}

export function buildFixtures(seed = 42) {
  const rnd = mulberry32(seed);
  const now = Date.now();

  const satellites: SatelliteDto[] = [];
  for (let i = 0; i < 600; i++) {
    const regime = (["LEO", "LEO", "LEO", "LEO", "MEO", "GEO", "HEO"] as Regime[])[
      Math.floor(rnd() * 7)
    ]!;
    const mm =
      regime === "LEO"
        ? 14 + rnd() * 2
        : regime === "MEO"
          ? 2 + rnd() * 3
          : regime === "GEO"
            ? 1.0027 + (rnd() - 0.5) * 0.01
            : 1 + rnd() * 3;
    const sma =
      Math.pow((398600.4418 * Math.pow(86400 / (mm * 2 * Math.PI), 2)), 1 / 3);
    const op = OPERATORS[Math.floor(rnd() * OPERATORS.length)]!;
    // OpacityScout: demo-tag a small minority of satellites with a data-gap
    // signature. Rare on purpose — this is a reviewer hint, not a witch hunt.
    // Never uses the word "classified" — that's the whole point of the cortex.
    const opacityRoll = rnd();
    let opacityScore: number | null = null;
    let opacityReasons: string[] | undefined;
    if (opacityRoll < 0.015) {
      opacityScore = 0.7 + rnd() * 0.3; // 0.7–1.0 — strongest signals (~1.5%)
      opacityReasons = [
        "payload not yet disclosed",
        "corroborated by SeeSat-L observers (Molczan, Langbroek)",
      ];
    } else if (opacityRoll < 0.04) {
      opacityScore = 0.5 + rnd() * 0.2; // 0.5–0.7 — moderate (~2.5%)
      opacityReasons = [
        "payload not yet disclosed",
        "minor catalog gap 2026-03-12",
      ];
    }

    satellites.push({
      id: i + 1,
      name: `${op.name.slice(0, 4).toUpperCase()}-${1000 + i}`,
      noradId: 40000 + i,
      regime,
      operator: op.name,
      country: op.country,
      inclinationDeg: regime === "GEO" ? rnd() * 2 : rnd() * 100,
      semiMajorAxisKm: sma,
      eccentricity: rnd() * 0.02,
      raanDeg: rnd() * 360,
      argPerigeeDeg: rnd() * 360,
      meanAnomalyDeg: rnd() * 360,
      meanMotionRevPerDay: mm,
      epoch: new Date(now - rnd() * 86400_000).toISOString(),
      massKg: 100 + rnd() * 5000,
      classificationTier:
        rnd() < 0.7 ? "unclassified" : rnd() < 0.9 ? "sensitive" : "restricted",
      opacityScore,
      opacityDeficitReasons: opacityReasons,
    });
  }

  const conjunctions: ConjunctionDto[] = [];
  for (let i = 0; i < 180; i++) {
    const a = Math.floor(rnd() * satellites.length);
    let b = Math.floor(rnd() * satellites.length);
    while (b === a) b = Math.floor(rnd() * satellites.length);
    const pA = satellites[a]!;
    const pB = satellites[b]!;
    const logPc = -8 + rnd() * 6;
    const corroborated = rnd() < 0.4;
    conjunctions.push({
      id: i + 1,
      primaryId: pA.id,
      secondaryId: pB.id,
      primaryName: pA.name,
      secondaryName: pB.name,
      epoch: new Date(now + rnd() * 7 * 86400_000).toISOString(),
      minRangeKm: 0.05 + rnd() * 5,
      relativeVelocityKmps: 5 + rnd() * 10,
      probabilityOfCollision: Math.pow(10, logPc),
      combinedSigmaKm: 0.1 + rnd() * 2,
      hardBodyRadiusM: 10 + rnd() * 30,
      pcMethod: "foster-gaussian",
      sourceClass: corroborated ? "field" : "osint",
      corroborated,
    });
  }

  // Knowledge graph: satellites + operators + payloads + orbits + conjunction events
  const kgNodes: KgNodeDto[] = [];
  const kgEdges: KgEdgeDto[] = [];
  const operators = Array.from(new Set(satellites.map((s) => s.operator)));
  const regimes: Regime[] = ["LEO", "MEO", "GEO", "HEO"];

  regimes.forEach((r, i) => {
    kgNodes.push({
      id: `regime:${r}`,
      label: r,
      class: "OrbitRegime",
      degree: 0,
      x: Math.cos((i / regimes.length) * Math.PI * 2) * 400,
      y: Math.sin((i / regimes.length) * Math.PI * 2) * 400,
      cortex: "catalog",
    });
  });

  operators.forEach((op, i) => {
    kgNodes.push({
      id: `op:${op}`,
      label: op,
      class: "Operator",
      degree: 0,
      x: Math.cos((i / operators.length) * Math.PI * 2) * 200,
      y: Math.sin((i / operators.length) * Math.PI * 2) * 200,
      cortex: "catalog",
    });
  });

  const sample = satellites.slice(0, 150);
  sample.forEach((s) => {
    const theta = rnd() * Math.PI * 2;
    const r = 600 + rnd() * 200;
    kgNodes.push({
      id: `sat:${s.id}`,
      label: s.name,
      class: "Satellite",
      degree: 0,
      x: Math.cos(theta) * r,
      y: Math.sin(theta) * r,
      cortex: "catalog",
    });
    kgEdges.push({
      id: `e:sat-op-${s.id}`,
      source: `sat:${s.id}`,
      target: `op:${s.operator}`,
      relation: "operated_by",
      confidence: 0.95,
      sourceClass: "osint",
    });
    kgEdges.push({
      id: `e:sat-regime-${s.id}`,
      source: `sat:${s.id}`,
      target: `regime:${s.regime}`,
      relation: "in_regime",
      confidence: 0.99,
      sourceClass: "derived",
    });
  });

  conjunctions.slice(0, 60).forEach((c) => {
    kgNodes.push({
      id: `ce:${c.id}`,
      label: `CE-${c.id}`,
      class: "ConjunctionEvent",
      degree: 0,
      x: (rnd() - 0.5) * 1400,
      y: (rnd() - 0.5) * 1400,
      cortex: "conjunction-analysis",
    });
    const confPrimary = c.corroborated ? 0.92 : 0.35;
    kgEdges.push({
      id: `e:ce-p-${c.id}`,
      source: `ce:${c.id}`,
      target: `sat:${c.primaryId}`,
      relation: "primary",
      confidence: confPrimary,
      sourceClass: c.sourceClass,
    });
    kgEdges.push({
      id: `e:ce-s-${c.id}`,
      source: `ce:${c.id}`,
      target: `sat:${c.secondaryId}`,
      relation: "secondary",
      confidence: confPrimary,
      sourceClass: c.sourceClass,
    });
  });

  // Compute degrees
  const degMap = new Map<string, number>();
  kgEdges.forEach((e) => {
    degMap.set(e.source, (degMap.get(e.source) ?? 0) + 1);
    degMap.set(e.target, (degMap.get(e.target) ?? 0) + 1);
  });
  kgNodes.forEach((n) => (n.degree = degMap.get(n.id) ?? 0));

  // Findings — densify to ~1200 for SWEEP view
  const findings: FindingDto[] = [];
  const statusBuckets: FindingStatus[] = [
    "pending",
    "pending",
    "pending",
    "accepted",
    "accepted",
    "rejected",
    "in-review",
  ];
  for (let i = 0; i < 1200; i++) {
    const status = statusBuckets[Math.floor(rnd() * statusBuckets.length)]!;
    const cortex = CORTICES[Math.floor(rnd() * CORTICES.length)]!;
    const linkCount = 1 + Math.floor(rnd() * 4);
    const links: string[] = [];
    for (let k = 0; k < linkCount; k++) {
      const t = rnd();
      if (t < 0.6) links.push(`sat:${1 + Math.floor(rnd() * sample.length)}`);
      else if (t < 0.85) links.push(`ce:${1 + Math.floor(rnd() * 60)}`);
      else links.push(`op:${operators[Math.floor(rnd() * operators.length)]!}`);
    }
    const hasSwarm = rnd() < 0.25;
    const pcHint = rnd() < 0.3 ? ` · Pc ≈ ${Math.pow(10, -8 + rnd() * 6).toExponential(2)}` : "";
    findings.push({
      id: `f:${i + 1}`,
      title:
        cortex === "conjunction-analysis"
          ? `Conjunction anomaly · window +${Math.floor(rnd() * 72)}h${pcHint}`
          : cortex === "catalog"
            ? `Stale TLE epoch on ${sample[Math.floor(rnd() * sample.length)]!.name}`
            : cortex === "correlation"
              ? `Uncorroborated OSINT edge pending field confirmation`
              : cortex === "observations"
                ? `Radar track residual exceeds 2σ`
                : `Maneuver window candidate · Δv < 1.2 m/s`,
      summary: `Finding produced by ${cortex} cortex. Review provenance and swarm consensus before committing decision.`,
      cortex,
      status,
      priority: Math.floor(rnd() * 100),
      createdAt: new Date(now - rnd() * 3 * 86400_000).toISOString(),
      linkedEntityIds: links,
      evidence: [
        { kind: "osint", uri: "celestrak://active", snippet: "TLE epoch drift detected across 3 tracking windows" },
        ...(rnd() < 0.5
          ? [{ kind: "field" as const, uri: "radar://site-07/track", snippet: "Range residual 1.8σ over 4 passes" }]
          : []),
      ],
      swarmConsensus: hasSwarm
        ? { accept: 18 + Math.floor(rnd() * 10), reject: 2 + Math.floor(rnd() * 6), abstain: Math.floor(rnd() * 4), k: 30 }
        : undefined,
    });
  }

  return { satellites, conjunctions, kgNodes, kgEdges, findings };
}
