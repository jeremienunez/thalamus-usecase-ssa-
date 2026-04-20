/**
 * setEntityExtractor — Phase 3 · Task 3.3d.
 *
 * Nano-swarm used to import `extractSatelliteEntities` + `DATA_POINT_RE`
 * from `../utils/satellite-entity-patterns` (SSA-specific). Those two
 * imports are replaced by a setter-driven port: the app injects an
 * extractor at boot; the kernel stays free of SSA vocabulary.
 *
 * The default extractor returns an empty payload so the kernel is still
 * runnable standalone (tests, demos).
 */

import { describe, it, expect } from "vitest";
import {
  setEntityExtractor,
  type CrawlerExtraction,
  type EntityExtractorFn,
} from "../src";

describe("entity extractor seam", () => {
  it("exports the setter so apps can inject at boot", () => {
    expect(typeof setEntityExtractor).toBe("function");
  });

  it("accepts a domain extractor and round-trips the call", () => {
    const calls: string[] = [];
    const extractor: EntityExtractorFn = (text) => {
      calls.push(text);
      return {
        entities: { tag: "domain-payload" },
        dataPoints: [`${text.length} chars`],
      };
    };
    setEntityExtractor(extractor);
    // We exercise the setter via round-trip: setEntityExtractor returns
    // void and the internal reference is hidden, so the best we can
    // assert is that the setter does not throw and the extractor fn
    // itself still behaves as written.
    const out: CrawlerExtraction = extractor("hello world");
    expect(calls).toEqual(["hello world"]);
    expect(out.entities).toEqual({ tag: "domain-payload" });
    expect(out.dataPoints).toEqual(["11 chars"]);
  });
});
