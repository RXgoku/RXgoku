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
}, "Player");

export const Pickup = schema({
  x: t.float32(),
  y: t.float32(),
  weapon: t.string(),
  mag: t.uint8(),
  reserve: t.uint16(),
}, "Pickup");

export const GameState = schema({
  mapWidth: t.number(),
  mapHeight: t.number(),
  players: t.map(Player),
  pickups: t.map(Pickup),
}, "GameState");
