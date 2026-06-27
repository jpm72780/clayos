import { useEffect, useState } from "react";
import { listBusinessUnits } from "./lib/api.js";
import GraphView from "./views/GraphView.jsx";
import DashboardView from "./views/DashboardView.jsx";
import AskView from "./views/AskView.jsx";

const TABS = [
  { id: "graph", label: "Ontology" },
  { id: "dashboard", label: "Reporting" },
  { id: "ask", label: "Ask ClayOS" },
];

export default function App() {
  const [tab, setTab] = useState("graph");
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
        {tab === "graph" && <GraphView businessUnit={bu} />}
        {tab === "dashboard" && <DashboardView businessUnit={bu} bus={bus} />}
        {tab === "ask" && <AskView />}
      </main>
    </div>
  );
}
