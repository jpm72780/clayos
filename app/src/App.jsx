import { useEffect, useState, lazy, Suspense } from "react";
import { listBusinessUnits, projectsLite } from "./lib/api.js";
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
  const [focus, setFocus] = useState(null); // {pid,name,code} — a project, shared across pages
  const [hl, setHl] = useState(null);       // {dim,value,label,depth} — cross-cutting highlight, shared

  useEffect(() => { listBusinessUnits().then(setBus); projectsLite().then(setProjects); }, []);
  // persist ONLY navigational state (which tab / ontology mode) to the URL hash —
  // never the data-scoping filters — so reopening the app always shows full data.
  useEffect(() => {
    try { history.replaceState(null, "", "#" + btoa(encodeURIComponent(JSON.stringify({ tab, ontoMode })))); } catch { /* noop */ }
  }, [tab, ontoMode]);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-white/10 bg-[#0d1218]">
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
          <label className="text-xs text-white/40">Business unit</label>
          <select value={bu || ""} onChange={(e) => setBu(e.target.value || null)}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-sm">
            <option value="">All Clayco</option>
            {bus.filter((b) => b.kind !== "enterprise").map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
        </div>
      </header>
      <main className="flex-1 min-h-0">
        {tab === "graph" && ontoMode === "3d" && (
          <Suspense fallback={<div className="h-full grid place-items-center text-white/50 text-sm">loading 3D…</div>}>
            <Lifecycle3DView businessUnit={bu} focus={focus} setFocus={setFocus} hl={hl} setHl={setHl} />
          </Suspense>
        )}
        {tab === "graph" && ontoMode === "lifecycle" && <LifecycleView businessUnit={bu} />}
        {tab === "graph" && ontoMode === "network" && <GraphView businessUnit={bu} />}
        {tab === "data" && <DataView businessUnit={bu} focus={focus} setFocus={setFocus} hl={hl} setHl={setHl} goToOntology={() => setTab("graph")} />}
        {tab === "dashboard" && <DashboardView businessUnit={bu} bus={bus} focus={focus} setFocus={setFocus} />}
      </main>
      <AskDock projects={projects} focus={focus} setFocus={setFocus} setHl={setHl} goToOntology={() => setTab("graph")} />
    </div>
  );
}
