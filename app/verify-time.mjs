// Headless verification for the Clayco Time tab (Schedule / History / Trends).
// Same CDP-attach pattern as verify-map.mjs: snap chromium won't start under
// puppeteer's launcher, and the profile dir must be a NON-hidden $HOME path
// (AppArmor denies dot-dirs). Port 9337 — 9333/9335 belong to the other suites.
import puppeteer from "puppeteer-core";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import os from "node:os";

const BASE = process.argv[2] || "http://localhost:4181";
const SHOTS = process.argv[3] || "/tmp/claude-1001/-home-clawd/e26b339f-c202-4716-8df0-843940355621/scratchpad";
const hash = (o) => Buffer.from(encodeURIComponent(JSON.stringify(o))).toString("base64");

const results = [];
const check = (name, ok, extra = "") => { results.push([name, ok, extra]); console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const profile = mkdtempSync(join(os.homedir(), "clayos-verify-"));
const PORT = 9337;
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

// ── Schedule (Gantt) ─────────────────────────────────────────────────────────
{
  const page = await newPage(1440, 900);
  await page.goto(`${BASE}/#${hash({ tab: "time", timeMode: "schedule" })}`, { waitUntil: "domcontentloaded" });

  const bars = await poll(page, () => document.querySelectorAll('[data-kind="project"]').length >= 20 || null);
  check("schedule: portfolio bars render", !!bars, `${bars ?? "timeout"} visible`);

  const total = await page.evaluate(() => document.querySelector("svg[data-total-rows]")?.getAttribute("data-total-rows"));
  check("schedule: all 200 projects in the row model", total === "200", `data-total-rows=${total}`);

  check("schedule: today line present", await page.evaluate(() => !!document.querySelector('[data-testid="now-line"]')));

  // axis is non-degenerate
  const axis = await page.evaluate(() => {
    const t = [...document.querySelectorAll("svg text")].map((n) => n.textContent).filter((s) => /\d{4}|[A-Z][a-z]{2}/.test(s));
    return { first: t[0], last: t[t.length - 1], n: t.length };
  });
  check("schedule: time axis spans a real range", axis.n > 2 && axis.first !== axis.last, `${axis.first} … ${axis.last}`);

  // Expand a detailed project. Use puppeteer's real input rather than a synthetic
  // MouseEvent: d3-zoom reads event.view.document, and a hand-built MouseEvent has
  // view === null, which throws inside the zoom behaviour.
  await page.waitForSelector('button[aria-label^="Expand"]', { timeout: 15000 }).catch(() => {});
  await page.click('button[aria-label^="Expand"]').catch(() => {});
  await sleep(1200);
  const drill = await page.evaluate(() => ({
    acts: document.querySelectorAll('[data-kind="activity"]').length,
    deps: document.querySelectorAll('[data-kind="dep"]').length,
    floats: document.querySelectorAll('[data-kind="float"]').length,
    ms: document.querySelectorAll('[data-kind="milestone"]').length,
  }));
  check("schedule: drill-down shows activities", drill.acts >= 11, `${drill.acts} activities`);
  check("schedule: finish-to-start logic drawn", drill.deps >= 10, `${drill.deps} links`);
  check("schedule: total float rendered", drill.floats >= 1, `${drill.floats} float tails`);
  check("schedule: milestones rendered", drill.ms >= 4, `${drill.ms} milestones`);

  // THE honesty guard: no actual-progress bar may extend past the data date.
  const noFutureActuals = await page.evaluate(() => {
    const now = document.querySelector('[data-testid="now-line"] line');
    if (!now) return false;
    const nowX = now.getBoundingClientRect().right;
    return [...document.querySelectorAll('[data-kind="actual"]')]
      .every((el) => el.getBoundingClientRect().right <= nowX + 2);
  });
  check("schedule: no actual bar extends past today", noFutureActuals);

  check("schedule: partial-coverage stated honestly",
    await page.evaluate(() => /activity detail: \d+ of \d+/.test(document.body.innerText)));

  // click a bar → shared focus
  const barBox = await page.evaluate(() => {
    const el = document.querySelector('[data-kind="project"] rect');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  if (barBox) await page.mouse.click(barBox.x, barBox.y);
  await sleep(800);
  // NB: the filter bar's label is CSS-uppercased and innerText reflects that,
  // so match the chip content rather than the label casing.
  check("schedule: click bar sets the shared project focus",
    await page.evaluate(() => /Project · \S+/.test(document.body.innerText)));

  await page.screenshot({ path: join(SHOTS, "time-schedule.png") });
  check("schedule: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
  await page.close();
}

// ── History ──────────────────────────────────────────────────────────────────
{
  const page = await newPage(1440, 900);
  await page.goto(`${BASE}/#${hash({ tab: "time", timeMode: "history" })}`, { waitUntil: "domcontentloaded" });

  const bins = await poll(page, () => document.querySelectorAll('[data-kind="bin"]').length >= 5 || null);
  check("history: event histogram renders", !!bins, `${bins ?? "timeout"} bins`);

  // Paging proof: PostgREST caps a plain select at 1,000 rows. If fetchAllRows
  // were dropped from timelineEvents() this would read ~1000 and fail.
  const evts = Number(await page.evaluate(() => document.querySelector("svg[data-events]")?.getAttribute("data-events")));
  check("history: reads past the 1,000-row PostgREST cap", evts > 1000, `${evts} events`);

  check("history: per-type swimlanes render",
    await page.evaluate(() => document.querySelectorAll("[data-lane]").length >= 6));
  check("history: detail list populated",
    await page.evaluate(() => document.querySelectorAll('[data-row="event"]').length > 20));

  // brush the overview band → shared range chip
  const band = await page.evaluate(() => {
    const svg = document.querySelector("svg[data-events]");
    const r = svg.getBoundingClientRect();
    return { y: r.top + 60, x1: r.left + r.width * 0.45, x2: r.left + r.width * 0.75 };
  });
  await page.mouse.move(band.x1, band.y);
  await page.mouse.down();
  await page.mouse.move(band.x2, band.y, { steps: 8 });
  await page.mouse.up();
  await sleep(900);
  check("history: brushing sets the shared time range",
    await page.evaluate(() => /Time · \d{4}-\d{2}-\d{2}/.test(document.body.innerText)));

  await page.screenshot({ path: join(SHOTS, "time-history.png") });
  check("history: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
  await page.close();
}

// ── Trends ───────────────────────────────────────────────────────────────────
{
  const page = await newPage(1440, 900);
  // focus a deep project so the S-curve has a monthly series
  await page.goto(`${BASE}/#${hash({ tab: "time", timeMode: "trends", focus: { pid: null, name: "Aurora Hyperscale Data Center", code: "DC-001" } })}`,
    { waitUntil: "domcontentloaded" });
  await poll(page, () => document.body.innerText.includes("Performance indices") || null);
  await sleep(1500);

  check("trends: KPI trend renders", await page.evaluate(() => document.querySelectorAll("svg .recharts-line").length >= 1));

  // Regression guard for the kpiHistory paging fix — the table holds far more
  // than the 1,000-row cap, so a truncated read shows far fewer snapshots.
  const pts = Number((await page.evaluate(() => document.querySelector('[data-testid="kpi-points"]')?.textContent || "0")).replace(/[^\d]/g, ""));
  check("trends: kpi_history read is paged", pts > 1000, `${pts} snapshots`);

  await page.screenshot({ path: join(SHOTS, "time-trends.png") });
  check("trends: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
  await page.close();
}

// ── Getting to a detailed project ────────────────────────────────────────────
// Only 8 of 200 projects carry activity/monthly detail. Both views that can't
// show anything useful for the other 192 must offer a route into one.
{
  const env = Object.fromEntries(readFileSync(join(import.meta.dirname, ".env"), "utf8")
    .split("\n").filter((l) => l.includes("=")).map((l) => {
      const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }));
  const rest = (path) => fetch(`${env.VITE_SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: env.VITE_SUPABASE_ANON_KEY, Authorization: `Bearer ${env.VITE_SUPABASE_ANON_KEY}`,
      "Accept-Profile": "clayos" },
  }).then((r) => r.json());

  const deep = new Set((await rest("schedule_activities?select=project_id&is_summary=eq.false")).map((r) => r.project_id));
  const projects = await rest("projects?select=id,code,name&order=code");
  const light = projects.find((p) => !deep.has(p.id));
  check("fixture: a light project exists", !!light && deep.size > 0, `${deep.size} deep / ${projects.length} total`);

  // Trends — the exact dead end John hit: a light project, no curve, no way out.
  const page = await newPage(1440, 900);
  await page.goto(`${BASE}/#${hash({ tab: "time", timeMode: "trends", focus: { pid: light.id, name: light.name, code: light.code } })}`,
    { waitUntil: "domcontentloaded" });
  const jump = await poll(page, () => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.startsWith("Show me "));
    return b ? b.textContent.trim() : null;
  });
  check("trends: light project offers a way into a detailed one", !!jump, jump || "no button");

  if (jump) {
    await page.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.startsWith("Show me ")).click());
    await sleep(2500);
    check("trends: jumping renders an actual S-curve",
      await page.evaluate(() => document.querySelectorAll("svg .recharts-area").length >= 3),
      await page.evaluate(() => `${document.querySelectorAll("svg .recharts-area").length} areas`));
  }
  await page.screenshot({ path: join(SHOTS, "time-trends-jump.png") });
  check("trends jump: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
  await page.close();

  // Schedule — the detail count is a filter, not just a stat.
  const g = await newPage(1440, 900);
  await g.goto(`${BASE}/#${hash({ tab: "time", timeMode: "schedule" })}`, { waitUntil: "domcontentloaded" });
  await poll(g, () => document.querySelectorAll('[data-kind="project"]').length >= 20 || null);
  await sleep(800);
  await g.click('[data-testid="detail-only"]');
  await sleep(800);
  const shown = await g.evaluate(() => Number(document.querySelector("[data-total-rows]")?.getAttribute("data-total-rows") || 0));
  check("schedule: detail-count filters to the deep projects", shown === deep.size, `${shown} rows vs ${deep.size} deep`);
  await g.screenshot({ path: join(SHOTS, "time-schedule-detailonly.png") });
  check("schedule filter: zero runtime exceptions", g.errors.length === 0, g.errors.slice(0, 2).join(" | "));
  await g.close();
}

// ── Mobile ───────────────────────────────────────────────────────────────────
{
  const page = await newPage(390, 844);
  await page.goto(`${BASE}/#${hash({ tab: "time", timeMode: "schedule" })}`, { waitUntil: "domcontentloaded" });
  await poll(page, () => document.querySelectorAll('[data-kind="project"]').length >= 5 || null);
  await sleep(600);
  check("mobile: bars render at 390px",
    await page.evaluate(() => document.querySelectorAll('[data-kind="project"]').length >= 5));
  check("mobile: no horizontal page overflow",
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await page.screenshot({ path: join(SHOTS, "time-mobile.png") });
  check("mobile: zero runtime exceptions", page.errors.length === 0, page.errors.slice(0, 2).join(" | "));
  await page.close();
}

await browser.close().catch(() => {});
chrome.kill();
const fails = results.filter(([, ok]) => !ok);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
