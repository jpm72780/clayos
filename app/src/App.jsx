import { useEffect, useState, lazy, Suspense } from "react";
import { listBusinessUnits, projectsLite, dataHealth } from "./lib/api.js";
import GraphView from "./views/GraphView.jsx";
import LifecycleView from "./views/LifecycleView.jsx";
import DataView from "./views/DataView.jsx";
import DashboardView from "./views/DashboardView.jsx";
import AskDock from "./components/AskDock.jsx";

const Lifecycle3DView = lazy(() => import("./views/Lifecycle3DView.jsx"));

const TABS = [
  { id: "graph", label: "Clayco Ontology" },
  { id: "data", label: "Clayco Data" },
  { id: "dashboard", label: "Clayco Analytics" },
];

// restore shared view state from the URL hash so any view is a shareable deep-link
const initial = (() => { try { const h = location.hash.slice(1); return h ? JSON.parse(decodeURIComponent(atob(h))) : {}; } catch { return {}; } })();

export default function App() {
  const [tab, setTab] = useState(initial.tab || "graph");
  const [ontoMode, setOntoMode] = useState(initial.ontoMode || "3d"); // '3d' | 'lifecycle' | 'network'
  const [bus, setBus] = useState([]);
  const [bu, setBu] = useState(null); // selected business_unit_id (null = all)
  const [projects, setProjects] = useState([]);
  // shared cross-filter state — in-session only (NOT persisted to the URL, so a
  // reload never comes back scoped to a stale filter and looking empty)
  // focus/hl may arrive from an explicit shared link (initial.*); they're applied on
  // load AND shown in the active-filter bar, so a shared view is never *silently* scoped
  // (the prior footgun was auto-persisting them — we still only auto-persist tab/ontoMode).
  const [focus, setFocus] = useState(initial.focus || null); // {pid,name,code} — shared across pages
  const [hl, setHl] = useState(initial.hl || null);          // {dim,value,label,depth} — cross-cutting
  const [dataErr, setDataErr] = useState(null); // set when the data API is unreachable
  const [askSeed, setAskSeed] = useState(null); // a question pushed into the chat ("ask about this")
  const [copied, setCopied] = useState(false);

  // Build a shareable deep-link to the current view on demand (explicit, not auto-persisted).
  const copyShareLink = () => {
    const payload = { tab, ontoMode, ...(focus ? { focus } : {}), ...(hl ? { hl } : {}) };
    const url = `${location.origin}${location.pathname}#${btoa(encodeURIComponent(JSON.stringify(payload)))}`;
    navigator.clipboard?.writeText(url).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }, () => {});
  };

  useEffect(() => { listBusinessUnits().then(setBus); projectsLite().then(setProjects); }, []);
  const checkHealth = () => dataHealth().then((h) => setDataErr(h.ok ? null : h.message));
  useEffect(() => { checkHealth(); }, []);
  // persist ONLY navigational state (which tab / ontology mode) to the URL hash —
  // never the data-scoping filters — so reopening the app always shows full data.
  useEffect(() => {
    try { history.replaceState(null, "", "#" + btoa(encodeURIComponent(JSON.stringify({ tab, ontoMode })))); } catch { /* noop */ }
  }, [tab, ontoMode]);

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3 border-b border-white/10 bg-[#0d1218]">
        <span className="text-lg font-semibold tracking-tight text-amber-300/90">Clayco</span>
        <nav className="flex gap-1 ml-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                tab === t.id ? "bg-amber-500/20 text-amber-300" : "text-white/60 hover:text-white hover:bg-white/5"
              }`}>{t.label}</button>
          ))}
        </nav>
        {tab === "graph" && (
          <div className="flex items-center gap-1 ml-2 bg-white/5 rounded-md p-0.5">
            {[{ id: "3d", label: "3D" }, { id: "lifecycle", label: "2D story" }, { id: "network", label: "Network" }].map((m) => (
              <button key={m.id} onClick={() => setOntoMode(m.id)}
                className={`px-2.5 py-1 rounded text-xs transition ${
                  ontoMode === m.id ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"
                }`}>{m.label}</button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="bu-select" className="text-xs text-white/40">Business unit</label>
          <select id="bu-select" aria-label="Filter by business unit" value={bu || ""} onChange={(e) => setBu(e.target.value || null)}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-sm">
            <option value="">All Clayco</option>
            {bus.filter((b) => b.kind !== "enterprise").map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </header>
      {dataErr && (
        <div className="bg-red-500/15 border-b border-red-500/30 text-red-200 text-sm px-5 py-2 flex items-center gap-3">
          <span>⚠ Can't reach the data service — <span className="text-red-200/70">{dataErr}</span>. The backend is fine; your network/IP may be blocked from the API (try another network or a VPN).</span>
          <button onClick={checkHealth} className="ml-auto text-xs px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30">Retry</button>
        </div>
      )}
      {(focus || hl) && (
        <div className="flex items-center gap-2 px-5 py-1.5 border-b border-white/10 bg-amber-500/[0.06] text-xs">
          <span className="text-white/40 uppercase tracking-wide text-[10px]">Active filter</span>
          {focus && <FilterChip onClear={() => setFocus(null)}>Project · {focus.code || focus.name}</FilterChip>}
          {hl && <FilterChip onClear={() => setHl(null)}>{HL_DIM[hl.dim] || "Filter"} · {hl.label || hl.value}</FilterChip>}
          <button onClick={() => { setFocus(null); setHl(null); }} className="text-amber-300/80 hover:text-amber-200">Clear all</button>
          <button onClick={copyShareLink} title="Copy a link to this exact view" className="text-white/45 hover:text-white/80 border border-white/10 rounded px-2 py-0.5">{copied ? "✓ copied" : "🔗 copy link"}</button>
          <span className="ml-auto text-white/35">Scope: <span className="text-white/55">{scopeLabel(focus, hl)}</span></span>
        </div>
      )}
      <main className="flex-1 min-h-0">
        {tab === "graph" && ontoMode === "3d" && (
          <Suspense fallback={<div className="h-full grid place-items-center text-white/50 text-sm">loading 3D…</div>}>
            <Lifecycle3DView businessUnit={bu} focus={focus} setFocus={setFocus} hl={hl} setHl={setHl} />
          </Suspense>
        )}
        {tab === "graph" && ontoMode === "lifecycle" && <LifecycleView businessUnit={bu} />}
        {tab === "graph" && ontoMode === "network" && <GraphView businessUnit={bu} />}
        {tab === "data" && <DataView businessUnit={bu} focus={focus} setFocus={setFocus} hl={hl} setHl={setHl} goToOntology={() => setTab("graph")} />}
        {tab === "dashboard" && <DashboardView businessUnit={bu} bus={bus} focus={focus} setFocus={setFocus} onAsk={setAskSeed} />}
      </main>
      <AskDock projects={projects} focus={focus} setFocus={setFocus} setHl={setHl} goToOntology={() => setTab("graph")} seed={askSeed} onSeedConsumed={() => setAskSeed(null)} />
    </div>
  );
}

const HL_DIM = { masterformat: "MasterFormat", uniformat: "UniFormat", vendor: "Vendor", employee: "Employee" };
const scopeLabel = (focus, hl) =>
  [focus ? "1 project" : null, hl ? "highlight slice" : null].filter(Boolean).join(" · ") || "whole portfolio";

function FilterChip({ children, onClear }) {
  return (
    <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 text-amber-200 px-2 py-0.5">
      {children}
      <button onClick={onClear} aria-label="Clear filter" className="opacity-70 hover:opacity-100">✕</button>
    </span>
  );
}
