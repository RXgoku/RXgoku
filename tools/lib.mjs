// Shared helpers for the generators. One data file is the single source of truth.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const dataPath = path.join(root, "data", "locations.json");

export function loadData() {
  return JSON.parse(fs.readFileSync(dataPath, "utf8"));
}

export function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function render(template, vars) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
    if (!(k in vars)) throw new Error("Missing template variable: " + k);
    return vars[k];
  });
}

export function siteUrl(data) {
  return data.meta.siteUrl.replace(/\/+$/, "");
}

export function storeUrl(data, store) {
  return `${siteUrl(data)}/stores/${store.slug}/`;
}

/** Drop null and undefined values recursively. Fields that are null in source are omitted from schema, never guessed. */
export function prune(obj) {
  if (Array.isArray(obj)) return obj.map(prune).filter((v) => v !== undefined && v !== null);
  if (obj && typeof obj === "object") {
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      const pv = prune(v);
      if (pv === undefined || pv === null) continue;
      if (Array.isArray(pv) && pv.length === 0) continue;
      if (typeof pv === "object" && !Array.isArray(pv) && Object.keys(pv).length === 0) continue;
      out[k] = pv;
    }
    return out;
  }
  return obj;
}

export function storeDisplayName(data, store) {
  return `${data.meta.brand}, ${store.name}`;
}

export function streetAddress(store) {
  const a = store.address;
  const parts = [a.landmark, a.street].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

export function mapsUrl(store) {
  return "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(store.mapsQuery);
}

export function openingHoursSpec(store) {
  // Per-store hours are unknown until confirmed. Null in source means omitted here.
  if (!store.hours) return null;
  return store.hours.map((h) => prune({
    "@type": "OpeningHoursSpecification",
    dayOfWeek: h.days,
    opens: h.opens,
    closes: h.closes,
  }));
}

export function orgNode(data) {
  const site = siteUrl(data);
  return prune({
    "@type": "Organization",
    "@id": `${site}/#organization`,
    name: data.meta.brand,
    alternateName: data.meta.shortName,
    url: `${site}/`,
    logo: `${site}/assets/img/og.png`,
    image: `${site}/assets/img/og.png`,
    description: data.meta.description,
    sameAs: [data.meta.instagramUrl],
    slogan: data.meta.tagline,
    areaServed: { "@type": "City", name: "Mumbai" },
  });
}

export function websiteNode(data) {
  const site = siteUrl(data);
  return {
    "@type": "WebSite",
    "@id": `${site}/#website`,
    name: data.meta.brand,
    url: `${site}/`,
    publisher: { "@id": `${site}/#organization` },
    inLanguage: "en-IN",
  };
}

export function menuNode(data) {
  const site = siteUrl(data);
  return {
    "@type": "Menu",
    "@id": `${site}/#menu`,
    name: `${data.meta.shortName} menu`,
    url: `${site}/#menu`,
    inLanguage: "en-IN",
    hasMenuSection: data.meta.menu.map((m) => ({
      "@type": "MenuSection",
      name: m.name,
      description: m.description,
    })),
  };
}

export function storeNode(data, store) {
  const site = siteUrl(data);
  const a = store.address;
  return prune({
    "@type": "CafeOrCoffeeShop",
    "@id": `${storeUrl(data, store)}#store`,
    name: storeDisplayName(data, store),
    url: storeUrl(data, store),
    image: `${site}/assets/img/og.png`,
    description: store.intro,
    telephone: store.phone,
    priceRange: data.meta.pricing.priceRange,
    servesCuisine: data.meta.servesCuisine,
    currenciesAccepted: "INR",
    address: prune({
      "@type": "PostalAddress",
      streetAddress: streetAddress(store),
      addressLocality: a.locality,
      addressRegion: a.region,
      postalCode: a.postalCode,
      addressCountry: a.country,
    }),
    geo: store.geo ? { "@type": "GeoCoordinates", latitude: store.geo.lat, longitude: store.geo.lng } : null,
    openingHoursSpecification: openingHoursSpec(store),
    hasMap: mapsUrl(store),
    hasMenu: { "@id": `${site}/#menu` },
    parentOrganization: { "@id": `${site}/#organization` },
    sameAs: [data.meta.instagramUrl],
    branchOf: { "@id": `${site}/#organization` },
  });
}

export function breadcrumbNode(data, items) {
  return {
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })),
  };
}

export function graph(nodes) {
  return { "@context": "https://schema.org", "@graph": nodes };
}

export function injectJsonLd(html, obj) {
  const block = `<!-- seo:jsonld -->\n<script type="application/ld+json">${JSON.stringify(obj, null, 0)}</script>\n<!-- /seo:jsonld -->`;
  if (!/<!-- seo:jsonld -->[\s\S]*?<!-- \/seo:jsonld -->/.test(html)) throw new Error("No seo:jsonld markers in page");
  return html.replace(/<!-- seo:jsonld -->[\s\S]*?<!-- \/seo:jsonld -->/, block);
}

export function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

export function walk(dir, pred = () => true, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!["node_modules", ".git", "dist", ".verify"].includes(e.name)) walk(p, pred, out); }
    else if (pred(p)) out.push(p);
  }
  return out;
}
