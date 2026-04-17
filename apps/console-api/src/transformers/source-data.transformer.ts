// Transformers for source-data domain (advisories, RSS, maneuver, etc.)
import type {
  AdvisoryRow,
  RssTrendRow,
  ManeuverPlanRow,
  ObservationIngestRow,
  CorrelationMergeRow,
  OrbitalPrimerRow,
  SourceHeader,
  AdvisoryView,
  RssView,
  ManeuverView,
  ObservationView,
  CorrelationView,
  OrbitalPrimerView,
} from "../types/source-data.types";

// ---- shared helpers ----------------------------------------------------
function toIso(v: Date | string | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function sourceHeader(r: {
  sourceName: string;
  title: string;
  summary: string | null;
  url?: string | null;
  link?: string | null;
  publishedAt: string | null;
}): SourceHeader {
  return {
    sourceName: r.sourceName,
    title: r.title,
    summary: r.summary ?? null,
    url: (r.url ?? r.link ?? null) as string | null,
    publishedAt: toIso(r.publishedAt),
  };
}

// ---- transformers ------------------------------------------------------
export function toAdvisoryView(r: AdvisoryRow, i: number): AdvisoryView {
  const h = sourceHeader(r);
  return {
    id: `adv:${i}:${h.url ?? h.title}`,
    ...h,
    sourceKind: r.sourceKind,
    score: r.score ?? null,
  };
}

export function toRssView(r: RssTrendRow, i: number): RssView {
  const h = sourceHeader(r);
  return {
    id: `rss:${i}:${h.url ?? h.title}`,
    ...h,
    sourceCategory: r.sourceCategory,
    score: r.score ?? null,
  };
}

export function toManeuverView(r: ManeuverPlanRow, i: number): ManeuverView {
  const h = sourceHeader(r);
  return {
    id: `mnv:${i}:${h.url ?? h.title}`,
    ...h,
    sourceKind: r.sourceKind,
  };
}

export function toObservationView(
  r: ObservationIngestRow,
  i: number,
): ObservationView {
  const h = sourceHeader(r);
  return {
    id: `obs:${i}:${h.url ?? h.title}`,
    ...h,
    sourceKind: r.sourceKind,
  };
}

export function toCorrelationView(
  r: CorrelationMergeRow,
  i: number,
): CorrelationView {
  const h = sourceHeader(r);
  return {
    id: `cor:${r.streamKind}:${i}:${h.url ?? h.title}`,
    ...h,
    streamKind: r.streamKind,
    score: r.score ?? null,
  };
}

export function toOrbitalPrimerView(
  r: OrbitalPrimerRow,
  i: number,
): OrbitalPrimerView {
  return {
    id: `op:${r.kind}:${i}:${r.url ?? r.title}`,
    kind: r.kind,
    title: r.title,
    abstract: r.abstract ?? null,
    authors: Array.isArray(r.authors) ? r.authors : [],
    url: r.url ?? null,
    publishedAt: toIso(r.publishedAt),
    sourceName: r.sourceName ?? null,
  };
}
