import { Room } from "@colyseus/core";
import { GameState, Player } from "./schema.js";
import { MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, TICK_MS, MAX_INPUT_DT, applyMove } from "./constants.js";

const COLORS = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c", "#ecf0f1"];
const MAX_QUEUED_INPUTS = 60;
const MAX_TIME_BUDGET = 0.25; // seconds of movement a client may bank

export class GameRoom extends Room {
  maxClients = 20;

  onCreate() {
    this.setState(new GameState());
    this.state.mapWidth = MAP_WIDTH;
    this.state.mapHeight = MAP_HEIGHT;
    this.queues = new Map(); // sessionId -> { inputs: [], budget: seconds }

    // Clients send key state + frame time; the server applies it and owns the result.
    this.onMessage("input", (client, msg) => {
      const q = this.queues.get(client.sessionId);
      if (!q || typeof msg !== "object" || msg === null || q.inputs.length >= MAX_QUEUED_INPUTS) return;
      q.inputs.push({
        seq: msg.seq >>> 0,
        up: !!msg.up,
        down: !!msg.down,
        left: !!msg.left,
        right: !!msg.right,
        dt: Math.min(Math.max(Number(msg.dt) || 0, 0), MAX_INPUT_DT),
      });
    });

    this.setPatchRate(TICK_MS);
    this.setSimulationInterval((dt) => this.update(dt), TICK_MS);
  }

  onJoin(client, options = {}) {
    const player = new Player();
    player.x = PLAYER_RADIUS + Math.random() * (MAP_WIDTH - PLAYER_RADIUS * 2);
    player.y = PLAYER_RADIUS + Math.random() * (MAP_HEIGHT - PLAYER_RADIUS * 2);
    player.color = COLORS[this.clients.length % COLORS.length];
    player.name = String(options.name || "Player").slice(0, 16);
    player.lastSeq = 0;
    this.state.players.set(client.sessionId, player);
    this.queues.set(client.sessionId, { inputs: [], budget: 0 });
  }

  onLeave(client) {
    this.state.players.delete(client.sessionId);
    this.queues.delete(client.sessionId);
  }

  update(deltaMs) {
    this.state.players.forEach((player, id) => {
      const q = this.queues.get(id);
      // Speed hack guard: a client can only spend as much movement time as has really passed.
      q.budget = Math.min(q.budget + deltaMs / 1000, MAX_TIME_BUDGET);
      const pos = { x: player.x, y: player.y };
      while (q.inputs.length && q.budget > 0) {
        const input = q.inputs.shift();
        input.dt = Math.min(input.dt, q.budget);
        q.budget -= input.dt;
        applyMove(pos, input);
        player.lastSeq = input.seq;
      }
      player.x = pos.x;
      player.y = pos.y;
    });
  }
}
