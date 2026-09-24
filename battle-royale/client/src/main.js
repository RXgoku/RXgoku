import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import { MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, MAX_INPUT_DT, applyMove } from "../../server/src/constants.js";

const INTERP_DELAY_MS = 100; // render remote players this far in the past
const serverUrl = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);
const statusEl = document.getElementById("status");

class GameScene extends Phaser.Scene {
  constructor() {
    super("game");
    this.others = new Map(); // sessionId -> { sprite, label, buffer: [{t,x,y}] }
    this.pending = [];       // inputs sent but not yet acknowledged by the server
    this.seq = 0;
  }

  async create() {
    this.drawGround();
    this.keys = this.input.keyboard.addKeys("W,A,S,D");
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);

    const name = new URLSearchParams(location.search).get("name") || `Player${Math.floor(Math.random() * 1000)}`;
    try {
      this.room = await new Client(serverUrl).joinOrCreate("battle", { name });
    } catch (err) {
      statusEl.textContent = `Could not connect to ${serverUrl}: ${err.message}`;
      return;
    }
    statusEl.textContent = `${name} — WASD to move`;

    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd("players", (player, id) => {
      if (id === this.room.sessionId) {
        this.me = this.makeAvatar(player);
        this.me.pos = { x: player.x, y: player.y };
        this.cameras.main.startFollow(this.me.sprite, true, 0.15, 0.15);
        callbacks.onChange(player, () => this.reconcile(player));
      } else {
        const other = this.makeAvatar(player);
        other.buffer = [{ t: performance.now(), x: player.x, y: player.y }];
        this.others.set(id, other);
        callbacks.onChange(player, () => {
          other.buffer.push({ t: performance.now(), x: player.x, y: player.y });
          if (other.buffer.length > 30) other.buffer.shift();
        });
      }
    });
    callbacks.onRemove("players", (_player, id) => {
      const other = this.others.get(id);
      if (!other) return;
      other.sprite.destroy();
      other.label.destroy();
      this.others.delete(id);
    });
    this.room.onLeave(() => { statusEl.textContent = "Disconnected"; });
  }

  update(_time, deltaMs) {
    if (!this.me) return;
    this.sendInputAndPredict(deltaMs / 1000);
    this.placeAvatar(this.me, this.me.pos.x, this.me.pos.y);
    this.interpolateOthers(performance.now() - INTERP_DELAY_MS);
  }

  sendInputAndPredict(dt) {
    const { W, A, S, D } = this.keys;
    if (!(W.isDown || A.isDown || S.isDown || D.isDown)) return;
    const input = {
      seq: ++this.seq,
      up: W.isDown, down: S.isDown, left: A.isDown, right: D.isDown,
      dt: Math.min(dt, MAX_INPUT_DT),
    };
    this.room.send("input", input);
    this.pending.push(input);
    applyMove(this.me.pos, input); // move now; the server will confirm or correct
  }

  // Start from the server's position, then replay inputs it hasn't processed yet.
  reconcile(player) {
    this.pending = this.pending.filter((input) => input.seq > player.lastSeq);
    const pos = { x: player.x, y: player.y };
    for (const input of this.pending) applyMove(pos, input);
    this.me.pos = pos;
  }

  interpolateOthers(renderTime) {
    for (const other of this.others.values()) {
      const buf = other.buffer;
      while (buf.length >= 2 && buf[1].t <= renderTime) buf.shift();
      const [a, b] = buf;
      if (!b || renderTime <= a.t) {
        this.placeAvatar(other, a.x, a.y);
        continue;
      }
      const k = (renderTime - a.t) / (b.t - a.t);
      this.placeAvatar(other, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k);
    }
  }

  makeAvatar(player) {
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const sprite = this.add.circle(player.x, player.y, PLAYER_RADIUS, color).setStrokeStyle(2, 0x000000);
    const label = this.add.text(player.x, player.y - 28, player.name, {
      fontFamily: "monospace", fontSize: "12px", color: "#ffffff",
    }).setOrigin(0.5);
    return { sprite, label };
  }

  placeAvatar(avatar, x, y) {
    avatar.sprite.setPosition(x, y);
    avatar.label.setPosition(x, y - 28);
  }

  drawGround() {
    const g = this.add.graphics();
    g.fillStyle(0x2d4a2b).fillRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
    g.lineStyle(1, 0x3b5e38);
    for (let i = 0; i <= MAP_WIDTH; i += 100) g.lineBetween(i, 0, i, MAP_HEIGHT);
    for (let i = 0; i <= MAP_HEIGHT; i += 100) g.lineBetween(0, i, MAP_WIDTH, i);
    g.lineStyle(4, 0xff0000).strokeRect(0, 0, MAP_WIDTH, MAP_HEIGHT);
  }
}

window.game = new Phaser.Game({ // exposed for debugging from the console
  type: Phaser.AUTO,
  parent: document.body,
  backgroundColor: "#111111",
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  scene: GameScene,
});
