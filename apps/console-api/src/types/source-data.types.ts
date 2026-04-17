// DTOs for source-data domain (advisories, RSS, maneuver, observations,
// correlation, orbital primer).

// ---- row types (mirror repo return shapes) ----------------------------

export type AdvisoryRow = {
  sourceName: string;
  sourceKind: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  score: number | null;
};

export type RssTrendRow = {
  sourceCategory: string;
  sourceName: string;
  title: string;
  summary: string | null;
  link: string | null;
  publishedAt: string | null;
  score: number | null;
};

export type ManeuverPlanRow = {
  sourceName: string;
  sourceKind: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
};

export type ObservationIngestRow = {
  sourceName: string;
  sourceKind: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
};

export type CorrelationMergeRow = {
  streamKind: "field" | "osint";
  sourceName: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
  score: number | null;
};

export type OrbitalPrimerRow = {
  kind: "paper" | "news" | "finding";
  title: string;
  abstract: string | null;
  authors: string[] | null;
  url: string | null;
  publishedAt: string | null;
  sourceName: string | null;
};

// ---- shared header fragment -------------------------------------------

export type SourceHeader = {
  sourceName: string;
  title: string;
  summary: string | null;
  url: string | null;
  publishedAt: string | null;
};

// ---- DTO types ---------------------------------------------------------

export type AdvisoryView = SourceHeader & {
  id: string;
  sourceKind: string;
  score: number | null;
};

export type RssView = SourceHeader & {
  id: string;
  sourceCategory: string;
  score: number | null;
};

export type ManeuverView = SourceHeader & {
  id: string;
  sourceKind: string;
};

export type ObservationView = SourceHeader & {
  id: string;
  sourceKind: string;
};

export type CorrelationView = SourceHeader & {
  id: string;
  streamKind: "field" | "osint";
  score: number | null;
};

export type OrbitalPrimerView = {
  id: string;
  kind: "paper" | "news" | "finding";
  title: string;
  abstract: string | null;
  authors: string[];
  url: string | null;
  publishedAt: string | null;
  sourceName: string | null;
};
