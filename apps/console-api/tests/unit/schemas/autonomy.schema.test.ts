import { describe, expect, it } from "vitest";
import { AutonomyStartBodySchema } from "../../../src/schemas/autonomy.schema";

describe("AutonomyStartBodySchema", () => {
  it("defaults intervalSec to 45 seconds", () => {
    expect(AutonomyStartBodySchema.parse({})).toEqual({ intervalSec: 45 });
  });

  it("clamps intervalSec into the supported range", () => {
    expect(AutonomyStartBodySchema.parse({ intervalSec: 0 })).toEqual({ intervalSec: 15 });
    expect(AutonomyStartBodySchema.parse({ intervalSec: 900 })).toEqual({ intervalSec: 600 });
  });

  it("rejects non-finite and boolean intervalSec values", () => {
    for (const intervalSec of [NaN, Infinity, -Infinity, true, false]) {
      expect(AutonomyStartBodySchema.safeParse({ intervalSec }).success).toBe(false);
    }
  });
});
