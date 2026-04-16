import { describe, expect, it } from "vitest";
import {
  FindingDecisionBodySchema,
  FindingIdParamsSchema,
  FindingsListQuerySchema,
} from "../../../src/schemas/findings.schema";

describe("FindingsListQuerySchema", () => {
  it("accepts supported status filters and bounded cortex names", () => {
    expect(FindingsListQuerySchema.parse({ status: "pending", cortex: "catalog" })).toEqual({
      status: "pending",
      cortex: "catalog",
    });
  });

  it("rejects unsupported status filters and blank cortex names", () => {
    expect(FindingsListQuerySchema.safeParse({ status: "active" }).success).toBe(false);
    expect(FindingsListQuerySchema.safeParse({ cortex: "" }).success).toBe(false);
    expect(FindingsListQuerySchema.safeParse({ cortex: "x".repeat(65) }).success).toBe(false);
  });
});

describe("FindingIdParamsSchema", () => {
  it("accepts raw numeric ids and f:-prefixed ids", () => {
    expect(FindingIdParamsSchema.parse({ id: "42" })).toEqual({ id: "42" });
    expect(FindingIdParamsSchema.parse({ id: "f:42" })).toEqual({ id: "f:42" });
  });

  it("rejects malformed ids", () => {
    for (const id of ["", "-1", "f:-1", "abc", "f:abc"]) {
      expect(FindingIdParamsSchema.safeParse({ id }).success).toBe(false);
    }
  });
});

describe("FindingDecisionBodySchema", () => {
  it("accepts supported decisions only", () => {
    expect(FindingDecisionBodySchema.parse({ decision: "accepted" })).toEqual({
      decision: "accepted",
    });
    expect(FindingDecisionBodySchema.safeParse({ decision: "approve" }).success).toBe(false);
  });
});
