import { Room } from "@colyseus/core";
import { GameState, Player, Pickup } from "./schema.js";
import {
  MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, TICK_MS, MAX_INPUT_DT, applyMove,
  MAX_HEALTH, BULLET_RADIUS, RESPAWN_MS, PICKUP_COUNT, PICKUP_RANGE,
} from "./constants.js";
import { WEAPONS, randomPickupWeapon } from "./weapons.js";

const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#ecf0f1"];
const MAX_QUEUED_INPUTS = 60;
const MAX_TIME_BUDGET = 0.25; // seconds of movement a client may bank

export class GameRoom extends Room {
  maxClients = 20;

  onCreate() {
    this.setState(new GameState());
    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.sessions = new Map(); // sessionId -> { inputs: [], budget, lastShot, reloadTimer }
    this.bullets = new Map();  // id -> { owner, x, y, vx, vy, damage, expires }; server-only, clients get events
    this.nextBulletId = 1;
    this.nextPickupId = 1;
    for (let i = 0; i < PICKUP_COUNT; i++) {
      const id = randomPickupWeapon();
      this.dropPickup(id, randomCoord(MAP_WIDTH), randomCoord(MAP_HEIGHT), WEAPONS[id].magSize, WEAPONS[id].reserve);
    }

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

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval((dt) => this.update(dt), TICK_MS);
  }

  onJoin(client, options = {}) {
    const player = new Player();
    player.color = COLORS[this.clients.length % COLORS.length];
    player.name = String(options.name || "Player").slice(0, 16);
    player.lastSeq = 0;
    player.angle = 0;
    this.sessions.set(client.sessionId, { inputs: [], budget: 0, lastShot: -Infinity, reloadTimer: null });
    this.respawn(player);
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client) {
    this.cancelReload(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.sessions.delete(client.sessionId);
  }

  respawn(player) {
    player.x = randomCoord(MAP_WIDTH);
    player.y = randomCoord(MAP_HEIGHT);
    player.health = MAX_HEALTH;
    player.alive = true;
    player.slot = 0;
    player.primary = "";
    player.primaryMag = 0;
    player.primaryReserve = 0;
    player.pistolMag = WEAPONS.pistol.magSize;
    player.reloading = false;
  }

  // --- weapons -------------------------------------------------------------

  activeWeapon(player) {
    return player.slot === 1 && player.primary ? player.primary : "pistol";
  }

  shoot(id, angle) {
    const player = this.state.players.get(id);
    const s = this.sessions.get(id);
    if (!player?.alive || !s || player.reloading) return;
    const weaponId = this.activeWeapon(player);
    const w = WEAPONS[weaponId];
    const now = this.clock.currentTime;
    if (now - s.lastShot < w.cooldownMs) return;
    const magKey = weaponId === "pistol" ? "pistolMag" : "primaryMag";
    if (player[magKey] === 0) return this.startReload(id);
    s.lastShot = now;
    player[magKey] -= 1;
    player.angle = angle;

    const spawned = [];
    for (let i = 0; i < w.pellets; i++) {
      spawned.push(this.spawnBullet(id, player, angle + (Math.random() * 2 - 1) * w.spread, w, now));
    }
    this.broadcast("bullets", spawned);
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
    const isPistol = weaponId === "pistol";
    const mag = isPistol ? player.pistolMag : player.primaryMag;
    if (mag >= w.magSize || (!isPistol && player.primaryReserve === 0)) return;

    player.reloading = true;
    s.reloadTimer = this.clock.setTimeout(() => {
      s.reloadTimer = null;
      player.reloading = false;
      if (isPistol) {
        player.pistolMag = w.magSize;
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
    if (!player?.alive) return;
    let nearest = null;
    let nearestDist = PICKUP_RANGE;
    this.state.pickups.forEach((pickup, pickupId) => {
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
    if (player.primary) this.dropPickup(player.primary, player.x, player.y, player.primaryMag, player.primaryReserve);
    player.primary = pickup.weapon;
    player.primaryMag = pickup.mag;
    player.primaryReserve = pickup.reserve;
    player.slot = 1;
  }

  dropPickup(weapon, x, y, mag, reserve) {
    const pickup = new Pickup();
    pickup.x = x;
    pickup.y = y;
    pickup.weapon = weapon;
    pickup.mag = mag;
    pickup.reserve = reserve;
    this.state.pickups.set(String(this.nextPickupId++), pickup);
  }

  // --- simulation ----------------------------------------------------------

  update(deltaMs) {
    this.movePlayers(deltaMs);
    this.moveBullets(deltaMs);
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
        this.damage(victim.player, victim.id, b.owner, b.damage);
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

  damage(player, victimId, attackerId, amount) {
    if (!player.alive) return; // several shotgun pellets can land in the same tick
    player.health = Math.max(0, player.health - amount);
    if (player.health > 0) return;
    player.alive = false;
    this.cancelReload(victimId);
    if (player.primary) this.dropPickup(player.primary, player.x, player.y, player.primaryMag, player.primaryReserve);
    player.primary = "";
    player.slot = 0;
    const attacker = this.state.players.get(attackerId);
    this.broadcast("kill", { killer: attacker?.name ?? "?", victim: player.name });
    this.clock.setTimeout(() => {
      if (this.state.players.get(victimId) === player) this.respawn(player);
    }, RESPAWN_MS);
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
