import type { PayloadView } from "@interview/shared";
import type { SatellitePayloadRow } from "../types/payload.types";

export function toPayloadView(r: SatellitePayloadRow): PayloadView {
  return {
    id: Number(r.id),
    name: r.name,
    slug: r.slug,
    role: r.role,
    massKg: r.mass_kg,
    powerW: r.power_w,
    photoUrl: r.photo_url,
  };
}
