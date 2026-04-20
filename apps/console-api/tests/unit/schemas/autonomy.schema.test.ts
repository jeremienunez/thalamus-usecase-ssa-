import { describe, expect, it } from "vitest";
import { AutonomyStartBodySchema } from "../../../src/schemas/autonomy.schema";

describe("AutonomyStartBodySchema", () => {
  it("leaves intervalSec undefined when body is empty", () => {
    expect(AutonomyStartBodySchema.parse({})).toEqual({});
  });

  it("clamps intervalSec into the supported range", () => {
    expect(AutonomyStartBodySchema.parse({ intervalSec: 0 })).toEqual({ intervalSec: 15 });
    expect(AutonomyStartBodySchema.parse({ intervalSec: 900 })).toEqual({ intervalSec: 600 });
    expect(AutonomyStartBodySchema.parse({ intervalSec: 60 })).toEqual({ intervalSec: 60 });
  });

  it("rejects non-finite and boolean intervalSec values", () => {
    for (const intervalSec of [NaN, Infinity, -Infinity, true, false]) {
      expect(AutonomyStartBodySchema.safeParse({ intervalSec }).success).toBe(false);
    }
  });
});
