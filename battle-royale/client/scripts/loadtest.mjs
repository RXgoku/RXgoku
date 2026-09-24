// Load test: fills a fresh room with simulated players who move and shoot, and reports
// how smoothly the server keeps up. Usage (from battle-royale/):
//   npm --prefix client run loadtest -- [url] [players] [seconds]
//   npm --prefix client run loadtest -- https://your-app.onrender.com 20 30
import { Client } from "@colyseus/sdk";

const url = process.argv[2] || "http://localhost:2567";
const players = Math.min(20, Number(process.argv[3]) || 20);
const seconds = Number(process.argv[4]) || 30;
const TICK_MS = 1000 / 30;

console.log(`Load test: ${players} players for ${seconds}s against ${url}`);
const client = new Client(url);
// Create our own room so the test never lands in a real lobby.
const rooms = [await client.create("battle", { name: "Load1" })];
for (let i = 2; i <= players; i++) rooms.push(await new Client(url).joinById(rooms[0].roomId, { name: `Load${i}` }));
rooms.forEach((r) => r.onMessage("*", () => {})); // we don't render events; just accept them
console.log(`Joined room ${rooms[0].roomId}. Starting match…`);

const probe = rooms[0];
await new Promise((resolve) => {
  probe.onStateChange(() => { if (probe.state.phase === "playing") resolve(); });
  probe.send("start");
});

// Simulated players: wander in random directions and hold the trigger.
const timers = rooms.map((room, i) => {
  let dir = {}, seq = 0, angle = 0;
  return setInterval(() => {
    if (Math.random() < 0.1) {
      dir = { up: Math.random() < 0.5, down: Math.random() < 0.5, left: Math.random() < 0.5, right: Math.random() < 0.5 };
      angle = Math.random() * Math.PI * 2;
    }
    room.send("input", { seq: ++seq, ...dir, dt: TICK_MS / 1000 });
    if (seq % 6 === i % 6) room.send("shoot", { angle });
  }, TICK_MS);
});

// Measure on one client: how often state updates arrive, the worst gap, and round-trip ping.
let patches = 0, last = performance.now();
const gaps = [], pings = [];
probe.onStateChange(() => {
  const now = performance.now();
  gaps.push(now - last);
  last = now;
  patches++;
});
const pinger = setInterval(() => probe.ping((ms) => pings.push(ms)), 1000);

const start = performance.now();
let lastReport = 0;
await new Promise((resolve) => {
  const report = setInterval(() => {
    const elapsed = (performance.now() - start) / 1000;
    const rate = (patches - lastReport) / 5;
    lastReport = patches;
    console.log(`  ${elapsed.toFixed(0).padStart(3)}s  updates/s ${rate.toFixed(1).padStart(5)}  ping ${pings.at(-1) ?? "?"} ms  phase ${probe.state.phase}  alive ${probe.state.aliveCount}`);
    if (elapsed >= seconds || probe.state.phase !== "playing") { clearInterval(report); resolve(); }
  }, 5000);
});

timers.forEach(clearInterval);
clearInterval(pinger);
const elapsed = (performance.now() - start) / 1000;
const sorted = gaps.slice(5).sort((a, b) => a - b);
const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
const worst = sorted.at(-1) ?? 0;
const rate = patches / elapsed;
const avgPing = pings.length ? pings.reduce((a, b) => a + b, 0) / pings.length : NaN;
console.log(`\nResult: ${rate.toFixed(1)} updates/s (target ~30), gap p95 ${p95.toFixed(0)} ms, worst ${worst.toFixed(0)} ms, ` +
  `ping avg ${avgPing.toFixed(0)} ms / max ${Math.max(...pings)} ms`);
console.log(rate >= 25 && p95 < 80 ? "VERDICT: server keeps up" : "VERDICT: server is struggling (see numbers above)");
await Promise.all(rooms.map((r) => r.leave().catch(() => {})));
process.exit(0);
