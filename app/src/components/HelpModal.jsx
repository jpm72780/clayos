import { useEffect } from "react";

// Re-summonable "what am I looking at?" help, per view. The header "?" opens this
// for whatever tab is active, so the explanation is never one-shot. Plain-language
// by design (it's the literal-mode companion to the poetic 3D intro overlay).
const HELP = {
  graph: {
    title: "Clayco Ontology",
    blurb: "Clayco's whole data environment as one living picture — every project, the people and vendors behind them, and what has moved lately.",
    points: [
      ["Each globe is a project", "tinted by business unit and placed along its lifecycle (left → right). It glows brighter the more it has changed recently."],
      ["Travelling dots are real updates", "each one is a record that moved within the time window — colour shows what kind, faster means more recent."],
      ["Thicker links carry more money", "contracts, pay applications and cost accounts."],
      ["Click a project to focus everything", "the KPI strip and the Ask agent rescope to it. Use “Highlight by” (left rail) to light up a CSI code, vendor or person across every project at once."],
      ["The Map shows where the work is", "every project as a dot on a real US map — sized by contract value, colored by business unit, stage, or cost health. Zoom, hover, and click a dot to focus it."],
    ],
    foot: "3D · Map · Network are three views of the same data — switch with the toggle in the header.",
  },
  data: {
    title: "Clayco Data",
    blurb: "Every node in the ontology as one sortable, filterable table.",
    points: [
      ["Filter and search", "by type, domain, business unit, or free text. The quantification panel re-totals as you filter."],
      ["Click any row", "to open the full underlying record and everything it connects to."],
      ["It stays in sync", "a focused project or a highlighted vendor from the ontology scopes this table too."],
      ["Export", "download the filtered set as CSV at any time."],
    ],
  },
  dashboard: {
    title: "Clayco Analytics",
    blurb: "Portfolio KPIs and trends, value-weighted across whatever projects are in scope.",
    points: [
      ["Every number explains itself", "hover or tap any dotted-underlined label (CPI, SPI, EAC, TRIR, WIP, backlog…) for what it measures, what a good value means, and what a bad one means — no construction background assumed."],
      ["Every chart has ⓘ explain", "tap it for how to read that chart: what the bars and reference lines mean and when to worry."],
      ["Scope follows your focus", "focus a project (from the ontology, the data table, or the chat) and every stat and chart rescopes to it."],
      ["Compare over time", "the CPI / SPI trend line shows direction, not just a snapshot."],
      ["Export or ask", "every chart exports CSV / PNG, and “✦ ask” sends a chart-specific question to the agent."],
    ],
  },
};

export default function HelpModal({ topic, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const h = HELP[topic] || HELP.graph;
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-black/55 backdrop-blur-[1px] p-4"
      onClick={onClose} role="dialog" aria-modal="true" aria-label={`Help: ${h.title}`}>
      <div className="max-w-md bg-[#0d1218]/95 border border-white/10 rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1 gap-3">
          <div className="text-amber-300/90 font-semibold text-base">{h.title} — what am I looking at?</div>
          <button onClick={onClose} aria-label="Close help" className="text-white/40 hover:text-white text-sm shrink-0">✕</button>
        </div>
        <div className="text-sm text-white/70 mb-3">{h.blurb}</div>
        <ul className="space-y-2 text-[13px] text-white/80">
          {h.points.map(([b, t], i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-amber-400/80 shrink-0" />
              <span><b className="text-white/90">{b}</b> — {t}</span>
            </li>
          ))}
        </ul>
        {h.foot && <div className="mt-3 text-[11px] text-white/40">{h.foot}</div>}
        <div className="mt-4 flex justify-end">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-sm hover:bg-amber-500/30">Got it</button>
        </div>
      </div>
    </div>
  );
}
