// Renders the drawn hero scene and the Open Graph card to WebP and PNG.
// Dev-time only. Needs playwright and sharp (npm i -D playwright sharp).
import { chromium } from "playwright";
import sharp from "sharp";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const exe = process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});

// Hero
{
  const page = await browser.newPage({ viewport: { width: 1600, height: 1200 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(root, "assets/img/src/hero-frame.html"));
  await page.waitForTimeout(300);
  const png = await page.screenshot({ type: "png" });
  await sharp(png).webp({ quality: 82 }).toFile(path.join(root, "assets/img/hero-room.webp"));
  await sharp(png).resize(900).webp({ quality: 80 }).toFile(path.join(root, "assets/img/hero-room-900.webp"));
  await page.close();
}
// OG card
{
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
  await page.goto("file://" + path.join(root, "assets/img/src/og.html"));
  await page.waitForTimeout(400);
  await page.screenshot({ type: "png", path: path.join(root, "assets/img/og.png") });
  await page.close();
}
await browser.close();
console.log("images rendered");
