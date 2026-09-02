// Runs stores and seo, then assembles dist/: pages, referenced assets only, caching headers, netlify.toml.
// Usage: node tools/build.mjs [--site https://realdomain.com]
import fs from "node:fs";
import path from "node:path";
import { root, walk } from "./lib.mjs";
import { buildStores } from "./stores.mjs";
import { buildSeo, rewriteSite } from "./seo.mjs";

const argv = process.argv.slice(2);
const i = argv.indexOf("--site");
const site = i !== -1 ? argv[i + 1] : (argv.find((a) => a.startsWith("--site=")) || "").slice(7) || null;

if (site) { const r = rewriteSite(site); console.log(`build: site ${r.oldSite} -> ${r.newSite}`); }
console.log(`build: stores, ${buildStores()} pages`);
console.log(`build: seo, ${buildSeo()} URLs in sitemap`);

const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });

function copy(rel) {
  const src = path.join(root, rel);
  const dst = path.join(dist, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

// Pages and top-level files
const pages = ["index.html", "404.html", "sitemap.xml", "robots.txt", ...walk(path.join(root, "stores"), (p) => p.endsWith(".html")).map((p) => path.relative(root, p))];
for (const p of pages) if (fs.existsSync(path.join(root, p))) copy(p);

// Referenced assets only. Scan HTML for assets/ paths, then CSS for url() references relative to the stylesheet.
const referenced = new Set();
const assetRe = /(?:href|src|content)=["']([^"']*?assets\/[^"'#?]+)/g;
const srcsetRe = /srcset=["']([^"']+)["']/g;
for (const p of pages.filter((x) => x.endsWith(".html"))) {
  const file = path.join(root, p);
  if (!fs.existsSync(file)) continue;
  const html = fs.readFileSync(file, "utf8");
  for (const m of html.matchAll(assetRe)) referenced.add(m[1].replace(/^.*?(assets\/)/, "$1"));
  for (const m of html.matchAll(srcsetRe)) for (const part of m[1].split(",")) { const u = part.trim().split(/\s+/)[0]; if (u.includes("assets/")) referenced.add(u.replace(/^.*?(assets\/)/, "$1")); }
}
let grew = true;
while (grew) {
  grew = false;
  for (const rel of Array.from(referenced)) {
    if (!rel.endsWith(".css")) continue;
    const file = path.join(root, rel);
    if (!fs.existsSync(file)) continue;
    const css = fs.readFileSync(file, "utf8");
    for (const m of css.matchAll(/url\(["']?([^"')]+)["']?\)/g)) {
      const u = m[1];
      if (/^(data:|https?:)/.test(u)) continue;
      const resolved = path.relative(root, path.resolve(path.dirname(file), u)).split(path.sep).join("/");
      if (!referenced.has(resolved)) { referenced.add(resolved); grew = true; }
    }
  }
}
let copied = 0, missing = [];
for (const rel of referenced) {
  if (fs.existsSync(path.join(root, rel))) { copy(rel); copied++; } else missing.push(rel);
}
const allAssets = walk(path.join(root, "assets"), () => true).map((p) => path.relative(root, p).split(path.sep).join("/"));
const pruned = allAssets.filter((a) => !referenced.has(a));

// Caching headers and Netlify config
fs.writeFileSync(path.join(dist, "_headers"), `/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Cache-Control: public, max-age=0, must-revalidate\n\n/assets/*\n  Cache-Control: public, max-age=31536000, immutable\n\n/sitemap.xml\n  Cache-Control: public, max-age=3600\n`);
fs.writeFileSync(path.join(dist, "netlify.toml"), `[build]\n  publish = "."\n\n[[headers]]\n  for = "/assets/*"\n  [headers.values]\n    Cache-Control = "public, max-age=31536000, immutable"\n\n[[headers]]\n  for = "/*"\n  [headers.values]\n    X-Content-Type-Options = "nosniff"\n    Referrer-Policy = "strict-origin-when-cross-origin"\n\n[[redirects]]\n  from = "/*"\n  to = "/404.html"\n  status = 404\n`);

console.log(`build: ${pages.length} pages, ${copied} assets copied, ${pruned.length} unreferenced assets pruned${missing.length ? ", MISSING: " + missing.join(", ") : ""}`);
if (missing.length) process.exit(1);
