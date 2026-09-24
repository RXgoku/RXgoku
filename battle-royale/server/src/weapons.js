// Weapon stats as data. Shared by server (authoritative) and client (HUD, cooldown hints).
// spread: max random angle offset in radians. pellets: bullets per shot. reserve: spare
// ammo a freshly spawned gun comes with (pistol reserve is unlimited).
//
// Time to kill a 100 HP player: pistol 5 hits / 1.2s, SMG 10 hits / 0.9s,
// shotgun 1 shot if all 7 pellets land (point blank), sniper 1 hit.
export const WEAPONS = {
  pistol: {
    label: "Pistol", color: "#bdc3c7", damage: 20, cooldownMs: 300, spread: 0.04, pellets: 1,
    bulletSpeed: 900, rangeMs: 600, magSize: 12, reloadMs: 1000, reserve: Infinity, barrel: 8,
  },
  smg: {
    label: "SMG", color: "#3498db", damage: 10, cooldownMs: 100, spread: 0.10, pellets: 1,
    bulletSpeed: 950, rangeMs: 550, magSize: 30, reloadMs: 1600, reserve: 90, spawnWeight: 4, barrel: 12,
  },
  shotgun: {
    label: "Shotgun", color: "#e67e22", damage: 15, cooldownMs: 800, spread: 0.30, pellets: 7,
    bulletSpeed: 800, rangeMs: 300, magSize: 5, reloadMs: 2200, reserve: 15, spawnWeight: 3, barrel: 14,
  },
  sniper: {
    label: "Sniper", color: "#9b59b6", damage: 100, cooldownMs: 1200, spread: 0.005, pellets: 1,
    bulletSpeed: 1800, rangeMs: 900, magSize: 4, reloadMs: 2500, reserve: 12, spawnWeight: 1, barrel: 22,
  },
};

export const PICKUP_WEAPONS = Object.keys(WEAPONS).filter((id) => WEAPONS[id].spawnWeight);

export function randomPickupWeapon() {
  const total = PICKUP_WEAPONS.reduce((sum, id) => sum + WEAPONS[id].spawnWeight, 0);
  let roll = Math.random() * total;
  for (const id of PICKUP_WEAPONS) {
    roll -= WEAPONS[id].spawnWeight;
    if (roll < 0) return id;
  }
  return PICKUP_WEAPONS[0];
}
