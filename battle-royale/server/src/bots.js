import { applyMove, PICKUP_RANGE, MAX_INPUT_DT } from "./constants.js";
import { WEAPONS } from "./weapons.js";

export const BOT_NAMES = ["Viper", "Ghost", "Rook", "Nova", "Blaze", "Echo", "Jinx", "Talon", "Frost", "Havoc", "Onyx", "Rex"];

const THINK_MS = 200;               // how often a bot re-plans
const SIGHT = 420;                  // px; about half a screen, so bots never shoot from off-screen
const REACTION_MS = [400, 800];     // delay between spotting a target and firing
const AIM_ERROR = 0.12;             // radians of random aim error per shot
const LOOT_RADIUS = 700;            // px; how far a bot will walk for a gun
const WAYPOINT_MS = 6000;
const LANDING_GRACE_MS = 4000;      // bots hold fire at match start so nobody dies on landing

// Server-side brain for one bot player. It drives the bot through the same room
// methods humans use (shoot, reload, pick up), so all game rules still apply.
export class BotBrain {
  constructor(id) {
    this.id = id;
    this.nextThink = 0;
    this.targetId = null;
    this.fireAfter = 0;
    this.goal = null;
    this.waypoint = null;
    this.waypointUntil = 0;
    this.strafe = Math.random() < 0.5 ? 1 : -1;
  }

  update(room, player, deltaMs, now) {
    if (!player.alive) return;
    if (now >= this.nextThink) {
      this.nextThink = now + THINK_MS;
      this.think(room, player, now);
    }

    const target = this.targetId && room.state.players.get(this.targetId);
    if (this.goal) this.moveTowards(player, this.goal, deltaMs / 1000);

    if (!player.primary && this.nearestPickup(room, player, PICKUP_RANGE)) room.pickUp(this.id);

    if (target?.alive) {
      const aim = Math.atan2(target.y - player.y, target.x - player.x);
      player.angle = aim;
      const dist = Math.hypot(target.x - player.x, target.y - player.y);
      const landed = now >= room.matchStartedAt + LANDING_GRACE_MS;
      if (landed && now >= this.fireAfter && dist <= weaponRange(room, player)) {
        room.shoot(this.id, aim + (Math.random() * 2 - 1) * AIM_ERROR);
      }
    } else if (!player.reloading) {
      room.startReload(this.id); // top up while nobody is around (no-op when full)
    }
  }

  think(room, player, now) {
    const zone = room.state.zone;
    const target = this.findTarget(room, player);
    if (target?.id !== this.targetId) {
      this.targetId = target?.id ?? null;
      this.fireAfter = now + REACTION_MS[0] + Math.random() * (REACTION_MS[1] - REACTION_MS[0]);
    }

    const distCur = Math.hypot(player.x - zone.x, player.y - zone.y);
    const distNext = Math.hypot(player.x - zone.nextX, player.y - zone.nextY);
    const zoneUrgent = zone.shrinking || zone.secondsLeft < 12;

    if (distCur > zone.radius - 40) {
      this.goal = { x: zone.x, y: zone.y };                 // in the gas: get out first
    } else if (zoneUrgent && distNext > zone.nextRadius - 40) {
      this.goal = { x: zone.nextX, y: zone.nextY };         // beat the next circle
    } else if (target) {
      this.goal = this.combatGoal(room, player, target.player);
    } else if (!player.primary && (this.pickupGoal = this.nearestPickup(room, player, LOOT_RADIUS))) {
      this.goal = { x: this.pickupGoal.x, y: this.pickupGoal.y };
    } else {
      if (!this.waypoint || now >= this.waypointUntil || near(player, this.waypoint, 30)) {
        this.waypoint = randomPointInCircle(zone.nextX, zone.nextY, Math.max(0, zone.nextRadius - 60));
        this.waypointUntil = now + WAYPOINT_MS;
      }
      this.goal = this.waypoint;
    }
  }

  // Close in when out of range, back off when too close, otherwise circle-strafe.
  combatGoal(room, player, target) {
    const range = weaponRange(room, player);
    const dx = target.x - player.x, dy = target.y - player.y;
    const dist = Math.hypot(dx, dy) || 1;
    const ux = dx / dist, uy = dy / dist;
    if (Math.random() < 0.1) this.strafe *= -1;
    let radial = 0;
    if (dist > range * 0.8) radial = 1;
    else if (dist < range * 0.35) radial = -1;
    return {
      x: player.x + (ux * radial - uy * this.strafe) * 100,
      y: player.y + (uy * radial + ux * this.strafe) * 100,
    };
  }

  findTarget(room, player) {
    let best = null;
    room.state.players.forEach((other, id) => {
      if (id === this.id || !other.alive) return;
      const d = Math.hypot(other.x - player.x, other.y - player.y);
      if (d <= SIGHT && (!best || d < best.d)) best = { id, player: other, d };
    });
    return best;
  }

  nearestPickup(room, player, radius) {
    let best = null;
    let bestDist = radius;
    room.state.pickups.forEach((p) => {
      if (p.owner && p.owner !== this.id) return; // someone else's loadout crate
      const d = Math.hypot(p.x - player.x, p.y - player.y);
      if (d <= bestDist) { best = p; bestDist = d; }
    });
    return best;
  }

  moveTowards(player, goal, dt) {
    const dx = goal.x - player.x, dy = goal.y - player.y;
    const input = { right: dx > 6, left: dx < -6, down: dy > 6, up: dy < -6, dt: Math.min(dt, MAX_INPUT_DT) };
    const pos = { x: player.x, y: player.y };
    applyMove(pos, input);
    player.x = pos.x;
    player.y = pos.y;
    if (!this.targetId && (dx || dy)) player.angle = Math.atan2(dy, dx);
  }
}

function weaponRange(room, player) {
  const w = WEAPONS[room.activeWeapon(player)];
  return Math.min(SIGHT, (w.bulletSpeed * w.rangeMs) / 1000 * 0.85);
}

function near(a, b, d) {
  return Math.hypot(a.x - b.x, a.y - b.y) <= d;
}

function randomPointInCircle(cx, cy, r) {
  const a = Math.random() * Math.PI * 2;
  const d = Math.sqrt(Math.random()) * r;
  return { x: cx + Math.cos(a) * d, y: cy + Math.sin(a) * d };
}
