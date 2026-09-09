// Shared time primitives for the Time views (Gantt / History / Trends).
//
// Division of labour: this module takes and returns Dates and encodes domain
// meaning; lib/format.js turns them into strings for humans.

// ─────────────────────────────────────────────────────────────────────────────
// parseDay — the single most important function here.
//
// PostgREST returns a `date` column as "2026-06-27". `new Date("2026-06-27")`
// parses that as UTC midnight, which is 8pm the PREVIOUS DAY in US Eastern — so
// every Gantt bar and every timeline marker would render one day early for any
// user west of Greenwich. Splitting the parts and using the local-time Date
// constructor pins it to local midnight. Use this everywhere; never `new Date(str)`.
export function parseDay(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  const [y, m, d] = String(s).slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

/** Local midnight today, memoised per module load so every row in a render agrees. */
let _today = null;
export function today() {
  if (!_today) { const n = new Date(); _today = new Date(n.getFullYear(), n.getMonth(), n.getDate()); }
  return _today;
}

export const DAY_MS = 86400000;
export const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
export const dayDiff = (a, b) => Math.round((b - a) / DAY_MS);
/** Do [t0,t1] and [from,to] overlap? Null bounds are treated as unbounded. */
export const overlaps = (t0, t1, from, to) =>
  (!to || (t0 && t0 <= to)) && (!from || (t1 && t1 >= from));

// ─── Range presets ───────────────────────────────────────────────────────────
// `portfolio` (fit to the data) is the default, deliberately. The synthetic
// dataset is anchored to a seed date that drifts further into the past every
// day, so a recency default like "last 30 days" renders an almost-empty view.
// Fitting to the data is also just the right default for a Gantt.
export const RANGE_PRESETS = [
  { id: "portfolio", label: "Fit to data" },
  { id: "ytd", label: "Year to date" },
  { id: "90d", label: "Last 90 days" },
  { id: "1y", label: "Last year" },
  { id: "2y", label: "Last 2 years" },
  { id: "all", label: "All time" },
];

/** Resolve a preset id into concrete {from,to} Dates given the data extent. */
export function resolveRange(preset, extent) {
  const t = today();
  const [dMin, dMax] = extent || [null, null];
  switch (preset) {
    case "all": return { from: null, to: null };
    case "ytd": return { from: new Date(t.getFullYear(), 0, 1), to: dMax && dMax > t ? dMax : t };
    case "90d": return { from: addDays(t, -90), to: t };
    case "1y": return { from: addDays(t, -365), to: t };
    case "2y": return { from: addDays(t, -730), to: t };
    case "portfolio":
    default: {
      if (!dMin || !dMax) return { from: null, to: null };
      // Pad 4% either side, and always keep "today" on screen so the now-line
      // is never off the edge on first paint.
      const pad = Math.max(7, Math.round(dayDiff(dMin, dMax) * 0.04));
      let from = addDays(dMin, -pad), to = addDays(dMax, pad);
      if (t < from) from = addDays(t, -pad);
      if (t > to) to = addDays(t, pad);
      return { from, to };
    }
  }
}

/** Min/max over rows via one or more date accessors. Returns [Date, Date] | [null,null]. */
export function dataExtent(rows, ...accessors) {
  let lo = null, hi = null;
  for (const r of rows || []) {
    for (const acc of accessors) {
      const d = typeof acc === "function" ? acc(r) : parseDay(r?.[acc]);
      if (!d) continue;
      if (!lo || d < lo) lo = d;
      if (!hi || d > hi) hi = d;
    }
  }
  return [lo, hi];
}

/** Pick a histogram bucket size that yields a readable number of bars. */
export function autoBucket(from, to, pxWidth) {
  const span = Math.max(1, dayDiff(from, to));
  const target = Math.max(12, Math.floor((pxWidth || 800) / 14)); // ~14px per bar
  const perBucket = span / target;
  if (perBucket <= 1) return "day";
  if (perBucket <= 7) return "week";
  if (perBucket <= 31) return "month";
  return "quarter";
}

const bucketKey = (d, step) => {
  if (step === "day") return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (step === "week") return addDays(d, -d.getDay());
  if (step === "month") return new Date(d.getFullYear(), d.getMonth(), 1);
  return new Date(d.getFullYear(), Math.floor(d.getMonth() / 3) * 3, 1);
};

/**
 * Bin dated events into buckets. `events` are {at: Date, ...}; `groupBy` picks a
 * stack key per event. Returns { buckets: [{t, total, by:{key:n}}], step, max }.
 */
export function bucketize(events, from, to, step, groupBy) {
  const map = new Map();
  for (const e of events) {
    if (!e.at) continue;
    if (from && e.at < from) continue;
    if (to && e.at > to) continue;
    const k = bucketKey(e.at, step).getTime();
    let b = map.get(k);
    if (!b) { b = { t: new Date(k), total: 0, by: {} }; map.set(k, b); }
    b.total += 1;
    const g = groupBy ? groupBy(e) : "all";
    b.by[g] = (b.by[g] || 0) + 1;
  }
  const buckets = [...map.values()].sort((a, b) => a.t - b.t);
  return { buckets, step, max: buckets.reduce((m, b) => Math.max(m, b.total), 0) };
}

// ─── Activity status ─────────────────────────────────────────────────────────
/**
 * Decide what a schedule activity's ACTUAL dates are allowed to claim.
 *
 * Status comes from pct_complete (real data). Actual dates are only honoured
 * when they don't contradict it or sit in the future — a bar planned for 2027
 * must never render as "started" because the source row carries an actual_start.
 * Anything suppressed is reported in `flags` so the UI can count it rather than
 * silently swallowing it.
 */
export function deriveActivityStatus(a, now = today()) {
  const pct = Number(a?.pct_complete) || 0;
  const ps = parseDay(a?.planned_start), pf = parseDay(a?.planned_finish);
  let as = parseDay(a?.actual_start), af = parseDay(a?.actual_finish);
  const flags = [];
  if (as && as > now) { flags.push("future-actual-start"); as = null; }
  if (af && af > now) { flags.push("future-actual-finish"); af = null; }
  if (as && pct === 0) { flags.push("started-but-zero-pct"); as = null; }
  if (af && pct < 100) { flags.push("finished-but-incomplete"); af = null; }
  const status = pct >= 100 ? "complete" : pct > 0 ? "in_progress" : "not_started";
  if (status === "complete" && !af) flags.push("complete-without-actual-finish");
  if (pf && pf < now && status !== "complete") flags.push("past-planned-finish");
  return { status, pct, plannedStart: ps, plannedFinish: pf, actualStart: as, actualFinish: af, flags };
}

// ─── Recency windows (shared with the 3D flow animation) ─────────────────────
// Hours back from now. Lifted out of Lifecycle3DView so the 3D view and the Time
// views speak the same vocabulary instead of forking the labels.
const D = 24;
export const WINDOWS = [
  { h: 7 * D, label: "7d" }, { h: 30 * D, label: "30d" }, { h: 60 * D, label: "60d" },
  { h: 90 * D, label: "90d" }, { h: 180 * D, label: "6mo" }, { h: 365 * D, label: "1y" },
  { h: 1e9, label: "all" },
];
