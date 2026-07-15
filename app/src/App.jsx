import { useEffect, useState, lazy, Suspense } from "react";
import { listBusinessUnits, projectsLite, dataHealth } from "./lib/api.js";
import AskDock from "./components/AskDock.jsx";
import HelpModal from "./components/HelpModal.jsx";
import { ShimmerStyle } from "./components/Skeleton.jsx";
import { loadPrefs, savePrefs } from "./lib/prefs.js";
import { setPalette } from "./lib/palette.js";

// Every view is its own chunk — three.js, sigma/graphology, and recharts only
// download when their tab/mode is first opened.
const Lifecycle3DView = lazy(() => import("./views/Lifecycle3DView.jsx"));
const LifecycleView = lazy(() => import("./views/LifecycleView.jsx"));
const GraphView = lazy(() => import("./views/GraphView.jsx"));
const DataView = lazy(() => import("./views/DataView.jsx"));
const DashboardView = lazy(() => import("./views/DashboardView.jsx"));

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
  const [help, setHelp] = useState(false);      // per-tab "what am I looking at?" modal
  const [menu, setMenu] = useState(false);      // display-preferences popover
  const [prefs, setPrefs] = useState(loadPrefs);
  const [prefsRev, setPrefsRev] = useState(0);  // bump → remount views that bake colors/labels

  const updatePrefs = (patch) => {
    const next = { ...prefs, ...patch };
    setPrefs(next); savePrefs(next); setPalette(next.palette);
    // palette + terminology are baked into the views at build time; contrast is pure CSS
    if ("palette" in patch || "literal" in patch) setPrefsRev((v) => v + 1);
  };

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
  // a pasted/edited hash after load re-routes too (replaceState above never fires this,
  // so there is no feedback loop) — same honored-on-arrival semantics as the initial hash
  useEffect(() => {
    const onHash = () => {
      try {
        const h = location.hash.slice(1); if (!h) return;
        const v = JSON.parse(decodeURIComponent(atob(h)));
        if (v.tab) setTab(v.tab);
        if (v.ontoMode) setOntoMode(v.ontoMode);
        if (v.focus) setFocus(v.focus);
        if (v.hl) setHl(v.hl);
      } catch { /* malformed hash — ignore */ }
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  return (
    <div className={`h-full flex flex-col overflow-x-hidden${prefs.contrast ? " cl-contrast" : ""}`}>
      <ShimmerStyle />
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:bg-amber-400 focus:text-black focus:px-3 focus:py-1.5 focus:rounded-md focus:text-sm">
        Skip to content
      </a>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 px-3 py-3 md:px-5 border-b border-white/10 bg-[#0d1218]">
        <h1 className="text-lg font-semibold tracking-tight text-amber-300/90">Clayco</h1>
        <nav className="flex gap-1 ml-1">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 max-md:py-3 rounded-md text-sm transition ${
                tab === t.id ? "bg-amber-500/20 text-amber-300" : "text-white/60 hover:text-white hover:bg-white/5"
              }`}>{t.label}</button>
          ))}
        </nav>
        {tab === "graph" && (
          <div className="flex items-center gap-1 ml-2 bg-white/5 rounded-md p-0.5">
            {[{ id: "3d", label: "3D" }, { id: "lifecycle", label: "2D story" }, { id: "network", label: "Network" }].map((m) => (
              <button key={m.id} onClick={() => setOntoMode(m.id)}
                className={`px-2.5 py-1 max-md:px-3.5 max-md:py-3 rounded text-xs transition ${
                  ontoMode === m.id ? "bg-white/10 text-white" : "text-white/45 hover:text-white/80"
                }`}>{m.label}</button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-2">
          <label htmlFor="bu-select" className="text-xs text-white/40 max-md:hidden">Business unit</label>
          <select id="bu-select" aria-label="Filter by business unit" value={bu || ""} onChange={(e) => setBu(e.target.value || null)}
            className="bg-white/5 border border-white/10 rounded-md px-2 py-1 max-md:py-2.5 text-sm min-w-0 max-md:max-w-[10rem]">
            <option value="">All Clayco</option>
            {bus.filter((b) => b.kind !== "enterprise").map((b) => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <div className="relative">
            <button onClick={() => setMenu((v) => !v)} aria-label="Display preferences" title="Display preferences"
              className="w-7 h-7 max-md:w-11 max-md:h-11 grid place-items-center rounded-md text-white/50 hover:text-white hover:bg-white/5 text-sm">⚙</button>
            {menu && <DisplayMenu prefs={prefs} update={updatePrefs} onClose={() => setMenu(false)} />}
          </div>
          <button onClick={() => setHelp(true)} aria-label="What am I looking at?" title="What am I looking at?"
            className="w-7 h-7 max-md:w-11 max-md:h-11 grid place-items-center rounded-md border border-white/15 text-white/50 hover:text-white hover:bg-white/5 text-xs font-semibold">?</button>
        </div>
      </header>
      {help && <HelpModal topic={tab} onClose={() => setHelp(false)} />}
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
      <main id="main" className="flex-1 min-h-0" key={prefsRev}>
        <Suspense fallback={<div className="h-full grid place-items-center text-white/50 text-sm">loading view…</div>}>
          {tab === "graph" && ontoMode === "3d" && (
            <Lifecycle3DView businessUnit={bu} focus={focus} setFocus={setFocus} hl={hl} setHl={setHl} />
          )}
          {tab === "graph" && ontoMode === "lifecycle" && <LifecycleView businessUnit={bu} />}
          {tab === "graph" && ontoMode === "network" && <GraphView businessUnit={bu} />}
          {tab === "data" && <DataView businessUnit={bu} focus={focus} setFocus={setFocus} hl={hl} setHl={setHl} goToOntology={() => setTab("graph")} />}
          {tab === "dashboard" && <DashboardView businessUnit={bu} bus={bus} focus={focus} setFocus={setFocus} onAsk={setAskSeed} />}
        </Suspense>
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

function DisplayMenu({ prefs, update, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-2 z-50 w-64 bg-[#0d1218] border border-white/10 rounded-xl p-3 shadow-2xl text-sm">
        <div className="text-white/40 text-[10px] uppercase tracking-wide mb-1">Display</div>
        <Toggle label="Colorblind-safe palette" hint="hue = domain family (matches the legend shapes), lightness = type"
          checked={prefs.palette === "colorblind"} onChange={(v) => update({ palette: v ? "colorblind" : "default" })} />
        <Toggle label="Higher contrast" hint="lifts dim text and hairline borders"
          checked={prefs.contrast} onChange={(v) => update({ contrast: v })} />
        <Toggle label="Literal labels" hint="plain construction terms instead of the flow metaphor"
          checked={prefs.literal} onChange={(v) => update({ literal: v })} />
      </div>
    </>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex items-start gap-2.5 py-1.5 cursor-pointer select-none">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 accent-amber-400" />
      <span>
        <span className="text-white/85">{label}</span>
        {hint && <span className="block text-[11px] text-white/40 leading-snug">{hint}</span>}
      </span>
    </label>
  );
}
