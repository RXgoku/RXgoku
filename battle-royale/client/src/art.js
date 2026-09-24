import Phaser from "phaser";
// All game art is drawn in code at startup: no image files to download or license.
import { WEAPONS } from "../../server/src/weapons.js";

// Barrel length in px for each weapon sprite, drawn pointing right (+x).
const GUN_LENGTH = { pistol: 14, revolver: 17, smg: 22, shotgun: 26, sniper: 34 };

export function createTextures(scene) {
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const bake = (key, w, h) => { g.generateTexture(key, w, h); g.clear(); };

  // Grass tile with blades and a few dirt patches.
  const rand = mulberry32(7);
  g.fillStyle(0x3b6a33).fillRect(0, 0, 256, 256);
  for (let i = 0; i < 10; i++) {
    g.fillStyle(0x4a5a30, 0.25).fillEllipse(rand() * 256, rand() * 256, 30 + rand() * 50, 20 + rand() * 30);
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle(rand() < 0.5 ? 0x447a3a : 0x325d2b, 0.9).fillRect(rand() * 256, rand() * 256, 2, 3 + rand() * 3);
  }
  bake("grass", 256, 256);

  // Soldier body seen from above, facing right. Drawn light grey so it can be tinted per player.
  g.fillStyle(0x555555).fillRoundedRect(3, 12, 10, 16, 3);              // backpack
  g.fillStyle(0xdddddd).fillEllipse(20, 20, 24, 34);                     // shoulders
  g.lineStyle(2, 0x222222, 0.8).strokeEllipse(20, 20, 24, 34);
  g.fillStyle(0xe0ac69).fillCircle(31, 14, 4).fillCircle(33, 25, 4);     // hands
  g.lineStyle(1, 0x7a5230).strokeCircle(31, 14, 4).strokeCircle(33, 25, 4);
  bake("soldier", 40, 40);

  g.fillStyle(0x4b5320).fillCircle(11, 11, 10);                          // helmet
  g.fillStyle(0x6b7530).fillCircle(9, 8, 5);
  g.lineStyle(2, 0x1f2410).strokeCircle(11, 11, 10);
  bake("helmet", 22, 22);

  g.fillStyle(0x000000, 0.3).fillEllipse(22, 22, 40, 40);
  bake("shadow", 44, 44);

  // One sprite per weapon: dark body with a coloured stripe.
  for (const [id, w] of Object.entries(WEAPONS)) {
    const len = GUN_LENGTH[id] ?? 16;
    const accent = Phaser.Display.Color.HexStringToColor(w.color).color;
    g.fillStyle(0x222222).fillRect(0, 2, len, 6);
    g.fillStyle(accent).fillRect(2, 3, Math.max(4, len * 0.4), 3);
    if (id === "sniper") g.fillStyle(0x111111).fillRect(8, 0, 10, 3);     // scope
    if (id === "shotgun") g.fillStyle(0x6b4423).fillRect(0, 2, 7, 6);     // wooden grip
    bake(`gun_${id}`, len, 10);
  }

  // Loadout crate: wooden planks with orange straps.
  g.fillStyle(0x8b5a2b).fillRect(0, 0, 30, 30);
  g.lineStyle(2, 0x5e3b1a);
  for (let y = 7; y < 30; y += 8) g.lineBetween(0, y, 30, y);
  g.strokeRect(1, 1, 28, 28);
  g.fillStyle(0xf39c12).fillRect(12, 0, 6, 30).fillRect(0, 12, 30, 6);
  bake("crate", 30, 30);

  // Bush: overlapping blobs with highlights.
  const brand = mulberry32(3);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    g.fillStyle(0x1f4d1c).fillCircle(40 + Math.cos(a) * 16, 40 + Math.sin(a) * 16, 18 + brand() * 5);
  }
  g.fillStyle(0x2b6326).fillCircle(40, 40, 22);
  for (let i = 0; i < 12; i++) g.fillStyle(0x3d7d34, 0.8).fillCircle(20 + brand() * 40, 20 + brand() * 40, 3 + brand() * 4);
  bake("bush", 80, 80);

  g.fillStyle(0xfff3a0).fillRect(0, 1, 12, 2);
  g.fillStyle(0xffffff).fillRect(8, 0, 4, 4);
  bake("tracer", 12, 4);

  g.fillStyle(0xffe066).fillCircle(8, 8, 8);
  g.fillStyle(0xffffff).fillCircle(8, 8, 4);
  bake("flash", 16, 16);

  g.fillStyle(0xffffff).fillRect(0, 0, 4, 4);
  bake("spark", 4, 4);

  g.destroy();
}

// Same bush layout on every client, so hiding in a bush works for everyone.
export function bushLayout(mapWidth, mapHeight, count = 45) {
  const rand = mulberry32(1337);
  return Array.from({ length: count }, () => ({
    x: 60 + rand() * (mapWidth - 120),
    y: 60 + rand() * (mapHeight - 120),
    scale: 0.8 + rand() * 0.7,
    angle: rand() * 360,
  }));
}

export function gunLength(id) {
  return GUN_LENGTH[id] ?? 16;
}

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
