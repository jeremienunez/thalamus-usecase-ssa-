import { describe, it, expect } from "vitest";
import { toPayloadView } from "../../../src/transformers/payload-view.transformer";
import type { SatellitePayloadRow } from "../../../src/types/payload.types";
import { PayloadViewSchema } from "@interview/shared";

function row(over: Partial<SatellitePayloadRow> = {}): SatellitePayloadRow {
  return {
    id: "42",
    name: "Ka-band transponder",
    slug: "ka-band-transponder",
    role: "primary",
    mass_kg: 85.5,
    power_w: 320,
    photo_url: null,
    ...over,
  };
}

describe("toPayloadView", () => {
  it("parses id string to number", () => {
    const v = toPayloadView(row({ id: "7" }));
    expect(v.id).toBe(7);
  });

  it("passes role, mass, power, photoUrl through verbatim", () => {
    const v = toPayloadView(row());
    expect(v.role).toBe("primary");
    expect(v.massKg).toBe(85.5);
    expect(v.powerW).toBe(320);
    expect(v.photoUrl).toBeNull();
  });

  it("preserves null role / mass / power when the join row is incomplete", () => {
    const v = toPayloadView(
      row({ role: null, mass_kg: null, power_w: null }),
    );
    expect(v.role).toBeNull();
    expect(v.massKg).toBeNull();
    expect(v.powerW).toBeNull();
  });

  it("returns a shape that round-trips through PayloadViewSchema", () => {
    const v = toPayloadView(row({ photo_url: "https://ex/x.png" }));
    const parsed = PayloadViewSchema.safeParse(v);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  });
});
