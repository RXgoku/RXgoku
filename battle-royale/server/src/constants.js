// Shared by server and client (client imports this file directly) so
// movement math is identical on both sides and prediction stays exact.
import { buildObstacles, resolveCircle } from "./map.js";

export const MAP_WIDTH = 2000;
export const MAP_HEIGHT = 2000;
export const PLAYER_SPEED = 250; // px per second
export const PLAYER_RADIUS = 16;
export const TICK_MS = 1000 / 30;
export const MAX_INPUT_DT = 0.05; // seconds; one input can never move more than this

export const MAX_HEALTH = 100;
export const BULLET_RADIUS = 4;
export const PICKUP_COUNT = 40;
export const PICKUP_RANGE = 48; // px from player centre
export const MIN_PLAYERS = 2;        // host can start once this many are in the lobby
export const AUTO_START_PLAYERS = 20; // lobby starts by itself at this many (20 = full room)
export const COUNTDOWN_S = 3;
export const END_SCREEN_S = 10;       // winner screen, then back to the lobby
// Zone phase at which each player's loadout crate lands (0 = spawn with the full loadout).
export const LOADOUT_DROP_PHASE = 2;

// Walls, containers and rocks (same seeded layout everywhere; see map.js).
export const OBSTACLES = buildObstacles(MAP_WIDTH, MAP_HEIGHT);

// Input is either a direction vector {mx, my} (3D client: WASD relative to where you
// face) or four booleans {up, down, left, right} (2D client and bots). Either way the
// speed is capped at PLAYER_SPEED.
export function applyMove(pos, input) {
  let dx, dy;
  if (input.mx !== undefined || input.my !== undefined) {
    dx = input.mx || 0;
    dy = input.my || 0;
  } else {
    dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  }
  const len = Math.hypot(dx, dy);
  if (len === 0) return;
  const step = PLAYER_SPEED * input.dt * Math.min(len, 1); // never faster than full speed
  pos.x = clamp(pos.x + (dx / len) * step, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
  pos.y = clamp(pos.y + (dy / len) * step, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
  resolveCircle(pos, PLAYER_RADIUS, OBSTACLES); // slide along cover instead of walking through it
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
