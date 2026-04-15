import { useMemo, useRef } from "react";
import { useFrame, useLoader } from "@react-three/fiber";
import * as THREE from "three";
import { EARTH_UNITS } from "@/lib/orbit";

export function Globe() {
  const earthRef = useRef<THREE.Group>(null);
  const cloudsRef = useRef<THREE.Mesh>(null);

  // Load textures
  const [colorMap, normalMap, specularMap, cloudsMap] = useLoader(THREE.TextureLoader, [
    "/textures/earth_color.jpg",
    "/textures/earth_normal.jpg",
    "/textures/earth_specular.jpg",
    "/textures/earth_clouds.png",
  ]);

  // Configure textures
  useMemo(() => {
    [colorMap, normalMap, specularMap, cloudsMap].forEach((tex) => {
      if (tex) {
        tex.anisotropy = 16;
        tex.colorSpace = THREE.SRGBColorSpace;
      }
    });
    // Cloud texture needs linear color space generally and no gamma, but keeping SRGB is fine as it's just alpha mostly
  }, [colorMap, normalMap, specularMap, cloudsMap]);

  const graticule = useMemo(() => buildGraticule(EARTH_UNITS * 1.001, 15), []);
  const primary = useMemo(() => buildPrimaryLines(EARTH_UNITS * 1.0015), []);

  useFrame((_, dt) => {
    if (earthRef.current) {
      earthRef.current.rotation.y += dt * 0.02;
    }
    if (cloudsRef.current) {
      cloudsRef.current.rotation.y += dt * 0.025; // Clouds rotate slightly faster
    }
  });

  return (
    <group ref={earthRef}>
      {/* Photorealistic Earth surface */}
      <mesh>
        <sphereGeometry args={[EARTH_UNITS, 128, 96]} />
        <meshPhysicalMaterial
          map={colorMap}
          normalMap={normalMap}
          normalScale={new THREE.Vector2(0.8, 0.8)}
          roughnessMap={specularMap}
          roughness={0.7}
          metalness={0.1}
          clearcoat={0.1} // Adds a subtle sheen to the ocean
          clearcoatRoughness={0.2}
        />
      </mesh>

      {/* Moving Clouds Layer */}
      <mesh ref={cloudsRef} scale={[1.006, 1.006, 1.006]}>
        <sphereGeometry args={[EARTH_UNITS, 128, 96]} />
        <meshStandardMaterial
          map={cloudsMap}
          transparent={true}
          opacity={0.8}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* Graticule: latitude/longitude grid */}
      <lineSegments>
        <bufferGeometry attach="geometry" {...graticule} />
        <lineBasicMaterial attach="material" color="#2D3748" transparent opacity={0.35} />
      </lineSegments>

      {/* Emphasized equator + prime meridian */}
      <lineSegments>
        <bufferGeometry attach="geometry" {...primary} />
        <lineBasicMaterial attach="material" color="#22D3EE" transparent opacity={0.5} />
      </lineSegments>

      {/* Inner atmosphere scatter */}
      <mesh scale={[1.02, 1.02, 1.02]}>
        <sphereGeometry args={[EARTH_UNITS, 64, 48]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{ uColor: { value: new THREE.Color("#22D3EE") } }}
          vertexShader={`
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec3 vNormal;
            uniform vec3 uColor;
            void main() {
              float f = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.4);
              gl_FragColor = vec4(uColor, clamp(f, 0.0, 1.0) * 0.6);
            }
          `}
        />
      </mesh>

      {/* Outer atmosphere halo */}
      <mesh scale={[1.08, 1.08, 1.08]}>
        <sphereGeometry args={[EARTH_UNITS, 64, 48]} />
        <shaderMaterial
          transparent
          side={THREE.BackSide}
          depthWrite={false}
          uniforms={{ uColor: { value: new THREE.Color("#60A5FA") } }}
          vertexShader={`
            varying vec3 vNormal;
            void main() {
              vNormal = normalize(normalMatrix * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying vec3 vNormal;
            uniform vec3 uColor;
            void main() {
              float f = pow(0.85 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.2);
              gl_FragColor = vec4(uColor, clamp(f, 0.0, 1.0) * 0.28);
            }
          `}
        />
      </mesh>
    </group>
  );
}

function buildGraticule(r: number, stepDeg: number) {
  const positions: number[] = [];
  const segs = 128;
  for (let lat = -75; lat <= 75; lat += stepDeg) {
    if (lat === 0) continue;
    const phi = (lat * Math.PI) / 180;
    const ringR = r * Math.cos(phi);
    const y = r * Math.sin(phi);
    for (let k = 0; k < segs; k++) {
      const t1 = (k / segs) * Math.PI * 2;
      const t2 = ((k + 1) / segs) * Math.PI * 2;
      positions.push(ringR * Math.cos(t1), y, ringR * Math.sin(t1));
      positions.push(ringR * Math.cos(t2), y, ringR * Math.sin(t2));
    }
  }
  for (let lon = 0; lon < 360; lon += stepDeg) {
    if (lon === 0) continue;
    const lam = (lon * Math.PI) / 180;
    for (let k = 0; k < segs / 2; k++) {
      const p1 = -Math.PI / 2 + (k / (segs / 2)) * Math.PI;
      const p2 = -Math.PI / 2 + ((k + 1) / (segs / 2)) * Math.PI;
      positions.push(
        r * Math.cos(p1) * Math.cos(lam),
        r * Math.sin(p1),
        r * Math.cos(p1) * Math.sin(lam),
      );
      positions.push(
        r * Math.cos(p2) * Math.cos(lam),
        r * Math.sin(p2),
        r * Math.cos(p2) * Math.sin(lam),
      );
    }
  }
  const attr = new THREE.BufferAttribute(new Float32Array(positions), 3);
  return { attributes: { position: attr } } as unknown as THREE.BufferGeometry;
}

function buildPrimaryLines(r: number) {
  const positions: number[] = [];
  const segs = 256;
  // Equator
  for (let k = 0; k < segs; k++) {
    const t1 = (k / segs) * Math.PI * 2;
    const t2 = ((k + 1) / segs) * Math.PI * 2;
    positions.push(r * Math.cos(t1), 0, r * Math.sin(t1));
    positions.push(r * Math.cos(t2), 0, r * Math.sin(t2));
  }
  // Prime meridian
  for (let k = 0; k < segs / 2; k++) {
    const p1 = -Math.PI / 2 + (k / (segs / 2)) * Math.PI;
    const p2 = -Math.PI / 2 + ((k + 1) / (segs / 2)) * Math.PI;
    positions.push(r * Math.cos(p1), r * Math.sin(p1), 0);
    positions.push(r * Math.cos(p2), r * Math.sin(p2), 0);
  }
  const attr = new THREE.BufferAttribute(new Float32Array(positions), 3);
  return { attributes: { position: attr } } as unknown as THREE.BufferGeometry;
}
