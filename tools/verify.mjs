// Verify by scrolling it. Screenshots at many scroll positions, at desktop, 390px and under reduced motion,
// plus contrast measured on the composited render, tap-target sizes and minimum font size.
// Dev-time only: node tools/verify.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const base = process.argv[2] || "http://localhost:8080/";
const out = path.resolve(process.argv[3] || ".verify");
fs.mkdirSync(out, { recursive: true });
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

const profiles = [
  { name: "desktop", viewport: { width: 1440, height: 900 }, reducedMotion: "no-preference" },
  { name: "phone", viewport: { width: 390, height: 844 }, reducedMotion: "no-preference", isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  { name: "desktop-rm", viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" },
];

function lum([r, g, b]) {
  const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a, b) { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); }
function parseRgb(s) { const m = s.match(/[\d.]+/g); return m ? m.slice(0, 3).map(Number) : null; }

const report = { profiles: {} };

for (const prof of profiles) {
  const ctx = await browser.newContext({ viewport: prof.viewport, reducedMotion: prof.reducedMotion, isMobile: !!prof.isMobile, hasTouch: !!prof.hasTouch, deviceScaleFactor: prof.deviceScaleFactor || 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const requests = new Set();
  page.on("request", (r) => requests.add(r.url()));
  await page.goto(base, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);

  const dir = path.join(out, prof.name);
  fs.mkdirSync(dir, { recursive: true });

  // Screenshots at many scroll positions: every 0.5 viewport, plus each cut's top.
  const total = await page.evaluate(() => document.documentElement.scrollHeight);
  const vh = prof.viewport.height;
  const positions = new Set();
  for (let y = 0; y < total; y += Math.round(vh * 0.5)) positions.add(y);
  const tops = await page.evaluate(() => Array.from(document.querySelectorAll(".cut")).map((c) => Math.round(c.getBoundingClientRect().top + window.scrollY)));
  tops.forEach((t) => positions.add(t));
  const sorted = Array.from(positions).sort((a, b) => a - b);
  let i = 0;
  for (const y of sorted) {
    await page.evaluate((yy) => window.scrollTo({ top: yy, behavior: "instant" }), y);
    await page.waitForTimeout(prof.reducedMotion === "reduce" ? 500 : 1100);
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(2, "0")}-${y}.png`) });
    i++;
  }

  // Contrast on composited pixels. For each visible text element, sample the pixel colours behind the text box
  // from a screenshot with the text made transparent, then compare to the computed text colour.
  const contrastFindings = [];
  for (const y of tops) {
    await page.evaluate((yy) => window.scrollTo({ top: yy + 1, behavior: "instant" }), y);
    await page.waitForTimeout(prof.reducedMotion === "reduce" ? 400 : 1000);
    const els = await page.evaluate(() => {
      const sel = "h1,h2,h3,p,li,a,dt,dd,blockquote,span,figcaption,button,strong";
      const out = [];
      const seen = new Set();
      for (const el of document.querySelectorAll(sel)) {
        if (el.closest("[aria-hidden='true']") || el.closest(".chrome") || el.closest(".skip")) continue;
        const text = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join("");
        if (!text) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || parseFloat(cs.opacity) === 0) continue;
        const key = text.slice(0, 40) + "|" + Math.round(r.top);
        if (seen.has(key)) continue; seen.add(key);
        out.push({ text: text.slice(0, 50), color: cs.color, fontSize: parseFloat(cs.fontSize), rect: { x: r.x, y: r.y, w: r.width, h: r.height }, path: el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ").join(".") : "") });
      }
      return out;
    });
    // hide text to sample the background behind it
    await page.addStyleTag({ content: "body * { color: transparent !important; -webkit-text-fill-color: transparent !important; } body svg text{fill:transparent!important}" });
    const buf = await page.screenshot({ type: "png" });
    
    const sharp = (await import("sharp")).default;
    const img = sharp(buf);
    const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
    const dpr = prof.deviceScaleFactor || 1;
    const px = (x, yy) => { const idx = ((Math.round(yy * dpr) * info.width) + Math.round(x * dpr)) * info.channels; return [data[idx], data[idx + 1], data[idx + 2]]; };
    for (const e of els) {
      const fg = parseRgb(e.color); if (!fg) continue;
      // Sample inside the box, away from rounded corners and borders, and judge against every colour that
      // covers at least a fifth of the samples. A single stray pixel (a border, a dot) is not the background.
      const samples = [];
      const { x, y: ry, w, h } = e.rect;
      for (let sx = 0.12; sx <= 0.88; sx += 0.095) for (let sy = 0.3; sy <= 0.7; sy += 0.2) {
        const X = x + w * sx, Y = ry + h * sy;
        if (X < 0 || Y < 0 || X >= prof.viewport.width || Y >= vh) continue;
        samples.push(px(X, Y));
      }
      if (!samples.length) continue;
      const counts = new Map();
      for (const c of samples) { const k = c.map((v) => v >> 3).join(","); counts.set(k, (counts.get(k) || { n: 0, c })); counts.get(k).n++; }
      const major = Array.from(counts.values()).filter((v) => v.n >= samples.length * 0.2).map((v) => v.c);
      const worst = Math.min(...(major.length ? major : samples).map((bg) => contrast(fg, bg)));
      if (!Number.isFinite(worst)) continue; // element was off the composited frame
      const large = e.fontSize >= 24;
      contrastFindings.push({ scrollTop: y, text: e.text, path: e.path, fontSize: e.fontSize, worst: Number(worst.toFixed(2)), large, pass: worst >= 4.5 });
    }
    // restore
    await page.reload({ waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
  }

  // Tap targets and font floor over the whole page.
  const audits = await page.evaluate(() => {
    const small = [];
    for (const el of document.querySelectorAll("a,button")) {
      if (el.closest("[aria-hidden='true']")) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.width < 44 || r.height < 44) small.push({ text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 40), w: Math.round(r.width), h: Math.round(r.height) });
    }
    const tiny = [];
    for (const el of document.querySelectorAll("body *")) {
      const cs = getComputedStyle(el);
      const fs = parseFloat(cs.fontSize);
      const hasText = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
      if (hasText && fs < 12 && cs.display !== "none") tiny.push({ tag: el.tagName, text: el.textContent.trim().slice(0, 30), fs });
    }
    const imgs = Array.from(document.images).filter((im) => !im.getAttribute("width") || !im.getAttribute("height")).map((im) => im.getAttribute("src"));
    return { small, tiny, imgsWithoutSize: imgs };
  });

  const external = Array.from(requests).filter((u) => !u.startsWith(base) && !u.startsWith("data:"));
  report.profiles[prof.name] = { screenshots: sorted.length, errors, externalRequests: external, contrastFailures: contrastFindings.filter((f) => !f.pass), contrastChecked: contrastFindings.length, ...audits };
  await ctx.close();
}
await browser.close();
fs.writeFileSync(path.join(out, "report.json"), JSON.stringify(report, null, 2));
for (const [name, r] of Object.entries(report.profiles)) {
  console.log(`\n== ${name}: ${r.screenshots} screenshots, ${r.contrastChecked} text elements checked`);
  console.log(`errors: ${r.errors.length}`, r.errors.slice(0, 5));
  console.log(`external requests: ${r.externalRequests.length}`, r.externalRequests.slice(0, 5));
  console.log(`contrast failures (<4.5): ${r.contrastFailures.length}`);
  r.contrastFailures.slice(0, 40).forEach((f) => console.log(`  ${f.worst}  ${f.fontSize}px  ${f.path}  "${f.text}" @${f.scrollTop}`));
  console.log(`tap targets under 44px: ${r.small.length}`, r.small.slice(0, 12));
  console.log(`text under 12px: ${r.tiny.length}`, r.tiny.slice(0, 8));
  console.log(`images without width/height: ${r.imgsWithoutSize.length}`, r.imgsWithoutSize);
}
