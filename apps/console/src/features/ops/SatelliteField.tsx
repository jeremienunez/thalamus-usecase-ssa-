import { useMemo, useRef, useState, useEffect } from "react";
import { useFrame, ThreeEvent } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import type { SatelliteDTO } from "@/shared/types";
import { classifySatellite } from "@/shared/types/satellite-classification";
import { propagateSgp4 } from "@/adapters/propagator/sgp4";
import { useRenderer } from "@/adapters/renderer/RendererContext";

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

export function SatelliteField({ satellites, selectedId, onSelect, timeScale, labelIds = [] }: Props) {
  const renderer = useRenderer();
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
      // Pick 2 floating decorative labels; never collide with priority labels.
      const skip = new Set([selectedId, ...labelIds]);
      const randoms: number[] = [];
      let attempts = 0;
      while (randoms.length < 2 && attempts < 12) {
        attempts++;
        const pick = satellites[Math.floor(Math.random() * satellites.length)];
        if (pick && !skip.has(pick.id) && !randoms.includes(pick.id)) {
          randoms.push(pick.id);
        }
      }
      setFloatingIds(randoms);
    }, 5000);
    return () => clearInterval(interval);
  }, [satellites, selectedId, labelIds]);

  const positions = useMemo(
    () => new Array(satellites.length).fill(0).map(() => new THREE.Vector3()),
    [satellites.length],
  );

  const viewData = useMemo(() => {
    const goldBump = renderer.makeGoldBumpTexture();
    const panelTex = renderer.makeSolarPanelTexture();
    return {
      haloTex: renderer.makeHaloTexture(),
      
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
      const baseCol = renderer.getCompanyColor(s.name);
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

    const nowMs = Date.now() + tRef.current * 1000;
    satellites.forEach((s, i) => {
      const p = propagateSgp4(s, nowMs, positions[i]);
      const isSelected = selectedId === s.id;
      const type = classifySatellite({ name: s.name, regime: s.regime });
      
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
            zIndexRange={[10, 0]}
            pointerEvents="none"
            style={{
              pointerEvents: "none",
              opacity: isFloat ? 0.8 : 1,
              transition: "opacity 1s ease",
            }}
          >
            <div className="flex flex-col gap-0.5" style={{ transform: "translate(12px, -12px)" }}>
              <div className="flex max-w-[12rem] items-center gap-1 whitespace-nowrap border-l-2 border-cyan bg-panel/95 pl-1.5 pr-2 py-0.5 shadow-hud backdrop-blur-md">
                <span className="h-1.5 w-1.5 shrink-0" style={{ backgroundColor: `#${renderer.getCompanyColor(s.name).getHexString()}` }} />
                <span
                  title={s.name}
                  className={
                    isSel
                      ? "mono truncate text-caption text-cyan font-bold"
                      : "mono truncate text-caption text-primary"
                  }
                >
                  {s.name}
                </span>
              </div>
              
              {(isSel || isFloat) && (
                <div className="flex flex-col gap-0.5 border-l-2 border-hairline bg-panel/95 pl-2 pr-2 py-1 backdrop-blur-md shadow-elevated">
                  <span className="mono text-nano text-muted tracking-widest">
                    REGIME <strong className="ml-1 text-primary">{s.regime}</strong>
                  </span>
                  <span className="mono text-nano text-muted tracking-widest">
                    INC <strong className="ml-1 text-primary tabular-nums">{s.inclinationDeg.toFixed(1)}°</strong>
                  </span>
                  <span className="mono text-nano text-muted tracking-widest">
                    ALT <strong className="ml-1 text-primary tabular-nums">{Math.round(s.semiMajorAxisKm - 6371).toLocaleString()}<span className="ml-0.5 text-dim">km</span></strong>
                  </span>
                </div>
              )}
            </div>
          </Html>
        );
      })}
    </group>
  );
}
