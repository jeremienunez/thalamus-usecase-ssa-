import type { PoolClient } from "pg";

export const E2E_DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgres://thalamus:thalamus@localhost:5433/thalamus";

export const SWEEP_MISSION_SATELLITE_IDS = Array.from(
  { length: 10 },
  (_, index) => BigInt(9900101 + index),
);

export const KNN_TARGET_ID = 9901001n;
export const KNN_NEIGHBOUR_IDS = [9901002n, 9901003n, 9901004n] as const;
export const HTTP_SMOKE_CYCLE_ID = 9903000n;
export const HTTP_SMOKE_FINDING_ID = 9903001n;
export const HTTP_SMOKE_SATELLITE_ID = 9903002n;
export const HTTP_SMOKE_OPERATOR_ID = 9903003n;
export const HTTP_SMOKE_REGIME_ID = 9903004n;

const CONJUNCTION_OPERATOR_IDS = [9902001n, 9902002n] as const;
const CONJUNCTION_BUS_ID = 9902010n;
const CONJUNCTION_PRIMARY_ID = 9902100n;
const CONJUNCTION_SECONDARY_ID = 9902200n;
export const CONJUNCTION_ID = 9902300n;
export const CONJUNCTION_PRIMARY_NORAD_ID = 9925544;
export const CONJUNCTION_SECONDARY_NORAD_ID = 9950001;

function halfvecLiteral(head: number[]): string {
  const values = Array.from({ length: 2048 }, (_, index) => head[index] ?? 0);
  return `[${values.join(",")}]`;
}

async function upsertPayloadSatellite(
  client: PoolClient,
  args: {
    id: bigint;
    name: string;
    slug: string;
    noradId: number;
    massKg?: number | null;
    lifetime?: number | null;
    operatorId?: bigint | null;
    satelliteBusId?: bigint | null;
    telemetrySummary?: Record<string, unknown> | null;
    embeddingHead?: number[] | null;
  },
): Promise<void> {
  await client.query(
    `
      INSERT INTO satellite (
        id,
        name,
        slug,
        norad_id,
        object_class,
        operator_id,
        satellite_bus_id,
        mass_kg,
        lifetime,
        telemetry_summary
      )
      VALUES ($1, $2, $3, $4, 'payload', $5, $6, $7, $8, $9::jsonb)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        norad_id = EXCLUDED.norad_id,
        object_class = EXCLUDED.object_class,
        operator_id = EXCLUDED.operator_id,
        satellite_bus_id = EXCLUDED.satellite_bus_id,
        mass_kg = EXCLUDED.mass_kg,
        lifetime = EXCLUDED.lifetime,
        telemetry_summary = EXCLUDED.telemetry_summary
    `,
    [
      String(args.id),
      args.name,
      args.slug,
      args.noradId,
      args.operatorId ? String(args.operatorId) : null,
      args.satelliteBusId ? String(args.satelliteBusId) : null,
      args.massKg ?? null,
      args.lifetime ?? null,
      JSON.stringify(args.telemetrySummary ?? {}),
    ],
  );

  if (args.embeddingHead) {
    await client.query(
      `
        UPDATE satellite
        SET embedding = $2::halfvec(2048),
            embedding_model = 'test-fixture',
            embedded_at = NOW()
        WHERE id = $1
      `,
      [String(args.id), halfvecLiteral(args.embeddingHead)],
    );
  }
}

export async function seedSweepMissionSatellites(
  client: PoolClient,
): Promise<string[]> {
  for (const [index, satelliteId] of SWEEP_MISSION_SATELLITE_IDS.entries()) {
    await upsertPayloadSatellite(client, {
      id: satelliteId,
      name: `mission-payload-${index + 1}`,
      slug: `mission-payload-${index + 1}`,
      noradId: 880001 + index,
    });
  }

  return SWEEP_MISSION_SATELLITE_IDS.map((id) => id.toString());
}

export async function seedKnnFixture(client: PoolClient): Promise<{
  targetId: string;
  neighbourIds: string[];
}> {
  await upsertPayloadSatellite(client, {
    id: KNN_TARGET_ID,
    name: "knn-target",
    slug: "knn-target",
    noradId: 881001,
    massKg: null,
    lifetime: null,
    telemetrySummary: { regime: "LEO", raan: 10, meanMotion: 15 },
    embeddingHead: [1, 0],
  });

  const neighbours: Array<{
    id: bigint;
    name: string;
    slug: string;
    noradId: number;
    massKg: number;
    lifetime: number;
    embeddingHead: number[];
  }> = [
    {
      id: KNN_NEIGHBOUR_IDS[0],
      name: "knn-neighbour-near",
      slug: "knn-neighbour-near",
      noradId: 881002,
      massKg: 100,
      lifetime: 12,
      embeddingHead: [0.999, 0.001],
    },
    {
      id: KNN_NEIGHBOUR_IDS[1],
      name: "knn-neighbour-mid",
      slug: "knn-neighbour-mid",
      noradId: 881003,
      massKg: 102,
      lifetime: 12,
      embeddingHead: [0.998, 0.002],
    },
    {
      id: KNN_NEIGHBOUR_IDS[2],
      name: "knn-neighbour-far",
      slug: "knn-neighbour-far",
      noradId: 881004,
      massKg: 98,
      lifetime: 11,
      embeddingHead: [0.997, 0.003],
    },
  ];

  for (const neighbour of neighbours) {
    await upsertPayloadSatellite(client, {
      id: neighbour.id,
      name: neighbour.name,
      slug: neighbour.slug,
      noradId: neighbour.noradId,
      massKg: neighbour.massKg,
      lifetime: neighbour.lifetime,
      telemetrySummary: { regime: "LEO", raan: 20, meanMotion: 15 },
      embeddingHead: neighbour.embeddingHead,
    });
  }

  return {
    targetId: KNN_TARGET_ID.toString(),
    neighbourIds: KNN_NEIGHBOUR_IDS.map((id) => id.toString()),
  };
}

export async function cleanupKnnFixture(client: PoolClient): Promise<void> {
  const ids = [KNN_TARGET_ID, ...KNN_NEIGHBOUR_IDS].map(String);
  await client.query(
    `
      DELETE FROM research_edge
      WHERE entity_type = 'satellite'
        AND entity_id = ANY($1::bigint[])
    `,
    [ids],
  );
  await client.query(
    `
      DELETE FROM research_finding
      WHERE cortex = 'data_auditor'
        AND title LIKE 'KNN fill%'
    `,
  );
  await client.query(
    `
      DELETE FROM satellite
      WHERE id = ANY($1::bigint[])
    `,
    [ids],
  );
}

export async function seedConjunctionFixture(
  client: PoolClient,
): Promise<void> {
  await client.query(
    `
      INSERT INTO operator (id, name, slug)
      VALUES
        ($1, 'NASA', 'nasa-e2e'),
        ($2, 'SpaceX', 'spacex-e2e')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug
    `,
    [String(CONJUNCTION_OPERATOR_IDS[0]), String(CONJUNCTION_OPERATOR_IDS[1])],
  );

  await client.query(
    `
      INSERT INTO satellite_bus (id, name)
      VALUES ($1, 'A2100')
      ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name
    `,
    [String(CONJUNCTION_BUS_ID)],
  );

  await upsertPayloadSatellite(client, {
    id: CONJUNCTION_PRIMARY_ID,
    name: "ISS",
    slug: "iss-e2e",
    noradId: CONJUNCTION_PRIMARY_NORAD_ID,
    operatorId: CONJUNCTION_OPERATOR_IDS[0],
    satelliteBusId: CONJUNCTION_BUS_ID,
    telemetrySummary: {
      regime: "LEO",
      tleEpoch: "2026-04-20T12:00:00.000Z",
      meanMotion: 15.5,
    },
  });
  await upsertPayloadSatellite(client, {
    id: CONJUNCTION_SECONDARY_ID,
    name: "STARLINK-1000",
    slug: "starlink-1000-e2e",
    noradId: CONJUNCTION_SECONDARY_NORAD_ID,
    operatorId: CONJUNCTION_OPERATOR_IDS[1],
    telemetrySummary: {
      regime: "LEO",
      meanMotion: 15.4,
    },
  });

  await client.query(
    `
      INSERT INTO conjunction_event (
        id,
        primary_satellite_id,
        secondary_satellite_id,
        epoch,
        min_range_km,
        relative_velocity_kmps,
        probability_of_collision,
        primary_sigma_km,
        secondary_sigma_km,
        combined_sigma_km,
        hard_body_radius_m,
        pc_method,
        computed_at
      )
      VALUES (
        $1,
        $2,
        $3,
        NOW() + interval '1 hour',
        1.5,
        12.3,
        1e-5,
        0.2,
        0.3,
        0.36,
        15,
        'foster-gaussian',
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        primary_satellite_id = EXCLUDED.primary_satellite_id,
        secondary_satellite_id = EXCLUDED.secondary_satellite_id,
        epoch = EXCLUDED.epoch,
        min_range_km = EXCLUDED.min_range_km,
        relative_velocity_kmps = EXCLUDED.relative_velocity_kmps,
        probability_of_collision = EXCLUDED.probability_of_collision,
        primary_sigma_km = EXCLUDED.primary_sigma_km,
        secondary_sigma_km = EXCLUDED.secondary_sigma_km,
        combined_sigma_km = EXCLUDED.combined_sigma_km,
        hard_body_radius_m = EXCLUDED.hard_body_radius_m,
        pc_method = EXCLUDED.pc_method,
        computed_at = EXCLUDED.computed_at
    `,
    [
      String(CONJUNCTION_ID),
      String(CONJUNCTION_PRIMARY_ID),
      String(CONJUNCTION_SECONDARY_ID),
    ],
  );
}

export async function cleanupConjunctionFixture(client: PoolClient): Promise<void> {
  await client.query(
    `
      DELETE FROM conjunction_event
      WHERE id = $1::bigint
    `,
    [String(CONJUNCTION_ID)],
  );
  await client.query(
    `
      DELETE FROM satellite
      WHERE id = ANY($1::bigint[])
    `,
    [[
      String(CONJUNCTION_PRIMARY_ID),
      String(CONJUNCTION_SECONDARY_ID),
    ]],
  );
  await client.query(
    `
      DELETE FROM satellite_bus
      WHERE id = $1::bigint
    `,
    [String(CONJUNCTION_BUS_ID)],
  );
  await client.query(
    `
      DELETE FROM operator
      WHERE id = ANY($1::bigint[])
    `,
    [CONJUNCTION_OPERATOR_IDS.map(String)],
  );
}

export async function seedHttpSmokeFixture(client: PoolClient): Promise<void> {
  await client.query(
    `
      INSERT INTO operator (id, name, slug)
      VALUES ($1, 'Smoke Operator', 'smoke-operator')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug
    `,
    [String(HTTP_SMOKE_OPERATOR_ID)],
  );

  await client.query(
    `
      INSERT INTO orbit_regime (id, name)
      VALUES ($1, 'SMOKE-LEO')
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name
    `,
    [String(HTTP_SMOKE_REGIME_ID)],
  );

  await upsertPayloadSatellite(client, {
    id: HTTP_SMOKE_SATELLITE_ID,
    name: "smoke-sat",
    slug: "smoke-sat",
    noradId: 883002,
    operatorId: HTTP_SMOKE_OPERATOR_ID,
    telemetrySummary: {
      regime: "SMOKE-LEO",
      meanMotion: 15.2,
    },
  });

  await client.query(
    `
      INSERT INTO research_cycle (
        id,
        trigger_type,
        trigger_source,
        cortices_used,
        status,
        findings_count,
        started_at,
        completed_at
      )
      VALUES (
        $1,
        'system',
        'http-smoke',
        ARRAY['catalog'],
        'completed',
        1,
        NOW(),
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        trigger_source = EXCLUDED.trigger_source,
        cortices_used = EXCLUDED.cortices_used,
        status = EXCLUDED.status,
        findings_count = EXCLUDED.findings_count,
        completed_at = EXCLUDED.completed_at
    `,
    [String(HTTP_SMOKE_CYCLE_ID)],
  );

  await client.query(
    `
      INSERT INTO research_finding (
        id,
        research_cycle_id,
        cortex,
        finding_type,
        status,
        urgency,
        title,
        summary,
        evidence,
        reasoning,
        confidence,
        impact_score
      )
      VALUES (
        $1,
        $2,
        'catalog',
        'insight',
        'active',
        'high',
        'Smoke Finding',
        'Synthetic finding for HTTP smoke coverage',
        $3::jsonb,
        'smoke reasoning',
        0.88,
        0.88
      )
      ON CONFLICT (id) DO UPDATE SET
        research_cycle_id = EXCLUDED.research_cycle_id,
        title = EXCLUDED.title,
        summary = EXCLUDED.summary,
        evidence = EXCLUDED.evidence,
        reasoning = EXCLUDED.reasoning,
        confidence = EXCLUDED.confidence,
        impact_score = EXCLUDED.impact_score
    `,
    [
      String(HTTP_SMOKE_FINDING_ID),
      String(HTTP_SMOKE_CYCLE_ID),
      JSON.stringify([
        {
          source: "osint",
          data: {
            url: "https://example.org/smoke-finding",
            snippet: "Synthetic smoke evidence",
          },
        },
      ]),
    ],
  );

  await client.query(
    `
      INSERT INTO research_cycle_finding (
        research_cycle_id,
        research_finding_id,
        iteration,
        is_dedup_hit
      )
      VALUES ($1, $2, 0, false)
      ON CONFLICT (research_cycle_id, research_finding_id) DO NOTHING
    `,
    [String(HTTP_SMOKE_CYCLE_ID), String(HTTP_SMOKE_FINDING_ID)],
  );

  await client.query(
    `
      INSERT INTO research_edge (
        finding_id,
        entity_type,
        entity_id,
        relation,
        weight,
        context
      )
      VALUES
        ($1, 'satellite', $2, 'about', 1, '{"source":"http-smoke"}'::jsonb),
        ($1, 'operator', $3, 'supports', 1, '{"source":"http-smoke"}'::jsonb),
        ($1, 'orbit_regime', $4, 'about', 1, '{"source":"http-smoke"}'::jsonb)
    `,
    [
      String(HTTP_SMOKE_FINDING_ID),
      String(HTTP_SMOKE_SATELLITE_ID),
      String(HTTP_SMOKE_OPERATOR_ID),
      String(HTTP_SMOKE_REGIME_ID),
    ],
  );
}

export async function cleanupHttpSmokeFixture(client: PoolClient): Promise<void> {
  await client.query(
    `
      DELETE FROM research_edge
      WHERE finding_id = $1::bigint
    `,
    [String(HTTP_SMOKE_FINDING_ID)],
  );
  await client.query(
    `
      DELETE FROM research_cycle_finding
      WHERE research_cycle_id = $1::bigint
         OR research_finding_id = $2::bigint
    `,
    [String(HTTP_SMOKE_CYCLE_ID), String(HTTP_SMOKE_FINDING_ID)],
  );
  await client.query(
    `
      DELETE FROM research_finding
      WHERE id = $1::bigint
    `,
    [String(HTTP_SMOKE_FINDING_ID)],
  );
  await client.query(
    `
      DELETE FROM research_cycle
      WHERE id = $1::bigint
    `,
    [String(HTTP_SMOKE_CYCLE_ID)],
  );
  await client.query(
    `
      DELETE FROM satellite
      WHERE id = $1::bigint
    `,
    [String(HTTP_SMOKE_SATELLITE_ID)],
  );
  await client.query(
    `
      DELETE FROM operator
      WHERE id = $1::bigint
    `,
    [String(HTTP_SMOKE_OPERATOR_ID)],
  );
  await client.query(
    `
      DELETE FROM orbit_regime
      WHERE id = $1::bigint
    `,
    [String(HTTP_SMOKE_REGIME_ID)],
  );
}
