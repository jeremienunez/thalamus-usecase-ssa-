import { useMemo, useRef, useState, useEffect } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { SatelliteDTO } from "@/lib/api";
import { regimeColor, satellitePosition } from "@/lib/orbit";

const colorCache = new Map<string, THREE.Color>();
function getCompanyColor(name: string): THREE.Color {
  const n = name.toUpperCase();
  const prefix = n.split("-")[0] || n.substring(0, 4);
  if (colorCache.has(prefix)) return colorCache.get(prefix)!;

  let color;
  if (n.includes("THAL")) color = new THREE.Color(0xFFC000); // Thales stays gold
  else if (n.includes("NASA")) color = new THREE.Color(0x05d9e8); // NASA Cyan
  else if (n.includes("JAXA")) color = new THREE.Color(0x01ffc3); // JAXA Mint
  else if (n.includes("ISRO") || n.includes("INDIA")) color = new THREE.Color(0xffb300); // ISRO Orange
  else if (n.includes("PLAN")) color = new THREE.Color(0xb5179e); // Planet Purple
  else if (n.includes("CNES")) color = new THREE.Color(0x4361ee); // CNES Blue
  else if (n.includes("CNSA")) color = new THREE.Color(0xd90429); // CNSA Red
  else if (n.includes("SPACE") || n.includes("STAR")) color = new THREE.Color(0xaaaaaa); // SpaceX Silver
  else {
    let hash = 0;
    for (let i = 0; i < prefix.length; i++) hash = prefix.charCodeAt(i) + ((hash << 5) - hash);
    color = new THREE.Color().setHSL(Math.abs(hash % 360) / 360, 0.85, 0.55);
  }
  colorCache.set(prefix, color);
  return color;
}

type Props = {
  satellites: SatelliteDTO[];
  selectedId?: number | null;
  onSelect: (id: number) => void;
  timeScale: number;
  labelIds?: number[];
};

const busTmp = new THREE.Object3D();
const childTmp = new THREE.Object3D();
const hideTmp = new THREE.Object3D();
hideTmp.scale.setScalar(0);
hideTmp.updateMatrixWorld(true);

const tmpColor = new THREE.Color();
const upVec = new THREE.Vector3(0, 1, 0);

function makeHaloTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.55)");
  grad.addColorStop(0.6, "rgba(255,255,255,0.08)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Generates highly realistic "multi-layer insulation" (MLI) crinkle bump maps
function makeGoldBumpTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  
  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, size, size);
  
  // Draw random sharp geometric polygons for metallic foil crumples
  for (let i = 0; i < 400; i++) {
    const darkness = Math.random();
    ctx.fillStyle = `rgba(255,255,255,${darkness})`;
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = 10 + Math.random() * 30; // large crinkles
    ctx.moveTo(x, y);
    ctx.lineTo(x + s, y + (Math.random() - 0.5) * s);
    ctx.lineTo(x + (Math.random() - 0.5) * s, y + s);
    ctx.fill();
  }
  
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

// Generates high-contrast glowing solar panel grids
function makeSolarPanelTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  
  // Base vibrant deep blue
  ctx.fillStyle = "#0D3B66"; 
  ctx.fillRect(0, 0, size, size);
  
  // Glowing cyan grid lattice
  ctx.strokeStyle = "#4CC9F0"; 
  ctx.lineWidth = 6;
  const cellsX = 10;
  const cellsY = 4; 
  for (let i = 0; i <= size; i += size/cellsX) {
    ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, size); ctx.stroke();
  }
  for (let i = 0; i <= size; i += size/cellsY) {
    ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(size, i); ctx.stroke();
  }

  // Pre-bake an anisotropic highlight into the texture map
  const grad = ctx.createLinearGradient(0, 0, size, size);
  grad.addColorStop(0, "rgba(255,255,255,0.85)");
  grad.addColorStop(0.4, "rgba(255,255,255,0)");
  grad.addColorStop(1, "rgba(255,255,255,0.4)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.anisotropy = 16;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Bus-archetype classifier. Drives which 3D model an instance picks up.
 *
 * Prefer explicit operator-family matches (they tell us the mission class
 * beyond what the orbital regime alone implies). Fall back to regime when
 * the name doesn't disclose an operator.
 *
 * TELECOM  → large bus, big solar panels, dishes (GEO comms, MEO GNSS buses)
 * PROBE    → instrument-platform style (ISS, weather sats, science)
 * SMALLSAT → flat black box + single panel (Starlink-class, cubesats)
 */
const getModelType = (s: SatelliteDTO): "TELECOM" | "PROBE" | "SMALLSAT" => {
  const n = s.name.toUpperCase();

  // Station-class / platforms
  if (
    n.includes("ISS") ||
    n.includes("TIANGONG") ||
    n.includes("HUBBLE") ||
    n.includes("HST") ||
    n.includes("TIANHE") ||
    n.includes("TIANZHOU")
  ) return "PROBE";

  // Science / weather / Earth observation — instrument platforms
  if (
    n.startsWith("NOAA") ||
    n.startsWith("GOES") ||
    n.startsWith("LANDSAT") ||
    n.startsWith("TERRA") ||
    n.startsWith("AQUA") ||
    n.startsWith("AURA") ||
    n.startsWith("METOP") ||
    n.startsWith("SENTINEL") ||
    n.startsWith("CRYOSAT") ||
    n.startsWith("JPSS") ||
    n.startsWith("TDRS") ||
    n.startsWith("METEOR") ||
    n.startsWith("ICESAT") ||
    n.startsWith("CALIPSO") ||
    n.startsWith("JASON") ||
    n.startsWith("SMAP") ||
    n.startsWith("TIROS") ||
    n.includes("NASA") ||
    n.includes("JAXA") ||
    n.includes("ISRO") ||
    n.includes("CNSA") ||
    n.includes("ESA")
  ) return "PROBE";

  // Commercial / government comms buses — big dish + panel assemblies
  if (
    n.startsWith("INTELSAT") ||
    n.startsWith("INMARSAT") ||
    n.startsWith("EUTELSAT") ||
    n.startsWith("SES") ||
    n.startsWith("DIRECTV") ||
    n.startsWith("ECHOSTAR") ||
    n.startsWith("GALAXY") ||
    n.startsWith("ASTRA") ||
    n.startsWith("NIMIQ") ||
    n.startsWith("JCSAT") ||
    n.startsWith("NSS") ||
    n.startsWith("AMC") ||
    n.startsWith("ASIASAT") ||
    n.startsWith("VIASAT") ||
    n.startsWith("SKYNET") ||
    n.startsWith("WGS") ||
    n.startsWith("MILSTAR") ||
    n.startsWith("MUOS") ||
    n.startsWith("SICRAL") ||
    n.startsWith("GSAT") ||
    n.includes("THAL") ||
    n.includes("CNES")
  ) return "TELECOM";

  // GNSS buses — large structure with directional antennas
  if (
    n.startsWith("NAVSTAR") ||
    n.startsWith("GPS") ||
    n.startsWith("GALILEO") ||
    n.startsWith("BEIDOU") ||
    n.startsWith("GLONASS") ||
    n.startsWith("QZS") ||
    n.startsWith("IRNSS")
  ) return "TELECOM";

  // Regime-based fallback: GEO is almost always a big comms bus
  if (s.regime === "GEO") return "TELECOM";

  // LEO constellations (Starlink / OneWeb / Iridium / Planet / Globalstar /
  // Orbcomm / Cosmos), plus anything we didn't classify — flat-panel smallsat
  return "SMALLSAT";
};

export function SatelliteField({ satellites, selectedId, onSelect, timeScale, labelIds = [] }: Props) {
  const haloRef = useRef<THREE.InstancedMesh>(null);
  
  const m = {
    goldBox: useRef<THREE.InstancedMesh>(null),
    silverCyl: useRef<THREE.InstancedMesh>(null),
    blackFlatBox: useRef<THREE.InstancedMesh>(null),
    goldCap: useRef<THREE.InstancedMesh>(null),
    panelHuge: useRef<THREE.InstancedMesh>(null),
    panelSmall: useRef<THREE.InstancedMesh>(null),
    panelSingle: useRef<THREE.InstancedMesh>(null),
    dishes: useRef<THREE.InstancedMesh>(null),
    struts: useRef<THREE.InstancedMesh>(null),
    longAntenna: useRef<THREE.InstancedMesh>(null),
  };
  
  const tRef = useRef(0);
  const [, force] = useState(0);
  const [floatingIds, setFloatingIds] = useState<number[]>([]);

  useEffect(() => {
    if (satellites.length === 0) return;
    const interval = setInterval(() => {
      const randoms: number[] = [];
      for (let i = 0; i < 4; i++) {
        const pick = satellites[Math.floor(Math.random() * satellites.length)];
        if (pick) randoms.push(pick.id);
      }
      setFloatingIds(randoms);
    }, 5000);
    return () => clearInterval(interval);
  }, [satellites]);

  const positions = useMemo(
    () => new Array(satellites.length).fill(0).map(() => new THREE.Vector3()),
    [satellites.length],
  );

  const viewData = useMemo(() => {
    const goldBump = makeGoldBumpTexture();
    const panelTex = makeSolarPanelTexture();
    return {
      haloTex: makeHaloTexture(),
      
      // Universal vibrant chassis material that dynamically accepts instance color!
      matChassis: new THREE.MeshPhysicalMaterial({ 
        color: 0xffffff, // White base seamlessly catches the injected instance color overlay
        emissive: 0x222222, 
        metalness: 1.0, 
        roughness: 0.25, 
        clearcoat: 1.0,
        clearcoatRoughness: 0.2,
        bumpMap: goldBump, // keep the incredible foil crinkles!
        bumpScale: 0.08 
      }),
      // Gleaming Aerospace Silver/White Array
      matSilver: new THREE.MeshPhysicalMaterial({ 
        color: 0xffffff, 
        emissive: 0x112244,
        roughness: 0.1, 
        metalness: 1.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.1
      }),
      // Carbon/Black Chassis
      matBlack: new THREE.MeshPhysicalMaterial({ 
        color: 0x050505, 
        emissive: 0x111111,
        roughness: 0.4, 
        metalness: 0.6,
        clearcoatRoughness: 0.5
      }),
      // Insanely vibrant glowing active solar arrays
      matPanel: new THREE.MeshPhysicalMaterial({ 
        map: panelTex, 
        emissiveMap: panelTex,
        emissive: 0xffffff,
        emissiveIntensity: 2.0, // Let them truly glow!
        color: 0xffffff,
        metalness: 1.0, 
        roughness: 0.1,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05
      }),
    };
  }, []);

  const labelIdSet = useMemo(() => new Set([...labelIds, ...floatingIds]), [labelIds, floatingIds]);

  useEffect(() => {
    if (!haloRef.current) return;
    
    // We will dynamically paint the chassis of every model based on the satellite's company
    const bodyMeshes = [
      haloRef.current,
      m.goldBox.current,
      m.silverCyl.current,
      m.blackFlatBox.current,
      m.goldCap.current,
    ];
    
    // OpacityScout overlay: satellites with a high opacity score pick up a
    // subtle cyan tint so reviewers can spot them without the globe screaming.
    // We're analysts, not witch-hunters — soft cue, not an alert.
    const opacityHigh = new THREE.Color(0x67d2ff);
    const opacityMid = new THREE.Color(0xa8e3ff);

    satellites.forEach((s, i) => {
      const baseCol = getCompanyColor(s.name);
      const score = s.opacityScore ?? 0;
      const col =
        score >= 0.9
          ? baseCol.clone().lerp(opacityHigh, 0.6)
          : score >= 0.7
            ? baseCol.clone().lerp(opacityMid, 0.4)
            : baseCol;
      bodyMeshes.forEach(mesh => {
        if (mesh) mesh.setColorAt(i, col);
      });
    });

    bodyMeshes.forEach(mesh => {
      if (mesh && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    });
  }, [satellites]);

  useFrame(({ camera }, dt) => {
    const halo = haloRef.current;
    if (!halo) return;
    
    tRef.current += dt * timeScale;
    const camQuat = camera.quaternion;
    
    const renderPart = (mesh: THREE.InstancedMesh | null, i: number, pos: [number,number,number], rot?: [number,number,number]) => {
      if (!mesh) return;
      childTmp.position.set(...pos);
      if (rot) childTmp.quaternion.setFromEuler(new THREE.Euler(...rot));
      else childTmp.quaternion.identity();
      childTmp.scale.setScalar(1);
      busTmp.add(childTmp);
      childTmp.updateMatrixWorld(true);
      mesh.setMatrixAt(i, childTmp.matrixWorld);
      busTmp.remove(childTmp);
    };

    const hide = (mesh: THREE.InstancedMesh | null, i: number) => {
      if (mesh) mesh.setMatrixAt(i, hideTmp.matrixWorld);
    };

    satellites.forEach((s, i) => {
      const p = satellitePosition(s, tRef.current, positions[i]);
      const isSelected = selectedId === s.id;
      const type = getModelType(s);
      
      const up = p.clone().normalize();
      
      if (type === "TELECOM") {
        const baseScale = isSelected ? 5.5 : 3.8;
        busTmp.position.copy(p); busTmp.quaternion.setFromUnitVectors(upVec, up); 
        busTmp.rotateY((i + tRef.current)*0.08); busTmp.scale.setScalar(baseScale); busTmp.updateMatrixWorld(true);
        m.goldBox.current?.setMatrixAt(i, busTmp.matrixWorld);
        
        const wRot = (tRef.current + i) * 0.2;
        renderPart(m.panelHuge.current, i*2, [0.045, 0, 0], [wRot, 0, 0]);
        renderPart(m.panelHuge.current, i*2+1, [-0.045, 0, 0], [wRot, 0, 0]);
        
        renderPart(m.dishes.current, i*2, [0, 0, 0.02], [Math.PI/2, 0, 0]);
        renderPart(m.dishes.current, i*2+1, [0, 0, -0.02], [-Math.PI/2, 0, 0]);
        
        renderPart(m.struts.current, i*4, [0.015, 0, 0], [0, 0, Math.PI/2]);
        renderPart(m.struts.current, i*4+1, [-0.015, 0, 0], [0, 0, Math.PI/2]);
        renderPart(m.struts.current, i*4+2, [0, 0, 0.01], [Math.PI/2, 0, 0]);
        renderPart(m.struts.current, i*4+3, [0, 0, -0.01], [Math.PI/2, 0, 0]);

        // Hide unused parts
        hide(m.silverCyl.current, i); hide(m.blackFlatBox.current, i); hide(m.goldCap.current, i);
        hide(m.panelSmall.current, i*2); hide(m.panelSmall.current, i*2+1);
        hide(m.panelSingle.current, i); hide(m.longAntenna.current, i);

      } else if (type === "PROBE") {
        const baseScale = isSelected ? 5.0 : 3.2;
        busTmp.position.copy(p); busTmp.quaternion.setFromUnitVectors(upVec, up); 
        busTmp.rotateY((i + tRef.current)*0.15); busTmp.scale.setScalar(baseScale); busTmp.updateMatrixWorld(true);
        m.silverCyl.current?.setMatrixAt(i, busTmp.matrixWorld);

        const wRot = (tRef.current + i) * 0.1;
        renderPart(m.goldCap.current, i, [0, 0.015, 0]);
        renderPart(m.longAntenna.current, i, [0, -0.025, 0]);
        
        renderPart(m.panelSmall.current, i*2, [0.025, 0, 0], [wRot, 0, 0]);
        renderPart(m.panelSmall.current, i*2+1, [-0.025, 0, 0], [wRot, 0, 0]);

        // Hide unused parts
        hide(m.goldBox.current, i); hide(m.blackFlatBox.current, i);
        hide(m.panelHuge.current, i*2); hide(m.panelHuge.current, i*2+1);
        hide(m.panelSingle.current, i);
        hide(m.dishes.current, i*2); hide(m.dishes.current, i*2+1);
        hide(m.struts.current, i*4); hide(m.struts.current, i*4+1); hide(m.struts.current, i*4+2); hide(m.struts.current, i*4+3);

      } else { // SMALLSAT
        const baseScale = isSelected ? 4.0 : 2.5;
        busTmp.position.copy(p); busTmp.quaternion.setFromUnitVectors(upVec, up); 
        busTmp.rotateY((i + tRef.current)*0.05); busTmp.scale.setScalar(baseScale); busTmp.updateMatrixWorld(true);
        m.blackFlatBox.current?.setMatrixAt(i, busTmp.matrixWorld);

        renderPart(m.panelSingle.current, i, [0.025, 0, 0], [Math.sin(tRef.current + i) * 0.2, 0, 0]);

        // Hide unused parts
        hide(m.goldBox.current, i); hide(m.silverCyl.current, i); hide(m.goldCap.current, i);
        hide(m.panelHuge.current, i*2); hide(m.panelHuge.current, i*2+1);
        hide(m.panelSmall.current, i*2); hide(m.panelSmall.current, i*2+1);
        hide(m.dishes.current, i*2); hide(m.dishes.current, i*2+1);
        hide(m.struts.current, i*4); hide(m.struts.current, i*4+1); hide(m.struts.current, i*4+2); hide(m.struts.current, i*4+3);
        hide(m.longAntenna.current, i);
      }

      // Halo layer mapping
      const pulse = 1 + Math.sin(tRef.current * 2 + i) * 0.08;
      childTmp.position.copy(p);
      childTmp.quaternion.copy(camQuat);
      childTmp.scale.setScalar(isSelected ? 6 : 4.0 * pulse);
      childTmp.updateMatrix();
      halo.setMatrixAt(i, childTmp.matrix);
    });
    
    // Commit all matrix transforms
    Object.values(m).forEach(mesh => mesh.current && (mesh.current.instanceMatrix.needsUpdate = true));
    halo.instanceMatrix.needsUpdate = true;
    
    if (labelIdSet.size > 0 && tRef.current % 0.2 < dt) force((n) => (n + 1) % 1024);
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id === undefined) return;
    const sat = satellites[id];
    if (sat) onSelect(sat.id);
  };

  const labeled = useMemo(
    () => satellites.filter((s) => labelIdSet.has(s.id) || s.id === selectedId),
    [satellites, labelIdSet, selectedId],
  );

  return (
    <group>
      {/* Halo layer */}
      <instancedMesh ref={haloRef} args={[undefined, undefined, satellites.length]} renderOrder={1}>
        <planeGeometry args={[0.065, 0.065]} />
        <meshBasicMaterial vertexColors color={0xffffff} map={viewData.haloTex} transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
      </instancedMesh>

      {/* CORE BODIES (Dynamically Color-Coded by Enterprise using matChassis) */}
      <instancedMesh ref={m.goldBox} args={[undefined, undefined, satellites.length]} onClick={handleClick} material={viewData.matChassis}>
        <boxGeometry args={[0.015, 0.015, 0.02]} />
      </instancedMesh>
      <instancedMesh ref={m.silverCyl} args={[undefined, undefined, satellites.length]} onClick={handleClick} material={viewData.matChassis}>
        <cylinderGeometry args={[0.008, 0.008, 0.03, 16]} />
      </instancedMesh>
      <instancedMesh ref={m.blackFlatBox} args={[undefined, undefined, satellites.length]} onClick={handleClick} material={viewData.matChassis}>
        <boxGeometry args={[0.012, 0.006, 0.016]} />
      </instancedMesh>
      <instancedMesh ref={m.goldCap} args={[undefined, undefined, satellites.length]} material={viewData.matChassis}>
        <cylinderGeometry args={[0.0085, 0.0085, 0.005, 16]} />
      </instancedMesh>

      {/* SOLAR WINGS */}
      <instancedMesh ref={m.panelHuge} args={[undefined, undefined, satellites.length * 2]} material={viewData.matPanel}>
        <boxGeometry args={[0.06, 0.0005, 0.02]} />
      </instancedMesh>
      <instancedMesh ref={m.panelSmall} args={[undefined, undefined, satellites.length * 2]} material={viewData.matPanel}>
        <boxGeometry args={[0.03, 0.0005, 0.015]} />
      </instancedMesh>
      <instancedMesh ref={m.panelSingle} args={[undefined, undefined, satellites.length]} material={viewData.matPanel}>
        <boxGeometry args={[0.04, 0.0005, 0.012]} />
      </instancedMesh>

      {/* ATTACHMENTS (DISHES/ANTENNAS) */}
      <instancedMesh ref={m.dishes} args={[undefined, undefined, satellites.length * 2]} material={viewData.matSilver}>
        <cylinderGeometry args={[0.012, 0.012, 0.0005, 16]} />
      </instancedMesh>
      <instancedMesh ref={m.struts} args={[undefined, undefined, satellites.length * 4]} material={viewData.matSilver}>
        <cylinderGeometry args={[0.0008, 0.0008, 0.02, 4]} />
      </instancedMesh>
      <instancedMesh ref={m.longAntenna} args={[undefined, undefined, satellites.length]} material={viewData.matSilver}>
        <cylinderGeometry args={[0.0005, 0.0005, 0.05, 4]} />
      </instancedMesh>

      {/* Floating Information Tags */}
      {labeled.map((s) => {
        const p = positions[satellites.indexOf(s)];
        if (!p) return null;
        const isSel = s.id === selectedId;
        const isFloat = floatingIds.includes(s.id) && !isSel;
        
        return (
          <Html
            key={s.id}
            position={[p.x, p.y, p.z]}
            center={false}
            distanceFactor={8}
            zIndexRange={[10, 0]}
            pointerEvents="none"
            style={{ pointerEvents: "none", opacity: isFloat ? 0.8 : 1, transition: "opacity 1s ease" }}
          >
            <div className="flex flex-col gap-0.5" style={{ transform: "translate(12px, -12px)" }}>
              <div className="flex items-center gap-1 whitespace-nowrap border-l-2 border-cyan bg-panel/80 pl-1.5 pr-2 py-0.5 backdrop-blur-md">
                <span className="h-1.5 w-1.5" style={{ backgroundColor: `#${getCompanyColor(s.name).getHexString()}` }} />
                <span className={isSel ? "mono text-caption text-cyan font-bold" : "mono text-caption text-primary"}>{s.name}</span>
              </div>
              
              {(isSel || isFloat) && (
                <div className="flex flex-col gap-0.5 border-l-2 border-hairline bg-panel/60 pl-2 pr-2 py-1 backdrop-blur-sm shadow-xl">
                  <span className="mono text-[9px] text-muted tracking-widest uppercase">REGIME: <strong className="text-primary">{s.regime}</strong></span>
                  <span className="mono text-[9px] text-muted tracking-widest uppercase">INC: <strong className="text-primary">{s.inclinationDeg.toFixed(1)}°</strong></span>
                  <span className="mono text-[9px] text-muted tracking-widest uppercase">A: <strong className="text-primary">{s.semiMajorAxisKm.toFixed(0)}km</strong></span>
                </div>
              )}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
