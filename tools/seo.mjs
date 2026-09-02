// Writes JSON-LD for the main page (Organization, WebSite, Menu, nine CafeOrCoffeeShop), sitemap.xml and robots.txt,
// and rewrites every absolute URL when --site is given. Fields that are null in source are omitted, never guessed.
import fs from "node:fs";
import path from "node:path";
import { root, dataPath, loadData, siteUrl, storeUrl, orgNode, websiteNode, menuNode, storeNode, breadcrumbNode, graph, injectJsonLd, writeFile, walk } from "./lib.mjs";

function argSite(argv) {
  const i = argv.indexOf("--site");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--site="));
  return eq ? eq.slice(7) : null;
}

export function rewriteSite(newSite) {
  const data = loadData();
  const oldSite = siteUrl(data);
  const next = newSite.replace(/\/+$/, "");
  if (!/^https?:\/\/[^/]+$/.test(next)) throw new Error("--site must be an origin like https://example.com");
  if (next === oldSite) return { oldSite, newSite: next, files: 0 };
  const files = walk(root, (p) => /\.(html|xml|txt|json|webmanifest)$/.test(p));
  let count = 0;
  for (const f of files) {
    const s = fs.readFileSync(f, "utf8");
    if (!s.includes(oldSite)) continue;
    fs.writeFileSync(f, s.split(oldSite).join(next));
    count++;
  }
  // data file is the source of truth for the next run
  const raw = JSON.parse(fs.readFileSync(dataPath, "utf8"));
  raw.meta.siteUrl = next;
  fs.writeFileSync(dataPath, JSON.stringify(raw, null, 2) + "\n");
  return { oldSite, newSite: next, files: count };
}

export function buildSeo() {
  const data = loadData();
  const site = siteUrl(data);

  // Main page JSON-LD
  const indexPath = path.join(root, "index.html");
  let index = fs.readFileSync(indexPath, "utf8");
  index = injectJsonLd(index, graph([
    orgNode(data),
    websiteNode(data),
    menuNode(data),
    breadcrumbNode(data, [{ name: data.meta.shortName, url: `${site}/` }]),
    ...data.stores.map((s) => storeNode(data, s)),
  ]));
  fs.writeFileSync(indexPath, index);

  // Sitemap and robots
  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    { loc: `${site}/`, priority: "1.0" },
    { loc: `${site}/stores/`, priority: "0.8" },
    ...data.stores.map((s) => ({ loc: storeUrl(data, s), priority: "0.7" })),
  ];
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`).join("\n") +
    `\n</urlset>\n`;
  writeFile(path.join(root, "sitemap.xml"), sitemap);
  writeFile(path.join(root, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${site}/sitemap.xml\n`);
  return urls.length;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const s = argSite(process.argv.slice(2));
  if (s) { const r = rewriteSite(s); console.log(`seo: site ${r.oldSite} -> ${r.newSite} (${r.files} files rewritten)`); }
  const n = buildSeo();
  console.log(`seo: JSON-LD injected, sitemap with ${n} URLs, robots.txt`);
}
