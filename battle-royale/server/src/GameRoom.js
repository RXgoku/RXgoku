import { Room } from "@colyseus/core";
import { GameState, Player, Pickup, Zone } from "./schema.js";
import {
  MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, TICK_MS, MAX_INPUT_DT, applyMove,
  MAX_HEALTH, BULLET_RADIUS, PICKUP_COUNT, PICKUP_RANGE,
  MIN_PLAYERS, AUTO_START_PLAYERS, COUNTDOWN_S, END_SCREEN_S, LOADOUT_DROP_PHASE,
} from "./constants.js";
import { WEAPONS, randomPickupWeapon, PRIMARY_CHOICES, SECONDARY_CHOICES, LOADOUT } from "./weapons.js";
import { ZoneController } from "./zone.js";
import { BotBrain, BOT_NAMES } from "./bots.js";

const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#ecf0f1"];
const MAX_QUEUED_INPUTS = 60;
const MAX_TIME_BUDGET = 0.25; // seconds of movement a client may bank
// Bots fill each match up to this many players (BOTS=0 disables them).
const BOT_FILL = Math.max(0, Math.min(20, Number(process.env.BOTS ?? 10)));
const SPAWN_SPACING = 350; // px; try to keep spawns at least this far apart

export class GameRoom extends Room {
  maxClients = 20;

  onCreate() {
    this.setState(new GameState());
    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.state.zone = new Zone();
    this.zone = new ZoneController(this.state.zone);
    this.clock.setInterval(() => this.zoneDamage(), 1000);
    this.sessions = new Map(); // sessionId -> { inputs: [], budget, lastShot, reloadTimer }
    this.bullets = new Map();  // id -> { owner, x, y, vx, vy, damage, expires }; server-only, clients get events
    this.nextBulletId = 1;
    this.nextPickupId = 1;
    this.phaseTimer = null;
    this.brains = new Map(); // bot id -> BotBrain
    this.nextBotId = 1;
    this.state.botFill = BOT_FILL;
    this.toLobby();

    // Clients send key state + frame time; the server applies it and owns the result.
    this.onMessage("input", (client, msg) => {
      const s = this.sessions.get(client.sessionId);
      if (!s || !isObject(msg) || s.inputs.length >= MAX_QUEUED_INPUTS) return;
      s.inputs.push({
        seq: msg.seq >>> 0,
        up: !!msg.up,
        down: !!msg.down,
        left: !!msg.left,
        right: !!msg.right,
        dt: Math.min(Math.max(Number(msg.dt) || 0, 0), MAX_INPUT_DT),
      });
    });

    this.onMessage("aim", (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (player?.alive && isObject(msg) && Number.isFinite(msg.angle)) player.angle = msg.angle;
    });

    this.onMessage("shoot", (client, msg) => {
      if (isObject(msg) && Number.isFinite(msg.angle)) this.shoot(client.sessionId, msg.angle);
    });
    this.onMessage("reload", (client) => this.startReload(client.sessionId));
    this.onMessage("switch", (client, msg) => {
      if (isObject(msg)) this.switchSlot(client.sessionId, msg.slot);
    });
    this.onMessage("pickup", (client) => this.pickUp(client.sessionId));
    this.onMessage("loadout", (client, msg) => {
      const player = this.state.players.get(client.sessionId);
      if (!player || !isObject(msg)) return;
      if (PRIMARY_CHOICES.includes(msg.primary)) player.loadoutPrimary = msg.primary;
      if (SECONDARY_CHOICES.includes(msg.secondary)) player.loadoutSecondary = msg.secondary;
    });
    this.onMessage("start", (client) => {
      if (client.sessionId === this.state.hostId) this.startCountdown();
    });

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval((dt) => this.update(dt), TICK_MS);
  }

  onJoin(client, options = {}) {
    const player = new Player();
    player.color = this.freeColor();
    player.name = String(options.name || "Player").slice(0, 16);
    player.lastSeq = 0;
    player.angle = 0;
    player.loadoutPrimary = PRIMARY_CHOICES[0];
    player.loadoutSecondary = SECONDARY_CHOICES[0];
    this.sessions.set(client.sessionId, { inputs: [], budget: 0, lastShot: -Infinity, reloadTimer: null });
    this.resetPlayer(player);
    // The room is locked outside the lobby, so this is only a safety net.
    if (this.state.phase !== "lobby") player.alive = false;
    this.state.players.set(client.sessionId, player);
    if (!this.state.hostId) this.state.hostId = client.sessionId;
    if (this.state.phase === "lobby" && this.clients.length >= AUTO_START_PLAYERS) this.startCountdown();
  }

  onLeave(client) {
    this.cancelReload(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
    if (this.state.hostId === client.sessionId) {
      this.state.hostId = [...this.state.players.entries()].find(([, p]) => !p.bot)?.[0] ?? "";
    }
    if (this.state.phase === "countdown" && Math.max(this.state.players.size, BOT_FILL) < MIN_PLAYERS) this.toLobby();
    if (this.state.phase === "playing") this.checkWinner();
  }

  freeColor() {
    const used = new Set([...this.state.players.values()].map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) ?? COLORS[this.state.players.size % COLORS.length];
  }

  addBot() {
    const n = this.nextBotId++;
    const id = `bot${n}`;
    const player = new Player();
    player.bot = true;
    player.name = `${BOT_NAMES[(n - 1) % BOT_NAMES.length]} [bot]`;
    player.color = this.freeColor();
    player.lastSeq = 0;
    player.angle = 0;
    this.sessions.set(id, { inputs: [], budget: 0, lastShot: -Infinity, reloadTimer: null });
    this.brains.set(id, new BotBrain(id));
    this.state.players.set(id, player);
  }

  removeBots() {
    for (const id of this.brains.keys()) {
      this.cancelReload(id);
      this.state.players.delete(id);
      this.sessions.delete(id);
    }
    this.brains.clear();
  }

  // Best of several random spots: the one furthest from spawns already taken.
  spawnPoint(taken) {
    let best = null;
    let bestDist = -1;
    for (let i = 0; i < 40 && bestDist < SPAWN_SPACING; i++) {
      const spot = this.zone.randomPointInside(PLAYER_RADIUS * 4);
      const d = Math.min(Infinity, ...taken.map((t) => Math.hypot(t.x - spot.x, t.y - spot.y)));
      if (d > bestDist) { best = spot; bestDist = d; }
    }
    taken.push(best);
    return best;
  }

  resetPlayer(player, taken = []) {
    const spot = this.spawnPoint(taken);
    player.x = spot.x;
    player.y = spot.y;
    player.health = MAX_HEALTH;
    player.alive = true;
    player.slot = 0;
    player.primary = "";
    player.primaryMag = 0;
    player.primaryReserve = 0;
    // Bots keep the default secondary; humans spawn with the one they chose.
    player.secondary = player.loadoutSecondary || SECONDARY_CHOICES[0];
    player.secondaryMag = WEAPONS[player.secondary].magSize;
    player.reloading = false;
    player.kills = 0;
  }

  // --- match flow: lobby -> countdown -> playing -> ended -> lobby ----------

  setPhaseTimer(fn, ms) {
    this.phaseTimer?.clear();
    this.phaseTimer = fn ? this.clock.setTimeout(fn, ms) : null;
  }

  toLobby() {
    this.setPhaseTimer(null);
    this.state.phase = "lobby";
    this.state.winner = "";
    this.state.countdown = 0;
    this.zone.reset();
    this.clearBullets();
    this.state.pickups.clear();
    this.removeBots();
    const taken = [];
    this.state.players.forEach((player, id) => {
      this.cancelReload(id);
      this.resetPlayer(player, taken);
    });
    this.state.aliveCount = this.state.players.size;
    this.unlock();
    if (this.clients.length >= AUTO_START_PLAYERS) this.startCountdown();
  }

  startCountdown() {
    const enough = Math.max(this.state.players.size, BOT_FILL) >= MIN_PLAYERS;
    if (this.state.phase !== "lobby" || !enough) return;
    this.lock(); // late joiners get a fresh room instead of landing mid-match
    this.state.phase = "countdown";
    this.state.countdown = COUNTDOWN_S;
    const tick = () => {
      if (this.state.phase !== "countdown") return;
      if (--this.state.countdown > 0) this.setPhaseTimer(tick, 1000);
      else this.startMatch();
    };
    this.setPhaseTimer(tick, 1000);
  }

  startMatch() {
    this.state.phase = "playing";
    this.matchStartedAt = this.clock.currentTime;
    this.clearBullets();
    this.state.pickups.clear();
    for (let i = 0; i < PICKUP_COUNT; i++) {
      const id = randomPickupWeapon();
      this.dropPickup(id, randomCoord(MAP_WIDTH), randomCoord(MAP_HEIGHT), WEAPONS[id].magSize, WEAPONS[id].reserve);
    }
    this.zone.start(this.clock.currentTime);
    while (this.state.players.size < BOT_FILL) this.addBot();
    const taken = [];
    this.state.players.forEach((player, id) => {
      this.cancelReload(id);
      this.resetPlayer(player, taken);
    });
    this.state.aliveCount = this.state.players.size;
    this.loadoutsDropped = false;
    if (LOADOUT_DROP_PHASE === 0) {
      this.state.players.forEach((player, id) => {
        if (!player.bot) this.giveLoadout(id, player);
      });
      this.loadoutsDropped = true;
    }
  }

  // Each human gets a crate near them that only they can open.
  dropLoadouts() {
    this.loadoutsDropped = true;
    this.state.players.forEach((player, id) => {
      if (player.bot || !player.alive) return;
      const a = Math.random() * Math.PI * 2;
      const d = 120 + Math.random() * 80;
      const x = Math.max(PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, player.x + Math.cos(a) * d));
      const y = Math.max(PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, player.y + Math.sin(a) * d));
      this.dropPickup(LOADOUT, x, y, 0, 0, id);
    });
    this.broadcast("loadoutDrop");
  }

  giveLoadout(id, player) {
    this.cancelReload(id);
    if (player.primary) this.dropPickup(player.primary, player.x, player.y, player.primaryMag, player.primaryReserve);
    const primary = WEAPONS[player.loadoutPrimary];
    player.primary = player.loadoutPrimary;
    player.primaryMag = primary.magSize;
    player.primaryReserve = primary.reserve;
    player.secondary = player.loadoutSecondary;
    player.secondaryMag = WEAPONS[player.secondary].magSize;
    player.slot = 1;
  }

  checkWinner() {
    const alive = [...this.state.players.values()].filter((p) => p.alive);
    this.state.aliveCount = alive.length;
    if (this.state.phase !== "playing") return;
    // Last one standing wins. If every human is out, don't make them watch bots:
    // end now and crown the best surviving bot.
    const humansAlive = alive.some((p) => !p.bot);
    if (alive.length > 1 && humansAlive) return;
    const best = alive.sort((a, b) => b.kills - a.kills || b.health - a.health)[0];
    this.state.phase = "ended";
    this.state.winner = best?.name ?? "";
    this.clearBullets();
    this.setPhaseTimer(() => this.toLobby(), END_SCREEN_S * 1000);
  }

  clearBullets() {
    this.bullets.clear();
    this.broadcast("clearBullets");
  }

  // --- weapons -------------------------------------------------------------

  activeWeapon(player) {
    return player.slot === 1 && player.primary ? player.primary : player.secondary;
  }

  shoot(id, angle) {
    const player = this.state.players.get(id);
    const s = this.sessions.get(id);
    if (this.state.phase !== "playing" || !player?.alive || !s || player.reloading) return;
    const weaponId = this.activeWeapon(player);
    const w = WEAPONS[weaponId];
    const now = this.clock.currentTime;
    if (now - s.lastShot < w.cooldownMs) return;
    const magKey = player.slot === 1 && player.primary ? "primaryMag" : "secondaryMag";
    if (player[magKey] === 0) return this.startReload(id);
    s.lastShot = now;
    player[magKey] -= 1;
    player.angle = angle;

    const spawned = [];
    for (let i = 0; i < w.pellets; i++) {
      spawned.push(this.spawnBullet(id, player, angle + (Math.random() * 2 - 1) * w.spread, w, now));
    }
    this.broadcast("bullets", { weapon: weaponId, shooter: id, x: player.x, y: player.y, angle, bullets: spawned });
    if (player[magKey] === 0) this.startReload(id);
  }

  spawnBullet(owner, player, angle, w, now) {
    const id = this.nextBulletId++;
    const vx = Math.cos(angle) * w.bulletSpeed;
    const vy = Math.sin(angle) * w.bulletSpeed;
    // Start at the barrel tip so the shooter doesn't hit themselves.
    const x = player.x + Math.cos(angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2);
    const y = player.y + Math.sin(angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2);
    this.bullets.set(id, { owner, x, y, vx, vy, damage: w.damage, expires: now + w.rangeMs });
    return { id, x, y, vx, vy, life: w.rangeMs };
  }

  startReload(id) {
    const player = this.state.players.get(id);
    const s = this.sessions.get(id);
    if (!player?.alive || !s || player.reloading) return;
    const weaponId = this.activeWeapon(player);
    const w = WEAPONS[weaponId];
    const isSecondary = !(player.slot === 1 && player.primary);
    const mag = isSecondary ? player.secondaryMag : player.primaryMag;
    if (mag >= w.magSize || (!isSecondary && player.primaryReserve === 0)) return;

    player.reloading = true;
    s.reloadTimer = this.clock.setTimeout(() => {
      s.reloadTimer = null;
      player.reloading = false;
      if (isSecondary) {
        player.secondaryMag = w.magSize;
      } else {
        const take = Math.min(w.magSize - player.primaryMag, player.primaryReserve);
        player.primaryMag += take;
        player.primaryReserve -= take;
      }
    }, w.reloadMs);
  }

  cancelReload(id) {
    const s = this.sessions.get(id);
    s?.reloadTimer?.clear();
    if (s) s.reloadTimer = null;
    const player = this.state.players.get(id);
    if (player) player.reloading = false;
  }

  switchSlot(id, slot) {
    const player = this.state.players.get(id);
    if (!player?.alive || (slot !== 0 && slot !== 1) || player.slot === slot) return;
    if (slot === 1 && !player.primary) return;
    this.cancelReload(id);
    player.slot = slot;
  }

  // Swap the nearest ground weapon into the primary slot, dropping the old one.
  pickUp(id) {
    const player = this.state.players.get(id);
    if (this.state.phase !== "playing" || !player?.alive) return;
    let nearest = null;
    let nearestDist = PICKUP_RANGE;
    this.state.pickups.forEach((pickup, pickupId) => {
      if (pickup.owner && pickup.owner !== id) return; // someone else's loadout crate
      const d = Math.hypot(pickup.x - player.x, pickup.y - player.y);
      if (d <= nearestDist) {
        nearest = { pickup, pickupId };
        nearestDist = d;
      }
    });
    if (!nearest) return;

    this.cancelReload(id);
    const { pickup, pickupId } = nearest;
    this.state.pickups.delete(pickupId);
    if (pickup.weapon === LOADOUT) return this.giveLoadout(id, player);
    if (player.primary) this.dropPickup(player.primary, player.x, player.y, player.primaryMag, player.primaryReserve);
    player.primary = pickup.weapon;
    player.primaryMag = pickup.mag;
    player.primaryReserve = pickup.reserve;
    player.slot = 1;
  }

  dropPickup(weapon, x, y, mag, reserve, owner = "") {
    const pickup = new Pickup();
    pickup.x = x;
    pickup.y = y;
    pickup.weapon = weapon;
    pickup.mag = mag;
    pickup.reserve = reserve;
    pickup.owner = owner;
    this.state.pickups.set(String(this.nextPickupId++), pickup);
  }

  // --- simulation ----------------------------------------------------------

  update(deltaMs) {
    this.movePlayers(deltaMs);
    if (this.state.phase === "playing") {
      const now = this.clock.currentTime;
      this.brains.forEach((brain, id) => {
        const player = this.state.players.get(id);
        if (player) brain.update(this, player, deltaMs, now);
      });
    }
    this.moveBullets(deltaMs);
    this.updateZone();
  }

  updateZone() {
    if (this.state.phase !== "playing") return;
    this.zone.update(this.clock.currentTime);
    if (!this.loadoutsDropped && this.state.zone.phase >= LOADOUT_DROP_PHASE) this.dropLoadouts();
  }

  zoneDamage() {
    if (this.state.phase !== "playing") return;
    const dps = this.state.zone.dps;
    this.state.players.forEach((player, id) => {
      if (player.alive && this.zone.isOutside(player.x, player.y)) this.damage(player, id, dps, "The zone");
    });
  }

  movePlayers(deltaMs) {
    this.state.players.forEach((player, id) => {
      const s = this.sessions.get(id);
      // Speed hack guard: a client can only spend as much movement time as has really passed.
      s.budget = Math.min(s.budget + deltaMs / 1000, MAX_TIME_BUDGET);
      const pos = { x: player.x, y: player.y };
      while (s.inputs.length && s.budget > 0) {
        const input = s.inputs.shift();
        player.lastSeq = input.seq; // acknowledge even while dead so the client's queue drains
        if (!player.alive) continue;
        input.dt = Math.min(input.dt, s.budget);
        s.budget -= input.dt;
        applyMove(pos, input);
      }
      player.x = pos.x;
      player.y = pos.y;
    });
  }

  moveBullets(deltaMs) {
    const dt = deltaMs / 1000;
    const now = this.clock.currentTime;
    for (const [id, b] of this.bullets) {
      const x0 = b.x, y0 = b.y;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      // Test the whole segment travelled this tick, so fast bullets can't skip past a player.
      const victim = this.findHit(b, x0, y0);
      if (victim) {
        this.damage(victim.player, victim.id, b.damage, this.state.players.get(b.owner)?.name ?? "?", b.owner);
        this.endBullet(id, b.x, b.y, true);
      } else if (now >= b.expires || b.x < 0 || b.y < 0 || b.x > MAP_WIDTH || b.y > MAP_HEIGHT) {
        this.endBullet(id, b.x, b.y, false);
      }
    }
  }

  findHit(b, x0, y0) {
    let best = null;
    this.state.players.forEach((player, id) => {
      if (id === b.owner || !player.alive) return;
      const t = segmentCircleT(x0, y0, b.x, b.y, player.x, player.y, PLAYER_RADIUS + BULLET_RADIUS);
      if (t !== null && (!best || t < best.t)) best = { t, player, id };
    });
    return best;
  }

  damage(player, victimId, amount, killerName, killerId = null) {
    // Several pellets can land in one tick, and nothing may die after the winner is decided.
    if (!player.alive || this.state.phase !== "playing") return;
    player.health = Math.max(0, player.health - amount);
    if (player.health > 0) return;
    player.alive = false;
    this.cancelReload(victimId);
    if (player.primary) this.dropPickup(player.primary, player.x, player.y, player.primaryMag, player.primaryReserve);
    player.primary = "";
    player.slot = 0;
    this.state.pickups.forEach((pickup, pickupId) => {
      if (pickup.owner === victimId) this.state.pickups.delete(pickupId); // unopened loadout crate
    });
    if (killerId) {
      const killer = this.state.players.get(killerId);
      if (killer) killer.kills += 1;
    }
    this.broadcast("kill", { killer: killerName, victim: player.name });
    this.checkWinner();
  }

  endBullet(id, x, y, hit) {
    this.bullets.delete(id);
    this.broadcast("bulletEnd", { id, x, y, hit });
  }
}

// Earliest t in [0,1] where segment (x0,y0)->(x1,y1) enters the circle, or null.
function segmentCircleT(x0, y0, x1, y1, cx, cy, r) {
  const dx = x1 - x0, dy = y1 - y0;
  const fx = x0 - cx, fy = y0 - cy;
  const a = dx * dx + dy * dy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // already inside
  if (a === 0) return null;
  const bq = 2 * (fx * dx + fy * dy);
  const disc = bq * bq - 4 * a * c;
  if (disc < 0) return null;
  const t = (-bq - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

function randomCoord(size) {
  return PLAYER_RADIUS + Math.random() * (size - PLAYER_RADIUS * 2);
}

function isObject(v) {
  return typeof v === "object" && v !== null;
}
