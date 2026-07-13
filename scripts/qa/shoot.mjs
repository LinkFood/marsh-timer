// Headless-Chrome screenshot driver for QA — real pixels, not source-level checks.
// Usage: node scripts/qa/shoot.mjs <url> <outPath> [width] [height] [scrollY]
import puppeteer from "puppeteer-core";

const [url, out, w = "375", h = "812", scrollY = "0"] = process.argv.slice(2);
if (!url || !out) {
  console.error("usage: node shoot.mjs <url> <outPath> [w] [h] [scrollY]");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  headless: "new",
});
const page = await browser.newPage();
await page.setViewport({ width: Number(w), height: Number(h), deviceScaleFactor: 1 });
try {
  await page.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
} catch {
  /* capture whatever rendered */
}
await new Promise((r) => setTimeout(r, 6000));
if (Number(scrollY) > 0) {
  await page.evaluate((y) => window.scrollTo({ top: y }), Number(scrollY));
  await new Promise((r) => setTimeout(r, 1200));
}
await page.screenshot({ path: out });
await browser.close();
console.log(out);
