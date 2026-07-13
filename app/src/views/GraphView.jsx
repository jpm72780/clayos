import { useEffect, useMemo, useRef, useState } from "react";
import Graph from "graphology";
import forceAtlas2 from "graphology-layout-forceatlas2";
import Sigma from "sigma";
import { subgraph, entityDetail } from "../lib/api.js";
import { colorFor, shapeFor, DOMAINS, TYPE_COLOR } from "../lib/palette.js";

export default function GraphView({ businessUnit }) {
  const containerRef = useRef(null);
  const sigmaRef = useRef(null);
  const [domains, setDomains] = useState(null); // null = all
  const [stats, setStats] = useState({ nodes: 0, edges: 0 });
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(true);
  const [railOpen, setRailOpen] = useState(false); // mobile filters drawer

  // Sigma's backing canvases don't track container size on their own, so when the
  // layout reflows (mobile stacking / drawer / rotate) they render into a clipped
  // strip. Observe the container and resize+refresh the live instance.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const sync = () => { const s = sigmaRef.current; if (s) { s.resize(); s.refresh(); } };
    const ro = new ResizeObserver(sync);
    ro.observe(el);
    window.addEventListener("orientationchange", sync);
    return () => { ro.disconnect(); window.removeEventListener("orientationchange", sync); };
  }, []);

  useEffect(() => {
    let killed = false;
    setLoading(true);
    subgraph({ businessUnit, domains, limit: 1500 }).then((data) => {
      if (killed || !containerRef.current) return;
      const g = new Graph();
      for (const n of data.nodes) {
        if (g.hasNode(n.id)) continue;
        g.addNode(n.id, {
          label: n.label, type: "circle", entityType: n.type, domain: n.domain,
          size: n.type === "Project" ? 10 : n.type === "Organization" || n.type === "Person" ? 6 : 4,
          color: colorFor(n.type),
          x: Math.random(), y: Math.random(),
        });
      }
      for (const e of data.edges) {
        if (g.hasNode(e.source) && g.hasNode(e.target) && !g.hasEdge(e.id)) {
          try { g.addEdgeWithKey(e.id, e.source, e.target, { label: e.type, size: 0.5, color: "#2a3441" }); } catch { /* dup */ }
        }
      }
      forceAtlas2.assign(g, { iterations: g.order > 800 ? 120 : 220, settings: { gravity: 1, scalingRatio: 8, slowDown: 2, barnesHutOptimize: true } });
      setStats({ nodes: g.order, edges: g.size });

      if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null; }
      const s = new Sigma(g, containerRef.current, {
        labelColor: { color: "#cbd5e1" }, labelSize: 11, defaultEdgeColor: "#1f2733",
        labelRenderedSizeThreshold: 8, renderEdgeLabels: false,
      });
      sigmaRef.current = s;
      s.on("clickNode", async ({ node }) => {
        setSelected({ loading: true });
        const d = await entityDetail(node);
        setSelected(d || { loading: false, missing: true });
      });
      s.on("clickStage", () => setSelected(null));
      setLoading(false);
    }).catch((e) => { console.error(e); setLoading(false); });
    return () => { killed = true; if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null; } };
  }, [businessUnit, domains]);

  const toggleDomain = (d) => {
    setDomains((cur) => {
      const set = new Set(cur || DOMAINS);
      if (!cur) { return DOMAINS.filter((x) => x !== d); }
      set.has(d) ? set.delete(d) : set.add(d);
      const arr = [...set];
      return arr.length === DOMAINS.length ? null : arr;
    });
  };

  const activeDomains = domains || DOMAINS;
  const presentTypes = useMemo(() => Object.keys(TYPE_COLOR), []);

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* mobile-only toolbar: open the filters drawer + show counts */}
      <div className="md:hidden shrink-0 flex items-center gap-3 px-3 py-2 border-b border-white/10 bg-[#0b0f14]">
        <button onClick={() => setRailOpen(true)} className="text-xs px-3 py-2 rounded bg-white/5 text-white/75 active:bg-white/10">☰ Filters</button>
        <span className="text-xs text-white/45">{loading ? "loading graph…" : `${stats.nodes} nodes · ${stats.edges} edges`}</span>
      </div>
      {/* drawer backdrop (mobile) */}
      {railOpen && <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setRailOpen(false)} />}

      <aside className={`w-56 shrink-0 border-r border-white/10 p-3 overflow-auto text-sm bg-[#0b0f14] md:static md:block
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-64 max-md:max-w-[85vw] max-md:shadow-2xl
        ${railOpen ? "max-md:block" : "max-md:hidden"}`}>
        <button onClick={() => setRailOpen(false)} className="md:hidden mb-3 text-xs text-white/45 hover:text-white/80">✕ close</button>
        <div className="text-white/40 text-xs uppercase tracking-wide mb-2">Domains</div>
        <div className="space-y-1">
          {DOMAINS.map((d) => (
            <label key={d} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={activeDomains.includes(d)} onChange={() => toggleDomain(d)} />
              <span className="capitalize text-white/70">{d.replace(/_/g, " ")}</span>
            </label>
          ))}
        </div>
        <div className="text-white/40 text-xs uppercase tracking-wide mt-4 mb-2">Legend</div>
        <div className="space-y-1">
          {presentTypes.map((t) => (
            <div key={t} className="flex items-center gap-2 text-white/70">
              <span className="w-3.5 text-center leading-none shrink-0" style={{ color: colorFor(t) }}>{shapeFor(t)}</span>{t}
            </div>
          ))}
        </div>
      </aside>

      <div className="relative flex-1 min-w-0 min-h-0 max-md:h-[60vh]">
        <div ref={containerRef} className="absolute inset-0" />
        <div className="absolute top-3 left-3 text-xs text-white/50 bg-black/40 rounded px-2 py-1 max-md:hidden">
          {loading ? "loading graph…" : `${stats.nodes} nodes · ${stats.edges} edges`}
        </div>
      </div>

      {selected && (
        <aside className="w-80 max-w-[80vw] shrink-0 border-l border-white/10 p-4 overflow-auto text-sm bg-[#0d1218]
          max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:w-full max-md:max-w-none max-md:border-l-0 max-md:border-t max-md:rounded-t-xl max-md:max-h-[70vh] max-md:pb-16 max-md:shadow-2xl">
          <button onClick={() => setSelected(null)} className="md:hidden mb-2 text-xs text-white/45 hover:text-white/80">✕ close</button>
          {selected.loading ? <div className="text-white/50">loading…</div> : selected.missing ? <div className="text-white/50">no detail</div> : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full" style={{ background: colorFor(selected.entity.entity_type) }} />
                <span className="text-xs text-white/50">{selected.entity.entity_type} · {selected.entity.domain}</span>
              </div>
              <div className="text-base font-semibold mb-3">{selected.entity.label}</div>
              <div className="text-white/40 text-xs uppercase tracking-wide mb-1">Record · {selected.entity.source_table}</div>
              <table className="w-full text-xs mb-4">
                <tbody>
                  {Object.entries(selected.record || {}).filter(([k]) => !["id"].includes(k)).slice(0, 24).map(([k, v]) => (
                    <tr key={k} className="border-b border-white/5">
                      <td className="py-1 pr-2 text-white/40 align-top">{k}</td>
                      <td className="py-1 text-white/80 break-words">{v === null ? "—" : String(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="text-white/40 text-xs uppercase tracking-wide mb-1">Connected ({(selected.neighbors.nodes || []).length - 1})</div>
              <div className="space-y-1">
                {(selected.neighbors.nodes || []).filter((n) => n.id !== selected.entity.id).slice(0, 30).map((n) => (
                  <div key={n.id} className="flex items-center gap-2 text-white/70">
                    <span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(n.type) }} />
                    <span className="truncate">{n.label}</span>
                    <span className="text-white/30 text-[10px] ml-auto shrink-0">{n.type}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
