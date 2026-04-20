// Row shape for satellite_payload ⋈ payload join — authoritative; repo re-exports.
// Invariants: id: string (bigint serialised), nulls explicit, snake_case columns.

export type SatellitePayloadRow = {
  id: string;
  name: string;
  slug: string;
  role: string | null;
  mass_kg: number | null;
  power_w: number | null;
  photo_url: string | null;
};
