import { useEffect, useMemo, useRef, useState } from "react";
import { geoMercator, geoPath } from "d3-geo";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition"; // side-effect: selection.transition() for animated zoom
import { feature, mesh } from "topojson-client";
import worldUrl from "world-atlas/countries-110m.json?url";
import statesUrl from "us-atlas/states-10m.json?url";
import { projectsGeo, listBusinessUnits, evmByProject, fieldByProject, safetyByProject } from "../lib/api.js";
import { coordsFor } from "../lib/geo.js";
import { BU_PALETTE, chartColor, STAGE_COLOR, STAGE_ORDER, healthColor } from "../lib/palette.js";
import { fmtMoney as fmt$ } from "../lib/format.js";
import { defOf } from "../lib/glossary.js";

// ─────────────────────────────────────────────────────────────────────────────
// ClayOS — portfolio map. Every project as a glowing dot on a real US/world
// basemap (TopoJSON, fully self-contained — no tile servers). Same-city projects
// fan out in a phyllotaxis cluster that stays readable at any zoom (offsets are
// screen-space). Selection drives everything, same as 3D: click a dot → the
// shared focus + the Ask agent rescope to it; an agent-driven focus flies here.
// ─────────────────────────────────────────────────────────────────────────────

// Basemap TopoJSON is fetched once per page load (two ~110 KB cached assets).
let basemapPromise = null;
const loadBasemap = () => (basemapPromise ??= Promise.all([
  fetch(worldUrl).then((r) => r.json()),
  fetch(statesUrl).then((r) => r.json()),
]).then(([w, us]) => ({
  land: feature(w, w.objects.land),
  countryBorders: mesh(w, w.objects.countries, (a, b) => a !== b),
  nation: feature(us, us.objects.nation),
  stateBorders: mesh(us, us.objects.states, (a, b) => a !== b),
})));

// Frame the lower 48 by default (all seed cities are CONUS); zoom out for world.
const CONUS = { type: "MultiPoint", coordinates: [[-125, 49.8], [-66.9, 49.8], [-66.9, 24.2], [-125, 24.2]] };
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
// screen-space fan-out inside a city cluster: biggest project sits center
const clusterOffset = (i) => i === 0 ? [0, 0]
  : [9.5 * Math.sqrt(i) * Math.cos(i * GOLDEN), 9.5 * Math.sqrt(i) * Math.sin(i * GOLDEN)];
const dotR = (v) => Math.min(11, 3 + Math.sqrt((v || 0) / 1e6) * 0.28);

// STAGE_COLOR / STAGE_ORDER / healthColor moved to lib/palette.js — the Gantt
// needs the same scales and they must not drift apart.
const REDUCED = () => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } };

export default function MapView({ businessUnit, focus, setFocus }) {
  const wrapRef = useRef(null), svgRef = useRef(null);
  const zoomRef = useRef(null);      // d3-zoom behavior
  const tRef = useRef(zoomIdentity); // live transform (rAF-coalesced into state)
  const rafRef = useRef(0);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [t, setT] = useState({ x: 0, y: 0, k: 1 });
  const [world, setWorld] = useState(null);
  const [projects, setProjects] = useState([]);
  const [bus, setBus] = useState([]);
  const [evm, setEvm] = useState([]); const [field, setField] = useState([]); const [safety, setSafety] = useState([]);
  const [colorMode, setColorMode] = useState("bu"); // 'bu' | 'stage' | 'health'
  // phones: the legend covers too much map — start collapsed under 768px
  const [legendOpen, setLegendOpen] = useState(() => { try { return window.innerWidth >= 768; } catch { return true; } });
  const [hov, setHov] = useState(null); // { p, x, y }
  const [err, setErr] = useState(null);

  useEffect(() => {
    loadBasemap().then(setWorld).catch((e) => setErr(e?.message || "basemap failed to load"));
    projectsGeo().then(setProjects).catch((e) => setErr(e?.message || "projects failed to load"));
    listBusinessUnits().then(setBus);
    evmByProject().then(setEvm); fieldByProject().then(setField); safetyByProject().then(setSafety);
  }, []);

  // container size (drawers/rotation resize the canvas — same pattern as 3D/Sigma)
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const projection = useMemo(() => {
    if (!dims.w || !dims.h) return null;
    return geoMercator().fitExtent([[28, 28], [dims.w - 28, dims.h - 28]], CONUS);
  }, [dims]);
  const path = useMemo(() => (projection ? geoPath(projection) : null), [projection]);
  const shapes = useMemo(() => (world && path ? {
    land: path(world.land), countryBorders: path(world.countryBorders),
    nation: path(world.nation), stateBorders: path(world.stateBorders),
  } : null), [world, path]);

  // group projects by city; biggest first so it anchors the cluster center
  const cities = useMemo(() => {
    if (!projection) return [];
    const m = new Map();
    for (const p of projects) {
      const key = `${p.city}, ${p.state}`;
      let c = m.get(key);
      if (!c) { c = { key, city: p.city, state: p.state, items: [], total: 0 }; m.set(key, c); }
      c.items.push(p); c.total += p.contract_value || 0;
    }
    for (const c of m.values()) {
      c.items.sort((a, b) => (b.contract_value || 0) - (a.contract_value || 0));
      c.xy = projection(coordsFor(c.city, c.state));
    }
    return [...m.values()].sort((a, b) => b.total - a.total);
  }, [projects, projection]);

  const buIds = useMemo(() => [...new Set(projects.map((p) => p.business_unit_id))].sort(), [projects]);
  const buName = useMemo(() => new Map(bus.map((b) => [b.id, b.name])), [bus]);
  const buColor = (id) => BU_PALETTE[buIds.indexOf(id) % BU_PALETTE.length];
  const evmByName = useMemo(() => new Map(evm.map((r) => [r.project_name, r])), [evm]);
  const dotColor = (p) => colorMode === "stage" ? (STAGE_COLOR[p.lifecycle_stage] || "#94a3b8")
    : colorMode === "health" ? healthColor(num(evmByName.get(p.name)?.cpi))
    : buColor(p.business_unit_id);

  const inScope = (p) => !businessUnit || p.business_unit_id === businessUnit;
  const scoped = useMemo(() => projects.filter(inScope), [projects, businessUnit]); // eslint-disable-line
  const scopedTotal = useMemo(() => scoped.reduce((a, p) => a + (p.contract_value || 0), 0), [scoped]);
  const scopedCities = useMemo(() => new Set(scoped.map((p) => `${p.city}, ${p.state}`)).size, [scoped]);

  // ── zoom / pan ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const svg = svgRef.current; if (!svg) return;
    const z = d3zoom().scaleExtent([0.14, 60]).on("zoom", (e) => {
      tRef.current = e.transform;
      if (!rafRef.current) rafRef.current = requestAnimationFrame(() => {
        rafRef.current = 0;
        const { x, y, k } = tRef.current; setT({ x, y, k });
      });
    });
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => { select(svg).on(".zoom", null); if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  const applyTransform = (transform, ms = 750) => {
    const svg = svgRef.current, z = zoomRef.current; if (!svg || !z) return;
    if (REDUCED() || ms === 0) select(svg).call(z.transform, transform);
    else select(svg).transition().duration(ms).call(z.transform, transform);
  };
  const zoomBy = (f) => { const svg = svgRef.current, z = zoomRef.current; if (svg && z) z.scaleBy(select(svg).transition().duration(220), f); };
  const resetView = () => applyTransform(zoomIdentity, 650);
  const flyTo = (lonlat, minK = 7) => {
    if (!projection || !dims.w) return;
    const [px, py] = projection(lonlat);
    const k = Math.max(minK, tRef.current.k);
    applyTransform(zoomIdentity.translate(dims.w / 2 - k * px, dims.h / 2 - k * py).scale(k), 900);
  };

  // agent / data-table / chat focus → fly to that project's city (and on mount)
  const flownRef = useRef(null);
  useEffect(() => {
    if (!focus || !projection || !projects.length) return;
    const p = projects.find((x) => (focus.code && x.code === focus.code) || x.name === focus.name || x.id === focus.pid);
    if (!p || flownRef.current === focus) return; // fly once per focus change
    flownRef.current = focus;
    flyTo(coordsFor(p.city, p.state));
  }, [focus, projection, projects, dims.w]); // eslint-disable-line

  const focused = useMemo(() => focus
    ? projects.find((x) => (focus.code && x.code === focus.code) || x.name === focus.name || x.id === focus.pid) || null
    : null, [focus, projects]);

  const k = t.k;
  const labelCities = useMemo(() => k >= 2.2 ? cities : cities.slice(0, 8), [cities, k]);

  const onDotEnter = (p, e) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (rect) setHov({ p, x: e.clientX - rect.left, y: e.clientY - rect.top });
  };

  if (err) return <div className="h-full grid place-items-center text-red-300/90 text-sm px-6 text-center">⚠ Map failed to load — {err}</div>;

  return (
    <div ref={wrapRef} className="relative h-full overflow-hidden bg-[#0a0f14] select-none">
      {(!shapes || !projects.length) && (
        <div className="absolute inset-0 grid place-items-center text-white/50 text-sm z-10">loading the portfolio map…</div>
      )}
      <svg ref={svgRef} width={dims.w} height={dims.h} className="block cursor-grab active:cursor-grabbing" role="img"
        aria-label="Interactive map of all Clayco projects across the United States">
        {shapes && (
          <g transform={`translate(${t.x},${t.y}) scale(${t.k})`}>
            {/* basemap */}
            <path d={shapes.land} fill="#141d28" stroke="none" />
            <path d={shapes.countryBorders} fill="none" stroke="rgba(255,255,255,0.10)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={shapes.nation} fill="#182432" stroke="rgba(255,255,255,0.16)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            <path d={shapes.stateBorders} fill="none" stroke="rgba(148,197,255,0.14)" strokeWidth={0.8} vectorEffect="non-scaling-stroke" />

            {/* city labels (top cities always; all cities once zoomed in) */}
            {labelCities.map((c) => {
              const spread = (9.5 * Math.sqrt(Math.max(0, c.items.length - 1)) + 12) / k;
              const dim = businessUnit && !c.items.some(inScope);
              return (
                <text key={c.key} x={c.xy[0]} y={c.xy[1] + spread + 11 / k} textAnchor="middle"
                  fontSize={10.5 / k} fill={dim ? "rgba(255,255,255,0.18)" : "rgba(255,255,255,0.55)"}
                  style={{ pointerEvents: "none", fontWeight: 500 }}>
                  {c.city}{c.items.length > 1 ? ` · ${c.items.length}` : ""}
                </text>
              );
            })}

            {/* project dots — every project, fanned out per city */}
            {cities.map((c) => c.items.map((p, i) => {
              const [ox, oy] = clusterOffset(i);
              const cx = c.xy[0] + ox / k, cy = c.xy[1] + oy / k;
              const r = dotR(p.contract_value) / k;
              const color = dotColor(p);
              const dim = !inScope(p);
              const isFocus = focused?.id === p.id;
              return (
                <g key={p.id} opacity={dim ? 0.12 : 1} style={dim ? { pointerEvents: "none" } : undefined}>
                  <circle cx={cx} cy={cy} r={r * 2.1} fill={color} opacity={isFocus ? 0.35 : 0.16} style={{ pointerEvents: "none" }} />
                  <circle cx={cx} cy={cy} r={r} fill={color} stroke="rgba(10,15,20,0.85)" strokeWidth={r * 0.18}
                    className="cursor-pointer"
                    onClick={() => setFocus({ pid: p.id, name: p.name, code: p.code })}
                    onMouseEnter={(e) => onDotEnter(p, e)} onMouseMove={(e) => onDotEnter(p, e)}
                    onMouseLeave={() => setHov(null)} />
                  {isFocus && <circle cx={cx} cy={cy} r={r + 4.5 / k} fill="none" stroke="#fbbf24" strokeWidth={1.6 / k} style={{ pointerEvents: "none" }} />}
                </g>
              );
            }))}
          </g>
        )}
      </svg>

      {/* scope readout + color-by + legend */}
      <div className="absolute top-3 left-3 z-20 flex flex-col gap-2 max-w-[78vw]">
        <div className="bg-[#0d1218]/85 backdrop-blur border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 shadow-lg">
          <span className="text-white font-medium">{scoped.length}</span> projects · <span className="text-white font-medium">{fmt$(scopedTotal)}</span> · {scopedCities} cities
        </div>
        <div className="bg-[#0d1218]/85 backdrop-blur border border-white/10 rounded-lg p-2 text-xs shadow-lg">
          <button onClick={() => setLegendOpen((v) => !v)} aria-expanded={legendOpen}
            className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-white/40 hover:text-white/70 mb-1.5 w-full">
            Color by <span className="ml-auto normal-case">{legendOpen ? "▾" : "▸"}</span>
          </button>
          <div className="flex gap-1">
            {[["bu", "Business unit"], ["stage", "Stage"], ["health", "Cost health"]].map(([id, label]) => (
              <button key={id} onClick={() => { setColorMode(id); setLegendOpen(true); }}
                className={`px-2 py-1 max-md:py-2 rounded text-[11px] transition ${colorMode === id ? "bg-white/15 text-white" : "text-white/45 hover:text-white/80 bg-white/5"}`}>
                {label}
              </button>
            ))}
          </div>
          {legendOpen && (<>
            <div className="flex flex-col gap-1 max-h-40 overflow-y-auto pr-1 mt-2">
              {colorMode === "bu" && buIds.map((id) => (
                <LegendRow key={id} color={buColor(id)} label={buName.get(id) || "—"} />
              ))}
              {colorMode === "stage" && STAGE_ORDER.filter((s) => projects.some((p) => p.lifecycle_stage === s)).map((s) => (
                <LegendRow key={s} color={STAGE_COLOR[s]} label={s} />
              ))}
              {colorMode === "health" && (<>
                <LegendRow color={chartColor("cpiBad")} label="over budget (CPI < 0.95)" />
                <LegendRow color="#f59e0b" label="watch (0.95 – 1.00)" />
                <LegendRow color={chartColor("cpiOk")} label="on / under budget" />
                <LegendRow color="#64748b" label="no cost data yet" />
              </>)}
            </div>
            <div className="text-[10px] text-white/35 mt-1.5">dot size = contract value</div>
          </>)}
        </div>
      </div>

      {/* zoom controls */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1">
        {[["+", () => zoomBy(1.6), "Zoom in"], ["−", () => zoomBy(1 / 1.6), "Zoom out"], ["⌂", resetView, "Reset to US view"]].map(([txt, fn, label]) => (
          <button key={label} onClick={fn} aria-label={label} title={label}
            className="w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center rounded-md bg-[#0d1218]/85 backdrop-blur border border-white/10 text-white/70 hover:text-white hover:bg-white/10 text-sm shadow-lg">
            {txt}
          </button>
        ))}
      </div>

      {/* hover tooltip */}
      {hov && (
        <div className="absolute z-30 pointer-events-none bg-[#0d1218]/95 border border-white/15 rounded-lg px-3 py-2 text-xs shadow-2xl max-w-[260px]"
          style={{ left: Math.min(hov.x + 14, Math.max(0, dims.w - 270)), top: Math.max(8, hov.y - 12) }}>
          <div className="text-white font-medium leading-snug">{hov.p.name}</div>
          <div className="text-white/50 mt-0.5">{hov.p.code} · {buName.get(hov.p.business_unit_id) || ""}</div>
          <div className="text-white/50">{hov.p.city}, {hov.p.state} · {hov.p.lifecycle_stage}</div>
          <div className="text-amber-300/90 mt-1">{fmt$(hov.p.contract_value)}</div>
          {evmByName.get(hov.p.name) && (
            <div className="text-white/50 mt-0.5">CPI {num(evmByName.get(hov.p.name).cpi)?.toFixed(2) ?? "—"} · SPI {num(evmByName.get(hov.p.name).spi)?.toFixed(2) ?? "—"}</div>
          )}
          <div className="text-white/30 mt-1">click to focus</div>
        </div>
      )}

      {/* focused-project detail card (desktop rail / phone bottom sheet) */}
      {focused && (
        <DetailCard p={focused} buName={buName.get(focused.business_unit_id)}
          evm={evmByName.get(focused.name)} field={field.find((r) => r.project_name === focused.name)}
          safety={safety.find((r) => r.project_name === focused.name)}
          onClose={() => setFocus(null)} />
      )}
    </div>
  );
}

function LegendRow({ color, label }) {
  return (
    <div className="flex items-center gap-2 text-white/70">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="truncate">{label}</span>
    </div>
  );
}

function DetailCard({ p, buName, evm, field, safety, onClose }) {
  const cpi = num(evm?.cpi), spi = num(evm?.spi), bac = num(evm?.bac), eac = num(evm?.eac);
  return (
    <div className="absolute z-20 md:top-3 md:right-14 md:w-80 max-md:left-2 max-md:right-2 max-md:bottom-20
      bg-[#0d1218]/95 backdrop-blur border border-white/10 rounded-xl p-4 shadow-2xl">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-white font-semibold leading-snug">{p.name}</div>
          <div className="text-white/45 text-xs mt-0.5">{p.code} · {buName || ""}</div>
        </div>
        <button onClick={onClose} aria-label="Clear focus" className="text-white/40 hover:text-white text-sm shrink-0">✕</button>
      </div>
      <div className="flex flex-wrap gap-1.5 mt-2 text-[11px]">
        <span className="px-2 py-0.5 rounded bg-white/5 text-white/60">{p.sector?.replace(/_/g, " ")}</span>
        <span className="px-2 py-0.5 rounded bg-white/5 text-white/60">{p.lifecycle_stage}</span>
        <span className="px-2 py-0.5 rounded bg-white/5 text-white/60">{p.city}, {p.state}</span>
      </div>
      <div className="grid grid-cols-3 gap-x-3 gap-y-2 mt-3 text-xs">
        <Stat label="Contract" value={fmt$(p.contract_value)} />
        <Stat label="CPI" value={cpi?.toFixed(2) ?? "—"} warn={cpi != null && cpi < 1} />
        <Stat label="SPI" value={spi?.toFixed(2) ?? "—"} warn={spi != null && spi < 1} />
        {bac != null && <Stat label="BAC" value={fmt$(bac)} />}
        {eac != null && <Stat label="EAC" value={fmt$(eac)} warn={eac > bac} />}
        {field && <Stat label="Open RFIs" value={`${field.open_rfis ?? 0} / ${field.total_rfis ?? 0}`} />}
        {safety && num(safety.trir) != null && <Stat label="TRIR" value={num(safety.trir).toFixed(2)} warn={num(safety.trir) > 3} />}
        {p.gross_sf && <Stat label="Size" value={`${Math.round(p.gross_sf / 1000)}k SF`} />}
        {p.end_date && <Stat label="Finish" value={p.end_date} />}
      </div>
      <div className="text-[11px] text-white/35 mt-3">The Ask agent is now scoped to this project — ask it anything below.</div>
    </div>
  );
}

function Stat({ label, value, warn }) {
  const def = defOf(label); // plain-language what/good/bad hover when the glossary knows it
  return (
    <div title={def || undefined} className={def ? "cursor-help" : undefined}>
      <div className={`text-[10px] uppercase tracking-wide text-white/35${def ? " underline decoration-dotted decoration-white/25 underline-offset-2" : ""}`}>{label}</div>
      <div className={warn ? "text-amber-300" : "text-white/85"}>{value}</div>
    </div>
  );
}

function num(v) { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; }
