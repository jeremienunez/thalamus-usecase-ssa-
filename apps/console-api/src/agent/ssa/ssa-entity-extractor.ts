/**
 * SSA entity extractor bridge.
 *
 * The thalamus nano-swarm exposes `setEntityExtractor(fn)` so the kernel
 * stays free of SSA vocabulary. This bridge adapts the existing SSA
 * regex extractor (`extractSatelliteEntities` + `DATA_POINT_RE`) to the
 * kernel's `EntityExtractorFn` port shape. Wire it at container boot.
 */

import {
  extractSatelliteEntities,
  DATA_POINT_RE,
} from "./explorer/satellite-entity-patterns";
import type { EntityExtractorFn } from "@interview/thalamus";

export const ssaEntityExtractor: EntityExtractorFn = (text) => {
  const entities = extractSatelliteEntities(text);
  const dataPoints: string[] = [];
  const re = new RegExp(DATA_POINT_RE.source, DATA_POINT_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) dataPoints.push(m[0]);
  return { entities, dataPoints };
};
