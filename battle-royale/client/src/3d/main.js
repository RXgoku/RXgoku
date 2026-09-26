// 3D third-person client. Same server and netcode as the 2D client: map coordinates are
// pixels (x, y) on a flat 2000 x 2000 map; the 3D world shows them as (x, 0, y) * SCALE.
import * as THREE from "three";
import { Client, Callbacks } from "@colyseus/sdk";
import {
  MAP_WIDTH, MAX_INPUT_DT, applyMove, MAX_HEALTH, PICKUP_RANGE,
  MIN_PLAYERS, AUTO_START_PLAYERS, END_SCREEN_S, LOADOUT_DROP_PHASE, OBSTACLES,
} from "../../../server/src/constants.js";
import { segmentObstacleT } from "../../../server/src/map.js";
import { WEAPONS, PRIMARY_CHOICES, SECONDARY_CHOICES, LOADOUT } from "../../../server/src/weapons.js";
import { Sfx } from "../sfx.js";
import { createWorld, SCALE } from "./world.js";
import { makeSoldier, setSoldierGun, makeGun, makeCrate, makeTag, drawTag } from "./models.js";

const INTERP_DELAY_MS = 100; // render remote players this far in the past
const AIM_SEND_MS = 50;      // how often we tell the server where we're aiming
const STEP_DIST = 55;        // px walked per footstep sound
const TELEPORT_DIST = 150;   // px; a bigger jump is a teleport (match start), not movement
const MOUSE_SENS = 0.0022;   // radians per pixel of mouse movement
const PITCH_MIN = -0.35, PITCH_MAX = 0.75;
const BULLET_HEIGHT = 1.3;   // world units; bullets fly flat at chest height
const CAMERA = {             // third-person rig: distance behind, shoulder offset, field of view
  hip: { dist: 4.2, shoulder: 0.75, fov: 70 },
  ads: { dist: 2.4, shoulder: 0.55, fov: 50 },
  scope: { dist: 2.0, shoulder: 0.5, fov: 28 }, // sniper aim-down-sights
};
const serverUrl = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);
const $ = (id) => document.getElementById(id);
const ui = {
  status: $("status"), banner: $("banner"), announce: $("announce"), killfeed: $("killfeed"),
  weapons: $("weapons"), health: $("health").firstElementChild, minimap: $("minimap"), crosshair: $("crosshair"),
  prompt: $("prompt"), lookhint: $("lookhint"), vignette: $("vignette"),
  overlay: $("overlay"), overlayTitle: $("overlay-title"), overlayBody: $("overlay-body"), start: $("start-btn"),
};
const tmpDir = new THREE.Vector3();

class Game {
  constructor() {
    this.canvas = $("game");
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CAMERA.hip.fov, 1, 0.1, 400);
    this.world = createWorld(this.scene);
    this.sfx = new Sfx();
    this.minimapCtx = ui.minimap.getContext("2d");

    this.others = new Map();  // sessionId -> avatar
    this.bullets = new Map(); // id -> { mesh, vx, vy, shooter, expires }
    this.pickups = new Map(); // id -> { state, group, spinner }
    this.effects = [];        // short-lived meshes: muzzle flashes, sparks
    this.pending = [];        // inputs sent but not yet acknowledged by the server
    this.keys = new Set();
    this.seq = 0;
    this.yaw = 0;
    this.pitch = 0.15;
    this.firing = false;
    this.ads = false;
    this.lastShot = 0;
    this.lastAimSent = 0;
    this.sentAngle = null;
    this.hurtFlash = 0;
    this.fov = CAMERA.hip.fov;
    this.tracerGeo = new THREE.BoxGeometry(0.9, 0.05, 0.05);
    this.tracerMat = new THREE.MeshBasicMaterial({ color: 0xfff3a0 });
    this.flashGeo = new THREE.SphereGeometry(0.18, 8, 6);
    this.flashMat = new THREE.MeshBasicMaterial({ color: 0xffe066, transparent: true });
    this.sparkGeo = new THREE.BoxGeometry(0.08, 0.08, 0.08);
    this.sparkMats = [new THREE.MeshBasicMaterial({ color: 0xff3b30 }), new THREE.MeshBasicMaterial({ color: 0xffffff })];
    this.dustMat = new THREE.MeshBasicMaterial({ color: 0xb8a98c });

    this.bindInput();
    this.resize();
    window.addEventListener("resize", () => this.resize());
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  bindInput() {
    const unlock = () => this.sfx.unlock(); // browsers only allow audio after a user gesture
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    this.canvas.addEventListener("click", () => { if (!this.locked) this.canvas.requestPointerLock?.(); });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.firing = false; this.ads = false; }
    });
    document.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.yaw += e.movementX * MOUSE_SENS * (this.ads ? 0.5 : 1);
      this.pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, this.pitch + e.movementY * MOUSE_SENS * (this.ads ? 0.5 : 1)));
    });
    document.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.firing = true;
      if (e.button === 2) this.ads = true;
    });
    document.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.firing = false;
      if (e.button === 2) this.ads = false;
    });
    document.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("blur", () => this.keys.clear());
    window.addEventListener("keydown", (e) => {
      this.keys.add(e.code);
      if (!this.room || e.repeat) return;
      const alive = this.me?.state.alive;
      if (e.code === "KeyE" && alive) this.room.send("pickup");
      if (e.code === "KeyR" && alive) this.room.send("reload");
      if (e.code === "Digit1") this.room.send("switch", { slot: 0 });
      if (e.code === "Digit2") this.room.send("switch", { slot: 1 });
      if (e.code === "KeyM") this.announce(this.sfx.toggleMute() ? "🔇 Sound off (M)" : "🔊 Sound on (M)");
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
  }

  async connect() {
    const name = new URLSearchParams(location.search).get("name") || `Player${Math.floor(Math.random() * 1000)}`;
    try {
      this.room = await new Client(serverUrl).joinOrCreate("battle", { name });
    } catch (err) {
      ui.status.textContent = `Could not connect to ${serverUrl}: ${err.message}`;
      return;
    }
    this.name = name;
    ui.status.textContent = `${name} — WASD move, mouse look, click shoot, right-click aim, E pick up, R reload, 1/2 switch, M mute`;

    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd("players", (player, id) => {
      const avatar = this.makeAvatar(player);
      if (id === this.room.sessionId) {
        this.me = avatar;
        this.me.pos = { x: player.x, y: player.y };
        avatar.tag.sprite.visible = false; // you don't need your own name tag
        callbacks.onChange(player, () => this.reconcile(player));
        callbacks.listen(player, "health", (hp, prev) => {
          if (prev !== undefined && hp < prev && hp > 0 && !this.inGas()) {
            this.sfx.hurt();
            this.hurtFlash = 1;
          }
        });
        callbacks.listen(player, "reloading", (on) => { if (on) this.sfx.reload(); });
        callbacks.listen(player, "primary", (w, prev) => { if (w && w !== prev) this.sfx.pickup(); });
      } else {
        avatar.buffer = [{ t: performance.now(), x: player.x, y: player.y }];
        this.others.set(id, avatar);
        callbacks.onChange(player, () => {
          const last = avatar.buffer[avatar.buffer.length - 1];
          const point = { t: performance.now(), x: player.x, y: player.y };
          if (Math.hypot(point.x - last.x, point.y - last.y) > TELEPORT_DIST) avatar.buffer = [point];
          else avatar.buffer.push(point);
          if (avatar.buffer.length > 30) avatar.buffer.shift();
        });
      }
      callbacks.listen(player, "alive", (alive) => this.setAlive(avatar, alive));
    });
    callbacks.onRemove("players", (_player, id) => {
      const avatar = this.others.get(id);
      if (avatar) this.scene.remove(avatar.soldier.root);
      this.others.delete(id);
    });
    callbacks.onAdd("pickups", (pickup, id) => this.addPickup(pickup, id));
    callbacks.onRemove("pickups", (_pickup, id) => {
      const p = this.pickups.get(id);
      if (p) this.scene.remove(p.group);
      this.pickups.delete(id);
    });

    this.room.onMessage("bullets", (volley) => this.onVolley(volley));
    this.room.onMessage("bulletEnd", ({ id, x, y, hit, wall }) => this.removeBullet(id, x, y, hit, wall));
    this.room.onMessage("kill", ({ killer, victim }) => {
      if (killer === this.me?.state.name) this.sfx.kill();
      if (victim === this.me?.state.name) {
        this.sfx.death();
        this.killedBy = killer;
      }
      this.showKill(killer, victim);
    });
    this.room.onMessage("clearBullets", () => {
      for (const id of [...this.bullets.keys()]) this.removeBullet(id);
    });
    this.room.onMessage("loadoutDrop", () => {
      this.announce("📦 Your loadout crate landed nearby — follow the orange beam and press E");
      const crate = [...this.pickups.values()].find((p) => p.state.weapon === LOADOUT && p.state.owner === this.room.sessionId);
      if (crate) this.sfx.crateLanded(crate.state.x, crate.state.y);
    });
    callbacks.listen("phase", (phase, prev) => {
      if (phase === "ended") {
        this.endedAt = performance.now();
        const won = this.room.state.winner === this.me?.state.name && this.me?.state.alive;
        if (won) this.sfx.victory(); else this.sfx.defeat();
      }
      if (phase === "playing" && prev === "countdown") this.sfx.beep(true);
      if (phase !== "playing") this.killedBy = null;
    });
    callbacks.listen("countdown", (n) => { if (n > 0 && this.room.state.phase === "countdown") this.sfx.beep(); });
    callbacks.listen("zone", (zone) => {
      callbacks.listen(zone, "shrinking", (on) => { if (on && this.room.state.phase === "playing") this.sfx.siren(); });
    });
    ui.start.addEventListener("click", () => this.room.send("start"));
    ui.overlayBody.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-slot]");
      if (btn) this.room.send("loadout", { [btn.dataset.slot]: btn.dataset.weapon });
    });
    this.room.onLeave(() => { ui.status.textContent = "Disconnected"; });
  }

  // --- per-frame -------------------------------------------------------------

  frame() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - this.last) / 1000); // cap long stalls (e.g. a background tab)
    this.last = now;
    if (this.me) {
      const playing = this.room.state.phase === "playing";
      if (this.me.state.alive) {
        this.sendInputAndPredict(dt);
        this.aimAndShoot(now, playing);
      }
      this.placeAvatar(this.me, this.me.pos.x, this.me.pos.y, this.yaw, dt);
      this.interpolateOthers(now - INTERP_DELAY_MS, dt);
      this.moveBullets(dt, now);
      this.updateEffects(dt);
      this.updatePickups(now);
      this.updateCamera(dt);
      this.updateAudio(now);
      this.updateBushes();
      this.world.updateZone(this.room.state.zone, this.room.state.phase === "playing");
      this.updateHud(now);
    }
    this.renderer.render(this.scene, this.camera);
  }

  // WASD relative to where you're looking, sent as a direction vector.
  sendInputAndPredict(dt) {
    const f = (this.keys.has("KeyW") ? 1 : 0) - (this.keys.has("KeyS") ? 1 : 0);
    const r = (this.keys.has("KeyD") ? 1 : 0) - (this.keys.has("KeyA") ? 1 : 0);
    if (!f && !r) return;
    const cos = Math.cos(this.yaw), sin = Math.sin(this.yaw);
    const mx = f * cos - r * sin, my = f * sin + r * cos;
    // The server accepts at most MAX_INPUT_DT per input, so a slow frame is sent as several
    // inputs; otherwise players on low frame rates would move slower than everyone else.
    for (let left = dt; left > 1e-4; left -= MAX_INPUT_DT) {
      const input = { seq: ++this.seq, mx, my, dt: Math.min(left, MAX_INPUT_DT) };
      this.room.send("input", input);
      this.pending.push(input);
      applyMove(this.me.pos, input); // move now; the server will confirm or correct
    }
  }

  // Aim where the crosshair points: at the player under it, else at the cover it's on,
  // else where the camera ray reaches chest height. Either way the shot leaves from your
  // position, so the shoulder offset doesn't throw it off.
  aimAngle() {
    const camPos = this.camera.position;
    this.camera.getWorldDirection(tmpDir);
    const FAR = 150;
    const wallT = FAR * segmentObstacleT(camPos.x / SCALE, camPos.z / SCALE,
      (camPos.x + tmpDir.x * FAR) / SCALE, (camPos.z + tmpDir.z * FAR) / SCALE, OBSTACLES);
    let t = Math.min(wallT, FAR);
    const target = this.playerUnderCrosshair(camPos, tmpDir, wallT);
    if (tmpDir.y < -0.01) t = Math.min(t, (BULLET_HEIGHT - camPos.y) / tmpDir.y);
    let tx = target ? target.px.x * SCALE : camPos.x + tmpDir.x * t;
    let tz = target ? target.px.y * SCALE : camPos.z + tmpDir.z * t;
    const px = this.me.pos.x * SCALE, pz = this.me.pos.y * SCALE;
    if (Math.hypot(tx - px, tz - pz) < 2) { // too close to trust the angle: shoot where you face
      tx = px + Math.cos(this.yaw);
      tz = pz + Math.sin(this.yaw);
    }
    return Math.atan2(tz - pz, tx - px);
  }

  // Nearest living player whose body (a 0.8-unit-radius, 2-unit-tall cylinder) the camera
  // ray hits before maxT (where cover blocks the ray).
  playerUnderCrosshair(origin, dir, maxT = Infinity) {
    const flat = Math.hypot(dir.x, dir.z) || 1;
    let best = null, bestT = maxT;
    for (const o of this.others.values()) {
      if (!o.state.alive || !o.px) continue;
      const ox = o.px.x * SCALE - origin.x, oz = o.px.y * SCALE - origin.z;
      const t = (ox * dir.x + oz * dir.z) / (flat * flat); // closest approach along the ray (xz)
      if (t <= 0 || t >= bestT) continue;
      const miss = Math.hypot(origin.x + dir.x * t - o.px.x * SCALE, origin.z + dir.z * t - o.px.y * SCALE);
      const y = origin.y + dir.y * t;
      if (miss < 0.8 && y > 0 && y < 2) { best = o; bestT = t; }
    }
    return best;
  }

  aimAndShoot(now, canShoot) {
    const angle = this.aimAngle();
    const state = this.me.state;
    const weaponId = activeWeapon(state);
    const mag = state.slot === 1 && state.primary ? state.primaryMag : state.secondaryMag;
    const canFire = canShoot && this.firing && !state.reloading && mag > 0;
    if (canShoot && this.firing && !state.reloading && mag === 0 && now - this.lastShot >= 300) {
      this.lastShot = now;
      this.sfx.empty();
    }
    if (canFire && now - this.lastShot >= WEAPONS[weaponId].cooldownMs) {
      this.lastShot = now;
      this.lastAimSent = now;
      this.sentAngle = angle;
      this.room.send("shoot", { angle });
    } else if (now - this.lastAimSent >= AIM_SEND_MS && Math.abs(angle - (this.sentAngle ?? 99)) > 0.01) {
      this.lastAimSent = now;
      this.sentAngle = angle;
      this.room.send("aim", { angle });
    }
  }

  // Start from the server's position, then replay inputs it hasn't processed yet.
  reconcile(player) {
    this.pending = this.pending.filter((input) => input.seq > player.lastSeq);
    const pos = { x: player.x, y: player.y };
    for (const input of this.pending) applyMove(pos, input);
    this.me.pos = pos;
  }

  interpolateOthers(renderTime, dt) {
    for (const other of this.others.values()) {
      const buf = other.buffer;
      while (buf.length >= 2 && buf[1].t <= renderTime) buf.shift();
      const [a, b] = buf;
      const k = !b || renderTime <= a.t ? 0 : (renderTime - a.t) / (b.t - a.t);
      const x = b ? a.x + (b.x - a.x) * k : a.x;
      const y = b ? a.y + (b.y - a.y) * k : a.y;
      other.facing = lerpAngle(other.facing ?? other.state.angle, other.state.angle, Math.min(1, dt * 15));
      this.placeAvatar(other, x, y, other.facing, dt);
    }
  }

  placeAvatar(avatar, x, y, facing, dt) {
    const { soldier } = avatar;
    const moved = avatar.px ? Math.hypot(x - avatar.px.x, y - avatar.px.y) : 0;
    avatar.px = { x, y };
    soldier.root.position.set(x * SCALE, 0, y * SCALE);
    soldier.root.rotation.y = -facing;
    setSoldierGun(soldier, activeWeapon(avatar.state));
    drawTag(avatar.tag, avatar.state.health);
    // Walk cycle: swing the legs while moving.
    const speed = dt > 0 ? moved / dt : 0;
    avatar.walk = (avatar.walk ?? 0) + (speed > 20 ? dt * 11 : 0);
    const swing = speed > 20 && avatar.state.alive ? Math.sin(avatar.walk) * 0.6 : 0;
    soldier.legL.rotation.z = swing;
    soldier.legR.rotation.z = -swing;
  }

  setAlive(avatar, alive) {
    const { soldier } = avatar;
    soldier.rig.rotation.z = alive ? 0 : Math.PI / 2; // lie down when eliminated
    soldier.rig.position.y = alive ? 0 : 0.25;
    soldier.team.color.set(alive ? avatar.state.color : "#555555");
    avatar.tag.sprite.visible = alive && avatar !== this.me;
  }

  // Third-person camera behind the shoulder; spectate your killer (or anyone) once out.
  updateCamera(dt) {
    let target = this.me, yaw = this.yaw, pitch = this.pitch;
    if (!this.me.state.alive && this.room.state.phase === "playing") {
      const alive = [...this.others.values()].filter((o) => o.state.alive);
      target = alive.find((o) => o.state.name === this.killedBy) ?? alive[0] ?? this.me;
      yaw = target === this.me ? this.yaw : target.facing ?? 0;
      pitch = 0.3;
    }
    this.spectating = target === this.me ? null : target.state.name;
    const weaponId = activeWeapon(this.me.state);
    const rig = !this.ads || target !== this.me ? CAMERA.hip : weaponId === "sniper" ? CAMERA.scope : CAMERA.ads;
    this.fov += (rig.fov - this.fov) * Math.min(1, dt * 12);
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();

    const p = target.px ?? this.me.px ?? this.me.pos;
    const rightX = -Math.sin(yaw), rightZ = Math.cos(yaw);
    const look = new THREE.Vector3(p.x * SCALE + rightX * rig.shoulder, 1.65, p.y * SCALE + rightZ * rig.shoulder);
    const dir = new THREE.Vector3(Math.cos(yaw) * Math.cos(pitch), -Math.sin(pitch), Math.sin(yaw) * Math.cos(pitch));
    this.camera.position.copy(look).addScaledVector(dir, -rig.dist);
    // Don't let the camera sink into cover behind you: pull it in front of the wall.
    const hit = segmentObstacleT(look.x / SCALE, look.z / SCALE,
      this.camera.position.x / SCALE, this.camera.position.z / SCALE, OBSTACLES, 6);
    if (hit <= 1) this.camera.position.lerpVectors(look, this.camera.position, Math.max(0.05, hit * 0.9));
    this.camera.position.y = Math.max(0.4, this.camera.position.y);
    this.camera.lookAt(look.x + dir.x * 10, look.y + dir.y * 10, look.z + dir.z * 10);
    this.world.followSun(p.x * SCALE, p.y * SCALE);
    this.cameraFocus = { x: p.x * SCALE, z: p.y * SCALE };
  }

  // --- shooting effects ------------------------------------------------------

  onVolley({ weapon, shooter, x, y, angle, bullets }) {
    const avatar = shooter === this.room.sessionId ? this.me : this.others.get(shooter);
    const pos = avatar?.px ?? { x, y };
    this.sfx.shot(weapon, pos.x, pos.y);
    const reach = 0.45 + (avatar?.soldier.gun?.userData.length ?? 0.5);
    const flash = new THREE.Mesh(this.flashGeo, this.flashMat.clone());
    flash.position.set(pos.x * SCALE + Math.cos(angle) * reach, 1.34, pos.y * SCALE + Math.sin(angle) * reach);
    flash.scale.setScalar(weapon === "shotgun" || weapon === "sniper" ? 1.6 : 1);
    this.scene.add(flash);
    this.effects.push({ mesh: flash, life: 0.07, max: 0.07, grow: true });
    for (const b of bullets) this.addBullet(b, shooter);
  }

  addBullet({ id, x, y, vx, vy, life }, shooter) {
    const mesh = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    mesh.position.set(x * SCALE, BULLET_HEIGHT, y * SCALE);
    mesh.rotation.y = -Math.atan2(vy, vx);
    this.scene.add(mesh);
    this.bullets.set(id, { mesh, vx: vx * SCALE, vy: vy * SCALE, shooter, expires: performance.now() + life });
  }

  moveBullets(dt, now) {
    for (const [id, b] of this.bullets) {
      b.mesh.position.x += b.vx * dt;
      b.mesh.position.z += b.vy * dt;
      if (now > b.expires + 500) this.removeBullet(id); // lost bulletEnd safety net
    }
  }

  removeBullet(id, x, y, hit, wall) {
    const bullet = this.bullets.get(id);
    if (bullet) this.scene.remove(bullet.mesh);
    this.bullets.delete(id);
    if (wall) { // puff of dust where cover stopped the bullet
      for (let i = 0; i < 6; i++) {
        const dust = new THREE.Mesh(this.sparkGeo, this.dustMat);
        dust.position.set(x * SCALE, BULLET_HEIGHT, y * SCALE);
        dust.scale.setScalar(1.5);
        dust.userData.v = new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 3, (Math.random() - 0.5) * 3);
        this.scene.add(dust);
        this.effects.push({ mesh: dust, life: 0.4, max: 0.4 });
      }
      this.sfx.impact(x, y);
    }
    if (!hit) return;
    for (let i = 0; i < 10; i++) {
      const spark = new THREE.Mesh(this.sparkGeo, this.sparkMats[i % 2]);
      spark.position.set(x * SCALE, BULLET_HEIGHT, y * SCALE);
      spark.userData.v = new THREE.Vector3((Math.random() - 0.5) * 6, Math.random() * 4, (Math.random() - 0.5) * 6);
      this.scene.add(spark);
      this.effects.push({ mesh: spark, life: 0.35, max: 0.35 });
    }
    this.sfx.hit(x, y);
    if (bullet?.shooter === this.room.sessionId) {
      this.sfx.hitMarker();
      ui.crosshair.classList.add("hit");
      clearTimeout(this.hitTimer);
      this.hitTimer = setTimeout(() => ui.crosshair.classList.remove("hit"), 120);
    }
  }

  updateEffects(dt) {
    this.effects = this.effects.filter((e) => {
      e.life -= dt;
      const v = e.mesh.userData.v;
      if (v) {
        v.y -= 12 * dt;
        e.mesh.position.addScaledVector(v, dt);
      }
      if (e.grow) {
        e.mesh.scale.multiplyScalar(1 + dt * 12);
        e.mesh.material.opacity = Math.max(0, e.life / e.max);
      }
      if (e.life > 0) return true;
      this.scene.remove(e.mesh);
      return false;
    });
  }

  // --- world objects -----------------------------------------------------------

  makeAvatar(player) {
    const soldier = makeSoldier(player.color);
    const tag = makeTag(player.name);
    soldier.root.add(tag.sprite);
    this.scene.add(soldier.root);
    return { soldier, tag, state: player };
  }

  addPickup(pickup, id) {
    const crate = pickup.weapon === LOADOUT;
    const mine = pickup.owner === this.room.sessionId;
    const group = new THREE.Group();
    group.position.set(pickup.x * SCALE, 0, pickup.y * SCALE);
    const color = crate ? 0xf39c12 : new THREE.Color(WEAPONS[pickup.weapon].color);
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(crate ? 1.2 : 0.8, 24),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: crate && !mine ? 0.15 : 0.4, depthWrite: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.03;
    group.add(glow);
    let spinner = null;
    if (crate) {
      group.add(makeCrate(mine));
      if (mine) { // a tall beam so you can find your crate from across the map
        const beam = new THREE.Mesh(
          new THREE.CylinderGeometry(0.25, 0.25, 40, 8, 1, true),
          new THREE.MeshBasicMaterial({ color: 0xffb030, transparent: true, opacity: 0.35, depthWrite: false }),
        );
        beam.position.y = 20;
        group.add(beam);
      }
    } else {
      spinner = makeGun(pickup.weapon);
      spinner.scale.setScalar(1.6);
      spinner.position.y = 0.8;
      group.add(spinner);
    }
    this.scene.add(group);
    this.pickups.set(id, { state: pickup, group, spinner });
  }

  updatePickups(now) {
    for (const p of this.pickups.values()) {
      if (!p.spinner) continue;
      p.spinner.rotation.y = now / 700;
      p.spinner.position.y = 0.8 + Math.sin(now / 350) * 0.08;
    }
  }

  // Bushes between the camera and the player you're following (including the one they
  // stand in) turn see-through for you only; other players still can't see into them.
  updateBushes() {
    const focus = this.cameraFocus;
    if (!focus) return;
    const cx = this.camera.position.x, cz = this.camera.position.z;
    for (const bush of this.world.bushes) {
      const blocking = distToSegment(bush.x, bush.z, cx, cz, focus.x, focus.z) < bush.radius + 0.4;
      bush.material.opacity = blocking ? 0.3 : 1;
    }
  }

  // --- audio -------------------------------------------------------------------

  updateAudio(now) {
    const focus = this.spectating ? [...this.others.values()].find((o) => o.state.name === this.spectating)?.px : this.me.px;
    if (focus) this.sfx.setListener(focus.x, focus.y);
    for (const a of [this.me, ...this.others.values()]) {
      if (!a.px) continue;
      if (a.lastStepPos && a.state.alive) {
        a.walked = (a.walked ?? 0) + Math.min(50, Math.hypot(a.px.x - a.lastStepPos.x, a.px.y - a.lastStepPos.y));
        if (a.walked >= STEP_DIST) {
          a.walked = 0;
          this.sfx.step(a.px.x, a.px.y, a === this.me ? 0.15 : 0.3);
        }
      }
      a.lastStepPos = { ...a.px };
    }
    if (this.inGas() && now - (this.lastGasTick ?? 0) >= 1000) {
      this.lastGasTick = now;
      this.sfx.zoneTick();
    }
  }

  inGas() {
    const z = this.room.state.zone;
    return this.room.state.phase === "playing" && this.me.state.alive
      && Math.hypot(this.me.pos.x - z.x, this.me.pos.y - z.y) > z.radius;
  }

  // --- HUD -----------------------------------------------------------------------

  updateHud(now) {
    const s = this.me.state;
    const slot = (n, id, mag, reserve) => {
      const active = activeWeapon(s) === (id || "none") ? ">" : " ";
      if (!id) return `${active}[${n}] ---`;
      return `${active}[${n}] ${WEAPONS[id].label.padEnd(8)} ${String(mag).padStart(2)}/${reserve}`;
    };
    const lines = [slot(1, s.secondary, s.secondaryMag, "∞"), slot(2, s.primary, s.primaryMag, s.primaryReserve)];
    if (s.reloading) lines.push("  Reloading…");
    setText(ui.weapons, lines.join("\n"));

    const frac = Math.max(0, s.health) / MAX_HEALTH;
    ui.health.style.width = `${frac * 100}%`;
    ui.health.style.background = frac > 0.5 ? "#2ecc71" : frac > 0.25 ? "#f1c40f" : "#e74c3c";

    this.hurtFlash = Math.max(0, this.hurtFlash - 0.04);
    ui.vignette.style.opacity = String(this.inGas() ? 0.9 : this.hurtFlash * 0.7);
    ui.lookhint.hidden = !!this.locked;
    ui.crosshair.hidden = !s.alive || this.room.state.phase === "ended";

    this.updateBanner();
    this.updatePrompt();
    this.updateOverlay(now);
    this.drawMinimap();
  }

  updateBanner() {
    const state = this.room.state, z = state.zone;
    ui.banner.hidden = state.phase !== "playing";
    if (ui.banner.hidden) return;
    const stage = z.radius === 0 ? "Zone closed"
      : z.shrinking ? `Zone closing: ${z.secondsLeft}s` : `Zone moves in ${z.secondsLeft}s`;
    const warn = this.inGas() ? `  ⚠ OUTSIDE ZONE -${z.dps}/s` : "";
    setText(ui.banner, `${state.aliveCount} alive · Phase ${z.phase}/4 · ${stage}${warn}`);
    ui.banner.style.color = warn ? "#ff7766" : "#fff";
  }

  updatePrompt() {
    let nearest = null;
    let nearestDist = PICKUP_RANGE;
    if (this.me.state.alive && this.room.state.phase === "playing") {
      for (const p of this.pickups.values()) {
        if (p.state.owner && p.state.owner !== this.room.sessionId) continue;
        const d = Math.hypot(p.state.x - this.me.pos.x, p.state.y - this.me.pos.y);
        if (d <= nearestDist) { nearest = p; nearestDist = d; }
      }
    }
    ui.prompt.hidden = !nearest;
    if (nearest) setText(ui.prompt, `E: ${nearest.state.weapon === LOADOUT ? "Open loadout" : WEAPONS[nearest.state.weapon].label}`);
  }

  drawMinimap() {
    const g = this.minimapCtx, size = ui.minimap.width, k = size / MAP_WIDTH;
    const z = this.room.state.zone;
    g.clearRect(0, 0, size, size);
    g.fillStyle = "#9a978f"; // cover
    for (const o of OBSTACLES) {
      if (o.type === "rock") { g.beginPath(); g.arc(o.x * k, o.y * k, Math.max(1.5, o.r * k), 0, Math.PI * 2); g.fill(); }
      else g.fillRect(o.x * k, o.y * k, Math.max(1.5, o.w * k), Math.max(1.5, o.h * k));
    }
    g.lineWidth = 2;
    g.strokeStyle = "#ff5544";
    g.beginPath(); g.arc(z.x * k, z.y * k, z.radius * k, 0, Math.PI * 2); g.stroke();
    if (z.nextRadius > 0) {
      g.lineWidth = 1;
      g.strokeStyle = "#ffffff";
      g.beginPath(); g.arc(z.nextX * k, z.nextY * k, z.nextRadius * k, 0, Math.PI * 2); g.stroke();
    }
    for (const p of this.pickups.values()) {
      if (p.state.weapon === LOADOUT && p.state.owner === this.room.sessionId) {
        g.fillStyle = "#f39c12";
        g.fillRect(p.state.x * k - 3, p.state.y * k - 3, 6, 6);
      }
    }
    const spectated = this.spectating && [...this.others.values()].find((o) => o.state.name === this.spectating);
    const focus = spectated?.px ? spectated : this.me;
    if (!focus.px) return;
    const fx = focus.px.x * k, fy = focus.px.y * k, fa = focus === this.me ? this.yaw : focus.facing ?? 0;
    g.fillStyle = "#fff";
    g.beginPath(); g.arc(fx, fy, 3, 0, Math.PI * 2); g.fill();
    g.strokeStyle = "#fff";
    g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + Math.cos(fa) * 10, fy + Math.sin(fa) * 10); g.stroke();
  }

  updateOverlay(now) {
    const state = this.room.state;
    const players = [...state.players.values()];
    let title = "", body = "", corner = false, showStart = false, canStart = false;

    if (state.phase === "lobby") {
      const isHost = state.hostId === this.room.sessionId;
      const host = state.players.get(state.hostId)?.name ?? "?";
      const bots = Math.max(0, state.botFill - players.length);
      title = `Lobby · ${players.length} player${players.length === 1 ? "" : "s"}`;
      body = `${players.map((p) => escapeHtml(p.name)).join(", ")}<br>`
        + (isHost ? "You're the host." : `Waiting for ${escapeHtml(host)} to start…`)
        + (bots ? `<br>${bots} bot${bots === 1 ? "" : "s"} will join when the match starts.` : "")
        + `<br>Auto-starts at ${AUTO_START_PLAYERS} players.`
        + this.loadoutPicker();
      showStart = isHost;
      canStart = players.length + bots >= MIN_PLAYERS;
      ui.start.textContent = canStart ? "Start match" : `Need ${MIN_PLAYERS} players`;
    } else if (state.phase === "countdown") {
      title = `Dropping in ${state.countdown}…`;
    } else if (state.phase === "playing" && !this.me.state.alive) {
      corner = true;
      body = `Eliminated${this.killedBy ? ` by ${escapeHtml(this.killedBy)}` : ""}`
        + (this.spectating ? ` · spectating ${escapeHtml(this.spectating)}` : "");
    } else if (state.phase === "ended") {
      const won = state.winner && state.winner === this.me.state.name && this.me.state.alive;
      title = won ? "🏆 Victory!" : state.winner ? `🏆 ${escapeHtml(state.winner)} wins` : "No survivors";
      const board = players.slice().sort((a, b) => b.kills - a.kills).slice(0, 5)
        .map((p) => `${escapeHtml(p.name)}: ${p.kills} kill${p.kills === 1 ? "" : "s"}`).join("<br>");
      const left = Math.max(0, Math.ceil(END_SCREEN_S - (now - (this.endedAt ?? now)) / 1000));
      body = `${board}<br><br>Back to lobby in ${left}s`;
    }

    const key = [title, body, corner, showStart, canStart].join("|");
    if (key === this.overlayKey) return;
    this.overlayKey = key;
    ui.overlay.hidden = !title && !body;
    ui.overlay.classList.toggle("corner", corner);
    ui.overlay.classList.toggle("side", state.phase === "lobby");
    ui.overlayTitle.hidden = !title;
    ui.overlayTitle.innerHTML = title;
    ui.overlayBody.innerHTML = body;
    ui.start.hidden = !showStart;
    ui.start.disabled = !canStart;
    // Free the mouse whenever there's a panel to click.
    if ((state.phase === "lobby" || state.phase === "ended") && this.locked) document.exitPointerLock?.();
  }

  loadoutPicker() {
    const me = this.me.state;
    const row = (slot, choices, chosen) => choices.map((id) => {
      const on = id === chosen;
      return `<button data-slot="${slot}" data-weapon="${id}" style="margin:4px 3px 0;padding:6px 10px;`
        + `background:${on ? WEAPONS[id].color : "#333"};color:${on ? "#000" : "#fff"}">${WEAPONS[id].label}</button>`;
    }).join("");
    const when = LOADOUT_DROP_PHASE === 0 ? "You spawn with it."
      : `Secondary at spawn · primary arrives in a loadout drop at zone phase ${LOADOUT_DROP_PHASE}.`;
    return `<hr style="border-color:#444;margin:12px 0 6px"><b>Loadout</b>`
      + `<div>Primary: ${row("primary", PRIMARY_CHOICES, me.loadoutPrimary)}</div>`
      + `<div>Secondary: ${row("secondary", SECONDARY_CHOICES, me.loadoutSecondary)}</div>`
      + `<div style="font-size:12px;opacity:.8;margin-top:6px">${when}</div>`;
  }

  announce(text) {
    setText(ui.announce, text);
    ui.announce.hidden = false;
    clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => { ui.announce.hidden = true; }, 5000);
  }

  showKill(killer, victim) {
    const row = document.createElement("div");
    row.className = "panel";
    row.textContent = `${killer} ✖ ${victim}`;
    ui.killfeed.append(row);
    while (ui.killfeed.children.length > 5) ui.killfeed.firstChild.remove();
    setTimeout(() => row.remove(), 4000);
  }
}

function setText(el, text) {
  if (el.textContent !== text) el.textContent = text;
}

function distToSegment(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz || 1;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / len2));
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}

function lerpAngle(a, b, t) {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * t;
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function activeWeapon(state) {
  return state.slot === 1 && state.primary ? state.primary : state.secondary || "pistol";
}

const game = new Game();
window.game = game; // exposed for debugging from the console
game.connect();
