// Cover: walls, shipping containers and rocks. The layout is generated from a fixed seed, so
// the server and every client build the identical map. Everything here works in map pixels.
// Obstacles are full height: they block movement and bullets.
//   box:  { type: "box", kind: "wall" | "container", x, y, w, h }   (x, y = top-left corner)
//   rock: { type: "rock", x, y, r }

const EDGE = 140;       // keep this far from the map border
const GAP = 70;         // min space between obstacles, so players (32 px wide) can always pass

export function buildObstacles(width, height, seed = 2024) {
  const rand = mulberry32(seed);
  const obstacles = [];
  const placed = []; // bounding circles, for spacing
  const fits = (cx, cy, radius) => cx - radius > EDGE && cy - radius > EDGE
    && cx + radius < width - EDGE && cy + radius < height - EDGE
    && placed.every((p) => Math.hypot(p.x - cx, p.y - cy) > p.r + radius + GAP);
  const place = (cx, cy, radius, parts) => {
    placed.push({ x: cx, y: cy, r: radius });
    obstacles.push(...parts);
  };

  // Structures first (they're biggest): straight walls, L-shaped ruins and container pairs.
  for (let tries = 0, made = 0; made < 16 && tries < 500; tries++) {
    const cx = rand() * width, cy = rand() * height;
    const kind = made % 3;
    const horizontal = rand() < 0.5;
    if (kind === 0) { // straight wall
      const len = 180 + rand() * 120, t = 24;
      if (!fits(cx, cy, len / 2)) continue;
      place(cx, cy, len / 2, [horizontal ? box("wall", cx - len / 2, cy - t / 2, len, t) : box("wall", cx - t / 2, cy - len / 2, t, len)]);
    } else if (kind === 1) { // L-shaped ruin
      const a = 160 + rand() * 60, b = 120 + rand() * 60, t = 24;
      const sx = rand() < 0.5 ? 1 : -1, sy = rand() < 0.5 ? 1 : -1;
      const radius = Math.hypot(a, b) / 2 + 10;
      if (!fits(cx, cy, radius)) continue;
      const ox = cx - (sx * a) / 2, oy = cy - (sy * b) / 2; // corner of the L
      place(cx, cy, radius, [
        box("wall", sx > 0 ? ox : ox - a, oy - t / 2, a, t),
        box("wall", ox - t / 2, sy > 0 ? oy : oy - b, t, b),
      ]);
    } else { // two shipping containers side by side
      const l = 120, w = 48, gap = 12;
      if (!fits(cx, cy, 80)) continue;
      place(cx, cy, 80, horizontal
        ? [box("container", cx - l / 2, cy - w - gap / 2, l, w), box("container", cx - l / 2, cy + gap / 2, l, w)]
        : [box("container", cx - w - gap / 2, cy - l / 2, w, l), box("container", cx + gap / 2, cy - l / 2, w, l)]);
    }
    made++;
  }

  // Rocks fill the gaps.
  for (let tries = 0, made = 0; made < 30 && tries < 800; tries++) {
    const r = 26 + rand() * 30;
    const cx = rand() * width, cy = rand() * height;
    if (!fits(cx, cy, r)) continue;
    place(cx, cy, r, [{ type: "rock", x: cx, y: cy, r }]);
    made++;
  }
  return obstacles;
}

function box(kind, x, y, w, h) {
  return { type: "box", kind, x, y, w, h };
}

// Push a circle (a player) out of any obstacle it overlaps. Mutates pos. Sliding along a
// wall falls out of this naturally: only the component into the wall is removed.
export function resolveCircle(pos, radius, obstacles) {
  for (let pass = 0; pass < 2; pass++) {
    for (const o of obstacles) {
      if (o.type === "rock") {
        const dx = pos.x - o.x, dy = pos.y - o.y;
        const d = Math.hypot(dx, dy), min = o.r + radius;
        if (d >= min) continue;
        const nx = d > 1e-6 ? dx / d : 1, ny = d > 1e-6 ? dy / d : 0;
        pos.x = o.x + nx * min;
        pos.y = o.y + ny * min;
      } else {
        const cx = clamp(pos.x, o.x, o.x + o.w), cy = clamp(pos.y, o.y, o.y + o.h);
        const dx = pos.x - cx, dy = pos.y - cy;
        const d = Math.hypot(dx, dy);
        if (d >= radius) continue;
        if (d > 1e-6) {
          pos.x = cx + (dx / d) * radius;
          pos.y = cy + (dy / d) * radius;
        } else { // centre is inside the box: leave by the nearest side
          const left = pos.x - o.x, right = o.x + o.w - pos.x, top = pos.y - o.y, bottom = o.y + o.h - pos.y;
          const m = Math.min(left, right, top, bottom);
          if (m === left) pos.x = o.x - radius;
          else if (m === right) pos.x = o.x + o.w + radius;
          else if (m === top) pos.y = o.y - radius;
          else pos.y = o.y + o.h + radius;
        }
      }
    }
  }
}

export function circleHitsObstacle(x, y, radius, obstacles) {
  return obstacles.some((o) => o.type === "rock"
    ? Math.hypot(x - o.x, y - o.y) < o.r + radius
    : Math.hypot(x - clamp(x, o.x, o.x + o.w), y - clamp(y, o.y, o.y + o.h)) < radius);
}

// Earliest t in [0, 1] where segment (x0,y0)->(x1,y1) enters an obstacle grown by pad,
// or Infinity if it hits nothing. Used for bullets, line of sight and the 3D camera.
export function segmentObstacleT(x0, y0, x1, y1, obstacles, pad = 0) {
  let best = Infinity;
  const dx = x1 - x0, dy = y1 - y0;
  for (const o of obstacles) {
    let t;
    if (o.type === "rock") {
      t = segmentCircleT(x0, y0, dx, dy, o.x, o.y, o.r + pad);
    } else {
      t = segmentBoxT(x0, y0, dx, dy, o.x - pad, o.y - pad, o.x + o.w + pad, o.y + o.h + pad);
    }
    if (t !== null && t < best) best = t;
  }
  return best;
}

function segmentCircleT(x0, y0, dx, dy, cx, cy, r) {
  const fx = x0 - cx, fy = y0 - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0; // starts inside
  const a = dx * dx + dy * dy;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

// Slab test against an axis-aligned box.
function segmentBoxT(x0, y0, dx, dy, minX, minY, maxX, maxY) {
  let tMin = 0, tMax = 1;
  for (const [p, d, lo, hi] of [[x0, dx, minX, maxX], [y0, dy, minY, maxY]]) {
    if (Math.abs(d) < 1e-9) {
      if (p < lo || p > hi) return null;
    } else {
      let t1 = (lo - p) / d, t2 = (hi - p) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tMin = Math.max(tMin, t1);
      tMax = Math.min(tMax, t2);
      if (tMin > tMax) return null;
    }
  }
  return tMin;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
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
