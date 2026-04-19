import * as THREE from "three";

export function makeHaloTexture(): THREE.Texture {
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

export function makeGoldBumpTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "black";
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 400; i++) {
    const darkness = Math.random();
    ctx.fillStyle = `rgba(255,255,255,${darkness})`;
    ctx.beginPath();
    const x = Math.random() * size;
    const y = Math.random() * size;
    const s = 10 + Math.random() * 30;
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

export function makeSolarPanelTexture(): THREE.Texture {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#0D3B66";
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = "#4CC9F0";
  ctx.lineWidth = 6;
  const cellsX = 10;
  const cellsY = 4;
  for (let i = 0; i <= size; i += size / cellsX) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i, size);
    ctx.stroke();
  }
  for (let i = 0; i <= size; i += size / cellsY) {
    ctx.beginPath();
    ctx.moveTo(0, i);
    ctx.lineTo(size, i);
    ctx.stroke();
  }

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
