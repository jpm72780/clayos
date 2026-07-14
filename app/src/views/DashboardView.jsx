import { useEffect, useRef, useState } from "react";
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import {
  buRollup, evmByProject, fieldByProject, safetyByProject,
  wipByProject, backlogByBu, pipelineByBu, utilizationByBu, kpiHistory,
} from "../lib/api.js";
import { defOf } from "../lib/glossary.js";
import { SkeletonStats, SkeletonCard } from "../components/Skeleton.jsx";

const fmt$ = (n) => (n == null ? "—" : "$" + (Number(n) / 1e6).toFixed(1) + "M");
const fmtPct = (n) => (n == null ? "—" : (Number(n) * 100).toFixed(0) + "%");
const short = (s) => (s || "").replace(/ (Hyperscale|Cloud Campus|Cell Therapy|Logistics Park|Logistics|Mixed-Use|Student Living|Fab|Expansion).*/, "");

function triggerDownload(blob, name) {
  const url = URL.createObjectURL(blob); const a = document.createElement("a");
  a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
}
function downloadCsv(rows, name) {
  if (!rows?.length) return;
  const cols = Object.keys(rows[0]); const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [cols.join(","), ...rows.map((r) => cols.map((c) => esc(r[c])).join(","))];
  triggerDownload(new Blob([lines.join("\n")], { type: "text/csv" }), name);
}
function svgToPng(svg, name) {
  const r = svg.getBoundingClientRect(), w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
  const clone = svg.cloneNode(true); clone.setAttribute("width", w); clone.setAttribute("height", h);
  const xml = new XMLSerializer().serializeToString(clone);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement("canvas"); c.width = w * 2; c.height = h * 2;
    const ctx = c.getContext("2d"); ctx.fillStyle = "#0d1218"; ctx.fillRect(0, 0, c.width, c.height); ctx.scale(2, 2); ctx.drawImage(img, 0, 0);
    c.toBlob((b) => b && triggerDownload(b, name), "image/png");
  };
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);
}

function Card({ title, children, sub, csvRows, name, ask, onAsk }) {
  const bodyRef = useRef(null);
  const exportPng = () => { const svg = bodyRef.current?.querySelector("svg"); if (svg) svgToPng(svg, (name || title) + ".png"); };
  return (
    <div className="min-w-0 bg-[#0d1218] border border-white/10 rounded-xl p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-medium text-white/80">{title}</div>
          {sub && <div className="text-xs text-white/40">{sub}</div>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {onAsk && ask && <button onClick={() => onAsk(ask)} title="Ask Clayco about this chart" className="text-[11px] text-amber-300/70 hover:text-amber-300">✦ ask</button>}
          {csvRows?.length > 0 && <button onClick={() => downloadCsv(csvRows, (name || title) + ".csv")} title="Download data as CSV" className="text-[11px] text-white/35 hover:text-white/80">CSV</button>}
          <button onClick={exportPng} title="Download chart as PNG" className="text-[11px] text-white/35 hover:text-white/80">PNG</button>
        </div>
      </div>
      <div ref={bodyRef} className="mt-2">{children}</div>
    </div>
  );
}
const tip = { contentStyle: { background: "#0d1218", border: "1px solid #1f2733", borderRadius: 8, fontSize: 12 } };

// metric label with a plain-language hover definition when the glossary knows it
function MetricLabel({ children, className = "text-[10px] text-white/45" }) {
  const def = defOf(children);
  return (
    <div title={def || undefined}
      className={`${className}${def ? " cursor-help underline decoration-dotted decoration-white/25 underline-offset-2" : ""}`}>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, warn }) {
  return (
    <div className="bg-[#0d1218] border border-white/10 rounded-lg px-3 py-2">
      <MetricLabel>{label}</MetricLabel>
      <div className={`text-lg font-semibold leading-tight ${warn ? "text-red-400" : "text-white/90"}`}>{value}</div>
      {sub && <div className={`text-[10px] ${warn ? "text-red-400/80" : "text-white/40"}`}>{sub}</div>}
    </div>
  );
}

export default function DashboardView({ businessUnit, bus = [], focus, setFocus, onAsk }) {
  const [rollup, setRollup] = useState([]);
  const [evm, setEvm] = useState([]);
  const [field, setField] = useState([]);
  const [safety, setSafety] = useState([]);
  const [wip, setWip] = useState([]);
  const [backlog, setBacklog] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [util, setUtil] = useState([]);
  const [hist, setHist] = useState({ cpi: [], spi: [], pct_complete: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.allSettled([
      buRollup().then(setRollup), evmByProject().then(setEvm), fieldByProject().then(setField), safetyByProject().then(setSafety),
      wipByProject().then(setWip), backlogByBu().then(setBacklog), pipelineByBu().then(setPipeline), utilizationByBu().then(setUtil),
      Promise.all([kpiHistory("cpi"), kpiHistory("spi"), kpiHistory("pct_complete")]).then(([cpi, spi, pct_complete]) => setHist({ cpi, spi, pct_complete })),
    ]).then(() => setLoading(false));
  }, []);

  const buName = (id) => bus.find((b) => b.id === id)?.name || "—";
  const askScope = focus ? (focus.code || focus.name) : businessUnit ? buName(businessUnit) : "the portfolio";
  const focusBu = focus ? evm.find((p) => p.project_id === focus.pid)?.business_unit_id : null;
  const projF = (arr) => (focus ? arr.filter((p) => p.project_id === focus.pid) : businessUnit ? arr.filter((p) => p.business_unit_id === businessUnit) : arr);
  const buF = (arr) => { const b = businessUnit || focusBu; return b ? arr.filter((x) => x.business_unit_id === b) : arr; };

  const evmF = projF(evm), fieldF = projF(field), safetyF = projF(safety), wipF = projF(wip);
  const backlogF = buF(backlog), pipelineF = buF(pipeline), utilF = buF(util);

  const N = (v) => Number(v || 0);

  // At portfolio scale (200 projects) per-project bars are unreadable — chart the
  // top N by the chart's own signal, always keeping the focused project visible.
  // The value-weighted portfolio stats above stay computed over the FULL set.
  const TOP_N = 14;
  const capped = (arr, signal) => {
    if (arr.length <= TOP_N) return arr;
    const top = [...arr].sort((a, b) => signal(b) - signal(a)).slice(0, TOP_N);
    if (focus && !top.some((p) => p.project_id === focus.pid)) {
      const f = arr.find((p) => p.project_id === focus.pid);
      if (f) top[top.length - 1] = f;
    }
    return top;
  };
  const capNote = (n) => (n > TOP_N ? ` · top ${TOP_N} of ${n}` : "");
  const evmC = capped(evmF, (p) => N(p.bac));
  const cpiData = evmC.map((p) => ({ name: short(p.project_name), CPI: Number(p.cpi), SPI: Number(p.spi) }));
  const budgetData = evmC.map((p) => ({ name: short(p.project_name), BAC: Number(p.bac) / 1e6, EAC: Number(p.eac) / 1e6 }));
  const rfiData = capped(fieldF, (p) => p.open_rfis || 0).map((p) => ({ name: short(p.project_name), Open: p.open_rfis, Total: p.total_rfis }));
  const trirData = capped(safetyF.filter((p) => p.trir != null), (p) => N(p.trir)).map((p) => ({ name: short(p.project_name), TRIR: Number(p.trir) }));
  const wipData = capped(wipF, (p) => Math.abs(N(p.over_under_billing))).map((p) => ({ name: short(p.project_name), v: Number(p.over_under_billing) / 1e6 }));

  // value-weighted portfolio analytics (full set, never the capped chart slices)
  const bac = evmF.reduce((a, p) => a + N(p.bac), 0), eac = evmF.reduce((a, p) => a + N(p.eac), 0);
  const wCpi = evmF.reduce((a, p) => a + N(p.cpi) * N(p.bac), 0) / (bac || 1);
  const wSpi = evmF.reduce((a, p) => a + N(p.spi) * N(p.bac), 0) / (bac || 1);
  const hours = safetyF.reduce((a, p) => a + N(p.hours_worked), 0);
  const wTrir = safetyF.reduce((a, p) => a + N(p.trir) * N(p.hours_worked), 0) / (hours || 1);
  const totalBacklog = backlogF.reduce((a, b) => a + N(b.backlog), 0);
  const totalPipeline = pipelineF.reduce((a, b) => a + N(b.weighted_pipeline_value), 0);
  const port = {
    bac, eac, overrun: eac - bac, overrunPct: bac ? ((eac - bac) / bac) * 100 : 0, wCpi, wSpi,
    overBudget: evmF.filter((p) => N(p.cpi) < 1).length, behind: evmF.filter((p) => N(p.spi) < 1).length,
    openRfis: fieldF.reduce((a, p) => a + (p.open_rfis || 0), 0), wTrir, n: evmF.length,
  };

  // performance trend over time from kpi_history (focus → that project, else portfolio average)
  const histScope = (arr) => (focus ? arr.filter((h) => h.project_id === focus.pid) : businessUnit ? arr.filter((h) => h.business_unit_id === businessUnit) : arr);
  const trendData = (() => {
    const byDate = new Map();
    const add = (arr, key) => { for (const h of histScope(arr)) { const o = byDate.get(h.snapshot_date) || { date: h.snapshot_date }; (o[key] = o[key] || []).push(N(h.value)); byDate.set(h.snapshot_date, o); } };
    add(hist.cpi, "c"); add(hist.spi, "s");
    const avg = (a) => (a && a.length ? +(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3) : null);
    return [...byDate.values()].map((o) => ({ date: (o.date || "").slice(0, 7), CPI: avg(o.c), SPI: avg(o.s) })).sort((a, b) => a.date.localeCompare(b.date));
  })();

  if (loading) {
    return (
      <div className="h-full overflow-auto p-3 md:p-5">
        <SkeletonStats />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 my-5">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} className="h-72" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-3 md:p-5">
      {/* portfolio analytics — calculated, value-weighted */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-medium text-white/80">Portfolio analytics</span>
          <span className="text-white/40 text-xs">· {port.n} project{port.n === 1 ? "" : "s"}, value-weighted</span>
          {focus && <button onClick={() => setFocus?.(null)} className="text-xs rounded px-2 py-0.5 bg-amber-500/15 text-amber-200">{focus.code || focus.name} ✕</button>}
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2">
          <Stat label="Backlog (remaining)" value={fmt$(totalBacklog)} />
          <Stat label="Forecast (EAC)" value={fmt$(port.eac)} sub={`${port.overrun >= 0 ? "+" : ""}${fmt$(port.overrun)} (${port.overrunPct.toFixed(1)}%)`} warn={port.overrun > 0} />
          <Stat label="Weighted CPI" value={port.wCpi.toFixed(3)} warn={port.wCpi < 1} />
          <Stat label="Weighted SPI" value={port.wSpi.toFixed(3)} warn={port.wSpi < 1} />
          <Stat label="Wtd. pipeline" value={fmt$(totalPipeline)} />
          <Stat label="Over budget" value={`${port.overBudget}/${port.n}`} warn={port.overBudget > 0} />
          <Stat label="Open RFIs" value={port.openRfis} />
          <Stat label="Portfolio TRIR" value={port.wTrir.toFixed(2)} warn={port.wTrir > 3} />
        </div>
      </div>

      {/* BU rollup strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {rollup.filter((r) => r.kind !== "enterprise").map((r) => {
          const hasProjects = Number(r.active_projects) > 0 || Number(r.total_contract_value) > 0;
          return (
            <div key={r.business_unit_id} className="bg-[#0d1218] border border-white/10 rounded-xl p-4">
              <div className="text-xs text-white/50">{r.business_unit_name}</div>
              {hasProjects ? (
                <>
                  <div className="text-2xl font-semibold mt-1">{fmt$(r.total_contract_value)}</div>
                  <div className="text-xs text-white/40 mt-1">{r.active_projects} active · CPI {r.cpi ?? "—"} · TRIR {r.trir ?? "—"}</div>
                </>
              ) : (
                <>
                  <div className="text-2xl font-semibold mt-1 text-white/30">—</div>
                  <div className="text-xs text-white/40 mt-1" title="A shared-services / support group — it carries no construction contract value of its own.">Support group · no construction projects</div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {/* backlog · pipeline · utilization by business unit (previously-hidden KPIs) */}
      <div className="mb-5">
        <div className="text-sm font-medium text-white/80 mb-2">Backlog · pipeline · workforce <span className="text-white/40 text-xs">· by business unit</span></div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {backlogF.map((b) => {
            const pl = pipelineF.find((x) => x.business_unit_id === b.business_unit_id) || {};
            const ru = utilF.find((x) => x.business_unit_id === b.business_unit_id) || {};
            return (
              <div key={b.business_unit_id} className="bg-[#0d1218] border border-white/10 rounded-xl p-4">
                <div className="text-sm text-white/80 mb-2">{buName(b.business_unit_id)}</div>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><MetricLabel className="text-[10px] text-white/45 inline-block">Backlog</MetricLabel><div className="text-base font-semibold">{fmt$(b.backlog)}</div></div>
                  <div title={pl.open_pipeline_value == null ? "No open pursuits tracked for this unit" : undefined}>
                    <MetricLabel className="text-[10px] text-white/45 inline-block">Open pipeline</MetricLabel>
                    <div className={`text-base font-semibold ${pl.open_pipeline_value == null ? "text-white/30" : ""}`}>{pl.open_pipeline_value == null ? "no data" : fmt$(pl.open_pipeline_value)}</div>
                  </div>
                  <div title={pl.win_rate == null ? "No closed (won/lost) pursuits yet — win rate needs decision history" : undefined}>
                    <MetricLabel className="text-[10px] text-white/45 inline-block">Win rate</MetricLabel>
                    <div className={`text-base font-semibold ${pl.win_rate == null ? "text-white/30" : ""}`}>{pl.win_rate != null ? fmtPct(pl.win_rate) : "no data"}</div>
                  </div>
                </div>
                <div className="mt-2 pt-2 border-t border-white/5 flex items-center justify-between text-xs text-white/50">
                  <span>{ru.people ?? 0} people · {ru.avg_utilization_pct != null ? Math.round(ru.avg_utilization_pct) + "% util" : "—"}</span>
                  <span>{(ru.unstaffed ?? 0) > 0 && <span className="text-cyan-300/80">{ru.unstaffed} bench</span>}{(ru.overallocated ?? 0) > 0 && <span className="text-red-400/80 ml-2">{ru.overallocated} over</span>}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* performance trend over time (kpi_history) */}
      {trendData.length > 1 && (
        <div className="mb-4">
          <Card title="Performance trend" sub={`CPI / SPI over time · ${focus ? focus.code || focus.name : "portfolio average"}`}
            csvRows={trendData} name="performance-trend" onAsk={onAsk} ask={`Explain the CPI and SPI performance trend over time for ${askScope}. What's driving the direction?`}>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData} margin={{ left: -16 }}>
                <CartesianGrid stroke="#1a212b" />
                <XAxis dataKey="date" tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <YAxis domain={[0.8, 1.2]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
                <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
                <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="CPI" stroke="#22d3ee" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="SPI" stroke="#a3e635" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </div>
      )}

      {/* charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Cost & Schedule Performance" sub={`CPI / SPI by project · 1.0 = on plan (lower = behind/over)${capNote(evmF.length)}`}
          csvRows={cpiData} name="cost-schedule" onAsk={onAsk} ask={`For ${askScope}, which projects are under-performing on cost (CPI) or schedule (SPI), and why?`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={cpiData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" />
              <XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis domain={[0, 1.3]} tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={1} stroke="#64748b" strokeDasharray="4 4" />
              <Bar dataKey="CPI" fill="#22d3ee">{cpiData.map((d, i) => <Cell key={i} fill={d.CPI < 1 ? "#ef4444" : "#22d3ee"} />)}</Bar>
              <Bar dataKey="SPI" fill="#a3e635">{cpiData.map((d, i) => <Cell key={i} fill={d.SPI < 1 ? "#f59e0b" : "#a3e635"} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Budget vs Forecast at Completion" sub={`BAC vs EAC ($M) · EAC > BAC = projected overrun${capNote(evmF.length)}`}
          csvRows={budgetData} name="budget-vs-forecast" onAsk={onAsk} ask={`For ${askScope}, which projects show the biggest forecast overrun (EAC vs BAC) and what's causing it?`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={budgetData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="BAC" fill="#3b82f6" /><Bar dataKey="EAC" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Work-in-Progress — over / under billing" sub={`$M billed vs earned · positive = overbilled, negative = underbilled${capNote(wipF.length)}`}
          csvRows={wipData} name="wip-billing" onAsk={onAsk} ask={`For ${askScope}, which projects are most over- or under-billed (WIP), and what does that imply for cash?`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={wipData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><ReferenceLine y={0} stroke="#64748b" />
              <Bar dataKey="v" name="over/under ($M)">{wipData.map((d, i) => <Cell key={i} fill={d.v >= 0 ? "#f59e0b" : "#22d3ee"} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Open RFIs" sub={`Open vs total RFIs by project${capNote(fieldF.length)}`}
          csvRows={rfiData} name="open-rfis" onAsk={onAsk} ask={`For ${askScope}, which projects have the most open RFIs and what's the average turnaround?`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rfiData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Total" fill="#334155" /><Bar dataKey="Open" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Safety — TRIR" sub={`Total Recordable Incident Rate (per 200k hours)${capNote(safetyF.length)}`}
          csvRows={trirData} name="safety-trir" onAsk={onAsk} ask={`For ${askScope}, which projects have the worst safety record (TRIR vs the industry average) and why?`}>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={trirData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><ReferenceLine y={3.0} stroke="#64748b" strokeDasharray="4 4" label={{ value: "industry avg", fill: "#64748b", fontSize: 10 }} />
              <Bar dataKey="TRIR" fill="#dc2626" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
    </div>
  );
}
