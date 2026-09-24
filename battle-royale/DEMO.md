# Last Circle: demo script

A 60-second live demo in which the audience joins your match from their laptops.

## The day before

- [ ] **Deploy** (see README → Deploy) and open the link from a different network, e.g. your phone's hotspot.
- `ZONE_TIME_SCALE` is already `3` in `render.yaml`, so matches last about 70 seconds, which is what the timings below assume. If you changed it in the Render dashboard, set it back to `3`.
- `AUTO_START_PLAYERS` is already `20` (a full room), so audience members joining won't start the match before you press Start.
- [ ] **Make a QR code for the link.** In Chrome, open your game URL, click the share icon in the address bar, choose **Create QR code**, then **Download**. Put it on a slide.
- [ ] **Record a backup video** of yourself running the whole script (Windows: `Win+G`, Mac: `Cmd+Shift+5`, or OBS). If the Wi-Fi dies, you play this and narrate the same lines.
- [ ] Rehearse the script 3 times with a timer. It is tight.

## 10 minutes before

- [ ] **Open the game link now.** The free Render plan sleeps after 15 minutes, and waking it takes about a minute. Don't do that in front of the judges.
- [ ] Open `https://YOUR-APP.onrender.com/?name=YourName` in the browser you'll present from, at 100% zoom, with other tabs closed.
- [ ] Check that sound comes out of the room speakers, not just your laptop (HDMI audio can switch output). Press **M** once to confirm the mute toggle works, then press it again.
- [ ] Have the QR slide ready to show next to the game.

## The script (60 seconds)

Timings assume `ZONE_TIME_SCALE=3`. **Bold** is what you do; quotes are what you say.

| Time | Do | Say |
|---|---|---|
| 0:00 | **QR slide + game lobby on screen** | "Battle royales like Warzone are a hundred-gigabyte download. This is **Last Circle**, a battle royale that runs in a browser tab. Scan the code, and you're in my lobby right now." |
| 0:10 | **Click Shotgun, then Revolver** in the loadout panel | "I pick my loadout here. I spawn with my sidearm, and my main gun arrives mid-match in a crate only I can open, just like Warzone's loadout drop." |
| 0:18 | **Click Start match** | "Anyone who didn't join, bots fill in. It works with one player or twenty." |
| 0:21 | **Drop in. Walk to the nearest gun, press E, and fight the closest player** | "Every shot is simulated on the server, so the browser can't cheat the fire rate or teleport." |
| 0:34 | **Siren plays. Head towards the white circle** | "That siren is the zone closing. Outside it you take damage, and it gets worse every phase." |
| 0:44 | **Crate lands next to you. Walk onto it and press E** | "And there's my loadout drop. Shotgun, full ammo." |
| 0:52 | **Keep playing while you close** | "Every sprite and every sound you just heard is generated in code: zero asset files and a 368-kilobyte download. That's Last Circle. Thank you." |

## If something goes wrong

| Problem | What to do |
|---|---|
| **You die before 0:44** | Say *"And when you're out, you spectate whoever got you."* Then skip straight to the 0:52 closing line. With no other humans alive the match ends by itself, which is fine. |
| **Page won't load / Wi-Fi is down** | Play the backup video and say the same lines over it. |
| **Page loads but says "Could not connect"** | The server is still waking up. Talk through the 0:00 and 0:10 lines, then refresh. |
| **No sound** | Keep going. Say "you'd hear the zone siren here" at 0:34. |
| **More than 20 people join** | Extra people automatically get their own new lobby. Nothing breaks. |

## Likely judge questions

**"How do you stop cheating?"**
The server is authoritative. The browser only sends intentions such as which keys are held and where it's aiming, and the server decides every result. It enforces fire rate, ammo, reload time, pickup range and movement speed. Bots go through the same checks.

**"Why a browser game instead of Unity or Unreal?"**
Judges and players can try it in five seconds from a link. A download is where most people give up.

**"How do the bots work?"**
Each bot runs a simple priority list: escape the zone, fight anyone within half a screen, find a gun if it has none, otherwise wander inside the next circle. They wait 0.4–0.8 s before firing and aim slightly off, so humans get a fair chance.

**"What was the hardest part?"**
Making your own movement feel instant while the server stays in charge. The client moves you right away, then the server confirms. When they disagree, the client snaps to the server's position and replays the inputs the server hasn't seen yet.

**"Does it scale?"**
Each match is one room with up to 20 players, and one server process can run many rooms. Beyond that, the multiplayer framework (Colyseus) supports spreading rooms across several processes. We haven't load-tested this.

**"Did you use AI?"**
Yes, Claude Code as a pair programmer for the code. The game design decisions and the playtesting were ours. *(Adjust this to what's true for your team.)*

**"What's next?"**
Lag compensation, walls and cover, squads, and touch controls for phones.

**Don't claim** that it works on phones (it needs a keyboard and mouse), or that it handles 100-player matches (rooms hold 20).
