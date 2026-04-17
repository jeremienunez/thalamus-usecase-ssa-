// apps/console-api/src/services/reflexion.service.ts
import {
  toReflexionTargetView,
  toCoplaneView,
  toBeltView,
  toMilPeerView,
} from "../transformers/reflexion.transformer";
import type {
  ReflexionTarget,
  CoplaneRow,
  BeltRow,
  MilRow,
  ReflexionTargetView,
  CoplaneView,
  BeltView,
  MilPeerView,
  ReflexionPassInput,
} from "../types/reflexion.types";
import type {
  FindingInsertInput,
  EdgeInsertInput,
} from "../types/finding.types";
import { HttpError } from "../utils/http-error";

// ── Ports (structural — repos satisfy these by duck typing) ────────
export interface ReflexionReadPort {
  findTarget(norad: number): Promise<ReflexionTarget | null>;
  findStrictCoplane(
    norad: number,
    t: Pick<ReflexionTarget, "inc" | "raan" | "mm" | "ma">,
    dIncMax: number,
    dRaanMax: number,
    dMmMax: number,
  ): Promise<CoplaneRow[]>;
  findInclinationBelt(
    norad: number,
    inc: number,
    dIncMax: number,
  ): Promise<BeltRow[]>;
  findMilLineagePeers(
    norad: number,
    inc: number,
    dIncMax: number,
  ): Promise<MilRow[]>;
}

export interface CyclesPort {
  getOrCreate(): Promise<bigint>;
}

export interface FindingsWritePort {
  insert(input: FindingInsertInput): Promise<bigint>;
}

export interface EdgesWritePort {
  insert(input: EdgeInsertInput): Promise<void>;
}

export type ReflexionResult = {
  target: ReflexionTargetView;
  strictCoplane: CoplaneView[];
  beltByCountry: BeltView[];
  milLineagePeers: MilPeerView[];
  findingId: string | null;
};

export class ReflexionService {
  constructor(
    private readonly repo: ReflexionReadPort,
    private readonly cycles: CyclesPort,
    private readonly findings: FindingsWritePort,
    private readonly edges: EdgesWritePort,
  ) {}

  async runPass(input: ReflexionPassInput): Promise<ReflexionResult> {
    // Schema (H3) enforces: noradId positive integer; dIncMax/dRaanMax/dMmMax
    // bounded with defaults. No re-clamp needed here.
    const norad = input.noradId;
    const { dIncMax, dRaanMax, dMmMax } = input;

    const t = await this.repo.findTarget(norad);
    if (!t) throw HttpError.notFound("satellite not found");
    if (t.inc == null || t.raan == null || t.mm == null)
      throw HttpError.badRequest("target missing orbital elements");

    const [strict, belt, mil] = await Promise.all([
      this.repo.findStrictCoplane(norad, t, dIncMax, dRaanMax, dMmMax),
      this.repo.findInclinationBelt(norad, t.inc, dIncMax),
      this.repo.findMilLineagePeers(norad, t.inc, dIncMax),
    ]);

    const declaredCountry = t.operator_country;
    const beltTop = belt.length > 0 ? belt[0]! : null;
    const mostCommonCountry = beltTop?.country ?? null;
    const divergentCountry = Boolean(
      mostCommonCountry &&
        declaredCountry &&
        mostCommonCountry !== declaredCountry,
    );
    const shouldEmit = mil.length > 0 || divergentCountry;

    let findingId: bigint | null = null;
    if (shouldEmit) {
      findingId = await this.emitFinding({
        t,
        norad,
        declaredCountry,
        strict,
        belt,
        mil,
        mostCommonCountry,
        dIncMax,
      });
    }

    return {
      target: toReflexionTargetView(norad, {
        ...t,
        inc: t.inc,
        raan: t.raan,
        mm: t.mm,
      }),
      strictCoplane: strict.map(toCoplaneView),
      beltByCountry: belt.map(toBeltView),
      milLineagePeers: mil.map(toMilPeerView),
      findingId: findingId ? String(findingId) : null,
    };
  }

  private async emitFinding(args: {
    t: ReflexionTarget;
    norad: number;
    declaredCountry: string | null;
    strict: CoplaneRow[];
    belt: BeltRow[];
    mil: MilRow[];
    mostCommonCountry: string | null;
    dIncMax: number;
  }): Promise<bigint> {
    const {
      t,
      norad,
      declaredCountry,
      strict,
      belt,
      mil,
      mostCommonCountry,
      dIncMax,
    } = args;
    const cycleId = await this.cycles.getOrCreate();
    const title =
      mil.length > 0
        ? `Orbital anomaly · ${t.name} shares inclination with ${mil.length} military-lineage peer(s)`
        : `Orbital anomaly · ${t.name} inclination-belt dominated by ${mostCommonCountry} (declared ${declaredCountry})`;
    const summary = [
      `Target ${t.name} (NORAD ${norad}) declared ${t.object_class ?? "?"} / ${t.classification_tier ?? "?"} / ${declaredCountry ?? "?"}.`,
      `Strict co-plane companions: ${strict.length}.`,
      `Inclination-belt peers at Δi<${dIncMax}°: ${belt.reduce((s, r) => s + Number(r.n), 0)}, top by country = ${belt
        .slice(0, 3)
        .map((r) => `${r.country ?? "?"}:${r.n}`)
        .join(", ")}.`,
      mil.length > 0
        ? `MIL-lineage name-matches in belt: ${mil
            .slice(0, 5)
            .map((m) => `${m.name} (${m.country}, Δi=${m.d_inc.toFixed(2)}°)`)
            .join("; ")}.`
        : "No explicit MIL-lineage name match.",
    ].join(" ");
    const evidence = [
      {
        source: "orbital_reflexion",
        data: {
          target: {
            noradId: norad,
            name: t.name,
            inc: t.inc,
            raan: t.raan,
            mm: t.mm,
            declared: {
              operator_country: declaredCountry,
              classification_tier: t.classification_tier,
              object_class: t.object_class,
              platform: t.platform_name,
            },
          },
          strictCoplane: strict.slice(0, 10).map((r) => ({
            noradId: Number(r.norad_id),
            name: r.name,
            country: r.operator_country,
            platform: r.platform,
            dInc: Number(r.d_inc.toFixed(3)),
            dRaan: Number(r.d_raan.toFixed(2)),
            lagMin: Number(r.lag_min.toFixed(1)),
          })),
          beltByCountry: belt.slice(0, 10).map((r) => ({
            country: r.country,
            tier: r.tier,
            class: r.object_class,
            n: Number(r.n),
          })),
          milLineagePeers: mil.map((m) => ({
            noradId: Number(m.norad_id),
            name: m.name,
            country: m.country,
            tier: m.tier,
            dInc: Number(m.d_inc.toFixed(3)),
          })),
        },
        weight: 0.9,
      },
    ];
    const urgency = mil.length >= 1 ? "high" : "medium";
    const reasoning =
      "Orbital fingerprint reflexion: SQL cross-tab on (inc, raan, meanMotion) against declared classification. No LLM. Provenance: every cited peer traced via similar_to edges.";

    const findingId = await this.findings.insert({
      cycleId,
      cortex: "classification_auditor",
      findingType: "anomaly",
      urgency,
      title,
      summary,
      evidence,
      reasoning,
      confidence: 0.8,
      impactScore: 0.7,
    });

    await this.edges.insert({
      findingId,
      entityType: "satellite",
      entityId: BigInt(t.id),
      relation: "about",
      weight: 1.0,
      context: {
        noradId: norad,
        declared: {
          operator_country: declaredCountry,
          tier: t.classification_tier,
          object_class: t.object_class,
        },
      },
    });
    for (const m of mil.slice(0, 10)) {
      await this.edges.insert({
        findingId,
        entityType: "satellite",
        entityId: BigInt(m.id),
        relation: "similar_to",
        weight: 0.9,
        context: { role: "mil_lineage_peer", dInc: Number(m.d_inc.toFixed(3)) },
      });
    }
    for (const r of strict.slice(0, 5)) {
      await this.edges.insert({
        findingId,
        entityType: "satellite",
        entityId: BigInt(r.id),
        relation: "similar_to",
        weight: 0.95,
        context: {
          role: "strict_coplane",
          dInc: Number(r.d_inc.toFixed(3)),
          dRaan: Number(r.d_raan.toFixed(2)),
          lagMin: Number(r.lag_min.toFixed(1)),
        },
      });
    }
    return findingId;
  }
}
