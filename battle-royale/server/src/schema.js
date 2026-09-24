import { schema, t } from "@colyseus/schema";

export const Player = schema({
  x: t.float32(),
  y: t.float32(),
  angle: t.float32(), // aim direction in radians
  health: t.uint8(),
  alive: t.boolean(),
  color: t.string(),
  name: t.string(),
  lastSeq: t.uint32(), // last input the server applied; lets the owner reconcile
  slot: t.uint8(),       // 0 = pistol, 1 = primary
  primary: t.string(),   // weapon id in slot 1, "" if empty
  pistolMag: t.uint8(),
  primaryMag: t.uint8(),
  primaryReserve: t.uint16(),
  reloading: t.boolean(),
  kills: t.uint8(),
}, "Player");

export const Pickup = schema({
  x: t.float32(),
  y: t.float32(),
  weapon: t.string(),
  mag: t.uint8(),
  reserve: t.uint16(),
}, "Pickup");

export const Zone = schema({
  x: t.float32(),          // current safe circle
  y: t.float32(),
  radius: t.float32(),
  nextX: t.float32(),      // where it's heading this phase
  nextY: t.float32(),
  nextRadius: t.float32(),
  phase: t.uint8(),        // 1-based; 0 = not started
  shrinking: t.boolean(),
  secondsLeft: t.uint16(), // until the current wait/shrink stage ends
  dps: t.uint8(),          // damage per second outside the circle
}, "Zone");

export const GameState = schema({
  mapWidth: t.number(),
  mapHeight: t.number(),
  players: t.map(Player),
  pickups: t.map(Pickup),
  zone: t.ref(Zone),
  phase: t.string(),     // "lobby" | "countdown" | "playing" | "ended"
  hostId: t.string(),    // sessionId allowed to press Start
  countdown: t.uint8(),
  aliveCount: t.uint8(),
  winner: t.string(),    // name of the last player standing ("" = nobody survived)
}, "GameState");
