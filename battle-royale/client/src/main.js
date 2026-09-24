import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import {
  MAP_WIDTH, MAP_HEIGHT, PLAYER_RADIUS, MAX_INPUT_DT, applyMove,
  MAX_HEALTH, FIRE_COOLDOWN_MS, BULLET_RADIUS, RESPAWN_MS,
} from "../../server/src/constants.js";

const INTERP_DELAY_MS = 100; // render remote players this far in the past
const AIM_SEND_MS = 50;      // how often we tell the server where we're aiming
const HEALTH_BAR_W = 36;
const serverUrl = import.meta.env.VITE_SERVER_URL
  || (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:2567` : location.origin);
const statusEl = document.getElementById("status");

class GameScene extends Phaser.Scene {
  constructor() {
    super("game");
    this.others = new Map();  // sessionId -> avatar + { buffer: [{t,x,y}] }
    this.bullets = new Map(); // id -> { sprite, vx, vy, expires }
    this.pending = [];        // inputs sent but not yet acknowledged by the server
    this.seq = 0;
    this.lastShot = 0;
    this.lastAimSent = 0;
    this.sentAngle = null;
  }

  async create() {
    this.drawGround();
    this.keys = this.input.keyboard.addKeys("W,A,S,D");
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.input.mouse?.disableContextMenu();

    const name = new URLSearchParams(location.search).get("name") || `Player${Math.floor(Math.random() * 1000)}`;
    try {
      this.room = await new Client(serverUrl).joinOrCreate("battle", { name });
    } catch (err) {
      statusEl.textContent = `Could not connect to ${serverUrl}: ${err.message}`;
      return;
    }
    this.name = name;
    this.showStatus();

    const callbacks = Callbacks.get(this.room);
    callbacks.onAdd("players", (player, id) => {
      const avatar = this.makeAvatar(player);
      if (id === this.room.sessionId) {
        this.me = avatar;
        this.me.state = player;
        this.me.pos = { x: player.x, y: player.y };
        this.cameras.main.startFollow(avatar.container, true, 0.15, 0.15);
        callbacks.onChange(player, () => this.reconcile(player));
      } else {
        avatar.state = player;
        avatar.buffer = [{ t: performance.now(), x: player.x, y: player.y }];
        this.others.set(id, avatar);
        callbacks.onChange(player, () => {
          avatar.buffer.push({ t: performance.now(), x: player.x, y: player.y });
          if (avatar.buffer.length > 30) avatar.buffer.shift();
        });
      }
      callbacks.listen(player, "alive", (alive) => {
        avatar.container.setAlpha(alive ? 1 : 0.25);
        if (avatar === this.me) this.showStatus();
      });
    });
    callbacks.onRemove("players", (_player, id) => {
      this.others.get(id)?.container.destroy();
      this.others.delete(id);
    });

    this.room.onMessage("bullet", (b) => this.addBullet(b));
    this.room.onMessage("bulletEnd", ({ id, x, y, hit }) => this.removeBullet(id, x, y, hit));
    this.room.onMessage("kill", ({ killer, victim }) => this.showKill(killer, victim));
    this.room.onLeave(() => { statusEl.textContent = "Disconnected"; });
  }

  update(_time, deltaMs) {
    if (!this.me) return;
    const now = performance.now();
    if (this.me.state.alive) {
      this.sendInputAndPredict(deltaMs / 1000);
      this.aimAndShoot(now);
    }
    this.placeAvatar(this.me, this.me.pos.x, this.me.pos.y, this.me.state);
    this.interpolateOthers(now - INTERP_DELAY_MS);
    this.moveBullets(deltaMs / 1000, now);
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

  aimAndShoot(now) {
    const pointer = this.input.activePointer;
    const world = pointer.positionToCamera(this.cameras.main);
    this.me.angle = Math.atan2(world.y - this.me.pos.y, world.x - this.me.pos.x);

    // Hold left mouse to fire; the server enforces the same cooldown.
    if (pointer.leftButtonDown() && now - this.lastShot >= FIRE_COOLDOWN_MS) {
      this.lastShot = now;
      this.lastAimSent = now;
      this.sentAngle = this.me.angle;
      this.room.send("shoot", { angle: this.me.angle });
    } else if (now - this.lastAimSent >= AIM_SEND_MS && this.me.angle !== this.sentAngle) {
      this.lastAimSent = now;
      this.sentAngle = this.me.angle;
      this.room.send("aim", { angle: this.me.angle });
    }
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
        this.placeAvatar(other, a.x, a.y, other.state);
        continue;
      }
      const k = (renderTime - a.t) / (b.t - a.t);
      this.placeAvatar(other, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, other.state);
    }
  }

  addBullet({ id, x, y, vx, vy, life }) {
    const sprite = this.add.circle(x, y, BULLET_RADIUS, 0xfff3a0).setDepth(5);
    this.bullets.set(id, { sprite, vx, vy, expires: performance.now() + life });
  }

  moveBullets(dt, now) {
    for (const [id, b] of this.bullets) {
      b.sprite.x += b.vx * dt;
      b.sprite.y += b.vy * dt;
      if (now > b.expires + 500) this.removeBullet(id); // lost bulletEnd safety net
    }
  }

  removeBullet(id, x, y, hit) {
    this.bullets.get(id)?.sprite.destroy();
    this.bullets.delete(id);
    if (hit) {
      const spark = this.add.circle(x, y, 8, 0xff4444).setDepth(6);
      this.tweens.add({ targets: spark, scale: 2, alpha: 0, duration: 200, onComplete: () => spark.destroy() });
    }
  }

  showKill(killer, victim) {
    const text = this.add.text(this.scale.width - 12, 12, `${killer} ✖ ${victim}`, {
      fontFamily: "monospace", fontSize: "14px", color: "#ffffff", backgroundColor: "#00000099", padding: { x: 6, y: 3 },
    }).setOrigin(1, 0).setScrollFactor(0).setDepth(10);
    this.time.delayedCall(4000, () => text.destroy());
  }

  showStatus() {
    statusEl.textContent = this.me && !this.me.state.alive
      ? `You died — respawning in ${RESPAWN_MS / 1000}s`
      : `${this.name} — WASD move, mouse aim, click shoot`;
  }

  makeAvatar(player) {
    const color = Phaser.Display.Color.HexStringToColor(player.color).color;
    const barrel = this.add.rectangle(0, 0, PLAYER_RADIUS + 10, 6, 0x222222).setOrigin(0, 0.5);
    const body = this.add.circle(0, 0, PLAYER_RADIUS, color).setStrokeStyle(2, 0x000000);
    const bar = this.add.graphics();
    const label = this.add.text(0, -40, player.name, {
      fontFamily: "monospace", fontSize: "12px", color: "#ffffff",
    }).setOrigin(0.5);
    const container = this.add.container(player.x, player.y, [barrel, body, bar, label]).setDepth(2);
    return { container, body, barrel, bar, label, angle: player.angle, drawnHealth: -1 };
  }

  placeAvatar(avatar, x, y, state) {
    avatar.container.setPosition(x, y);
    avatar.barrel.setRotation(avatar === this.me ? avatar.angle : state.angle);
    if (avatar.drawnHealth !== state.health) {
      avatar.drawnHealth = state.health;
      const frac = state.health / MAX_HEALTH;
      const color = frac > 0.5 ? 0x2ecc71 : frac > 0.25 ? 0xf1c40f : 0xe74c3c;
      avatar.bar.clear()
        .fillStyle(0x000000, 0.6).fillRect(-HEALTH_BAR_W / 2 - 1, -29, HEALTH_BAR_W + 2, 7)
        .fillStyle(color).fillRect(-HEALTH_BAR_W / 2, -28, HEALTH_BAR_W * frac, 5);
    }
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
