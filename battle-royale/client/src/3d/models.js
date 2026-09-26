// Low-poly 3D models built from primitives at runtime: no model files to download or license.
// Models face +X; rotate a group by -angle around Y to face a map angle (see main.js).
import * as THREE from "three";
import { WEAPONS } from "../../../server/src/weapons.js";

const GUN_LENGTH = { pistol: 0.35, revolver: 0.42, smg: 0.62, shotgun: 0.78, sniper: 1.05 };

const mat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
const SKIN = mat(0xe0ac69);
const DARK = mat(0x2b2b2b);
const OLIVE = mat(0x4b5320);
const BOOTS = mat(0x3a2a1a);
const PANTS = mat(0x3d4a35);

export function makeGun(id) {
  const len = GUN_LENGTH[id] ?? 0.5;
  const accent = mat(new THREE.Color(WEAPONS[id].color));
  const gun = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.08), DARK);
  body.position.x = len / 2;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(len * 0.45, 0.04, 0.085), accent);
  stripe.position.set(len * 0.3, 0.02, 0);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.07), DARK);
  grip.position.set(0.06, -0.1, 0);
  gun.add(body, stripe, grip);
  if (id === "sniper") {
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.3, 8), DARK);
    scope.rotation.z = Math.PI / 2;
    scope.position.set(0.4, 0.1, 0);
    gun.add(scope);
  }
  if (id === "shotgun") {
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.1, 0.07), mat(0x6b4423));
    stock.position.set(-0.08, -0.02, 0);
    gun.add(stock);
  }
  gun.traverse((m) => { m.castShadow = true; });
  gun.userData.length = len;
  return gun;
}

// Soldier ~1.8 units tall. Returns the group plus the parts main.js animates.
export function makeSoldier(colorHex) {
  const team = mat(new THREE.Color(colorHex));
  const root = new THREE.Group();
  const rig = new THREE.Group(); // tilts over on death
  root.add(rig);

  const legGeo = new THREE.BoxGeometry(0.22, 0.8, 0.24);
  legGeo.translate(0, -0.4, 0); // pivot at the hip
  const legL = new THREE.Mesh(legGeo, PANTS);
  const legR = new THREE.Mesh(legGeo, PANTS);
  legL.position.set(0, 0.85, -0.14);
  legR.position.set(0, 0.85, 0.14);
  for (const leg of [legL, legR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 0.26), BOOTS);
    boot.position.set(0.04, -0.76, 0);
    leg.add(boot);
  }

  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.62, 0.58), team);
  torso.position.y = 1.18;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.34, 0.5), OLIVE);
  vest.position.y = 1.22;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.4), DARK);
  pack.position.set(-0.26, 1.2, 0);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), SKIN);
  head.position.y = 1.66;
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), OLIVE);
  helmet.position.y = 1.7;

  // Both arms reach forward to hold the gun.
  const armGeo = new THREE.BoxGeometry(0.46, 0.12, 0.12);
  armGeo.translate(0.23, 0, 0);
  const armL = new THREE.Mesh(armGeo, team);
  const armR = new THREE.Mesh(armGeo, team);
  armL.position.set(0.05, 1.36, -0.26);
  armR.position.set(0.05, 1.36, 0.26);
  armL.rotation.y = -0.45;
  armR.rotation.y = 0.35;

  const hand = new THREE.Group(); // gun attaches here
  hand.position.set(0.42, 1.32, 0.08);

  rig.add(legL, legR, torso, vest, pack, head, helmet, armL, armR, hand);
  rig.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return { root, rig, legL, legR, hand, team, gun: null, gunId: "" };
}

export function setSoldierGun(soldier, id) {
  if (soldier.gunId === id) return;
  if (soldier.gun) soldier.hand.remove(soldier.gun);
  soldier.gun = makeGun(id);
  soldier.gunId = id;
  soldier.hand.add(soldier.gun);
}

export function makeCrate(mine) {
  const g = new THREE.Group();
  const box = new THREE.Mesh(new THREE.BoxGeometry(1.1, 1.1, 1.1), mat(0x8b5a2b));
  box.position.y = 0.55;
  const strapMat = mat(0xf39c12, mine ? { emissive: 0x7a4a00 } : {});
  const s1 = new THREE.Mesh(new THREE.BoxGeometry(1.14, 1.14, 0.22), strapMat);
  const s2 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.14, 1.14), strapMat);
  s1.position.y = s2.position.y = 0.55;
  g.add(box, s1, s2);
  g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
  return g;
}

// Name + health bar drawn on a canvas and shown as a billboard above a player.
export function makeTag(name) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true }));
  sprite.scale.set(2.4, 0.6, 1);
  sprite.position.y = 2.35;
  const tag = { sprite, canvas, texture, name, health: -1 };
  drawTag(tag, 100);
  return tag;
}

export function drawTag(tag, health) {
  if (tag.health === health) return;
  tag.health = health;
  const c = tag.canvas.getContext("2d");
  c.clearRect(0, 0, 256, 64);
  c.font = "bold 24px monospace";
  c.textAlign = "center";
  c.lineWidth = 5;
  c.strokeStyle = "#000";
  c.strokeText(tag.name, 128, 26);
  c.fillStyle = "#fff";
  c.fillText(tag.name, 128, 26);
  const frac = Math.max(0, health) / 100;
  c.fillStyle = "#000000aa";
  c.fillRect(48, 38, 160, 14);
  c.fillStyle = frac > 0.5 ? "#2ecc71" : frac > 0.25 ? "#f1c40f" : "#e74c3c";
  c.fillRect(50, 40, 156 * frac, 10);
  tag.texture.needsUpdate = true;
}
