// Shared currency formatter. Picks the readable magnitude tier instead of always
// dividing by 1e6 (which printed portfolio totals as "$92171.5M").
//   $92.2B · $421M · $87K · $950 · −$11.3M
export const fmtMoney = (n, { dash = "—" } = {}) => {
  if (n == null || Number.isNaN(Number(n))) return dash;
  const v = Number(n);
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${trim((a / 1e9).toFixed(1))}B`;
  if (a >= 1e6) return `${sign}$${trim((a / 1e6).toFixed(1))}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
};

// "92.0" → "92" but "92.2" stays
const trim = (s) => s.replace(/\.0$/, "");

// ─── Dates ───────────────────────────────────────────────────────────────────
// Take Date objects (parse strings with time.js#parseDay first — never
// `new Date("YYYY-MM-DD")`, which is UTC and lands a day early in the Americas).
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const fmtDay = (d, { dash = "—" } = {}) =>
  d ? `${d.getDate()} ${MON[d.getMonth()]} ${d.getFullYear()}` : dash;

export const fmtDayShort = (d, { dash = "—" } = {}) =>
  d ? `${d.getDate()} ${MON[d.getMonth()]}` : dash;

export const fmtMonth = (d, { dash = "—" } = {}) =>
  d ? `${MON[d.getMonth()]} ${d.getFullYear()}` : dash;

/** 0 → "same day"; 18 → "18 days"; 104 → "3 mo 14 d"; 800 → "2 yr 2 mo" */
export const fmtDuration = (nDays) => {
  if (nDays == null || Number.isNaN(nDays)) return "—";
  const n = Math.abs(Math.round(nDays));
  if (n === 0) return "same day";
  if (n < 45) return `${n} day${n === 1 ? "" : "s"}`;
  if (n < 365) { const m = Math.floor(n / 30), d = n % 30; return d ? `${m} mo ${d} d` : `${m} mo`; }
  const y = Math.floor(n / 365), m = Math.round((n % 365) / 30);
  return m ? `${y} yr ${m} mo` : `${y} yr`;
};

/** Signed, relative to a reference day: "74 days ago" / "in 3 mo 2 d". */
export const fmtRelative = (d, ref) => {
  if (!d || !ref) return "—";
  const n = Math.round((d - ref) / 86400000);
  if (n === 0) return "today";
  return n < 0 ? `${fmtDuration(n)} ago` : `in ${fmtDuration(n)}`;
};

/** Percent from a 0–1 fraction. Lifted from DashboardView so both can use it. */
export const fmtPct = (n) => (n == null ? "—" : `${(Number(n) * 100).toFixed(0)}%`);
