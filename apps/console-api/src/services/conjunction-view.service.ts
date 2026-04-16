import type { ConjunctionView } from "@interview/shared";
import { ConjunctionRepository } from "../repositories/conjunction.repository";
import { toConjunctionView } from "../transformers/conjunction-view.transformer";

export class ConjunctionViewService {
  constructor(private readonly repo: ConjunctionRepository) {}

  async list({
    minPc,
  }: {
    minPc: number;
  }): Promise<{ items: ConjunctionView[]; total: number }> {
    const rows = await this.repo.listAboveMinPc(minPc);
    const items = rows.map(toConjunctionView);
    return { items, total: items.length };
  }
}
