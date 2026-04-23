import type { EntityClass, KgEdgeDto, KgNodeDto } from "@/dto/http";

export const KG_CLASSES: EntityClass[] = [
  "Satellite",
  "Operator",
  "OrbitRegime",
  "ConjunctionEvent",
  "Payload",
  "Maneuver",
  "Debris",
];

export type KgSceneNode = KgNodeDto & {
  position: [number, number, number];
  hubness: number;
  ghost?: boolean;
};

export type KgSceneEdge = KgEdgeDto & {
  sourcePosition: [number, number, number];
  targetPosition: [number, number, number];
};

export type KgSceneGraph = {
  nodes: KgSceneNode[];
  edges: KgSceneEdge[];
  hiddenReferenceCount: number;
};

const MAX_GHOST_REFERENCES = 32;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

// Composed orbital layers — Operators anchor the centre, Satellites form the
// primary belt, OrbitRegime hangs underneath as outer rings, ConjunctionEvents
// hover above the plane (alert layer), Debris/Maneuver fill the periphery.
// Tighter scaleX/scaleZ ratios keep the scene spherical instead of arc-flat.
const CLASS_ORBIT: Record<
  EntityClass,
  {
    radius: number;
    y: number;
    scaleX: number;
    scaleZ: number;
    hubPull: number;
    phase: number;
    verticalSpread: number; // Max Math.PI / 2 for full 3D globe spread
  }
> = {
  Operator: {
    radius: 1.8,
    y: 0,
    scaleX: 1.0,
    scaleZ: 1.0,
    hubPull: 0.15,
    phase: 1.1,
    verticalSpread: Math.PI * 0.35,
  },
  Payload: {
    radius: 2.8,
    y: 0,
    scaleX: 1.0,
    scaleZ: 1.0,
    hubPull: 0.25,
    phase: 1.9,
    verticalSpread: Math.PI * 0.45,
  },
  Maneuver: {
    radius: 3.0,
    y: 0,
    scaleX: 1.0,
    scaleZ: 1.0,
    hubPull: 0.28,
    phase: 2.9,
    verticalSpread: Math.PI * 0.45,
  },
  Satellite: {
    radius: 4.0,
    y: 0,
    scaleX: 1.0,
    scaleZ: 1.0,
    hubPull: 0.45,
    phase: 0,
    verticalSpread: Math.PI * 0.5, // full globe coverage
  },
  ConjunctionEvent: {
    radius: 3.6,
    y: 0,
    scaleX: 1.0,
    scaleZ: 1.0,
    hubPull: 0.35,
    phase: 0.54,
    verticalSpread: Math.PI * 0.5, // full globe coverage
  },
  OrbitRegime: {
    radius: 4.8,
    y: 0,
    scaleX: 1.05,
    scaleZ: 1.05,
    hubPull: 0.2,
    phase: 2.4,
    verticalSpread: Math.PI * 0.2, // core hubs remain slightly belted
  },
  Debris: {
    radius: 5.6,
    y: 0,
    scaleX: 1.0,
    scaleZ: 1.0,
    hubPull: 0.1,
    phase: 3.65,
    verticalSpread: Math.PI * 0.5, // full globe coverage
  },
};

export function buildKgSceneGraph({
  nodes,
  edges,
  findingTitleById,
}: {
  nodes: KgNodeDto[];
  edges: KgEdgeDto[];
  findingTitleById?: Map<string, string>;
}): KgSceneGraph {
  const degreeById = computeDegree(edges);
  const nodeById = new Map<string, KgNodeDto>();
  for (const node of nodes) {
    nodeById.set(node.id, {
      ...node,
      degree: node.degree || degreeById.get(node.id) || 0,
    });
  }

  const ghostCandidates = new Map<string, KgNodeDto>();
  for (const edge of edges) {
    if (!nodeById.has(edge.source)) {
      ghostCandidates.set(
        edge.source,
        ghostNode(edge.source, degreeById, findingTitleById),
      );
    }
    if (!nodeById.has(edge.target)) {
      ghostCandidates.set(
        edge.target,
        ghostNode(edge.target, degreeById, findingTitleById),
      );
    }
  }

  const visibleGhosts = selectVisibleGhosts([...ghostCandidates.values()], findingTitleById);
  for (const ghost of visibleGhosts) nodeById.set(ghost.id, ghost);

  const sceneNodes = layoutSceneNodes([...nodeById.values()], nodes, edges);
  const positionById = new Map(sceneNodes.map((node) => [node.id, node.position]));
  const sceneEdges = edges.flatMap<KgSceneEdge>((edge) => {
    const sourcePosition = positionById.get(edge.source);
    const targetPosition = positionById.get(edge.target);
    if (!sourcePosition || !targetPosition) return [];
    return [{ ...edge, sourcePosition, targetPosition }];
  });

  return {
    nodes: sceneNodes,
    edges: sceneEdges,
    hiddenReferenceCount: ghostCandidates.size - visibleGhosts.length,
  };
}

export function computeDegree(edges: KgEdgeDto[]): Map<string, number> {
  const degreeById = new Map<string, number>();
  for (const edge of edges) {
    degreeById.set(edge.source, (degreeById.get(edge.source) ?? 0) + 1);
    degreeById.set(edge.target, (degreeById.get(edge.target) ?? 0) + 1);
  }
  return degreeById;
}

export function classForEntityId(id: string): EntityClass {
  if (id.startsWith("finding:")) return "ConjunctionEvent";
  if (id.startsWith("conj:")) return "ConjunctionEvent";
  if (id.startsWith("sat:")) return "Satellite";
  if (id.startsWith("op:")) return "Operator";
  if (id.startsWith("regime:")) return "OrbitRegime";
  if (id.startsWith("payload:")) return "Payload";
  if (id.startsWith("maneuver:")) return "Maneuver";
  if (id.startsWith("debris:")) return "Debris";
  return "ConjunctionEvent";
}

function ghostNode(
  id: string,
  degreeById: Map<string, number>,
  findingTitleById?: Map<string, string>,
): KgNodeDto {
  return {
    id,
    label: labelForGhost(id, findingTitleById),
    class: classForEntityId(id),
    degree: degreeById.get(id) ?? 0,
    x: 0,
    y: 0,
    cortex: "derived",
  };
}

function labelForGhost(id: string, findingTitleById?: Map<string, string>): string {
  if (id.startsWith("finding:")) {
    const suffix = id.slice("finding:".length);
    return (
      findingTitleById?.get(id) ??
      findingTitleById?.get(`finding:f:${suffix}`) ??
      `Finding ${suffix}`
    );
  }
  return id;
}

function selectVisibleGhosts(
  ghosts: KgNodeDto[],
  findingTitleById?: Map<string, string>,
): KgNodeDto[] {
  return ghosts
    .slice()
    .sort((a, b) => {
      const aKnownFinding = Boolean(
        a.id.startsWith("finding:") && findingTitleById?.has(a.id),
      );
      const bKnownFinding = Boolean(
        b.id.startsWith("finding:") && findingTitleById?.has(b.id),
      );
      return (
        Number(bKnownFinding) - Number(aKnownFinding) ||
        b.degree - a.degree ||
        a.label.localeCompare(b.label)
      );
    })
    .slice(0, MAX_GHOST_REFERENCES);
}

function layoutSceneNodes(
  nodes: KgNodeDto[],
  originalNodes: KgNodeDto[],
  edges: KgEdgeDto[],
): KgSceneNode[] {
  const originalIds = new Set(originalNodes.map((node) => node.id));
  const byClass = new Map<EntityClass, KgNodeDto[]>();
  for (const node of nodes) {
    const bucket = byClass.get(node.class) ?? [];
    bucket.push(node);
    byClass.set(node.class, bucket);
  }

  const presentClasses = KG_CLASSES.filter((cls) => (byClass.get(cls)?.length ?? 0) > 0);
  if (presentClasses.length === 0) return [];
  const maxGlobalDegree = Math.max(1, ...nodes.map((node) => node.degree));
  const angleById = seedSatelliteAngles(nodes);
  const anchorAnglesById = collectAnchorAngles(edges, angleById);

  const out: KgSceneNode[] = [];
  presentClasses.forEach((cls) => {
    const list = (byClass.get(cls) ?? [])
      .slice()
      .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));
    const orbit = CLASS_ORBIT[cls];

    list.forEach((node, index) => {
      const hubness = node.degree / maxGlobalDegree;
      const ghost = !originalIds.has(node.id);
      const anchorAngle =
        angleById.get(node.id) ??
        averageAngle(anchorAnglesById.get(node.id)) ??
        orbit.phase + index * GOLDEN_ANGLE;
      const phi = anchorAngle + signedHash(node.id, "angle") * (ghost ? 0.2 : 0.3);
      
      // Neural Ribbon / Bird Flock distribution:
      // Theta oscillates in a sine wave based on phi to create an undulating swooping sheet.
      // orbit.verticalSpread dictates how high/low the wave swoops from the equator.
      const waveAmplitude = orbit.verticalSpread * 0.85;
      const waveBase = Math.PI / 2 + Math.sin(phi * 2) * waveAmplitude;
      
      // Jitter controls the "thickness" of the swarm sheet
      const thickness = ghost ? 0.2 : 0.12;
      const theta = waveBase + signedHash(node.id, "theta") * thickness;

      const laneOffset = ((index % 5) - 2) * 0.04;
      const ghostOffset = ghost ? 0.25 : 0;
      const baseRadius =
        orbit.radius -
        hubness * orbit.hubPull +
        laneOffset +
        ghostOffset +
        signedHash(node.id, "radius") * 0.1;
      
      // Organic "Neural Swarm" wave modifier
      // Bulges the ribbon outward at specific intervals for organic volume
      const swell = Math.cos(phi * 4) * 0.15;
      const swirlRadius = baseRadius * (1 + swell);

      // Spherical to Cartesian projection
      const x = Math.sin(theta) * Math.cos(phi) * swirlRadius * orbit.scaleX;
      const y = Math.cos(theta) * swirlRadius + orbit.y + (ghost ? 0.12 : 0);
      const z = Math.sin(theta) * Math.sin(phi) * swirlRadius * orbit.scaleZ;

      out.push({
        ...node,
        position: [
          Number(x.toFixed(4)),
          Number(y.toFixed(4)),
          Number(z.toFixed(4)),
        ],
        hubness: Number(hubness.toFixed(4)),
        ghost,
      });
    });
  });

  return out;
}

function seedSatelliteAngles(nodes: KgNodeDto[]): Map<string, number> {
  const angles = new Map<string, number>();
  const satellites = nodes
    .filter((node) => node.class === "Satellite")
    .slice()
    .sort((a, b) => b.degree - a.degree || a.label.localeCompare(b.label) || a.id.localeCompare(b.id));

  satellites.forEach((node, index) => {
    angles.set(node.id, index * GOLDEN_ANGLE + signedHash(node.id, "sat") * 0.2);
  });

  return angles;
}

function collectAnchorAngles(
  edges: KgEdgeDto[],
  angleById: Map<string, number>,
): Map<string, number[]> {
  const anchors = new Map<string, number[]>();
  for (const edge of edges) {
    const sourceAngle = angleById.get(edge.source);
    const targetAngle = angleById.get(edge.target);
    if (sourceAngle !== undefined && targetAngle === undefined) {
      pushAnchor(anchors, edge.target, sourceAngle);
    }
    if (targetAngle !== undefined && sourceAngle === undefined) {
      pushAnchor(anchors, edge.source, targetAngle);
    }
  }
  return anchors;
}

function pushAnchor(anchors: Map<string, number[]>, nodeId: string, angle: number): void {
  const list = anchors.get(nodeId) ?? [];
  list.push(angle);
  anchors.set(nodeId, list);
}

function averageAngle(angles?: number[]): number | null {
  if (!angles?.length) return null;
  let x = 0;
  let y = 0;
  for (const angle of angles) {
    x += Math.cos(angle);
    y += Math.sin(angle);
  }
  return Math.atan2(y / angles.length, x / angles.length);
}

function signedHash(input: string, salt: string): number {
  return hash01(`${salt}:${input}`) * 2 - 1;
}

function hash01(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}
