import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { GameRoom } from "./GameRoom.js";

const port = Number(process.env.PORT || 2567);
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../client/dist");

const server = new Server({
  transport: new WebSocketTransport(),
  // Serves the built client so one deploy hosts both game and server.
  express: (app) => {
    app.get("/health", (_req, res) => res.send("ok")); // hosting health check
    app.use(express.static(clientDist));
  },
});

server.define("battle", GameRoom);
await server.listen(port);
console.log(`Game server listening on http://localhost:${port}`);
