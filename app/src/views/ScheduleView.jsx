import { useEffect, useMemo, useRef, useState } from "react";
import {
  projectSchedule, scheduleActivities, scheduleDependencies, projectPhases,
  listBusinessUnits, evmByProject,
} from "../lib/api.js";
import { BU_PALETTE, chartColor, STAGE_COLOR, STAGE_ORDER, healthColor, scheduleColor } from "../lib/palette.js";
import { fmtMoney as fmt$, fmtDay, fmtDuration } from "../lib/format.js";
import { parseDay, today, dataExtent, resolveRange, deriveActivityStatus, dayDiff } from "../lib/time.js";
import { defOf } from "../lib/glossary.js";
import { TimeAxis, NowLine, useTimeZoom } from "../components/TimeAxis.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// ClayOS — Schedule (Gantt).
//
// Two levels driven by the shared project focus:
//   portfolio → one bar per project (all 200, from projects.start_date/end_date)
//   project   → its activities, with baseline, progress, float, milestones and
//               finish-to-start logic.
//
// Honesty rules baked in, because a project-controls audience checks these first:
//   * actual dates are only drawn when they don't contradict pct_complete or sit
//     in the future (deriveActivityStatus); anything suppressed is COUNTED, not
//     silently dropped.
//   * a planned finish in the past with no actual finish is flagged amber and
//     labelled as such — never coloured as if it were measured lateness.
// ─────────────────────────────────────────────────────────────────────────────

const ROW_H = 24;
const ROW_H_COARSE = 32;
const NAME_W = 240;
const NAME_W_SM = 132;
const HEADER_H = 34;
const num = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

export default function ScheduleView({ businessUnit, focus, setFocus, range, setRange }) {
  const wrapRef = useRef(null), svgRef = useRef(null), scrollRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [projects, setProjects] = useState([]);
  const [acts, setActs] = useState([]);
  const [deps, setDeps] = useState([]);
  const [phases, setPhases] = useState([]);
  const [bus, setBus] = useState([]);
  const [evm, setEvm] = useState([]);
  const [err, setErr] = useState(null);
  const [groupBy, setGroupBy] = useState("none");
  const [sortBy, setSortBy] = useState("start");
  const [colorBy, setColorBy] = useState("bu");
  const [showLogic, setShowLogic] = useState(true);
  const [showFloat, setShowFloat] = useState(true);
  const [scrollTop, setScrollTop] = useState(0);
  const [expanded, setExpanded] = useState(() => new Set());
  const [hover, setHover] = useState(null);
  const [qualityOpen, setQualityOpen] = useState(false);

  const isCoarse = typeof window !== "undefined" && window.matchMedia?.("(pointer: coarse)").matches;
  const rowH = isCoarse ? ROW_H_COARSE : ROW_H;
  const nameW = dims.w < 640 ? NAME_W_SM : NAME_W;
  const now = today();

  useEffect(() => {
    projectSchedule().then(setProjects).catch((e) => setErr(e?.message || "projects failed to load"));
    scheduleActivities().then(setActs).catch((e) => setErr(e?.message || "schedule failed to load"));
    scheduleDependencies().then(setDeps).catch(() => setDeps([]));
    projectPhases().then(setPhases).catch(() => setPhases([]));
    listBusinessUnits().then(setBus);
    evmByProject().then(setEvm).catch(() => setEvm([]));
  }, []);

  useEffect(() => {
    const el = wrapRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // ── derived lookups ────────────────────────────────────────────────────────
  const buIds = useMemo(() => [...new Set(projects.map((p) => p.business_unit_id))].sort(), [projects]);
  const buColor = (id) => BU_PALETTE[Math.max(0, buIds.indexOf(id)) % BU_PALETTE.length];
  const buName = useMemo(() => new Map(bus.map((b) => [b.id, b.name])), [bus]);
  const evmByName = useMemo(() => new Map(evm.map((r) => [r.project_name, r])), [evm]);
  const actsByProject = useMemo(() => {
    const m = new Map();
    for (const a of acts) { if (!m.has(a.project_id)) m.set(a.project_id, []); m.get(a.project_id).push(a); }
    return m;
  }, [acts]);
  const detailPids = useMemo(
    () => new Set(acts.filter((a) => !a.is_summary).map((a) => a.project_id)), [acts]);

  // Suppressed-actuals tally — surfaced rather than swallowed.
  const quality = useMemo(() => {
    const counts = {};
    for (const a of acts) for (const f of deriveActivityStatus(a, now).flags) counts[f] = (counts[f] || 0) + 1;
    return counts;
  }, [acts, now]);

  const inScope = (p) => !businessUnit || p.business_unit_id === businessUnit;
  const scoped = useMemo(() => projects.filter(inScope), [projects, businessUnit]); // eslint-disable-line

  // ── time domain ────────────────────────────────────────────────────────────
  const extent = useMemo(
    () => dataExtent(scoped, (p) => parseDay(p.start_date), (p) => parseDay(p.end_date)),
    [scoped]);
  const domain = useMemo(() => {
    const r = range?.from && range?.to
      ? { from: parseDay(range.from), to: parseDay(range.to) }
      : resolveRange(range?.preset || "portfolio", extent);
    return [r.from || extent[0] || new Date(2024, 0, 1), r.to || extent[1] || new Date(2029, 0, 1)];
  }, [range, extent]);

  const plotW = Math.max(120, dims.w - nameW - 16);
  const { scale, zoomBy, reset } = useTimeZoom(svgRef, domain, plotW);

  // ── row model ──────────────────────────────────────────────────────────────
  const rows = useMemo(() => {
    const out = [];
    const sorters = {
      start: (a, b) => (a.start_date || "").localeCompare(b.start_date || ""),
      finish: (a, b) => (a.end_date || "").localeCompare(b.end_date || ""),
      value: (a, b) => (num(b.contract_value) || 0) - (num(a.contract_value) || 0),
      name: (a, b) => (a.name || "").localeCompare(b.name || ""),
    };
    const list = [...scoped].sort(sorters[sortBy] || sorters.start);
    const groupKey = (p) => groupBy === "bu" ? (buName.get(p.business_unit_id) || "—")
      : groupBy === "stage" ? (p.lifecycle_stage || "—")
      : groupBy === "sector" ? (p.sector || "—") : null;

    const push = (p) => {
      const e = evmByName.get(p.name);
      out.push({
        kind: "project", id: p.id, p, label: p.name, sub: p.code,
        t0: parseDay(p.start_date), t1: parseDay(p.end_date),
        pct: num(e?.pct_complete) != null ? num(e.pct_complete) * 100 : null,
        cpi: num(e?.cpi), spi: num(e?.spi),
        hasDetail: detailPids.has(p.id),
        overdue: parseDay(p.end_date) && parseDay(p.end_date) < now && !p.actual_finish,
      });
      if (expanded.has(p.id)) {
        for (const a of (actsByProject.get(p.id) || [])) {
          const st = deriveActivityStatus(a, now);
          if (!st.plannedStart || !st.plannedFinish) continue;
          out.push({ kind: "activity", id: a.id, a, st, pid: p.id,
            label: a.name, sub: a.activity_code,
            t0: st.plannedStart, t1: st.plannedFinish });
        }
      }
    };

    if (groupBy === "none") { list.forEach(push); return out; }
    const groups = new Map();
    for (const p of list) { const k = groupKey(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
    for (const [k, ps] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      const t0 = ps.map((p) => parseDay(p.start_date)).filter(Boolean).sort((a, b) => a - b)[0];
      const t1 = ps.map((p) => parseDay(p.end_date)).filter(Boolean).sort((a, b) => b - a)[0];
      out.push({ kind: "group", id: `g:${k}`, label: k, sub: `${ps.length} projects`, t0, t1,
        value: ps.reduce((s, p) => s + (num(p.contract_value) || 0), 0) });
      ps.forEach(push);
    }
    return out;
  }, [scoped, sortBy, groupBy, expanded, actsByProject, evmByName, buName, detailPids, now]);

  // windowed rendering — 200 projects fully expanded is ~1,300 rows
  const viewH = Math.max(120, dims.h - 8);
  const first = Math.max(0, Math.floor(scrollTop / rowH) - 6);
  const last = Math.min(rows.length, Math.ceil((scrollTop + viewH) / rowH) + 6);
  const visible = rows.slice(first, last);
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);

  const barColor = (r) => {
    if (r.kind === "group") return "#475569";
    if (colorBy === "stage") return STAGE_COLOR[r.p?.lifecycle_stage] || "#94a3b8";
    if (colorBy === "health") return healthColor(r.cpi);
    if (colorBy === "schedule") return scheduleColor(r.spi);
    return buColor(r.p?.business_unit_id);
  };

  const toggle = (pid) => setExpanded((s) => { const n = new Set(s); n.has(pid) ? n.delete(pid) : n.add(pid); return n; });

  // Focus from elsewhere (map/agent/data) auto-expands that project.
  useEffect(() => {
    if (!focus?.pid) return;
    setExpanded((s) => (s.has(focus.pid) ? s : new Set([...s, focus.pid])));
  }, [focus?.pid]);

  if (err) return <div className="h-full grid place-items-center text-red-300/90 text-sm px-6 text-center">⚠ Schedule failed to load — {err}</div>;

  const loading = !projects.length;
  const totalH = rows.length * rowH + HEADER_H + 12;
  const asOf = null; // history mode derives this; the Gantt shows today only

  return (
    <div className="h-full flex flex-col bg-[#0a0f14] select-none">
      {/* Control bar — a real header, not floating cards: the Gantt is a dense
          row list, so overlays would sit on top of the first projects. */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-white/10 bg-[#0d1218] text-xs">
        <span className="text-white/70">
          <span className="text-white font-medium">{scoped.length}</span> projects ·{" "}
          <span className="text-white font-medium">{fmt$(scoped.reduce((s, p) => s + (num(p.contract_value) || 0), 0))}</span>
        </span>
        <span className="text-white/35 text-[10px] max-md:hidden">
          activity detail: {detailPids.size} of {projects.length} · {acts.length.toLocaleString()} bars
        </span>
        <Picker label="Color" value={colorBy} onChange={setColorBy}
          opts={[["bu", "Business unit"], ["stage", "Stage"], ["health", "Cost health"], ["schedule", "Schedule health"]]} />
        <Picker label="Group" value={groupBy} onChange={setGroupBy}
          opts={[["none", "None"], ["bu", "Business unit"], ["stage", "Stage"], ["sector", "Sector"]]} />
        <Picker label="Sort" value={sortBy} onChange={setSortBy}
          opts={[["start", "Start"], ["finish", "Finish"], ["value", "Value"], ["name", "Name"]]} />
        {Object.keys(quality).length > 0 && (
          <button onClick={() => setQualityOpen((v) => !v)}
            className="ml-auto text-[11px] px-2 py-1 rounded border border-amber-500/25 bg-amber-500/10 text-amber-200/85 hover:text-amber-100">
            ⚠ {Object.values(quality).reduce((a, b) => a + b, 0)} data notes {qualityOpen ? "▾" : "▸"}
          </button>
        )}
      </div>
      {qualityOpen && (
        <div className="shrink-0 px-3 py-2 border-b border-white/10 bg-[#0d1218]/95 text-[11px] text-white/65 leading-snug">
          {Object.entries(quality).map(([k, n]) => (
            <div key={k} className="flex gap-2"><span className="text-amber-300/80 tabular-nums">{n}</span><span>{QUALITY_COPY[k] || k}</span></div>
          ))}
          <div className="text-white/35 mt-1">Affected dates are excluded from the drawing rather than shown as fact.</div>
        </div>
      )}

    <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden">
      {loading && <div className="absolute inset-0 grid place-items-center text-white/50 text-sm z-10">loading schedule…</div>}

      <div ref={scrollRef} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="h-full overflow-y-auto overflow-x-hidden" style={{ paddingBottom: 96 }}>
        <div style={{ height: totalH, position: "relative" }}>
          {/* name rail */}
          <div className="absolute left-0 top-0 z-10" style={{ width: nameW }}>
            <div style={{ height: HEADER_H }} className="bg-[#0b1016] border-b border-white/10" />
            {visible.map((r, i) => {
              const y = HEADER_H + (first + i) * rowH;
              const isFocus = focus?.pid && r.id === focus.pid;
              return (
                <div key={r.id} style={{ position: "absolute", top: y, height: rowH, width: nameW }}
                  className={`flex items-center gap-1 pr-2 text-[11px] truncate border-b border-white/[0.04]
                    ${r.kind === "group" ? "font-medium text-white/70 bg-white/[0.03]" : ""}
                    ${r.kind === "activity" ? "pl-6 text-white/55" : "pl-2"}
                    ${isFocus ? "bg-amber-500/10" : ""}`}>
                  {r.kind === "project" && (
                    r.hasDetail
                      ? <button onClick={() => toggle(r.id)} aria-label={`${expanded.has(r.id) ? "Collapse" : "Expand"} ${r.label}`}
                          className="w-4 shrink-0 text-white/40 hover:text-white">{expanded.has(r.id) ? "▾" : "▸"}</button>
                      : <span className="w-4 shrink-0 text-white/15 text-center" title="Summary-level schedule only — no activity detail for this project">·</span>
                  )}
                  <span className={`truncate ${r.kind === "project" ? "text-white/80 cursor-pointer" : ""}`}
                    onClick={r.kind === "project" ? () => setFocus({ pid: r.id, name: r.p.name, code: r.p.code }) : undefined}
                    title={r.label}>{r.label}</span>
                  {r.sub && <span className="ml-auto text-white/25 shrink-0">{r.sub}</span>}
                </div>
              );
            })}
          </div>

          {/* timeline surface */}
          <svg ref={svgRef} width={plotW} height={totalH} className="block cursor-grab active:cursor-grabbing"
            style={{ position: "absolute", left: nameW }} role="img"
            aria-label="Project schedule timeline" data-total-rows={rows.length}>
            <defs>
              <marker id="dep-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto">
                <path d="M0,1 L7,4 L0,7 z" fill={chartColor("depLink")} />
              </marker>
              <pattern id="float-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="5" stroke={chartColor("float")} strokeWidth="1.4" opacity="0.55" />
              </pattern>
            </defs>

            <TimeAxis scale={scale} width={plotW} height={totalH} headerH={HEADER_H} />

            {/* dependency logic (expanded projects only) */}
            {showLogic && deps.map((d) => {
              const pi = rowIndex.get(d.predecessor_id), si = rowIndex.get(d.successor_id);
              if (pi == null || si == null) return null;
              const pr = rows[pi], sr = rows[si];
              if (!pr.t1 || !sr.t0) return null;
              const x1 = scale(pr.t1), x2 = scale(sr.t0);
              const y1 = HEADER_H + pi * rowH + rowH / 2, y2 = HEADER_H + si * rowH + rowH / 2;
              const mx = Math.max(x1 + 6, x2 - 8);
              return (
                <path key={d.id} data-kind="dep"
                  d={`M${x1},${y1} H${mx} V${y2} H${x2 - 2}`} fill="none"
                  stroke={chartColor("depLink")} strokeWidth="1" opacity="0.8"
                  strokeDasharray={d.lag_days > 0 ? "3 3" : undefined}
                  markerEnd="url(#dep-arrow)" vectorEffect="non-scaling-stroke" />
              );
            })}

            {/* bars */}
            {visible.map((r, i) => {
              const idx = first + i;
              const y = HEADER_H + idx * rowH;
              const bh = Math.min(12, rowH - 10);
              if (!r.t0 || !r.t1) return null;
              const x0 = scale(r.t0), x1 = Math.max(scale(r.t1), x0 + 2);
              const w = x1 - x0;
              const color = barColor(r);

              if (r.kind === "group") {
                return (
                  <g key={r.id}>
                    <rect x={x0} y={y + rowH / 2 - 2} width={w} height="4" fill="#475569" opacity="0.6" rx="2" />
                    <text x={x1 + 6} y={y + rowH / 2 + 3} fill="#64748b" fontSize="9.5">{fmt$(r.value)}</text>
                  </g>
                );
              }

              if (r.kind === "activity") {
                const { st, a } = r;
                const isMilestone = a.activity_kind === "milestone";
                const cy = y + rowH / 2;
                if (isMilestone) {
                  const s = 5;
                  return (
                    <g key={r.id} data-kind="milestone"
                      onMouseEnter={(e) => setHover({ r, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)}>
                      <path d={`M${x0},${cy - s} L${x0 + s},${cy} L${x0},${cy + s} L${x0 - s},${cy} Z`}
                        fill={st.pct >= 100 ? chartColor("progress") : "none"}
                        stroke={chartColor("now")} strokeWidth="1.3" />
                    </g>
                  );
                }
                const floatW = showFloat && a.total_float_days > 0
                  ? scale(new Date(r.t1.getTime() + a.total_float_days * 86400000)) - x1 : 0;
                return (
                  <g key={r.id} data-kind="activity"
                    onMouseEnter={(e) => setHover({ r, x: e.clientX, y: e.clientY })}
                    onMouseLeave={() => setHover(null)}>
                    {floatW > 1 && (
                      <rect data-kind="float" x={x1} y={y + rowH / 2 - bh / 2} width={floatW} height={bh}
                        fill="url(#float-hatch)" opacity="0.5" rx="1" />
                    )}
                    <rect x={x0} y={y + rowH / 2 - bh / 2} width={w} height={bh}
                      fill={chartColor("baseline")} rx="2"
                      stroke={a.is_critical ? chartColor("critical") : "none"} strokeWidth={a.is_critical ? 1.4 : 0} />
                    {st.pct > 0 && (
                      <rect x={x0} y={y + rowH / 2 - bh / 2 + 2} width={Math.max(1, (w * Math.min(100, st.pct)) / 100)}
                        height={bh - 4} fill={a.is_critical ? chartColor("critical") : chartColor("progress")} rx="1" />
                    )}
                    {/* Actual track under the baseline. An in-progress bar runs to
                        the data date — that's the convention, and it's how a slipping
                        activity shows itself against its baseline. */}
                    {st.actualStart && (
                      <rect data-kind="actual" x={scale(st.actualStart)}
                        y={y + rowH / 2 + bh / 2 + 1}
                        width={Math.max(2, (st.actualFinish ? scale(st.actualFinish) : scale(now)) - scale(st.actualStart))}
                        height="2" fill={chartColor("actual")} opacity="0.55" rx="1" />
                    )}
                  </g>
                );
              }

              // project row
              return (
                <g key={r.id} data-kind="project" className="cursor-pointer"
                  onClick={() => setFocus({ pid: r.id, name: r.p.name, code: r.p.code })}
                  onMouseEnter={(e) => setHover({ r, x: e.clientX, y: e.clientY })}
                  onMouseLeave={() => setHover(null)}>
                  <rect x={x0} y={y + rowH / 2 - bh / 2} width={w} height={bh} fill={color} opacity="0.34" rx="3" />
                  {r.pct != null && (
                    <rect x={x0} y={y + rowH / 2 - bh / 2 + 2} width={Math.max(1, (w * Math.min(100, r.pct)) / 100)}
                      height={bh - 4} fill={color} rx="2" />
                  )}
                  {r.overdue && (
                    <path data-kind="overdue" d={`M${x1},${y + rowH / 2 - 5} L${x1 + 5},${y + rowH / 2} L${x1},${y + rowH / 2 + 5} L${x1 - 5},${y + rowH / 2} Z`}
                      fill="none" stroke="#f59e0b" strokeWidth="1.3" />
                  )}
                </g>
              );
            })}

            <NowLine scale={scale} height={totalH} now={now} asOf={asOf} headerH={HEADER_H} />
          </svg>
        </div>
      </div>

      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
        {[["+", () => zoomBy(1.6), "Zoom in"], ["−", () => zoomBy(1 / 1.6), "Zoom out"], ["⌂", reset, "Fit to range"]].map(([t, fn, lbl]) => (
          <button key={lbl} onClick={fn} aria-label={lbl} title={lbl}
            className="w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center rounded-md bg-[#0d1218]/85 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-white/10 text-sm shadow-lg">{t}</button>
        ))}
        <button onClick={() => setShowLogic((v) => !v)} title="Show finish-to-start logic"
          className={`w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center rounded-md bg-[#0d1218]/85 backdrop-blur border border-white/10 text-xs shadow-lg ${showLogic ? "text-cyan-300" : "text-white/40"}`}>⇉</button>
        <button onClick={() => setShowFloat((v) => !v)} title="Show total float"
          className={`w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center rounded-md bg-[#0d1218]/85 backdrop-blur border border-white/10 text-xs shadow-lg ${showFloat ? "text-cyan-300" : "text-white/40"}`}>▤</button>
      </div>

      {hover && <Tip r={hover.r} x={hover.x} y={hover.y} wrap={wrapRef} buName={buName} now={now} />}
    </div>
    </div>
  );
}

const QUALITY_COPY = {
  "future-actual-start": "activities carry an actual start in the future — not drawn as started",
  "future-actual-finish": "activities carry an actual finish in the future — not drawn as complete",
  "started-but-zero-pct": "activities have an actual start but 0% progress",
  "finished-but-incomplete": "activities have an actual finish but are under 100%",
  "complete-without-actual-finish": "activities are 100% complete with no actual finish recorded",
  "past-planned-finish": "activities are past their planned finish and not complete",
};

function Picker({ label, value, onChange, opts }) {
  return (
    <label className="flex items-center gap-1 text-white/45">
      <span className="text-[10px] uppercase tracking-wide">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}
        className="bg-white/5 border border-white/10 rounded px-1.5 py-1 max-md:py-2 text-[11px] text-white/80 outline-none">
        {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </label>
  );
}

function Tip({ r, x, y, wrap, buName, now }) {
  const rect = wrap.current?.getBoundingClientRect();
  if (!rect) return null;
  const left = Math.min(x - rect.left + 14, Math.max(0, rect.width - 300));
  const top = Math.max(8, y - rect.top - 10);
  const days = r.t0 && r.t1 ? dayDiff(r.t0, r.t1) : null;
  return (
    <div className="absolute z-30 pointer-events-none bg-[#0d1218]/95 border border-white/15 rounded-lg px-3 py-2 text-[11px] shadow-2xl max-w-[290px]"
      style={{ left, top }}>
      <div className="text-white font-medium leading-snug">{r.label}</div>
      {r.kind === "project" && (
        <div className="text-white/50">{r.sub} · {buName.get(r.p.business_unit_id) || ""} · {r.p.lifecycle_stage}</div>
      )}
      <div className="text-white/60 mt-1">{fmtDay(r.t0)} → {fmtDay(r.t1)}{days != null ? ` · ${fmtDuration(days)}` : ""}</div>
      {r.kind === "project" && r.pct != null && <div className="text-white/60">{Math.round(r.pct)}% complete</div>}
      {r.kind === "activity" && (
        <>
          <div className="text-white/60">{r.st.pct}% complete · {r.st.status.replace("_", " ")}</div>
          {r.a.is_critical && <div className="text-red-300/90" title={defOf("Critical path") || undefined}>on the critical path</div>}
          {r.a.total_float_days > 0 && <div className="text-white/50">{r.a.total_float_days} days total float</div>}
          {r.st.flags.includes("future-actual-start") && <div className="text-amber-300/80 mt-1">source row has a future actual start — not drawn</div>}
        </>
      )}
      {r.overdue && <div className="text-amber-300/90 mt-1">planned finish passed {fmtDuration(dayDiff(r.t1, now))} ago — no actual finish recorded</div>}
    </div>
  );
}
