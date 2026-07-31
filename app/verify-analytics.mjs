// Headless verification for the self-explaining Analytics (KPI guide popovers +
// per-chart ⓘ explain panels). Same CDP-attach pattern as verify-map.mjs.
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

const profile = mkdtempSync(join(os.homedir(), "clayos-verify-"));
const PORT = 9335;
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function newPage(w, h) {
  const page = await browser.newPage();
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error") page.errors.push("console: " + m.text()); });
  return page;
}
async function poll(page, fn, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    const v = await page.evaluate(fn);
    if (v) return v;
    if (Date.now() - t0 > timeout) return null;
    await sleep(500);
  }
}

// ── desktop dashboard ────────────────────────────────────────────────────────
{
  const page = await newPage(1440, 900);
  await page.goto(`${BASE}/#${hash({ tab: "dashboard" })}`, { waitUntil: "domcontentloaded" });

  const loaded = await poll(page, () => document.body.textContent.includes("Portfolio analytics") && document.body.textContent.includes("Weighted CPI") || null);
  check("dashboard loads with stat tiles", !!loaded);

  const hint = await page.evaluate(() => document.body.textContent.includes("dotted label"));
  check("discoverability hint visible in header", hint);

  // tap the Weighted CPI label → guide popover with good/bad rows
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Weighted CPI");
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await sleep(400);
  const pop = await page.evaluate(() => {
    const t = [...document.querySelectorAll('[role="tooltip"]')].map((e) => e.textContent).join(" ");
    return t.includes("Cost Performance Index") && t.includes("✓ Good") && t.includes("✗ Bad");
  });
  check("tap KPI label → what/good/bad popover", pop);
  await page.screenshot({ path: join(SHOTS, "analytics-popover.png") });
  await page.evaluate(() => window.dispatchEvent(new MouseEvent("click"))); // close
  await sleep(200);

  // every chart card has an ⓘ explain toggle
  const nInfo = await page.evaluate(() => [...document.querySelectorAll("button")].filter((b) => b.textContent.includes("explain")).length);
  check("all 6 charts have an explain toggle", nInfo === 6, `${nInfo} found`);

  // open the TRIR chart's explainer → chart read + metric guide
  const opened = await page.evaluate(() => {
    const card = [...document.querySelectorAll("h3")].find((h) => h.textContent.includes("Safety"))?.closest("div.rounded-xl");
    const b = [...(card?.querySelectorAll("button") || [])].find((x) => x.textContent.includes("explain"));
    b?.click(); return !!b;
  });
  await sleep(400);
  const panel = await page.evaluate(() => {
    const t = document.body.textContent;
    return t.includes("normalized per 200,000 hours") && t.includes("Total Recordable Incident Rate") && t.includes("✓ Good");
  });
  check("chart explain panel: how-to-read + metric guide", opened && panel);
  await page.screenshot({ path: join(SHOTS, "analytics-explain.png") });

  // popovers also land on the backlog/pipeline/win-rate labels
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Win rate");
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await sleep(400);
  const winPop = await page.evaluate(() => [...document.querySelectorAll('[role="tooltip"]')].some((e) => e.textContent.includes("share that were won")));
  check("BU strip labels (win rate) explain too", winPop);

  check("desktop: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  await page.close();
}

// ── mobile ───────────────────────────────────────────────────────────────────
{
  const page = await newPage(390, 844);
  await page.goto(`${BASE}/#${hash({ tab: "dashboard" })}`, { waitUntil: "domcontentloaded" });
  const loaded = await poll(page, () => document.body.textContent.includes("Weighted CPI") || null);
  check("mobile: dashboard loads", !!loaded);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Portfolio TRIR");
    b?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await sleep(400);
  const pop = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[role="tooltip"]')].find((e) => e.textContent.includes("Total Recordable"));
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.left >= 0 && r.right <= window.innerWidth; // stays on-screen
  });
  check("mobile: tap label → popover, clamped on-screen", pop);
  const noHScroll = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
  check("mobile: no horizontal overflow", noHScroll);
  check("mobile: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  await page.close();
}

// ── regression: map view still clean (it now imports the glossary) ───────────
{
  const page = await newPage(1280, 800);
  await page.goto(`${BASE}/#${hash({ tab: "graph", ontoMode: "map" })}`, { waitUntil: "domcontentloaded" });
  const dots = await poll(page, () => document.querySelectorAll("svg g circle").length >= 380 || null);
  check("regression: map still renders 200 dots", !!dots);
  check("regression: map zero exceptions", page.errors.length === 0, page.errors.slice(0, 3).join(" | "));
  await page.close();
}

await browser.close().catch(() => {});
chrome.kill();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
