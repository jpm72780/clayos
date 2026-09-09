import { useEffect, useRef, useState } from "react";
import { scaleTime } from "d3-scale";
import { zoom as d3zoom, zoomIdentity } from "d3-zoom";
import { select } from "d3-selection";
import { timeFormat } from "d3-time-format";
import { chartColor } from "../lib/palette.js";

// Shared time axis for the Gantt and the history timeline.
//
// House style is d3-for-math / React-for-DOM — d3-axis is deliberately not a
// dependency, because it mutates the DOM imperatively and fights React. So the
// scale comes from d3-scale and every tick is a plain <line>/<text>.

const fmtYear = timeFormat("%Y");
const fmtMonth = timeFormat("%b");
const fmtMonthYear = timeFormat("%b %Y");
const fmtDay = timeFormat("%-d %b");

/**
 * x-scale + zoom transform for a time surface.
 *
 * Zoom is x-only and the transform is written to a ref synchronously, then
 * coalesced into React state on an animation frame — the same pattern MapView
 * uses, and not optional here: at 200 rows a re-render per wheel tick drops frames.
 *
 * Wheel arbitration: a plain wheel scrolls the row list (what users expect from a
 * long list), ctrl/meta+wheel and pinch zoom time. Drag always pans time.
 */
export function useTimeZoom(svgRef, domain, width, { enabled = true, dragPans = true } = {}) {
  const [t, setT] = useState(zoomIdentity);
  const tRef = useRef(zoomIdentity);
  const rafRef = useRef(0);
  const zoomRef = useRef(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg || !enabled || !width) return;
    const z = d3zoom()
      .scaleExtent([1, 400])
      // `dragPans: false` leaves mouse drags entirely alone so a view can own them
      // (the History brush). d3-zoom's mousedown handler calls
      // stopImmediatePropagation, which would otherwise stop React ever seeing them.
      .filter((e) => (e.type === "wheel" ? e.ctrlKey || e.metaKey : dragPans && !e.button))
      .on("zoom", (e) => {
        tRef.current = e.transform;
        if (!rafRef.current) {
          rafRef.current = requestAnimationFrame(() => { rafRef.current = 0; setT(tRef.current); });
        }
      });
    zoomRef.current = z;
    select(svg).call(z).on("dblclick.zoom", null);
    return () => {
      select(svg).on(".zoom", null);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [svgRef, enabled, width]);

  const base = scaleTime().domain(domain).range([0, Math.max(1, width)]);
  const scale = t.rescaleX(base);

  const zoomBy = (k) => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) zoomRef.current.scaleBy(select(svg).transition().duration(200), k);
  };
  const reset = () => {
    const svg = svgRef.current;
    if (svg && zoomRef.current) select(svg).call(zoomRef.current.transform, zoomIdentity);
  };

  return { scale, transform: t, zoomBy, reset };
}

/** Tick marks: a labelled header band plus full-height gridlines. */
export function TimeAxis({ scale, width, height, headerH = 34 }) {
  const [d0, d1] = scale.domain();
  const spanDays = (d1 - d0) / 86400000;
  const ticks = scale.ticks(Math.max(2, Math.floor(width / 110)));
  const label = spanDays > 1500 ? fmtYear : spanDays > 200 ? fmtMonthYear : spanDays > 40 ? fmtMonth : fmtDay;

  return (
    <g>
      <rect x="0" y="0" width={width} height={headerH} fill="#0b1016" />
      {ticks.map((d, i) => {
        const x = scale(d);
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={headerH} y2={height} stroke="#151c26" strokeWidth="1" />
            <text x={x + 4} y={headerH - 11} fill="#94a3b8" fontSize="10.5">{label(d)}</text>
          </g>
        );
      })}
      <line x1="0" x2={width} y1={headerH} y2={headerH} stroke="rgba(255,255,255,0.12)" />
    </g>
  );
}

/** The "data date" (now) line, plus an optional data-as-of marker. */
export function NowLine({ scale, height, now, asOf, headerH = 34 }) {
  const [d0, d1] = scale.domain();
  const inView = (d) => d && d >= d0 && d <= d1;
  const nx = scale(now);
  const ax = asOf ? scale(asOf) : null;
  // When the data is current the two markers coincide; drawing both just collides
  // the labels and tells the reader nothing.
  const showAsOf = inView(asOf) && Math.abs(ax - nx) > 24;
  return (
    <g style={{ pointerEvents: "none" }}>
      {showAsOf && (
        <g data-testid="as-of-line">
          <line x1={ax} x2={ax} y1={headerH} y2={height} stroke={chartColor("asOf")}
            strokeWidth="1" strokeDasharray="3 4" opacity="0.75" />
          <text x={ax + 4} y={headerH + 11} fill={chartColor("asOf")} fontSize="9.5">data as-of</text>
        </g>
      )}
      {inView(now) && (
        <g data-testid="now-line">
          <line x1={nx} x2={nx} y1={headerH} y2={height} stroke={chartColor("now")} strokeWidth="1.25" opacity="0.9" />
          <text x={nx + 4} y={headerH + 11} fill={chartColor("now")} fontSize="9.5">today</text>
        </g>
      )}
    </g>
  );
}
