// The 3D world: sky, lights, ground, bushes, scenery and the zone. Everything is generated
// in code. Map pixels become world units at SCALE (2000 px map -> 100 x 100 units).
import * as THREE from "three";
import { MAP_WIDTH, MAP_HEIGHT } from "../../../server/src/constants.js";

export const SCALE = 1 / 20;
export const W = MAP_WIDTH * SCALE;
export const H = MAP_HEIGHT * SCALE;
const SKY = 0x9ec9e8;

export function createWorld(scene) {
  scene.background = new THREE.Color(SKY);
  scene.fog = new THREE.Fog(SKY, 45, 140);

  scene.add(new THREE.HemisphereLight(0xd8ecff, 0x3a5a2a, 1.1));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 30, bottom: -30, near: 1, far: 120 });
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // Playable ground plus a darker field around it for the horizon.
  const grassTex = new THREE.CanvasTexture(grassCanvas());
  grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping;
  grassTex.repeat.set(W / 8, H / 8);
  grassTex.colorSpace = THREE.SRGBColorSpace;
  grassTex.anisotropy = 4;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshLambertMaterial({ map: grassTex }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(W / 2, 0, H / 2);
  ground.receiveShadow = true;
  const outside = new THREE.Mesh(new THREE.PlaneGeometry(W * 6, H * 6), new THREE.MeshLambertMaterial({ color: 0x35552c }));
  outside.rotation.x = -Math.PI / 2;
  outside.position.set(W / 2, -0.02, H / 2);
  scene.add(ground, outside);

  // Map edge: a low hedge you can't pass (the server clamps you inside).
  const hedgeMat = new THREE.MeshLambertMaterial({ color: 0x1f4d1c });
  for (const [x, z, w, d] of [[W / 2, -0.5, W + 2, 1], [W / 2, H + 0.5, W + 2, 1], [-0.5, H / 2, 1, H], [W + 0.5, H / 2, 1, H]]) {
    const hedge = new THREE.Mesh(new THREE.BoxGeometry(w, 1.4, d), hedgeMat);
    hedge.position.set(x, 0.7, z);
    hedge.castShadow = hedge.receiveShadow = true;
    scene.add(hedge);
  }

  // Scenery: trees outside the playable area so the horizon isn't empty.
  const rand = mulberry32(99);
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5a3d22 });
  const leafMat = new THREE.MeshLambertMaterial({ color: 0x2d5e27 });
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.35, 3, 6);
  const leafGeo = new THREE.ConeGeometry(2, 5, 7);
  for (let i = 0; i < 160; i++) {
    const side = rand() * 4 | 0;
    const t = rand() * (W + 40) - 20;
    const d = 3 + rand() * 25;
    const x = side === 0 ? t : side === 1 ? t : side === 2 ? -d : W + d;
    const z = side === 0 ? -d : side === 1 ? H + d : t;
    const s = 0.8 + rand() * 0.9;
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 1.5 * s, z);
    trunk.scale.setScalar(s);
    const leaves = new THREE.Mesh(leafGeo, leafMat);
    leaves.position.set(x, 5 * s, z);
    leaves.scale.setScalar(s);
    trunk.castShadow = leaves.castShadow = true;
    scene.add(trunk, leaves);
  }

  // Bushes: same seeded layout on every client. Walk-through; they hide whoever is inside.
  const bushRand = mulberry32(1337);
  const bushGeo = new THREE.IcosahedronGeometry(1, 1);
  const bushes = [];
  for (let i = 0; i < 45; i++) {
    const x = 3 + bushRand() * (W - 6);
    const z = 3 + bushRand() * (H - 6);
    const s = 1.1 + bushRand() * 0.9;
    const material = new THREE.MeshLambertMaterial({ color: 0x2b6326, transparent: true, opacity: 1, flatShading: true });
    const bush = new THREE.Group();
    for (let j = 0; j < 4; j++) {
      const blob = new THREE.Mesh(bushGeo, material);
      const a = (j / 4) * Math.PI * 2 + bushRand();
      blob.position.set(Math.cos(a) * 0.5 * s, 0.9 * s, Math.sin(a) * 0.5 * s);
      blob.scale.set(s, 0.9 * s, s);
      blob.castShadow = true;
      bush.add(blob);
    }
    bush.position.set(x, 0, z);
    scene.add(bush);
    bushes.push({ x, z, radius: 1.3 * s, material });
  }

  // Zone: a glowing wall at the safe circle's edge, plus a white ring for the next circle.
  const zoneWall = new THREE.Mesh(
    new THREE.CylinderGeometry(1, 1, 40, 96, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false }),
  );
  zoneWall.position.y = 20;
  const nextRing = new THREE.Mesh(
    new THREE.RingGeometry(0.985, 1, 128),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
  );
  nextRing.rotation.x = -Math.PI / 2;
  nextRing.position.y = 0.05;
  scene.add(zoneWall, nextRing);

  return {
    sun,
    bushes,
    // Keep the shadow camera centred on whatever we're looking at.
    followSun(x, z) {
      sun.position.set(x + 25, 50, z + 15);
      sun.target.position.set(x, 0, z);
    },
    // The wall only shows during a match; in the lobby it would just tint the whole horizon.
    updateZone(zone, active) {
      zoneWall.visible = active;
      const r = Math.max(0.01, zone.radius * SCALE);
      zoneWall.scale.set(r, 1, r);
      zoneWall.position.x = zone.x * SCALE;
      zoneWall.position.z = zone.y * SCALE;
      const moving = zone.nextRadius > 0 && (zone.nextRadius !== zone.radius || zone.nextX !== zone.x);
      nextRing.visible = active && moving;
      const nr = Math.max(0.01, zone.nextRadius * SCALE);
      nextRing.scale.set(nr, nr, 1);
      nextRing.position.x = zone.nextX * SCALE;
      nextRing.position.z = zone.nextY * SCALE;
    },
  };
}

function grassCanvas() {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const rand = mulberry32(7);
  g.fillStyle = "#4a7a3c";
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < 12; i++) {
    g.fillStyle = "rgba(90, 100, 50, 0.25)";
    g.beginPath();
    g.ellipse(rand() * size, rand() * size, 20 + rand() * 30, 12 + rand() * 20, rand() * 3, 0, Math.PI * 2);
    g.fill();
  }
  for (let i = 0; i < 2500; i++) {
    g.fillStyle = rand() < 0.5 ? "#568a45" : "#3f6c33";
    g.fillRect(rand() * size, rand() * size, 1.5, 3 + rand() * 3);
  }
  return c;
}

export function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
