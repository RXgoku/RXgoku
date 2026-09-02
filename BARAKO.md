# Barako Bubble Tea & Coffee, the website

Marketing site for a real chain of nine cafes in Mumbai. Plain HTML, CSS and vanilla JavaScript. No framework, no runtime dependencies, no third-party requests. Works as static files on any host.

`README.md` in this repository is the GitHub profile README and is left untouched. This file documents the site.

## Layout

```
index.html              one scroll page, fifteen hard cuts
stores/                 generated: locator plus nine store pages (documents, not scroll experiences)
data/locations.json     the single source of truth for stores, hours, prices, menu, links
templates/              store.html and stores-index.html, filled by tools/stores.mjs
assets/css/tokens.css   fonts, the eight grounds, type scale, buttons, primitives
assets/css/site.css     the scroll page: sections, the fixed cup, the ramen bowl, the CSS 3D whisk
assets/css/stores.css   the store documents
assets/js/site.js       scroll driver: active ground, cup re-pour, ramen chapter, whisk progress
assets/fonts/           self-hosted Outfit 600/800/900 and Geist 400/500/600, Latin subset, woff2
assets/img/             hero WebP (1600 and 900 wide), OG card, favicon; src/ holds the drawn sources
tools/stores.mjs        writes the ten store pages
tools/seo.mjs           JSON-LD, sitemap.xml, robots.txt; --site rewrites every absolute URL
tools/build.mjs         runs both and assembles dist/ with referenced assets only
tools/verify.mjs        scrolls the page in a real browser and measures what it sees
tools/serve.mjs         tiny static server for local checks
tools/render-images.mjs re-renders the hero and OG images from the drawn sources
```

## Build

```
node tools/build.mjs --site https://realdomain.com
```

That rewrites the placeholder origin (`https://barako.example`) everywhere, regenerates the store pages, injects JSON-LD (Organization, WebSite, Menu, BreadcrumbList, nine CafeOrCoffeeShop nodes), writes `sitemap.xml` and `robots.txt`, then copies pages, only the assets they reference, a `_headers` file with caching rules and a `netlify.toml` into `dist/`. Anything under `assets/` that nothing references is pruned.

Fields that are null in `data/locations.json` (per-store hours, phone, postcode, coordinates) are omitted from the schema and shown on the page as "not confirmed yet". They are never guessed. To publish hours for a store, set its `hours` to an array of `{ "days": ["Monday", ...], "opens": "08:00", "closes": "01:00" }` objects and rebuild.

## Verify

```
npm install            # playwright, dev only
node tools/serve.mjs . 8080 &
node tools/verify.mjs http://localhost:8080/ .verify
```

Screenshots every half viewport at desktop, 390px and under reduced motion. Measures text contrast against the composited pixels behind each text element, tap target sizes, the 12px font floor, external requests and console errors. Set `CHROMIUM_PATH` to use a system Chromium instead of the Playwright download.

## Facts and their limits

- Prices published: large cup ₹250 to ₹320, about ₹450 for two, ramen and boba combos from ₹290. No per-item prices anywhere.
- Hours published as a range only. Per-store hours are null until confirmed.
- The hero image is a drawn interior, not a photograph. Replace `assets/img/hero-room.webp` (1600×1200) and `hero-room-900.webp` (900×675) with a real interior photo when one is available; nothing else needs to change.
- The Swiggy and Zomato links are chain-level search links. Swap in the real store listing URLs in `data/locations.json` under `meta.ordering` when known.
- Map positions in `data/locations.json` (`map.x`, `map.y`) are schematic percentages for the drawn rail-corridor map, not coordinates. `geo` stays null until real coordinates are confirmed.
