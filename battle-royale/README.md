# Battle Royale (hackathon prototype)

Top-down multiplayer shooter. Phaser 3 client, Colyseus server.

## Run locally

```bash
npm run install:all
npm run dev:server   # terminal 1, ws on :2567
npm run dev:client   # terminal 2, open the URL Vite prints
```

Controls: WASD move, mouse aim, hold left click shoot, E pick up/swap weapon, R reload, 1/2 switch slot.

Weapons are plain data in `server/src/weapons.js` (damage, fire rate, spread, pellets, magazine,
reload time, spawn weight). Edit numbers there to rebalance; both server and client read it.

Open two tabs to see two players. Add `?name=Alice` to the URL to set a name.
Other devices on the same Wi-Fi can join using the "Network" URL Vite prints.

## Deploy (one service)

`npm run build` then `npm start`. The server serves the built client from
`client/dist`, so a single Render/Railway/Fly service hosts everything.
Set `PORT` if the host requires it.

## Zone

Four phases (~4 minutes), defined in `server/src/zone.js`. Outside the circle you take
2 → 5 → 10 → 20 damage per second. For a shorter demo match, speed up every zone timer:

```bash
ZONE_TIME_SCALE=3 npm run dev:server   # ~80 second match
```

## How the netcode works

- The server is authoritative. Clients send `{seq, up, down, left, right, dt}` each frame,
  and the server applies them with a time budget so a client can't move faster than real time.
- Your own player is predicted locally. When the server reports `lastSeq`, the client resets to the
  server position and replays unacknowledged inputs (`server/src/constants.js` holds the shared `applyMove`).
- Other players are rendered 100 ms in the past, interpolated between server snapshots.
- Bullets live only on the server. It broadcasts `bullet` (spawn + velocity) and `bulletEnd` events;
  clients just draw them. Hits use a swept segment-vs-circle test so fast bullets can't skip players.
  Fire rate is enforced server-side (`FIRE_COOLDOWN_MS`).
