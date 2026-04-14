/**
 * SPEC-TH-040 — Dual-Stream Confidence Model.
 *
 * Per-edge confidence and source-class metadata. In-memory implementation of
 * the algorithmic core; persistence belongs to the repository layer.
 */

export type SourceClass =
  | "FIELD_HIGH"
  | "FIELD_LOW"
  | "OSINT_CORROBORATED"
  | "OSINT_UNCORROBORATED"
  // Multi-agent simulation inferences (sweep × sim-fish). These sit BELOW
  // OSINT in both bands and class ordering: a simulation is a structured
  // prior, not an observation. Only reviewer acceptance can promote them.
  | "SIM_CORROBORATED"
  | "SIM_UNCORROBORATED";

export interface EdgeConfidence {
  value: number;
  sourceClass: SourceClass;
  lastPromotedAt: Date | null;
  lastDemotedAt: Date | null;
  corroborationCount: number;
  fieldEventId: string | null;
}

export interface EdgeProvenanceEvent {
  edgeId: number;
  actor:
    | "osint-swarm"
    | "field-correlation"
    | "analyst"
    | "sweep"
    | "sim-fish";
  reason: string;
  previous: Pick<EdgeConfidence, "value" | "sourceClass">;
  next: Pick<EdgeConfidence, "value" | "sourceClass">;
  at: Date;
}

export interface PromoteEdgeInput {
  edgeId: number;
  evidence:
    | { kind: "osint-corroboration"; sources: string[] }
    | {
        kind: "field-match";
        fieldEventId: string;
        stream: string;
        policy?: "critical" | "partial";
      }
    | {
        /**
         * Multi-agent sim inference. `fishCount` is the swarm size, `dispersion`
         * is the normalised std-dev of proposals (low σ → high consensus →
         * CORROBORATED; high σ → UNCORROBORATED).
         */
        kind: "sim-inference";
        fishCount: number;
        dispersion: number;
      }
    | {
        /**
         * A reviewer accepted a sweep suggestion — analyst-driven promotion
         * with a concrete source citation (e.g. GCAT mass, bus datasheet).
         */
        kind: "reviewer-accept";
        analystId: number;
        citation: string;
      };
}

export interface DemoteEdgeInput {
  edgeId: number;
  evidence:
    | { kind: "field-contradiction"; fieldEventId: string }
    | { kind: "analyst-override"; analystId: number; note: string }
    | { kind: "field-freshness-expired" };
}

export interface QueryFilter {
  minConfidence?: number;
  sourceClasses?: SourceClass[];
  olderThan?: Date;
}

export class InvalidPromotion extends Error {
  constructor(msg: string) {
    super(msg);
    this.name = "InvalidPromotion";
  }
}

const BANDS: Record<SourceClass, { min: number; typical: number; max: number }> = {
  // Simulation inferences live strictly below OSINT: a structured prior is
  // not an observation. Bands are deliberately tight so sim can never
  // masquerade as corroborated open-source signal.
  SIM_UNCORROBORATED: { min: 0.1, typical: 0.2, max: 0.35 },
  SIM_CORROBORATED: { min: 0.3, typical: 0.42, max: 0.55 },
  OSINT_UNCORROBORATED: { min: 0.1, typical: 0.3, max: 0.5 },
  OSINT_CORROBORATED: { min: 0.4, typical: 0.55, max: 0.75 },
  FIELD_LOW: { min: 0.65, typical: 0.75, max: 0.85 },
  FIELD_HIGH: { min: 0.85, typical: 0.92, max: 1.0 },
};

const CLASS_ORDER: SourceClass[] = [
  "SIM_UNCORROBORATED",
  "SIM_CORROBORATED",
  "OSINT_UNCORROBORATED",
  "OSINT_CORROBORATED",
  "FIELD_LOW",
  "FIELD_HIGH",
];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function classRank(sc: SourceClass): number {
  return CLASS_ORDER.indexOf(sc);
}

function isFieldClass(sc: SourceClass): boolean {
  return sc === "FIELD_HIGH" || sc === "FIELD_LOW";
}

interface EdgeRecord {
  confidence: EdgeConfidence;
  createdAt: Date;
}

export class ConfidenceService {
  private edges = new Map<number, EdgeRecord>();
  private history_: EdgeProvenanceEvent[] = [];

  initialWrite(edgeId: number, now: Date = new Date()): EdgeConfidence {
    if (this.edges.has(edgeId)) {
      throw new Error(`edge ${edgeId} already exists`);
    }
    const next: EdgeConfidence = {
      value: BANDS.OSINT_UNCORROBORATED.typical,
      sourceClass: "OSINT_UNCORROBORATED",
      lastPromotedAt: null,
      lastDemotedAt: null,
      corroborationCount: 1,
      fieldEventId: null,
    };
    this.edges.set(edgeId, { confidence: next, createdAt: now });
    this.history_.push({
      edgeId,
      actor: "osint-swarm",
      reason: "initial-write",
      previous: { value: 0, sourceClass: "OSINT_UNCORROBORATED" },
      next: { value: next.value, sourceClass: next.sourceClass },
      at: now,
    });
    return next;
  }

  async read(edgeId: number): Promise<EdgeConfidence> {
    const rec = this.edges.get(edgeId);
    if (!rec) throw new Error(`edge ${edgeId} not found`);
    return rec.confidence;
  }

  async history(edgeId: number): Promise<EdgeProvenanceEvent[]> {
    return this.history_.filter((e) => e.edgeId === edgeId);
  }

  async query(
    filter: QueryFilter,
  ): Promise<Array<{ edgeId: number; confidence: EdgeConfidence }>> {
    const out: Array<{ edgeId: number; confidence: EdgeConfidence }> = [];
    for (const [edgeId, rec] of this.edges) {
      if (
        filter.minConfidence !== undefined &&
        rec.confidence.value < filter.minConfidence
      )
        continue;
      if (
        filter.sourceClasses &&
        !filter.sourceClasses.includes(rec.confidence.sourceClass)
      )
        continue;
      if (filter.olderThan && rec.createdAt >= filter.olderThan) continue;
      out.push({ edgeId, confidence: rec.confidence });
    }
    return out;
  }

  async promote(input: PromoteEdgeInput, now: Date = new Date()): Promise<EdgeConfidence> {
    const rec = this.edges.get(input.edgeId);
    if (!rec) throw new Error(`edge ${input.edgeId} not found`);
    const prev = rec.confidence;

    let nextClass: SourceClass;
    let nextValue: number;
    let fieldEventId: string | null = prev.fieldEventId;
    let corroborationCount = prev.corroborationCount;

    let actor: EdgeProvenanceEvent["actor"];

    switch (input.evidence.kind) {
      case "osint-corroboration": {
        // I-1 / I-3: OSINT corroboration cannot reach a FIELD class; if the
        // edge is already FIELD_*, field dominance means OSINT is a no-op.
        if (isFieldClass(prev.sourceClass)) return prev;
        corroborationCount += Math.max(1, input.evidence.sources.length);
        nextClass = "OSINT_CORROBORATED";
        const band = BANDS.OSINT_CORROBORATED;
        const climb = band.typical + (corroborationCount - 2) * 0.05;
        nextValue = clamp(climb, band.min, band.max);
        actor = "osint-swarm";
        break;
      }
      case "field-match": {
        const policy = input.evidence.policy ?? "critical";
        nextClass = policy === "critical" ? "FIELD_HIGH" : "FIELD_LOW";
        nextValue = BANDS[nextClass].typical;
        fieldEventId = input.evidence.fieldEventId;
        actor = "field-correlation";
        break;
      }
      case "sim-inference": {
        // Never promote over an OSINT_* or FIELD_* edge — simulation cannot
        // demote observation. Only UNCORROBORATED → SIM_CORROBORATED is allowed.
        if (
          prev.sourceClass === "OSINT_CORROBORATED" ||
          isFieldClass(prev.sourceClass)
        ) {
          return prev;
        }
        // Low dispersion across K fish → high consensus → promote to
        // SIM_CORROBORATED; high dispersion keeps UNCORROBORATED.
        const consensus = input.evidence.dispersion <= 0.15;
        nextClass = consensus ? "SIM_CORROBORATED" : "SIM_UNCORROBORATED";
        const band = BANDS[nextClass];
        // Value scales inversely with dispersion within the band.
        const clampedDisp = clamp(input.evidence.dispersion, 0, 0.5);
        const tilt = 1 - clampedDisp / 0.5; // 1.0 at disp=0, 0 at disp=0.5
        nextValue = band.min + (band.max - band.min) * tilt;
        corroborationCount = Math.max(
          corroborationCount,
          input.evidence.fishCount,
        );
        actor = "sim-fish";
        break;
      }
      case "reviewer-accept": {
        // Analyst accepted a suggestion — bumps the edge into OSINT_CORROBORATED
        // (reviewer is a credible cited source, not a field event).
        if (isFieldClass(prev.sourceClass)) return prev;
        nextClass = "OSINT_CORROBORATED";
        nextValue = BANDS.OSINT_CORROBORATED.typical;
        corroborationCount += 1;
        actor = "analyst";
        break;
      }
    }

    const next: EdgeConfidence = {
      value: clamp(nextValue, 0, 1),
      sourceClass: nextClass,
      lastPromotedAt: now,
      lastDemotedAt: prev.lastDemotedAt,
      corroborationCount,
      fieldEventId,
    };

    rec.confidence = next;
    this.history_.push({
      edgeId: input.edgeId,
      actor,
      reason: input.evidence.kind,
      previous: { value: prev.value, sourceClass: prev.sourceClass },
      next: { value: next.value, sourceClass: next.sourceClass },
      at: now,
    });
    return next;
  }

  async demote(input: DemoteEdgeInput, now: Date = new Date()): Promise<EdgeConfidence> {
    const rec = this.edges.get(input.edgeId);
    if (!rec) throw new Error(`edge ${input.edgeId} not found`);
    const prev = rec.confidence;

    let nextClass: SourceClass;
    let nextValue: number;
    let actor: EdgeProvenanceEvent["actor"];

    switch (input.evidence.kind) {
      case "field-contradiction":
        nextClass = "OSINT_UNCORROBORATED";
        nextValue = 0.15;
        actor = "field-correlation";
        break;
      case "analyst-override":
        nextClass = "OSINT_UNCORROBORATED";
        nextValue = Math.min(prev.value, BANDS.OSINT_UNCORROBORATED.max);
        actor = "analyst";
        break;
      case "field-freshness-expired": {
        const rank = classRank(prev.sourceClass);
        const nextRank = Math.max(0, rank - 1);
        nextClass = CLASS_ORDER[nextRank]!;
        nextValue = BANDS[nextClass].max;
        actor = "sweep";
        break;
      }
    }

    const next: EdgeConfidence = {
      value: clamp(nextValue, 0, 1),
      sourceClass: nextClass,
      lastPromotedAt: prev.lastPromotedAt,
      lastDemotedAt: now,
      corroborationCount: prev.corroborationCount,
      fieldEventId: isFieldClass(nextClass) ? prev.fieldEventId : null,
    };

    rec.confidence = next;
    this.history_.push({
      edgeId: input.edgeId,
      actor,
      reason: input.evidence.kind,
      previous: { value: prev.value, sourceClass: prev.sourceClass },
      next: { value: next.value, sourceClass: next.sourceClass },
      at: now,
    });
    return next;
  }
}
