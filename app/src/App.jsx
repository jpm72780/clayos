import { useEffect, useState, lazy, Suspense } from "react";
import { listBusinessUnits } from "./lib/api.js";
import GraphView from "./views/GraphView.jsx";
import LifecycleView from "./views/LifecycleView.jsx";
import DataView from "./views/DataView.jsx";
import DashboardView from "./views/DashboardView.jsx";
import AskView from "./views/AskView.jsx";

const Lifecycle3DView = lazy(() => import("./views/Lifecycle3DView.jsx"));

const TABS = [
  { id: "graph", label: "Ontology" },
  { id: "data", label: "Data" },
  { id: "dashboard", label: "Reporting" },
  { id: "ask", label: "Ask ClayOS" },
];

export default function App() {
  const [tab, setTab] = useState("graph");
  const [ontoMode, setOntoMode] = useState("3d"); // '3d' | 'lifecycle' | 'network'
  const [bus, setBus] = useState([]);
  const [bu, setBu] = useState(null); // selected business_unit_id (null = all)

  useEffect(() => { listBusinessUnits().then(setBus); }, []);

  return (
    <div className="h-full flex flex-col">
      <header className="flex items-center gap-4 px-5 py-3 border-b border-white/10 bg-[#0d1218]">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-semibold tracking-tight">ClayOS</span>
          <span className="text-xs text-white/40">Clayco operating system · POC</span>
        </div>
        <nav className="flex gap-1 ml-4">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm transition ${
                tab === t.id ? "bg-amber-500/20 text-amber-300" : "text-white/60 hover:text-white hover:bg-white/5"
              }`}>{t.label}</button>
          ))}
        </nav>
        {tab === "graph" && (
          <div className="flex items-center gap-1 ml-2 bg-white/5 rounded-md p-0.5">
            {[{ id: "3d", label: "Lifecycle 3D" }, { id: "lifecycle", label: "2D story" }, { id: "network", label: "Network" }].map((m) => (
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
            <Lifecycle3DView businessUnit={bu} />
          </Suspense>
        )}
        {tab === "graph" && ontoMode === "lifecycle" && <LifecycleView businessUnit={bu} />}
        {tab === "graph" && ontoMode === "network" && <GraphView businessUnit={bu} />}
        {tab === "data" && <DataView businessUnit={bu} />}
        {tab === "dashboard" && <DashboardView businessUnit={bu} bus={bus} />}
        {tab === "ask" && <AskView />}
      </main>
    </div>
  );
}
