import type { ConjunctionView } from "@interview/shared";
import {
  toConjunctionView,
  toScreenedConjunctionView,
  toKnnCandidateView,
} from "../transformers/conjunction-view.transformer";
import type {
  ConjunctionRow,
  ScreenedConjunctionRow,
  KnnCandidateRow,
  ScreenedConjunctionView,
  KnnCandidateView,
} from "../types/conjunction.types";

// ── Port (structural — repo satisfies this by duck typing) ────────
export interface ConjunctionsReadPort {
  listAboveMinPc(minPc: number): Promise<ConjunctionRow[]>;
  screenConjunctions(opts: {
    windowHours?: number;
    primaryNoradId?: string | number;
    limit?: number;
  }): Promise<ScreenedConjunctionRow[]>;
  findKnnCandidates(opts: {
    targetNoradId: number;
    knnK?: number;
    limit?: number;
    marginKm?: number;
    objectClass?: string | null;
    excludeSameFamily?: boolean;
    efSearch?: number;
  }): Promise<KnnCandidateRow[]>;
}

type ListResult<T> = { items: T[]; count: number };

export class ConjunctionViewService {
  constructor(private readonly repo: ConjunctionsReadPort) {}

  async list({
    minPc,
  }: {
    minPc: number;
  }): Promise<ListResult<ConjunctionView>> {
    const rows = await this.repo.listAboveMinPc(minPc);
    const items = rows.map(toConjunctionView);
    return { items, count: items.length };
  }

  async screen(
    opts: Parameters<ConjunctionsReadPort["screenConjunctions"]>[0],
  ): Promise<ListResult<ScreenedConjunctionView>> {
    const rows = await this.repo.screenConjunctions(opts);
    const items = rows.map(toScreenedConjunctionView);
    return { items, count: items.length };
  }

  async knnCandidates(
    opts: Parameters<ConjunctionsReadPort["findKnnCandidates"]>[0],
  ): Promise<ListResult<KnnCandidateView>> {
    const rows = await this.repo.findKnnCandidates(opts);
    const items = rows.map(toKnnCandidateView);
    return { items, count: items.length };
  }
}
