import { useEffect, useState } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
  ReferenceLine, CartesianGrid, Legend,
} from "recharts";
import {
  buRollup, evmByProject, fieldByProject, safetyByProject,
  wipByProject, backlogByBu, pipelineByBu, utilizationByBu,
} from "../lib/api.js";

const fmt$ = (n) => (n == null ? "—" : "$" + (Number(n) / 1e6).toFixed(1) + "M");
const fmtPct = (n) => (n == null ? "—" : (Number(n) * 100).toFixed(0) + "%");
const short = (s) => (s || "").replace(/ (Hyperscale|Cloud Campus|Cell Therapy|Logistics Park|Logistics|Mixed-Use|Student Living|Fab|Expansion).*/, "");

function Card({ title, children, sub }) {
  return (
    <div className="min-w-0 bg-[#0d1218] border border-white/10 rounded-xl p-4">
      <div className="text-sm font-medium text-white/80">{title}</div>
      {sub && <div className="text-xs text-white/40 mb-2">{sub}</div>}
      <div className="mt-2">{children}</div>
    </div>
  );
}
const tip = { contentStyle: { background: "#0d1218", border: "1px solid #1f2733", borderRadius: 8, fontSize: 12 } };

function Stat({ label, value, sub, warn }) {
  return (
    <div className="bg-[#0d1218] border border-white/10 rounded-lg px-3 py-2">
      <div className="text-[10px] text-white/45">{label}</div>
      <div className={`text-lg font-semibold leading-tight ${warn ? "text-red-400" : "text-white/90"}`}>{value}</div>
      {sub && <div className={`text-[10px] ${warn ? "text-red-400/80" : "text-white/40"}`}>{sub}</div>}
    </div>
  );
}

export default function DashboardView({ businessUnit, bus = [], focus, setFocus }) {
  const [rollup, setRollup] = useState([]);
  const [evm, setEvm] = useState([]);
  const [field, setField] = useState([]);
  const [safety, setSafety] = useState([]);
  const [wip, setWip] = useState([]);
  const [backlog, setBacklog] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [util, setUtil] = useState([]);

  useEffect(() => {
    buRollup().then(setRollup); evmByProject().then(setEvm); fieldByProject().then(setField); safetyByProject().then(setSafety);
    wipByProject().then(setWip); backlogByBu().then(setBacklog); pipelineByBu().then(setPipeline); utilizationByBu().then(setUtil);
  }, []);

  const buName = (id) => bus.find((b) => b.id === id)?.name || "—";
  const focusBu = focus ? evm.find((p) => p.project_id === focus.pid)?.business_unit_id : null;
  const projF = (arr) => (focus ? arr.filter((p) => p.project_id === focus.pid) : businessUnit ? arr.filter((p) => p.business_unit_id === businessUnit) : arr);
  const buF = (arr) => { const b = businessUnit || focusBu; return b ? arr.filter((x) => x.business_unit_id === b) : arr; };

  const evmF = projF(evm), fieldF = projF(field), safetyF = projF(safety), wipF = projF(wip);
  const backlogF = buF(backlog), pipelineF = buF(pipeline), utilF = buF(util);

  const cpiData = evmF.map((p) => ({ name: short(p.project_name), CPI: Number(p.cpi), SPI: Number(p.spi) }));
  const budgetData = evmF.map((p) => ({ name: short(p.project_name), BAC: Number(p.bac) / 1e6, EAC: Number(p.eac) / 1e6 }));
  const rfiData = fieldF.map((p) => ({ name: short(p.project_name), Open: p.open_rfis, Total: p.total_rfis }));
  const trirData = safetyF.map((p) => ({ name: short(p.project_name), TRIR: Number(p.trir) }));
  const wipData = wipF.map((p) => ({ name: short(p.project_name), v: Number(p.over_under_billing) / 1e6 }));

  // value-weighted portfolio analytics
  const N = (v) => Number(v || 0);
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

  return (
    <div className="h-full overflow-auto p-5">
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
        {rollup.filter((r) => r.kind !== "enterprise").map((r) => (
          <div key={r.business_unit_id} className="bg-[#0d1218] border border-white/10 rounded-xl p-4">
            <div className="text-xs text-white/50">{r.business_unit_name}</div>
            <div className="text-2xl font-semibold mt-1">{fmt$(r.total_contract_value)}</div>
            <div className="text-xs text-white/40 mt-1">{r.active_projects} active · CPI {r.cpi ?? "—"} · TRIR {r.trir ?? "—"}</div>
          </div>
        ))}
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
                  <div><div className="text-[10px] text-white/45">Backlog</div><div className="text-base font-semibold">{fmt$(b.backlog)}</div></div>
                  <div><div className="text-[10px] text-white/45">Open pipeline</div><div className="text-base font-semibold">{fmt$(pl.open_pipeline_value)}</div></div>
                  <div><div className="text-[10px] text-white/45">Win rate</div><div className="text-base font-semibold">{pl.win_rate != null ? fmtPct(pl.win_rate) : "—"}</div></div>
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

      {/* charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title="Cost & Schedule Performance" sub="CPI / SPI by project · 1.0 = on plan (lower = behind/over)">
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

        <Card title="Budget vs Forecast at Completion" sub="BAC vs EAC ($M) · EAC > BAC = projected overrun">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={budgetData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="BAC" fill="#3b82f6" /><Bar dataKey="EAC" fill="#f59e0b" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Work-in-Progress — over / under billing" sub="$M billed vs earned · positive = overbilled, negative = underbilled">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={wipData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><ReferenceLine y={0} stroke="#64748b" />
              <Bar dataKey="v" name="over/under ($M)">{wipData.map((d, i) => <Cell key={i} fill={d.v >= 0 ? "#f59e0b" : "#22d3ee"} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Open RFIs" sub="Open vs total RFIs by project">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={rfiData} margin={{ left: -16 }}>
              <CartesianGrid stroke="#1a212b" /><XAxis dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} /><YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <Tooltip {...tip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Total" fill="#334155" /><Bar dataKey="Open" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="Safety — TRIR" sub="Total Recordable Incident Rate (per 200k hours)">
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
