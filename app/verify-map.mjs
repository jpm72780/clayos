// Headless verification for the new ClayOS Map view (replaces the 2D story).
// Box gotchas honored: /snap/bin/chromium via puppeteer-core, home-dir userDataDir,
// wait on domcontentloaded (never networkidle2), poll up to 30s for data views.
import puppeteer from "puppeteer-core";
import { mkdtempSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import os from "node:os";

const BASE = process.argv[2] || "http://localhost:4181";
const SHOTS = process.argv[3] || "/tmp/claude-1001/-home-clawd/e26b339f-c202-4716-8df0-843940355621/scratchpad";
const hash = (o) => Buffer.from(encodeURIComponent(JSON.stringify(o))).toString("base64");

const results = [];
const check = (name, ok, extra = "") => { results.push([name, ok, extra]); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

// snap chromium won't start under puppeteer's launcher — spawn it with a CDP port
// and attach. Profile must live in $HOME (snap can't write /tmp).
const profile = mkdtempSync(join(os.homedir(), "clayos-verify-"));
const PORT = 9333;
const chrome = spawn("/snap/bin/chromium", [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  "--no-sandbox", "--enable-unsafe-swiftshader", "--disable-dev-shm-usage", "--no-first-run",
], { stdio: "ignore" });
let browser = null;
for (let i = 0; i < 40 && !browser; i++) {
  await new Promise((r) => setTimeout(r, 500));
  browser = await puppeteer.connect({ browserURL: `http://127.0.0.1:${PORT}`, defaultViewport: null }).catch(() => null);
}
if (!browser) { chrome.kill(); throw new Error("could not attach to chromium CDP"); }

async function newPage(w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") page.errors.push("console: " + m.text()); });
  return page;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function poll(page, fn, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(500);
  }
}

// ── desktop ──────────────────────────────────────────────────────────────────
{
  const page = await newPage(1440, 900);
  await page.goto(`${BASE}/#${hash({ tab: "graph", ontoMode: "map" })}`, { waitUntil: "domcontentloaded" });

  const dots = await poll(page, () => {
    const n = document.querySelectorAll("svg g circle").length;
    return n >= 380 ? n : null; // 200 projects × (halo + core)
  });
  check("desktop: all 200 project dots render", !!dots, `${dots ?? "timeout"} circles`);

  const scope = await poll(page, () => {
    const el = [...document.querySelectorAll("div")].find((d) => /200.*projects.*cities/s.test(d.textContent) && d.textContent.length < 80);
    return el ? el.textContent.trim() : null;
  }, 10000);
  check("desktop: scope readout shows 200 projects + $", !!scope && /\$\d/.test(scope), scope || "");

  const basemap = await page.evaluate(() => {
    const paths = document.querySelectorAll("svg g > path");
    return paths.length >= 4 && [...paths].every((p) => (p.getAttribute("d") || "").length > 100);
  });
  check("desktop: basemap (land/borders/states) rendered", basemap);

  // click the biggest dot in the first city cluster → focus + detail card
  await page.evaluate(() => {
    const core = [...document.querySelectorAll("svg g circle")].find((c) => c.classList.contains("cursor-pointer"));
    core?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const detail = await poll(page, () => document.body.textContent.includes("The Ask agent is now scoped") || null, 8000);
  check("desktop: click dot → detail card opens", !!detail);
  const chip = await page.evaluate(() => document.body.textContent.includes("Active filter"));
  check("desktop: click dot → shared focus chip appears", chip);

  // color-mode toggle → health legend
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Cost health")?.click());
  await sleep(400);
  const health = await page.evaluate(() => document.body.textContent.includes("over budget (CPI < 0.95)"));
  check("desktop: color-by cost health legend", health);

  // zoom control changes the transform
  const t0 = await page.evaluate(() => document.querySelector("svg > g")?.getAttribute("transform"));
  await page.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label") === "Zoom in")?.click());
  await sleep(700);
  const t1 = await page.evaluate(() => document.querySelector("svg > g")?.getAttribute("transform"));
  check("desktop: zoom-in button changes transform", t0 !== t1, `${t0} → ${t1}`);

  await page.screenshot({ path: join(SHOTS, "map-desktop.png") });
  check("desktop: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  await page.close();
}

// ── legacy "lifecycle" deep-link aliases to map ──────────────────────────────
{
  const page = await newPage(1280, 800);
  await page.goto(`${BASE}/#${hash({ tab: "graph", ontoMode: "lifecycle" })}`, { waitUntil: "domcontentloaded" });
  const dots = await poll(page, () => document.querySelectorAll("svg g circle").length >= 380 || null);
  check("legacy: ontoMode=lifecycle link renders the map", !!dots);
  await page.close();
}

// ── mobile ───────────────────────────────────────────────────────────────────
{
  const page = await newPage(390, 844);
  await page.goto(`${BASE}/#${hash({ tab: "graph", ontoMode: "map" })}`, { waitUntil: "domcontentloaded" });
  const dots = await poll(page, () => document.querySelectorAll("svg g circle").length >= 380 || null);
  check("mobile: dots render at 390px", !!dots);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check("mobile: no horizontal overflow", noHScroll);
  await page.evaluate(() => {
    const core = [...document.querySelectorAll("svg g circle")].find((c) => c.classList.contains("cursor-pointer"));
    core?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  const sheet = await poll(page, () => document.body.textContent.includes("The Ask agent is now scoped") || null, 8000);
  check("mobile: tap dot → bottom-sheet detail", !!sheet);
  await page.screenshot({ path: join(SHOTS, "map-mobile.png") });
  check("mobile: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  await page.close();
}

await browser.close().catch(() => {});
chrome.kill();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
