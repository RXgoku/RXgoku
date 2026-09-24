import { MAP_WIDTH, MAP_HEIGHT } from "./constants.js";

// Speeds up every zone timer, e.g. ZONE_TIME_SCALE=3 for a ~80s demo match.
const TIME_SCALE = Number(process.env.ZONE_TIME_SCALE) || 1;

// Each phase: wait (circle announced), then shrink towards it. Roughly a 4 minute match.
export const ZONE_PHASES = [
  { waitMs: 40000, shrinkMs: 30000, radius: 900, dps: 2 },
  { waitMs: 30000, shrinkMs: 25000, radius: 500, dps: 5 },
  { waitMs: 25000, shrinkMs: 20000, radius: 220, dps: 10 },
  { waitMs: 20000, shrinkMs: 20000, radius: 0, dps: 20 },
].map((p) => ({ ...p, waitMs: p.waitMs / TIME_SCALE, shrinkMs: p.shrinkMs / TIME_SCALE }));

// Drives the synced Zone schema. The circle starts covering the whole map.
export class ZoneController {
  constructor(zone) {
    this.zone = zone;
  }

  // Full-map circle that doesn't move (lobby).
  reset() {
    const z = this.zone;
    z.x = z.nextX = MAP_WIDTH / 2;
    z.y = z.nextY = MAP_HEIGHT / 2;
    z.radius = z.nextRadius = Math.hypot(MAP_WIDTH, MAP_HEIGHT) / 2;
    z.phase = 0;
    z.shrinking = false;
    z.secondsLeft = 0;
    z.dps = 0;
    this.closed = false;
  }

  start(now) {
    this.reset();
    this.beginPhase(0, now);
  }

  beginPhase(index, now) {
    const z = this.zone;
    const phase = ZONE_PHASES[index];
    this.index = index;
    this.from = { x: z.x, y: z.y, radius: z.radius };
    // Pick the next circle so it lies fully inside the current one and the map.
    const maxOffset = Math.max(0, Math.min(z.radius, MAP_WIDTH / 2) - phase.radius);
    const angle = Math.random() * Math.PI * 2;
    const dist = Math.sqrt(Math.random()) * maxOffset;
    z.nextX = clamp(z.x + Math.cos(angle) * dist, phase.radius, MAP_WIDTH - phase.radius);
    z.nextY = clamp(z.y + Math.sin(angle) * dist, phase.radius, MAP_HEIGHT - phase.radius);
    z.nextRadius = phase.radius;
    z.phase = index + 1;
    z.shrinking = false;
    z.dps = index === 0 ? 1 : ZONE_PHASES[index - 1].dps;
    this.stageEnds = now + phase.waitMs;
  }

  // Returns true once the final circle has fully closed.
  update(now) {
    const z = this.zone;
    if (this.closed) return true;
    const phase = ZONE_PHASES[this.index];
    if (!z.shrinking && now >= this.stageEnds) {
      z.shrinking = true;
      z.dps = phase.dps;
      this.shrinkStart = now;
      this.stageEnds = now + phase.shrinkMs;
    }
    if (z.shrinking) {
      const k = Math.min(1, (now - this.shrinkStart) / phase.shrinkMs);
      z.x = lerp(this.from.x, z.nextX, k);
      z.y = lerp(this.from.y, z.nextY, k);
      z.radius = lerp(this.from.radius, z.nextRadius, k);
      if (k >= 1) {
        if (this.index + 1 < ZONE_PHASES.length) this.beginPhase(this.index + 1, now);
        else this.closed = true;
      }
    }
    z.secondsLeft = Math.max(0, Math.ceil((this.stageEnds - now) / 1000));
    return this.closed;
  }

  isOutside(x, y) {
    const z = this.zone;
    return Math.hypot(x - z.x, y - z.y) > z.radius;
  }

  // A random point inside the current circle (and the map).
  randomPointInside(margin) {
    const z = this.zone;
    const r = Math.max(0, z.radius - margin) * Math.sqrt(Math.random());
    const a = Math.random() * Math.PI * 2;
    return {
      x: clamp(z.x + Math.cos(a) * r, margin, MAP_WIDTH - margin),
      y: clamp(z.y + Math.sin(a) * r, margin, MAP_HEIGHT - margin),
    };
  }
}

function lerp(a, b, k) {
  return a + (b - a) * k;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
