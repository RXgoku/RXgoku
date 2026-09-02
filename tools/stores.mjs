// Writes the ten store pages: /stores/ and /stores/<slug>/ from data/locations.json.
import fs from "node:fs";
import path from "node:path";
import { root, loadData, esc, render, siteUrl, storeUrl, storeDisplayName, streetAddress, mapsUrl, storeNode, breadcrumbNode, graph, injectJsonLd, writeFile } from "./lib.mjs";

export function buildStores() {
  const data = loadData();
  const site = siteUrl(data);
  const storeTpl = fs.readFileSync(path.join(root, "templates", "store.html"), "utf8");
  const indexTpl = fs.readFileSync(path.join(root, "templates", "stores-index.html"), "utf8");
  const zoneName = (id) => data.zones.find((z) => z.id === id).name;

  const menuShort = data.meta.menu.map((m) => `<li>${esc(m.name)}</li>`).join("");
  const menuFull = data.meta.menu.map((m) => `<li><strong>${esc(m.name)}</strong><span>${esc(m.description)}</span></li>`).join("");

  for (const store of data.stores) {
    const a = store.address;
    const street = streetAddress(store);
    const addressBig = esc(street || store.name);
    const addressSmall = esc([a.locality, a.city].filter(Boolean).join(", "));
    const addressSentence = street
      ? `${esc(street)}, ${esc(a.locality)}, ${esc(a.city)}.`
      : `${esc(a.locality)}, ${esc(a.city)}.`;

    let hoursHtml;
    if (store.hours) {
      hoursHtml = `<p class="big">${esc(store.hoursLabel || "Open today")}</p><ul role="list">` +
        store.hours.map((h) => `<li>${esc(h.days.join(", "))}: ${esc(h.opens)} to ${esc(h.closes)}</li>`).join("") + `</ul>`;
    } else {
      hoursHtml = `<p class="big">Not confirmed for this room yet.</p>` +
        `<p>Across the chain, doors open between 8:00 and 9:30 AM and close between 12:00 and 1:00 AM. Some suburban rooms run 24 hours. We publish exact hours for a store only once they are confirmed.</p>` +
        `<p class="note">Swiggy and Zomato show whether this room is taking orders right now.</p>`;
    }

    const siblings = data.stores.filter((s) => s.zone === store.zone && s.slug !== store.slug)
      .map((s) => `<li><a href="../${s.slug}/">${esc(s.name)}${streetAddress(s) ? `<span>${esc(streetAddress(s))}</span>` : ""}</a></li>`).join("") ||
      `<li><a href="../">All stores</a></li>`;

    const title = `${storeDisplayName(data, store)} | Boba, matcha, ramen bar`;
    const description = `Barako Bubble Tea & Coffee in ${store.name}${street ? ", " + street : ""}. Handcrafted boba, ceremonial matcha, a live Nongshim ramen bar and vegetarian bao. Directions, menu and delivery on Swiggy and Zomato.`;
    const canonical = storeUrl(data, store);

    let html = render(storeTpl, {
      title: esc(title), description: esc(description), canonical, siteUrl: site, root: "../../",
      name: esc(store.name), addressSentence, addressBig, addressSmall,
      mapsUrl: mapsUrl(store), hoursHtml, menuShort, menuFull,
      intro: esc(store.intro), zoneName: esc(zoneName(store.zone)), siblings,
      swiggy: data.meta.ordering.swiggy, zomato: data.meta.ordering.zomato, instagramUrl: data.meta.instagramUrl,
    });
    html = injectJsonLd(html, graph([
      storeNode(data, store),
      breadcrumbNode(data, [
        { name: data.meta.shortName, url: `${site}/` },
        { name: "Stores", url: `${site}/stores/` },
        { name: store.name, url: canonical },
      ]),
    ]));
    writeFile(path.join(root, "stores", store.slug, "index.html"), html);
  }

  // Locator, grouped by zone.
  const zonesHtml = data.zones.map((z) => {
    const items = data.stores.filter((s) => s.zone === z.id)
      .map((s) => `<li><a href="${s.slug}/">${esc(s.name)}${streetAddress(s) ? `<span>${esc(streetAddress(s))}</span>` : ""}</a></li>`).join("");
    return `<div class="zone"><h2>${esc(z.name)}</h2><ul class="store-list" role="list">${items}</ul></div>`;
  }).join("");
  const title = `All nine Barako stores in Mumbai | ${data.meta.brand}`;
  const description = "Every Barako Bubble Tea & Coffee in Mumbai, grouped by zone: Colaba, Lower Parel, Bandra West, Andheri West, Malad West, Borivali West, Ghatkopar East, Kurla and Mulund West.";
  let index = render(indexTpl, {
    title: esc(title), description: esc(description), canonical: `${site}/stores/`, siteUrl: site, root: "../",
    zonesHtml, swiggy: data.meta.ordering.swiggy, instagramUrl: data.meta.instagramUrl,
  });
  index = injectJsonLd(index, graph([
    {
      "@type": "CollectionPage",
      "@id": `${site}/stores/#page`,
      name: title,
      url: `${site}/stores/`,
      isPartOf: { "@id": `${site}/#website` },
      about: { "@id": `${site}/#organization` },
      hasPart: data.stores.map((s) => ({ "@id": `${storeUrl(data, s)}#store` })),
    },
    breadcrumbNode(data, [{ name: data.meta.shortName, url: `${site}/` }, { name: "Stores", url: `${site}/stores/` }]),
  ]));
  writeFile(path.join(root, "stores", "index.html"), index);
  return data.stores.length + 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const n = buildStores();
  console.log(`stores: wrote ${n} pages`);
}
