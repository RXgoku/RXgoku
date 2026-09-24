import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import {
  MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, MAX_INPUT_DT, applyMove,
  MAX_HEALTH, BULLET_RADIUS, PICKUP_RANGE, MIN_PLAYERS, AUTO_START_PLAYERS, END_SCREEN_S, LOADOUT_DROP_PHASE,
} from "../../server/src/constants.js";
import { WEAPONS, PRIMARY_CHOICES, SECONDARY_CHOICES, LOADOUT } from "../../server/src/weapons.js";

const INTERP_DELAY_MS = 100; // render remote players this far in the past
const AIM_SEND_MS = 50;      // how often we tell the server where we're aiming
const HEALTH_BAR_W = 36;
const MINIMAP_SIZE = 160;
const FOG_SEGMENTS = 96;
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
    this.drawGround();
    this.zoneGfx = this.add.graphics().setDepth(3);
    this.minimap = this.add.graphics().setScrollFactor(0).setDepth(10);
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
        avatar.container.setAlpha(alive ? 1 : 0.25);
        if (avatar === this.me) this.showStatus();
      });
    });
    callbacks.onAdd("pickups", (pickup, id) => {
      const crate = pickup.weapon === LOADOUT;
      const mine = pickup.owner === this.room.sessionId;
      const color = crate ? 0xf39c12 : Phaser.Display.Color.HexStringToColor(WEAPONS[pickup.weapon].color).color;
      const box = crate
        ? this.add.rectangle(0, 0, 30, 30, color).setStrokeStyle(3, mine ? 0xffffff : 0x000000)
        : this.add.rectangle(0, 0, 30, 14, color).setStrokeStyle(2, 0x000000);
      const text = crate ? (mine ? "YOUR LOADOUT" : "Loadout") : WEAPONS[pickup.weapon].label;
      const label = this.add.text(0, crate ? 20 : 14, text, { fontFamily: "monospace", fontSize: "10px", color: "#ffffff" }).setOrigin(0.5, 0);
      this.pickups.set(id, { state: pickup, container: this.add.container(pickup.x, pickup.y, [box, label]).setDepth(1) });
    });
    callbacks.onRemove("pickups", (_pickup, id) => {
      this.pickups.get(id)?.container.destroy();
      this.pickups.delete(id);
    });
    callbacks.onRemove("players", (_player, id) => {
      this.others.get(id)?.container.destroy();
      this.others.delete(id);
    });

    this.room.onMessage("bullets", (list) => list.forEach((b) => this.addBullet(b)));
    this.room.onMessage("bulletEnd", ({ id, x, y, hit }) => this.removeBullet(id, x, y, hit));
    this.room.onMessage("kill", ({ killer, victim }) => this.showKill(killer, victim));
    this.room.onMessage("clearBullets", () => {
      for (const id of [...this.bullets.keys()]) this.removeBullet(id);
    });
    callbacks.listen("phase", (phase) => {
      if (phase === "ended") this.endedAt = performance.now();
      if (phase !== "playing") this.killedBy = null;
    });
    overlay.start.addEventListener("click", () => this.room.send("start"));
    overlay.body.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-slot]");
      if (btn) this.room.send("loadout", { [btn.dataset.slot]: btn.dataset.weapon });
    });
    this.room.onMessage("loadoutDrop", () => this.announce("📦 Your loadout crate landed nearby — press E on it"));
    this.room.onLeave(() => { statusEl.textContent = "Disconnected"; });

    const kb = this.input.keyboard;
    kb.on("keydown-E", () => this.me?.state.alive && this.room.send("pickup"));
    kb.on("keydown-R", () => this.me?.state.alive && this.room.send("reload"));
    kb.on("keydown-ONE", () => this.room.send("switch", { slot: 0 }));
    kb.on("keydown-TWO", () => this.room.send("switch", { slot: 1 }));
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

  addBullet({ id, x, y, vx, vy, life }) {
    const sprite = this.add.circle(x, y, BULLET_RADIUS, 0xfff3a0).setDepth(5);
    this.bullets.set(id, { sprite, vx, vy, expires: performance.now() + life });
  }

  moveBullets(dt, now) {
    for (const [id, b] of this.bullets) {
      b.sprite.x += b.vx * dt;
      b.sprite.y += b.vy * dt;
      if (now > b.expires + 500) this.removeBullet(id); // lost bulletEnd safety net
    }
  }

  removeBullet(id, x, y, hit) {
    this.bullets.get(id)?.sprite.destroy();
    this.bullets.delete(id);
    if (hit) {
      const spark = this.add.circle(x, y, 8, 0xff4444).setDepth(6);
      this.tweens.add({ targets: spark, scale: 2, alpha: 0, duration: 200, onComplete: () => spark.destroy() });
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
    statusEl.textContent = `${this.name} — WASD move, mouse aim, click shoot, E pick up, R reload, 1/2 switch`;
  }

  makeAvatar(player) {
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const barrel = this.add.rectangle(0, 0, PLAYER_RADIUS + 10, 6, 0x222222).setOrigin(0, 0.5);
    const body = this.add.circle(0, 0, PLAYER_RADIUS, color).setStrokeStyle(2, 0x000000);
    const bar = this.add.graphics();
    const label = this.add.text(0, -40, player.name, {
      fontFamily: "monospace", fontSize: "12px", color: "#ffffff",
    }).setOrigin(0.5);
    const container = this.add.container(player.x, player.y, [barrel, body, bar, label]).setDepth(2);
    return { container, body, barrel, bar, label, angle: player.angle, drawnHealth: -1, drawnWeapon: "" };
  }

  placeAvatar(avatar, x, y, state) {
    avatar.container.setPosition(x, y);
    avatar.barrel.setRotation(avatar === this.me ? avatar.angle : state.angle);
    const weaponId = activeWeapon(state);
    if (avatar.drawnWeapon !== weaponId) {
      avatar.drawnWeapon = weaponId;
      const w = WEAPONS[weaponId];
      avatar.barrel.setSize(PLAYER_RADIUS + w.barrel, 6).setFillStyle(Phaser.Display.Color.HexStringToColor(w.color).color);
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
    const g = this.add.graphics();
    g.fillStyle(0x2d4a2b).fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    g.lineStyle(1, 0x3b5e38);
    for (let i = 0; i <= MAP_WIDTH; i += 100) g.lineBetween(i, 0, i, MAP_HEIGHT);
    for (let i = 0; i <= MAP_HEIGHT; i += 100) g.lineBetween(0, i, MAP_WIDTH, i);
    g.lineStyle(4, 0xff0000).strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
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
