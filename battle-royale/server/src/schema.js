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
}, "Player");

export const GameState = schema({
  mapWidth: t.number(),
  mapHeight: t.number(),
  players: t.map(Player),
}, "GameState");
