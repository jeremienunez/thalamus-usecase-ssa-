import * as THREE from "three";

const colorCache = new Map<string, THREE.Color>();

/**
 * Returns a stable THREE.Color per operator family, derived from the
 * satellite name's leading token. Known operators get branded colours;
 * unknowns get a deterministic HSL hash.
 */
export function getCompanyColor(name: string): THREE.Color {
  const n = name.toUpperCase();
  const prefix = n.split("-")[0] || n.substring(0, 4);
  if (colorCache.has(prefix)) return colorCache.get(prefix)!;

  let color: THREE.Color;
  if (n.includes("THAL")) color = new THREE.Color(0xffc000);
  else if (n.includes("NASA")) color = new THREE.Color(0x05d9e8);
  else if (n.includes("JAXA")) color = new THREE.Color(0x01ffc3);
  else if (n.includes("ISRO") || n.includes("INDIA")) color = new THREE.Color(0xffb300);
  else if (n.includes("PLAN")) color = new THREE.Color(0xb5179e);
  else if (n.includes("CNES")) color = new THREE.Color(0x4361ee);
  else if (n.includes("CNSA")) color = new THREE.Color(0xd90429);
  else if (n.includes("SPACE") || n.includes("STAR")) color = new THREE.Color(0xaaaaaa);
  else {
    let hash = 0;
    for (let i = 0; i < prefix.length; i++) hash = prefix.charCodeAt(i) + ((hash << 5) - hash);
    color = new THREE.Color().setHSL(Math.abs(hash % 360) / 360, 0.85, 0.55);
  }
  colorCache.set(prefix, color);
  return color;
}

const regimeMap = { LEO: "#60A5FA", MEO: "#A78BFA", GEO: "#34D399", HEO: "#F59E0B" } as const;

export function regimeColor(regime: "LEO" | "MEO" | "GEO" | "HEO"): THREE.Color {
  return new THREE.Color(regimeMap[regime]);
}

export function pcColor(pc: number): THREE.Color {
  if (pc >= 1e-4) return new THREE.Color("#F87171");
  if (pc >= 1e-6) return new THREE.Color("#F59E0B");
  return new THREE.Color("#6E7681");
}
