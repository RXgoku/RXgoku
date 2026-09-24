import { Room } from "@colyseus/core";
import { GameState, Player } from "./schema.js";
import {
  MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, TICK_MS, MAX_INPUT_DT, applyMove,
  MAX_HEALTH, FIRE_COOLDOWN_MS, BULLET_SPEED, BULLET_LIFETIME_MS, BULLET_DAMAGE, BULLET_RADIUS, RESPAWN_MS,
} from "./constants.js";

const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#ecf0f1"];
const MAX_QUEUED_INPUTS = 60;
const MAX_TIME_BUDGET = 0.25; // seconds of movement a client may bank

export class GameRoom extends Room {
  maxClients = 20;

  onCreate() {
    this.setState(new GameState());
    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.queues = new Map(); // sessionId -> { inputs: [], budget: seconds, lastShot: ms }
    this.bullets = new Map(); // id -> { owner, x, y, vx, vy, expires }; server-only, clients get events
    this.nextBulletId = 1;

    // Clients send key state + frame time; the server applies it and owns the result.
    this.onMessage("input", (client, msg) => {
      const q = this.queues.get(client.sessionId);
      if (!q || !isObject(msg) || q.inputs.length >= MAX_QUEUED_INPUTS) return;
      q.inputs.push({
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
      const player = this.state.players.get(client.sessionId);
      const q = this.queues.get(client.sessionId);
      if (!player?.alive || !q || !isObject(msg) || !Number.isFinite(msg.angle)) return;
      const now = this.clock.currentTime;
      if (now - q.lastShot < FIRE_COOLDOWN_MS) return;
      q.lastShot = now;
      player.angle = msg.angle;
      this.spawnBullet(client.sessionId, player, msg.angle, now);
    });

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval((dt) => this.update(dt), TICK_MS);
  }

  onJoin(client, options = {}) {
    const player = new Player();
    player.color = COLORS[this.clients.length % COLORS.length];
    player.name = String(options.name || "Player").slice(0, 16);
    player.lastSeq = 0;
    player.angle = 0;
    this.respawn(player);
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, { inputs: [], budget: 0, lastShot: -Infinity });
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
  }

  respawn(player) {
    player.x = PLAYER_RADIUS + Math.random() * (MAP_WIDTH - PLAYER_RADIUS * 2);
    player.y = PLAYER_RADIUS + Math.random() * (MAP_HEIGHT - PLAYER_RADIUS * 2);
    player.health = MAX_HEALTH;
    player.alive = true;
  }

  spawnBullet(owner, player, angle, now) {
    const id = this.nextBulletId++;
    const vx = Math.cos(angle) * BULLET_SPEED;
    const vy = Math.sin(angle) * BULLET_SPEED;
    // Start at the barrel tip so the shooter doesn't hit themselves.
    const x = player.x + Math.cos(angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2);
    const y = player.y + Math.sin(angle) * (PLAYER_RADIUS + BULLET_RADIUS + 2);
    this.bullets.set(id, { owner, x, y, vx, vy, expires: now + BULLET_LIFETIME_MS });
    this.broadcast("bullet", { id, x, y, vx, vy, life: BULLET_LIFETIME_MS });
  }

  update(deltaMs) {
    this.movePlayers(deltaMs);
    this.moveBullets(deltaMs);
  }

  movePlayers(deltaMs) {
    this.state.players.forEach((player, id) => {
      const q = this.queues.get(id);
      // Speed hack guard: a client can only spend as much movement time as has really passed.
      q.budget = Math.min(q.budget + deltaMs / 1000, MAX_TIME_BUDGET);
      const pos = { x: player.x, y: player.y };
      while (q.inputs.length && q.budget > 0) {
        const input = q.inputs.shift();
        player.lastSeq = input.seq; // acknowledge even while dead so the client's queue drains
        if (!player.alive) continue;
        input.dt = Math.min(input.dt, q.budget);
        q.budget -= input.dt;
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
        this.damage(victim.player, victim.id, b.owner);
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

  damage(player, victimId, attackerId) {
    player.health = Math.max(0, player.health - BULLET_DAMAGE);
    if (player.health > 0) return;
    player.alive = false;
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

function isObject(v) {
  return typeof v === "object" && v !== null;
}
