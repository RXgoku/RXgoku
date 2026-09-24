import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import {
  MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, MAX_INPUT_DT, applyMove,
  MAX_HEALTH, PICKUP_RANGE, MIN_PLAYERS, AUTO_START_PLAYERS, END_SCREEN_S, LOADOUT_DROP_PHASE,
} from "../../server/src/constants.js";
import { WEAPONS, PRIMARY_CHOICES, SECONDARY_CHOICES, LOADOUT } from "../../server/src/weapons.js";
import { createTextures, bushLayout, gunLength } from "./art.js";
import { Sfx } from "./sfx.js";

const INTERP_DELAY_MS = 100; // render remote players this far in the past
const AIM_SEND_MS = 50;      // how often we tell the server where we're aiming
const HEALTH_BAR_W = 36;
const MINIMAP_SIZE = 160;
const FOG_SEGMENTS = 96;
const STEP_DIST = 55;      // px walked per footstep sound
const TELEPORT_DIST = 150; // a jump bigger than this is a teleport (match start), not movement: don't interpolate it
const serverUrl = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);
const statusEl = document.getElementById("status");
const overlay = {
  root: document.getElementById("overlay"),
  title: document.getElementById("overlay-title"),
  body: document.getElementById("overlay-body"),
  start: document.getElementById("start-btn"),
};

class GameScene extends Phaser.Scene {
  constructor() {
    super("game");
    this.others = new Map();  // sessionId -> avatar + { buffer: [{t,x,y}] }
    this.bullets = new Map(); // id -> { sprite, vx, vy, expires }
    this.pickups = new Map(); // id -> { container, state }
    this.pending = [];        // inputs sent but not yet acknowledged by the server
    this.seq = 0;
    this.lastShot = 0;
    this.lastAimSent = 0;
    this.sentAngle = null;
  }

  async create() {
    createTextures(this);
    this.drawGround();
    this.sfx = new Sfx();
    // Audio can only start after a user gesture.
    const unlock = () => this.sfx.unlock();
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    this.hitSparks = this.add.particles(0, 0, "spark", {
      speed: { min: 60, max: 200 }, lifespan: 280, scale: { start: 1.4, end: 0 }, tint: [0xff3b30, 0xffffff], emitting: false,
    }).setDepth(6);
    this.zoneGfx = this.add.graphics().setDepth(3);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(10);
    // Clip the minimap so an early, map-sized zone circle doesn't spill past its edges.
    this.minimapClip = this.make.graphics({}, false).setScrollFactor(0);
    this.minimap.setMask(this.minimapClip.createGeometryMask());
    this.banner = this.add.text(0, 36, "", {
      fontFamily: "monospace", fontSize: "16px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 8, y: 4 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(10);
    this.keys = this.input.keyboard.addKeys("W,A,S,D");
    this.hud = this.add.text(12, 0, "", {
      fontFamily: "monospace", fontSize: "16px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 8, y: 6 },
    }).setScrollFactor(0).setDepth(10);
    this.prompt = this.add.text(0, 0, "", {
      fontFamily: "monospace", fontSize: "13px", color: "#ffffff", backgroundColor: "#000000aa", padding: { x: 5, y: 3 },
    }).setOrigin(0.5).setDepth(9).setVisible(false);
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.input.mouse?.disableContextMenu();

    const name = new URLSearchParams(location.search).get("name") || `Player${Math.floor(Math.random() * 1000)}`;
    try {
      this.room = await new Client(serverUrl).joinOrCreate("battle", { name });
    } catch (err) {
      statusEl.textContent = `Could not connect to ${serverUrl}: ${err.message}`;
      return;
    }
    this.name = name;
    this.showStatus();

    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd("players", (player, id) => {
      const avatar = this.makeAvatar(player);
      if (id === this.room.sessionId) {
        this.me = avatar;
        this.me.state = player;
        this.me.pos = { x: player.x, y: player.y };
        this.cameras.main.startFollow(avatar.container, true, 0.15, 0.15);
        callbacks.onChange(player, () => this.reconcile(player));
        callbacks.listen(player, "health", (hp, prev) => {
          if (prev !== undefined && hp < prev && hp > 0 && !this.inGas()) this.sfx.hurt();
        });
        callbacks.listen(player, "reloading", (on) => { if (on) this.sfx.reload(); });
        callbacks.listen(player, "primary", (w, prev) => { if (w && w !== prev) this.sfx.pickup(); });
      } else {
        avatar.state = player;
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
      callbacks.listen(player, "alive", (alive) => {
        avatar.container.setAlpha(alive ? 1 : 0.35);
        avatar.body.setTint(alive ? avatar.color : 0x666666);
        if (avatar === this.me) this.showStatus();
      });
    });
    callbacks.onAdd("pickups", (pickup, id) => {
      const crate = pickup.weapon === LOADOUT;
      const mine = pickup.owner === this.room.sessionId;
      const color = crate ? 0xf39c12 : Phaser.Display.Color.HexStringToColor(WEAPONS[pickup.weapon].color).color;
      const glow = this.add.circle(0, 0, crate ? 26 : 18, color, crate && !mine ? 0.12 : 0.3);
      const icon = crate
        ? this.add.image(0, 0, "crate")
        : this.add.image(0, 0, `gun_${pickup.weapon}`).setScale(1.4).setRotation(-0.35);
      const text = crate ? (mine ? "YOUR LOADOUT" : "Loadout") : WEAPONS[pickup.weapon].label;
      const label = this.add.text(0, crate ? 20 : 14, text, {
        fontFamily: "monospace", fontSize: "10px", color: "#ffffff", stroke: "#000000", strokeThickness: 3,
      }).setOrigin(0.5, 0);
      const container = this.add.container(pickup.x, pickup.y, [glow, icon, label]).setDepth(1);
      this.tweens.add({ targets: icon, y: -3, duration: 700, yoyo: true, repeat: -1, ease: "Sine.inOut" });
      this.tweens.add({ targets: glow, scale: 1.25, alpha: glow.alpha * 0.5, duration: 900, yoyo: true, repeat: -1 });
      this.pickups.set(id, { state: pickup, container });
    });
    callbacks.onRemove("pickups", (_pickup, id) => {
      this.pickups.get(id)?.container.destroy();
      this.pickups.delete(id);
    });
    callbacks.onRemove("players", (_player, id) => {
      this.others.get(id)?.container.destroy();
      this.others.delete(id);
    });

    this.room.onMessage("bullets", (volley) => this.onVolley(volley));
    this.room.onMessage("bulletEnd", ({ id, x, y, hit }) => this.removeBullet(id, x, y, hit));
    this.room.onMessage("kill", ({ killer, victim }) => {
      if (killer === this.me?.state.name) this.sfx.kill();
      if (victim === this.me?.state.name) this.sfx.death();
      this.showKill(killer, victim);
    });
    this.room.onMessage("clearBullets", () => {
      for (const id of [...this.bullets.keys()]) this.removeBullet(id);
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
    overlay.start.addEventListener("click", () => this.room.send("start"));
    overlay.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-slot]");
      if (btn) this.room.send("loadout", { [btn.dataset.slot]: btn.dataset.weapon });
    });
    this.room.onMessage("loadoutDrop", () => {
      this.announce("📦 Your loadout crate landed nearby — press E on it");
      const crate = [...this.pickups.values()].find((p) => p.state.weapon === LOADOUT && p.state.owner === this.room.sessionId);
      if (crate) this.sfx.crateLanded(crate.state.x, crate.state.y);
    });
    this.room.onLeave(() => { statusEl.textContent = "Disconnected"; });

    const kb = this.input.keyboard;
    kb.on("keydown-E", () => this.me?.state.alive && this.room.send("pickup"));
    kb.on("keydown-R", () => this.me?.state.alive && this.room.send("reload"));
    kb.on("keydown-ONE", () => this.room.send("switch", { slot: 0 }));
    kb.on("keydown-TWO", () => this.room.send("switch", { slot: 1 }));
    kb.on("keydown-M", () => this.announce(this.sfx.toggleMute() ? "🔇 Sound off (M)" : "🔊 Sound on (M)"));
  }

  update(_time, deltaMs) {
    if (!this.me) return;
    const now = performance.now();
    if (this.me.state.alive) {
      this.sendInputAndPredict(deltaMs / 1000);
      this.aimAndShoot(now, this.room.state.phase === "playing");
    }
    this.updateCamera();
    this.updateOverlay(now);
    this.updateAudio(now);
    this.updateBushes();
    this.placeAvatar(this.me, this.me.pos.x, this.me.pos.y, this.me.state);
    this.interpolateOthers(now - INTERP_DELAY_MS);
    this.moveBullets(deltaMs / 1000, now);
    this.updatePickupPrompt();
    this.updateHud();
    this.drawZone();
    this.drawMinimap();
  }

  sendInputAndPredict(dt) {
    const { W, A, S, D } = this.keys;
    if (!(W.isDown || A.isDown || S.isDown || D.isDown)) return;
    const input = {
      seq: ++this.seq,
      up: W.isDown, down: S.isDown, left: A.isDown, right: D.isDown,
      dt: Math.min(dt, MAX_INPUT_DT),
    };
    this.room.send("input", input);
    this.pending.push(input);
    applyMove(this.me.pos, input); // move now; the server will confirm or correct
  }

  aimAndShoot(now, canShoot) {
    const pointer = this.input.activePointer;
    const world = pointer.positionToCamera(this.cameras.main);
    this.me.angle = Math.atan2(world.y - this.me.pos.y, world.x - this.me.pos.x);

    // Hold left mouse to fire; the server enforces the same cooldown and ammo rules.
    const state = this.me.state;
    const weaponId = activeWeapon(state);
    const mag = state.slot === 1 && state.primary ? state.primaryMag : state.secondaryMag;
    const canFire = canShoot && !state.reloading && mag > 0;
    if (pointer.leftButtonDown() && canShoot && !state.reloading && mag === 0 && now - this.lastShot >= 300) {
      this.lastShot = now;
      this.sfx.empty();
    }
    if (pointer.leftButtonDown() && canFire && now - this.lastShot >= WEAPONS[weaponId].cooldownMs) {
      this.lastShot = now;
      this.lastAimSent = now;
      this.sentAngle = this.me.angle;
      this.room.send("shoot", { angle: this.me.angle });
    } else if (now - this.lastAimSent >= AIM_SEND_MS && this.me.angle !== this.sentAngle) {
      this.lastAimSent = now;
      this.sentAngle = this.me.angle;
      this.room.send("aim", { angle: this.me.angle });
    }
  }

  // Start from the server's position, then replay inputs it hasn't processed yet.
  reconcile(player) {
    this.pending = this.pending.filter((input) => input.seq > player.lastSeq);
    const pos = { x: player.x, y: player.y };
    for (const input of this.pending) applyMove(pos, input);
    this.me.pos = pos;
  }

  interpolateOthers(renderTime) {
    for (const other of this.others.values()) {
      const buf = other.buffer;
      while (buf.length >= 2 && buf[1].t <= renderTime) buf.shift();
      const [a, b] = buf;
      if (!b || renderTime <= a.t) {
        this.placeAvatar(other, a.x, a.y, other.state);
        continue;
      }
      const k = (renderTime - a.t) / (b.t - a.t);
      this.placeAvatar(other, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, other.state);
    }
  }

  onVolley({ weapon, shooter, x, y, angle, bullets }) {
    // Sound and flash come from where the shooter is drawn on this screen.
    const avatar = shooter === this.room.sessionId ? this.me : this.others.get(shooter);
    const pos = avatar === this.me ? this.me.pos : avatar ? { x: avatar.container.x, y: avatar.container.y } : { x, y };
    this.sfx.shot(weapon, pos.x, pos.y);
    const tip = PLAYER_RADIUS + gunLength(weapon);
    const flash = this.add.image(pos.x + Math.cos(angle) * tip, pos.y + Math.sin(angle) * tip, "flash")
      .setDepth(6).setRotation(angle).setScale(weapon === "shotgun" || weapon === "sniper" ? 1.5 : 1);
    this.tweens.add({ targets: flash, alpha: 0, scale: flash.scale * 1.6, duration: 70, onComplete: () => flash.destroy() });
    for (const b of bullets) this.addBullet(b, shooter);
  }

  addBullet({ id, x, y, vx, vy, life }, shooter) {
    const sprite = this.add.image(x, y, "tracer").setDepth(5).setRotation(Math.atan2(vy, vx));
    this.bullets.set(id, { sprite, vx, vy, shooter, expires: performance.now() + life });
  }

  moveBullets(dt, now) {
    for (const [id, b] of this.bullets) {
      b.sprite.x += b.vx * dt;
      b.sprite.y += b.vy * dt;
      if (now > b.expires + 500) this.removeBullet(id); // lost bulletEnd safety net
    }
  }

  removeBullet(id, x, y, hit) {
    const bullet = this.bullets.get(id);
    bullet?.sprite.destroy();
    this.bullets.delete(id);
    if (hit) {
      this.hitSparks.explode(10, x, y);
      this.sfx.hit(x, y);
      if (bullet?.shooter === this.room.sessionId) this.sfx.hitMarker();
    }
  }

  updateAudio(now) {
    const view = this.cameras.main.worldView;
    this.sfx.setListener(view.centerX, view.centerY);
    // Footsteps: yours, plus everyone else's so you can hear people nearby.
    const avatars = [this.me, ...this.others.values()];
    for (const a of avatars) {
      const x = a === this.me ? this.me.pos.x : a.container.x;
      const y = a === this.me ? this.me.pos.y : a.container.y;
      if (a.lastStepPos && a.state.alive) {
        a.walked = (a.walked ?? 0) + Math.min(50, Math.hypot(x - a.lastStepPos.x, y - a.lastStepPos.y));
        if (a.walked >= STEP_DIST) {
          a.walked = 0;
          this.sfx.step(x, y, a === this.me ? 0.15 : 0.3);
        }
      }
      a.lastStepPos = { x, y };
    }
    // Warning tick every second while you're in the gas.
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

  // Bushes hide whoever is under them; the one you're standing in turns see-through for you.
  updateBushes() {
    for (const bush of this.bushes) {
      const inside = Math.hypot(bush.x - this.me.pos.x, bush.y - this.me.pos.y) < 34 * bush.scale;
      bush.setAlpha(inside ? 0.45 : 0.96);
    }
  }

  updatePickupPrompt() {
    let nearest = null;
    let nearestDist = PICKUP_RANGE;
    if (this.me.state.alive && this.room.state.phase === "playing") {
      for (const p of this.pickups.values()) {
        if (p.state.owner && p.state.owner !== this.room.sessionId) continue;
        const d = Math.hypot(p.state.x - this.me.pos.x, p.state.y - this.me.pos.y);
        if (d <= nearestDist) { nearest = p; nearestDist = d; }
      }
    }
    this.prompt.setVisible(!!nearest);
    if (nearest) {
      const what = nearest.state.weapon === LOADOUT ? "Open loadout" : WEAPONS[nearest.state.weapon].label;
      this.prompt.setText(`E: ${what}`).setPosition(nearest.state.x, nearest.state.y + 36);
    }
  }

  updateHud() {
    const s = this.me.state;
    const slot = (n, id, mag, reserve) => {
      const active = activeWeapon(s) === (id || "none") ? ">" : " ";
      if (!id) return `${active}[${n}] ---`;
      return `${active}[${n}] ${WEAPONS[id].label.padEnd(7)} ${String(mag).padStart(2)}/${reserve}`;
    };
    const lines = [
      slot(1, s.secondary, s.secondaryMag, "∞"),
      slot(2, s.primary, s.primaryMag, s.primaryReserve),
    ];
    if (s.reloading) lines.push("  Reloading…");
    this.hud.setText(lines.join("\n"));
    this.hud.setY(this.scale.height - this.hud.height - 12);
  }

  // Follow yourself, or spectate your killer (or anyone alive) once eliminated.
  updateCamera() {
    let target = this.me;
    if (!this.me.state.alive) {
      const alive = [...this.others.values()].filter((o) => o.state.alive);
      target = alive.find((o) => o.state.name === this.killedBy) ?? alive[0] ?? this.me;
    }
    if (this.cameraTarget !== target) {
      this.cameraTarget = target;
      this.spectating = target === this.me ? null : target.state.name;
      this.cameras.main.startFollow(target.container, true, 0.15, 0.15);
    }
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
      overlay.start.textContent = canStart ? "Start match" : `Need ${MIN_PLAYERS} players`;
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
    overlay.root.hidden = !title && !body;
    overlay.root.classList.toggle("corner", corner);
    overlay.root.classList.toggle("side", state.phase === "lobby");
    overlay.title.hidden = !title;
    overlay.title.innerHTML = title;
    overlay.body.innerHTML = body;
    overlay.start.hidden = !showStart;
    overlay.start.disabled = !canStart;
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
    const msg = this.add.text(this.scale.width / 2, 80, text, {
      fontFamily: "monospace", fontSize: "18px", color: "#ffd166", backgroundColor: "#000000cc", padding: { x: 10, y: 6 },
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(11);
    this.time.delayedCall(5000, () => msg.destroy());
  }

  drawZone() {
    const z = this.room.state.zone;
    const g = this.zoneGfx.clear();
    // Fog outside the circle, as non-overlapping wedges so the alpha stays even.
    const far = Math.hypot(MAP_WIDTH, MAP_HEIGHT) * 2;
    g.fillStyle(0xc0392b, 0.28);
    for (let i = 0; i < FOG_SEGMENTS; i++) {
      const a0 = (i / FOG_SEGMENTS) * Math.PI * 2;
      const a1 = ((i + 1) / FOG_SEGMENTS) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      g.fillPoints([
        { x: z.x + c0 * z.radius, y: z.y + s0 * z.radius },
        { x: z.x + c0 * far, y: z.y + s0 * far },
        { x: z.x + c1 * far, y: z.y + s1 * far },
        { x: z.x + c1 * z.radius, y: z.y + s1 * z.radius },
      ], true);
    }
    g.lineStyle(3, 0xff5544, 0.9).strokeCircle(z.x, z.y, z.radius);
    if (z.nextRadius > 0 && (z.nextRadius !== z.radius || z.nextX !== z.x)) {
      g.lineStyle(2, 0xffffff, 0.8).strokeCircle(z.nextX, z.nextY, z.nextRadius);
    }

    const me = this.me.pos;
    const outside = Math.hypot(me.x - z.x, me.y - z.y) > z.radius;
    const phase = this.room.state.phase;
    this.banner.setVisible(phase === "playing");
    if (phase !== "playing") return;
    const stage = z.radius === 0 ? "Zone closed"
      : z.shrinking ? `Zone closing: ${z.secondsLeft}s` : `Zone moves in ${z.secondsLeft}s`;
    const warn = outside && this.me.state.alive ? `  ⚠ OUTSIDE ZONE -${z.dps}/s` : "";
    this.banner.setText(`${this.room.state.aliveCount} alive · Phase ${z.phase}/4 · ${stage}${warn}`)
      .setColor(outside ? "#ff7766" : "#ffffff")
      .setX(this.scale.width / 2);
  }

  drawMinimap() {
    const z = this.room.state.zone;
    const size = MINIMAP_SIZE;
    const ox = this.scale.width - size - 12;
    const oy = this.scale.height - size - 12;
    const sx = size / MAP_WIDTH;
    const sy = size / MAP_HEIGHT;
    this.minimapClip.clear().fillStyle(0xffffff).fillRect(ox, oy, size, size);
    const g = this.minimap.clear();
    g.fillStyle(0x1e3320, 0.9).fillRect(ox, oy, size, size);
    g.lineStyle(2, 0xff5544).strokeCircle(ox + z.x * sx, oy + z.y * sy, z.radius * sx);
    if (z.nextRadius > 0) g.lineStyle(1, 0xffffff).strokeCircle(ox + z.nextX * sx, oy + z.nextY * sy, z.nextRadius * sx);
    for (const p of this.pickups.values()) {
      if (p.state.weapon === LOADOUT && p.state.owner === this.room.sessionId) {
        g.fillStyle(0xf39c12).fillRect(ox + p.state.x * sx - 3, oy + p.state.y * sy - 3, 6, 6);
      }
    }
    const focus = this.cameraTarget && this.cameraTarget !== this.me ? this.cameraTarget.container : this.me.pos;
    g.fillStyle(0xffffff).fillCircle(ox + focus.x * sx, oy + focus.y * sy, 3);
    g.lineStyle(1, 0xffffff, 0.6).strokeRect(ox, oy, size, size);
  }

  showKill(killer, victim) {
    if (victim === this.me.state.name) this.killedBy = killer;
    this.killY = (this.killY ?? 0) % 5;
    const text = this.add.text(this.scale.width - 12, 12 + this.killY++ * 26, `${killer} ✖ ${victim}`, {
      fontFamily: "monospace", fontSize: "14px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.time.delayedCall(4000, () => text.destroy());
  }

  showStatus() {
    statusEl.textContent = `${this.name} — WASD move, mouse aim, click shoot, E pick up, R reload, 1/2 switch, M mute`;
  }

  makeAvatar(player) {
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const shadow = this.add.image(2, 4, "shadow");
    const body = this.add.image(0, 0, "soldier").setTint(color);
    const gun = this.add.image(10, 0, "gun_pistol").setOrigin(0, 0.5);
    const helmet = this.add.image(-1, 0, "helmet");
    const rig = this.add.container(0, 0, [body, gun, helmet]); // rotates with aim
    const bar = this.add.graphics();
    const label = this.add.text(0, -40, player.name, {
      fontFamily: "monospace", fontSize: "12px", color: "#ffffff", stroke: "#000000", strokeThickness: 3,
    }).setOrigin(0.5);
    const container = this.add.container(player.x, player.y, [shadow, rig, bar, label]).setDepth(2);
    return { container, rig, body, gun, bar, label, color, angle: player.angle, drawnHealth: -1, drawnWeapon: "" };
  }

  placeAvatar(avatar, x, y, state) {
    avatar.container.setPosition(x, y);
    avatar.rig.setRotation(avatar === this.me ? avatar.angle : state.angle);
    const weaponId = activeWeapon(state);
    if (avatar.drawnWeapon !== weaponId) {
      avatar.drawnWeapon = weaponId;
      avatar.gun.setTexture(`gun_${weaponId}`);
    }
    if (avatar.drawnHealth !== state.health) {
      avatar.drawnHealth = state.health;
      const frac = state.health / MAX_HEALTH;
      const color = frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf1c40f : 0xe74c3c;
      avatar.bar.clear()
        .fillStyle(0x000000, 0.6).fillRect(-HEALTH_BAR_W / 2 - 1, -29, HEALTH_BAR_W + 2, 7)
        .fillStyle(color).fillRect(-HEALTH_BAR_W / 2, -28, HEALTH_BAR_W * frac, 5);
    }
  }

  drawGround() {
    this.add.tileSprite(0, 0, MAP_WIDTH, MAP_HEIGHT, "grass").setOrigin(0).setDepth(0);
    this.add.graphics().setDepth(0).lineStyle(8, 0x1a2e17).strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.bushes = bushLayout(MAP_WIDTH, MAP_HEIGHT).map((b) =>
      this.add.image(b.x, b.y, "bush").setScale(b.scale).setAngle(b.angle).setDepth(2.5));
  }
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function activeWeapon(state) {
  return state.slot === 1 && state.primary ? state.primary : state.secondary || "pistol";
}

window.game = new Phaser.Game({ // exposed for debugging from the console
  type: Phaser.AUTO,
  parent: document.body,
  backgroundColor: "#111111",
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: GameScene,
});
