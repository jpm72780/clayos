import { useEffect, useMemo, useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  ReferenceLine, CartesianGrid, Legend, AreaChart, Area,
} from "recharts";
import { costCurve, kpiHistory, projectSchedule, listBusinessUnits } from "../lib/api.js";
import { chartColor } from "../lib/palette.js";
import { fmtMoney as fmt$ } from "../lib/format.js";
import { defOf } from "../lib/glossary.js";

// ─────────────────────────────────────────────────────────────────────────────
// ClayOS — Trends. How cost and performance moved over time.
//
// The S-curve (planned value / earned value / actual cost) is the chart a project
// controls team actually lives in: where the three lines separate tells you the
// story that a single CPI number only summarises.
// ─────────────────────────────────────────────────────────────────────────────

const num = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };
const tip = { contentStyle: { background: "#0d1218", border: "1px solid #1f2733", borderRadius: 8, fontSize: 12 } };
const month = (s) => (s || "").slice(0, 7);

export default function TrendsView({ businessUnit, focus, setFocus }) {
  const [curve, setCurve] = useState(null);
  const [hist, setHist] = useState({ cpi: [], spi: [], pct_complete: [] });
  const [projects, setProjects] = useState([]);
  const [bus, setBus] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { projectSchedule().then(setProjects).catch(() => setProjects([])); listBusinessUnits().then(setBus); }, []);

  useEffect(() => {
    let dead = false;
    setLoading(true);
    const opts = focus?.pid ? { projectId: focus.pid } : businessUnit ? { businessUnitId: businessUnit } : {};
    Promise.all([
      focus?.pid ? costCurve(focus.pid).catch(() => []) : Promise.resolve(null),
      kpiHistory("cpi", opts), kpiHistory("spi", opts), kpiHistory("pct_complete", opts),
    ]).then(([c, cpi, spi, pct]) => {
      if (dead) return;
      setCurve(c); setHist({ cpi, spi, pct_complete: pct }); setLoading(false);
    }).catch(() => !dead && setLoading(false));
    return () => { dead = true; };
  }, [focus?.pid, businessUnit]);

  const buName = useMemo(() => new Map(bus.map((b) => [b.id, b.name])), [bus]);
  const scopeLabel = focus ? (focus.code || focus.name)
    : businessUnit ? (buName.get(businessUnit) || "business unit") : "the whole portfolio";

  // S-curve: cost_progress rows are per cost account per month — sum to project level.
  const sData = useMemo(() => {
    if (!curve?.length) return [];
    const by = new Map();
    for (const r of curve) {
      const k = r.period;
      const o = by.get(k) || { period: k, pv: 0, ev: 0, ac: 0 };
      o.pv += num(r.pv) || 0; o.ev += num(r.ev) || 0; o.ac += num(r.ac) || 0;
      by.set(k, o);
    }
    return [...by.values()].sort((a, b) => a.period.localeCompare(b.period))
      .map((o) => ({ m: month(o.period), PV: o.pv / 1e6, EV: o.ev / 1e6, AC: o.ac / 1e6 }));
  }, [curve]);

  // KPI trend: average by month across whatever is in scope.
  const kData = useMemo(() => {
    const by = new Map();
    const add = (rows, key) => {
      for (const r of rows) {
        const m = month(r.snapshot_date);
        const o = by.get(m) || { m };
        (o[`_${key}`] = o[`_${key}`] || []).push(num(r.value));
        by.set(m, o);
      }
    };
    add(hist.cpi, "CPI"); add(hist.spi, "SPI"); add(hist.pct_complete, "PCT");
    const avg = (a) => (a?.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
    return [...by.values()].map((o) => ({ m: o.m, CPI: avg(o._CPI), SPI: avg(o._SPI), "% complete": avg(o._PCT) }))
      .sort((a, b) => a.m.localeCompare(b.m));
  }, [hist]);

  const totalPoints = hist.cpi.length + hist.spi.length + hist.pct_complete.length;
  const last = sData[sData.length - 1];

  return (
    <div className="h-full overflow-auto p-3 md:p-5 pb-24 md:pb-20 bg-[#0a0f14]">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <h2 className="text-sm font-medium text-white/80">Trends</h2>
        <span className="text-white/40 text-xs">· {scopeLabel}</span>
        {focus && (
          <button onClick={() => setFocus?.(null)} className="text-xs rounded px-2 py-0.5 bg-amber-500/15 text-amber-200">
            {focus.code || focus.name} ✕
          </button>
        )}
        <span className="ml-auto text-[10px] text-white/30" data-testid="kpi-points">
          {totalPoints.toLocaleString()} snapshots
        </span>
      </div>

      {/* ── S-curve ─────────────────────────────────────────────────────── */}
      <div className="min-w-0 bg-[#0d1218] border border-white/10 rounded-xl p-4 mb-4">
        <h3 className="text-sm font-medium text-white/80">Cost performance over time</h3>
        <div className="text-xs text-white/40">
          Planned value, earned value and actual cost ($M cumulative)
        </div>
        {!focus ? (
          <div className="h-56 grid place-items-center text-center text-white/45 text-xs px-6">
            <div>
              <div>Monthly cost history is tracked per project.</div>
              <div className="text-white/30 mt-1">Pick a project — from the schedule, the map, or the chat — to see its S-curve.</div>
            </div>
          </div>
        ) : loading ? (
          <div className="h-56 grid place-items-center text-white/40 text-xs">loading…</div>
        ) : sData.length < 2 ? (
          <div className="h-56 grid place-items-center text-center text-white/45 text-xs px-6">
            <div>
              <div>{scopeLabel} has only a single cost period recorded.</div>
              <div className="text-white/30 mt-1">A curve needs a monthly series — the detailed projects carry one.</div>
            </div>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={sData} margin={{ left: -12, top: 8 }}>
                <CartesianGrid stroke="#1a212b" />
                <XAxis dataKey="m" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} unit="M" />
                <Tooltip {...tip} formatter={(v, n) => [`$${Number(v).toFixed(1)}M`, n]} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="PV" stroke={chartColor("pv")} fill={chartColor("pv")} fillOpacity={0.08} strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="EV" stroke={chartColor("ev")} fill={chartColor("ev")} fillOpacity={0.08} strokeWidth={2} dot={false} />
                <Area type="monotone" dataKey="AC" stroke={chartColor("ac")} fill={chartColor("ac")} fillOpacity={0.08} strokeWidth={2} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
            {last && (
              <div className="grid grid-cols-3 gap-3 mt-2 text-xs">
                <Stat label="PV" value={`$${last.PV.toFixed(1)}M`} hint="Planned value — what should have been earned by now." />
                <Stat label="EV" value={`$${last.EV.toFixed(1)}M`} hint="Earned value — the budgeted worth of what's actually done." />
                <Stat label="AC" value={`$${last.AC.toFixed(1)}M`} hint="Actual cost — what has been spent to earn it." />
              </div>
            )}
            <p className="text-[11px] text-white/40 mt-2 leading-snug">
              {last && last.EV < last.PV
                ? "Earned value sits below planned value — the job is behind its spend plan. "
                : "Earned value is tracking at or above plan. "}
              {last && last.AC > last.EV
                ? "Actual cost is running above earned value, which is an overrun: each dollar spent is buying less than a dollar of budgeted work."
                : "Actual cost is at or below earned value, so spending is efficient against the budget."}
            </p>
          </>
        )}
      </div>

      {/* ── KPI trend ───────────────────────────────────────────────────── */}
      <div className="min-w-0 bg-[#0d1218] border border-white/10 rounded-xl p-4">
        <h3 className="text-sm font-medium text-white/80">Performance indices over time</h3>
        <div className="text-xs text-white/40">
          CPI and SPI by month · 1.0 is exactly on plan
        </div>
        {loading ? (
          <div className="h-56 grid place-items-center text-white/40 text-xs">loading…</div>
        ) : kData.length < 2 ? (
          <div className="h-56 grid place-items-center text-white/45 text-xs">Not enough history in scope yet.</div>
        ) : (
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={kData} margin={{ left: -16, top: 8 }}>
              <CartesianGrid stroke="#1a212b" />
              <XAxis dataKey="m" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis domain={[0.8, 1.2]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 4" />
              <Line type="monotone" dataKey="CPI" stroke={chartColor("cpiLine")} dot={false} strokeWidth={2} />
              <Line type="monotone" dataKey="SPI" stroke={chartColor("spiLine")} dot={false} strokeWidth={2} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, hint }) {
  const def = defOf(label) || hint;
  return (
    <div title={def || undefined} className={def ? "cursor-help" : undefined}>
      <div className={`text-[10px] uppercase tracking-wide text-white/35${def ? " underline decoration-dotted decoration-white/25 underline-offset-2" : ""}`}>{label}</div>
      <div className="text-white/85">{value}</div>
    </div>
  );
}
