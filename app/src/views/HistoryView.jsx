import { useEffect, useMemo, useRef, useState } from "react";
import { timelineEvents, projectSchedule, listBusinessUnits } from "../lib/api.js";
import { colorFor, shapeFor, chartColor } from "../lib/palette.js";
import { fmtMoney as fmt$, fmtDay } from "../lib/format.js";
import { parseDay, today, dataExtent, resolveRange, bucketize, autoBucket, dayDiff } from "../lib/time.js";
import { TimeAxis, NowLine, useTimeZoom } from "../components/TimeAxis.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// ClayOS — History. Every dated record in the portfolio on one axis.
//
// Overview + detail: a stacked histogram of event volume up top (brush it to set
// the shared time range), swimlanes per record type in the middle, and the
// matching records as a list underneath.
//
// The "data as-of" marker is derived from the newest daily log, not hardcoded:
// field reporting is the stream that stops first when a data load goes stale, and
// showing where it stops is more honest than letting the histogram just trail off.
// ─────────────────────────────────────────────────────────────────────────────

const HEADER_H = 34;
const OVERVIEW_H = 96;
const LANE_H = 26;
const KINDS = ["RFI", "Submittal", "DailyLog", "Contract", "PayApp", "SafetyEvent", "QualityEvent", "Document"];
const KIND_LABEL = {
  RFI: "RFIs", Submittal: "Submittals", DailyLog: "Daily logs", Contract: "Contracts executed",
  PayApp: "Pay applications", SafetyEvent: "Safety events", QualityEvent: "Quality events", Document: "Documents issued",
};
const num = (v) => { const n = typeof v === "string" ? parseFloat(v) : v; return Number.isFinite(n) ? n : null; };

export default function HistoryView({ businessUnit, focus, setFocus, range, setRange }) {
  const wrapRef = useRef(null), svgRef = useRef(null);
  const [dims, setDims] = useState({ w: 0, h: 0 });
  const [events, setEvents] = useState([]);
  const [projects, setProjects] = useState([]);
  const [bus, setBus] = useState([]);
  const [err, setErr] = useState(null);
  const [kindsOff, setKindsOff] = useState(() => new Set());
  const [drag, setDrag] = useState(null);
  const [hover, setHover] = useState(null);

  useEffect(() => {
    timelineEvents().then(setEvents).catch((e) => setErr(e?.message || "events failed to load"));
    projectSchedule().then(setProjects).catch(() => setProjects([]));
    listBusinessUnits().then(setBus);
  }, []);

  useEffect(() => {
    const el = wrapRef.current; if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setDims({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setDims({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const projById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const buName = useMemo(() => new Map(bus.map((b) => [b.id, b.name])), [bus]);
  const now = today();

  // Parse once; everything downstream works on Dates.
  const parsed = useMemo(
    () => events.map((e) => ({ ...e, at: parseDay(e.at), endAt: parseDay(e.endAt) })).filter((e) => e.at),
    [events]);

  const asOf = useMemo(() => {
    let m = null;
    for (const e of parsed) if (e.kind === "DailyLog" && (!m || e.at > m)) m = e.at;
    return m;
  }, [parsed]);

  // filters: BU + focused project + type toggles
  const scoped = useMemo(() => parsed.filter((e) => {
    if (kindsOff.has(e.kind)) return false;
    if (focus?.pid && e.pid !== focus.pid) return false;
    if (businessUnit) { const p = projById.get(e.pid); if (!p || p.business_unit_id !== businessUnit) return false; }
    return true;
  }), [parsed, kindsOff, focus, businessUnit, projById]);

  const extent = useMemo(() => dataExtent(scoped, (e) => e.at), [scoped]);
  const domain = useMemo(() => {
    if (!extent[0]) return [new Date(2024, 0, 1), new Date(2027, 0, 1)];
    const r = resolveRange("portfolio", extent);
    return [r.from, r.to];
  }, [extent]);

  const LANE_LABEL_W = dims.w < 640 ? 0 : 108;
  const plotW = Math.max(120, dims.w - 24 - LANE_LABEL_W);
  // drag belongs to the brush here, not to panning
  const { scale, zoomBy, reset } = useTimeZoom(svgRef, domain, plotW, { dragPans: false });

  const [d0, d1] = scale.domain();
  const step = autoBucket(d0, d1, plotW);
  const hist = useMemo(() => bucketize(scoped, d0, d1, step, (e) => e.kind),
    [scoped, d0?.getTime(), d1?.getTime(), step]); // eslint-disable-line

  // Selected window = the shared range, if it's a custom one; else the full view.
  const sel = useMemo(() => {
    const f = range?.from ? parseDay(range.from) : null;
    const t = range?.to ? parseDay(range.to) : null;
    return f && t ? [f, t] : null;
  }, [range]);

  const inSel = (e) => !sel || (e.at >= sel[0] && e.at <= sel[1]);
  const listed = useMemo(
    () => scoped.filter(inSel).sort((a, b) => b.at - a.at).slice(0, 600),
    [scoped, sel]); // eslint-disable-line
  const listedTotal = useMemo(() => scoped.filter(inSel).length, [scoped, sel]); // eslint-disable-line

  const lanes = KINDS.filter((k) => !kindsOff.has(k));
  const lanesH = lanes.length * LANE_H;
  const svgH = HEADER_H + OVERVIEW_H + 10 + lanesH + 8;

  // Brush on the overview band sets the shared range.
  const brushFrom = (px) => scale.invert(Math.max(0, Math.min(plotW, px)));
  const onDown = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    if (e.clientY - r.top > HEADER_H + OVERVIEW_H) return; // brush only on the overview band
    setDrag({ x0: e.clientX - r.left, x1: e.clientX - r.left });
  };
  const onMove = (e) => {
    if (!drag) return;
    const r = svgRef.current.getBoundingClientRect();
    setDrag((d) => ({ ...d, x1: e.clientX - r.left }));
  };
  const onUp = () => {
    if (!drag) return;
    const [a, b] = [drag.x0, drag.x1].sort((m, n) => m - n);
    setDrag(null);
    if (Math.abs(b - a) < 6) { setRange?.(null); return; }   // a click clears
    const from = brushFrom(a), to = brushFrom(b);
    setRange?.({ preset: "custom", from: iso(from), to: iso(to) });
  };

  if (err) return <div className="h-full grid place-items-center text-red-300/90 text-sm px-6 text-center">⚠ History failed to load — {err}</div>;

  const loading = !events.length;
  const laneBuckets = (kind) => bucketize(scoped.filter((e) => e.kind === kind), d0, d1, step, () => kind);

  return (
    <div className="h-full flex flex-col bg-[#0a0f14] select-none">
      {/* header: counts + type toggles */}
      <div className="shrink-0 flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2 border-b border-white/10 bg-[#0d1218] text-xs">
        <span className="text-white/70">
          <span className="text-white font-medium">{listedTotal.toLocaleString()}</span> records
          {sel ? <span className="text-white/40"> in range</span> : <span className="text-white/40"> in view</span>}
        </span>
        {asOf && (
          <span className="text-[10px] text-white/40 cursor-help"
            title="Newest daily field report. Streams that stop before this are stale; records after it are forecast or scheduled.">
            field data as-of {fmtDay(asOf)} ({Math.abs(dayDiff(asOf, now))}d ago)
          </span>
        )}
        <div className="flex flex-wrap gap-1 ml-auto">
          {KINDS.map((k) => (
            <button key={k} onClick={() => setKindsOff((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; })}
              className={`px-1.5 py-1 rounded text-[10px] border transition ${
                kindsOff.has(k) ? "border-white/10 text-white/30" : "border-white/15 text-white/75 bg-white/5"}`}
              style={kindsOff.has(k) ? undefined : { borderColor: colorFor(k) + "66" }}>
              <span style={{ color: colorFor(k) }}>{shapeFor(k)}</span> {KIND_LABEL[k]}
            </button>
          ))}
        </div>
        {sel && (
          <button onClick={() => setRange?.(null)} className="text-[11px] text-amber-300/80 hover:text-amber-200">clear range</button>
        )}
      </div>

      <div ref={wrapRef} className="relative flex-1 min-h-0 overflow-hidden flex flex-col">
        {loading && <div className="absolute inset-0 grid place-items-center text-white/50 text-sm z-10">loading history…</div>}

        <div className="flex shrink-0 px-3">
        {LANE_LABEL_W > 0 && (
          <div style={{ width: LANE_LABEL_W }} className="shrink-0">
            <div style={{ height: HEADER_H + OVERVIEW_H + 10 }} />
            {lanes.map((k) => (
              <div key={k} style={{ height: LANE_H }} className="flex items-center gap-1 text-[9.5px] text-white/45">
                <span style={{ color: colorFor(k) }}>{shapeFor(k)}</span>{KIND_LABEL[k]}
              </div>
            ))}
          </div>
        )}
        <svg ref={svgRef} width={plotW} height={svgH} className="block shrink-0 cursor-crosshair"
          onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={() => setDrag(null)}
          role="img" aria-label="Transaction history timeline" data-events={scoped.length}>
          <TimeAxis scale={scale} width={plotW} height={svgH} headerH={HEADER_H} />

          {/* overview histogram, stacked by record type */}
          {hist.buckets.map((b, i) => {
            const x = scale(b.t);
            const next = hist.buckets[i + 1];
            const w = Math.max(1.5, (next ? scale(next.t) : x + 8) - x - 1);
            let acc = 0;
            return (
              <g key={i}>
                {KINDS.filter((k) => b.by[k]).map((k) => {
                  const h = (b.by[k] / (hist.max || 1)) * (OVERVIEW_H - 12);
                  const y = HEADER_H + OVERVIEW_H - acc - h;
                  acc += h;
                  return <rect key={k} data-kind="bin" x={x} y={y} width={w} height={Math.max(0.6, h)} fill={colorFor(k)} opacity="0.85" />;
                })}
              </g>
            );
          })}

          {/* brush + selection shading */}
          {sel && (
            <rect x={scale(sel[0])} y={HEADER_H} width={Math.max(1, scale(sel[1]) - scale(sel[0]))}
              height={OVERVIEW_H} fill={chartColor("now")} opacity="0.10" data-testid="range-sel" />
          )}
          {drag && (
            <rect x={Math.min(drag.x0, drag.x1)} y={HEADER_H} width={Math.abs(drag.x1 - drag.x0)}
              height={OVERVIEW_H} fill="#fff" opacity="0.12" />
          )}

          {/* swimlanes — bucket density per record type */}
          {lanes.map((k, li) => {
            const lb = laneBuckets(k);
            const y = HEADER_H + OVERVIEW_H + 10 + li * LANE_H;
            return (
              <g key={k} data-lane={k}>
                {lb.buckets.map((b, i) => {
                  const x = scale(b.t);
                  const next = lb.buckets[i + 1];
                  const w = Math.max(1.5, (next ? scale(next.t) : x + 8) - x - 1);
                  const inten = Math.min(1, b.total / Math.max(1, lb.max));
                  return (
                    <rect key={i} x={x} y={y + 5} width={w} height={LANE_H - 12}
                      fill={colorFor(k)} opacity={0.25 + inten * 0.75}
                      onMouseEnter={(e) => setHover({ k, b, x: e.clientX, y: e.clientY })}
                      onMouseLeave={() => setHover(null)} />
                  );
                })}
              </g>
            );
          })}

          <NowLine scale={scale} height={svgH} now={now} asOf={asOf} headerH={HEADER_H} />
        </svg>
        </div>

        <div className="px-3 pb-1 pt-1 text-[10px] text-white/30 shrink-0">
          drag across the top band to set a time range · ctrl/⌘ + scroll to zoom
        </div>

        {/* detail list */}
        <div className="flex-1 min-h-0 overflow-auto px-3" style={{ paddingBottom: 96 }}>
          <table className="w-full text-[11px]">
            <tbody>
              {listed.map((e) => {
                const p = projById.get(e.pid);
                return (
                  <tr key={e.id} data-row="event"
                    className="border-b border-white/[0.04] hover:bg-white/[0.04] cursor-pointer"
                    onClick={() => p && setFocus?.({ pid: p.id, name: p.name, code: p.code })}>
                    <td className="py-1 pr-2 text-white/40 tabular-nums whitespace-nowrap w-24">{fmtDay(e.at)}</td>
                    <td className="py-1 pr-2 w-5" style={{ color: colorFor(e.kind) }}>{shapeFor(e.kind)}</td>
                    <td className="py-1 pr-2 text-white/35 whitespace-nowrap w-20">{p?.code || "—"}</td>
                    <td className="py-1 pr-2 text-white/80 truncate">{e.label}</td>
                    <td className="py-1 text-right text-amber-300/70 tabular-nums whitespace-nowrap w-24">
                      {num(e.amount) ? fmt$(num(e.amount)) : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {listedTotal > listed.length && (
            <div className="py-2 text-[11px] text-white/35">
              showing the {listed.length} most recent of {listedTotal.toLocaleString()} — narrow the range to see more
            </div>
          )}
          {!loading && listedTotal === 0 && (
            <div className="py-8 text-center text-white/45 text-xs">
              No records in this range{focus ? ` for ${focus.code || focus.name}` : ""}.
              <div className="text-white/25 mt-1">Try clearing the range, or widening the record types above.</div>
            </div>
          )}
        </div>

        {hover && (
          <div className="absolute z-30 pointer-events-none bg-[#0d1218]/95 border border-white/15 rounded px-2 py-1 text-[11px] shadow-2xl"
            style={{ left: Math.min(hover.x - (wrapRef.current?.getBoundingClientRect().left || 0) + 12, dims.w - 180),
                     top: hover.y - (wrapRef.current?.getBoundingClientRect().top || 0) - 8 }}>
            <span style={{ color: colorFor(hover.k) }}>{KIND_LABEL[hover.k]}</span>
            <span className="text-white/70"> · {hover.b.total} on {fmtDay(hover.b.t)}</span>
          </div>
        )}

        <div className="absolute top-3 right-6 z-20 flex gap-1">
          {[["+", () => zoomBy(1.6), "Zoom in"], ["−", () => zoomBy(1 / 1.6), "Zoom out"], ["⌂", reset, "Fit"]].map(([t, fn, lbl]) => (
            <button key={lbl} onClick={fn} aria-label={lbl} title={lbl}
              className="w-8 h-8 max-md:w-11 max-md:h-11 grid place-items-center rounded-md bg-[#0d1218]/85 backdrop-blur border border-white/10 text-white/70 hover:text-white text-sm">{t}</button>
          ))}
        </div>
      </div>
    </div>
  );
}

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
