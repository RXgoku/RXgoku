// Shared by server and client (client imports this file directly) so
// movement math is identical on both sides and prediction stays exact.
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
export const RESPAWN_MS = 3000; // temporary until the battle royale win condition exists

export function applyMove(pos, input) {
  const dx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
  const dy = (input.down ? 1 : 0) - (input.up ? 1 : 0);
  if (dx === 0 && dy === 0) return;
  const len = Math.hypot(dx, dy);
  const step = PLAYER_SPEED * input.dt;
  pos.x = clamp(pos.x + (dx / len) * step, PLAYER_RADIUS, MAP_WIDTH - PLAYER_RADIUS);
  pos.y = clamp(pos.y + (dy / len) * step, PLAYER_RADIUS, MAP_HEIGHT - PLAYER_RADIUS);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}
