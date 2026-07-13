import { useEffect, useMemo, useState } from "react";
import { allEntities, listBusinessUnits, projectsLite, entityFacts, classificationCodes, entityDetail, neighbors } from "../lib/api.js";
import { colorFor, shapeFor } from "../lib/palette.js";
import { SkeletonTable } from "../components/Skeleton.jsx";

// ─────────────────────────────────────────────────────────────────────────────
// Clayco Data — every node in the ontology as one sortable, filterable table,
// with live quantification that reacts to the filters. Cross-filters with the
// ontology: an active Highlight-by key or a focused project scopes the table,
// and a row can jump to the 3D ontology.
// ─────────────────────────────────────────────────────────────────────────────

const COLS = [
  { key: "type", label: "Type" },
  { key: "name", label: "Name", grow: true },
  { key: "domain", label: "Domain" },
  { key: "project", label: "Project" },
  { key: "bu", label: "Business Unit" },
  { key: "csi", label: "CSI" },
  { key: "status", label: "Status" },
  { key: "amount", label: "$ Amount", num: true, align: "right" },
  { key: "activity", label: "Last Activity", date: true },
];
const TYPES_WITH_STATUS = ["RFI", "Submittal", "Contract", "PayApp", "QualityEvent", "Requisition", "Pursuit"];

const fmt$ = (n) => (n == null ? "" : "$" + (Math.abs(Number(n)) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n / 1e3).toFixed(0) + "K"));
const fmtDate = (s) => (s ? new Date(s).toISOString().slice(0, 10) : "");
const daysAgo = (s) => (s ? (Date.now() - new Date(s).getTime()) / 8.64e7 : Infinity);

export default function DataView({ businessUnit, focus, setFocus, hl, setHl, goToOntology }) {
  const [ents, setEnts] = useState(null);
  const [bus, setBus] = useState([]);
  const [projs, setProjs] = useState([]);
  const [facts, setFacts] = useState({ a: new Map(), m: new Map() });
  const [codes, setCodes] = useState(new Map());
  const [selected, setSelected] = useState(null);
  const [showQuant, setShowQuant] = useState(true);
  const [hlNeighbors, setHlNeighbors] = useState(null); // ids connected to a vendor/employee highlight

  const [q, setQ] = useState("");
  const [typeF, setTypeF] = useState("");
  const [domainF, setDomainF] = useState("");
  const [buF, setBuF] = useState("");
  const [sort, setSort] = useState({ key: "type", dir: 1 });

  useEffect(() => {
    allEntities().then(setEnts);
    listBusinessUnits().then(setBus);
    projectsLite().then(setProjs);
    classificationCodes().then((cc) => setCodes(new Map(cc.map((c) => [c.id, c]))));
    entityFacts().then((rows) => {
      const a = new Map(), m = new Map();
      for (const r of rows) { if (r.activity_at) a.set(r.entity_id, r.activity_at); if (r.amount != null) m.set(r.entity_id, Number(r.amount)); }
      setFacts({ a, m });
    });
  }, []);

  // a vendor/employee highlight from the ontology scopes the table to its connected entities
  useEffect(() => {
    if (hl && (hl.dim === "vendor" || hl.dim === "employee")) {
      neighbors(hl.value).then((n) => setHlNeighbors(new Set([(hl.value), ...(n.nodes || []).map((x) => x.id)]))).catch(() => setHlNeighbors(null));
    } else setHlNeighbors(null);
  }, [hl]);

  const buById = useMemo(() => new Map(bus.map((b) => [b.id, b.name])), [bus]);
  const projById = useMemo(() => new Map(projs.map((p) => [p.id, p])), [projs]);

  const rows = useMemo(() => {
    if (!ents) return [];
    return ents.map((e) => {
      const pid = e.entity_type === "Project" ? e.source_id : e.properties?.project_id;
      const proj = pid ? projById.get(pid) : null;
      const c = e.classification_id ? codes.get(e.classification_id) : null;
      return {
        id: e.id, type: e.entity_type, name: e.label, domain: e.domain || "",
        pid, project: proj?.code || (e.entity_type === "Project" ? e.properties?.code : "") || "",
        bu: buById.get(e.business_unit_id) || "", csi: c ? c.code : "", csiSystem: c ? c.system_id : "",
        status: e.properties?.status || "", amount: facts.m.get(e.id) ?? null, activity: facts.a.get(e.id) || "",
      };
    });
  }, [ents, projById, buById, codes, facts]);

  const types = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows]);
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain).filter(Boolean))].sort(), [rows]);

  // classification highlight scopes the table (vendor/employee highlights don't map to rows)
  const hlClass = hl && (hl.dim === "masterformat" || hl.dim === "uniformat") ? hl : null;
  const matchesHl = (r) => {
    if (!hlClass) return true;
    if (r.csiSystem !== hlClass.dim) return false;
    return hlClass.dim === "masterformat" && hlClass.depth === 0 ? r.csi.slice(0, 2) === hlClass.value.slice(0, 2) : r.csi === hlClass.value;
  };

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) =>
      (!typeF || r.type === typeF) && (!domainF || r.domain === domainF) && (!buF || r.bu === buF) &&
      (!businessUnit || r.bu === (buById.get(businessUnit) || "")) &&
      (!focus || r.pid === focus.pid) && matchesHl(r) &&
      (!hlNeighbors || hlNeighbors.has(r.id)) &&
      (!needle || `${r.name} ${r.type} ${r.project} ${r.csi} ${r.status}`.toLowerCase().includes(needle)),
    );
    const { key, dir } = sort;
    out = [...out].sort((x, y) => {
      let a = x[key], b = y[key];
      if (key === "amount") { a = a ?? -1; b = b ?? -1; return (a - b) * dir; }
      return (a || "").toString().localeCompare((b || "").toString()) * dir;
    });
    return out;
  }, [rows, q, typeF, domainF, buF, businessUnit, buById, focus, hlClass, hlNeighbors, sort]);

  // quantification over the FILTERED rows — reacts to every filter
  const stats = useMemo(() => {
    const byType = new Map(), byDomain = new Map(), statusByType = new Map();
    let amount = 0, m7 = 0, m30 = 0, m60 = 0;
    for (const r of filtered) {
      const t = byType.get(r.type) || { count: 0, amount: 0, recent: 0 };
      t.count++; if (r.amount) t.amount += r.amount; if (daysAgo(r.activity) <= 60) t.recent++;
      byType.set(r.type, t);
      byDomain.set(r.domain || "—", (byDomain.get(r.domain || "—") || 0) + 1);
      if (r.amount) amount += r.amount;
      const d = daysAgo(r.activity); if (d <= 7) m7++; if (d <= 30) m30++; if (d <= 60) m60++;
      if (r.status) { const s = statusByType.get(r.type) || new Map(); s.set(r.status, (s.get(r.status) || 0) + 1); statusByType.set(r.type, s); }
    }
    return {
      count: filtered.length, amount, m7, m30, m60,
      byType: [...byType.entries()].sort((a, b) => b[1].count - a[1].count),
      byDomain: [...byDomain.entries()].sort((a, b) => b[1] - a[1]),
      statusByType: [...statusByType.entries()].filter(([t]) => TYPES_WITH_STATUS.includes(t)),
    };
  }, [filtered]);

  const setSortKey = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const openRow = async (id) => { setSelected({ loading: true }); const d = await entityDetail(id); setSelected(d || { missing: true }); };
  const viewInOntology = (r) => { if (r.pid) { const p = projById.get(r.pid); setFocus({ pid: r.pid, name: p?.name, code: p?.code }); goToOntology?.(); } };
  const maxDomain = Math.max(1, ...stats.byDomain.map(([, c]) => c));
  const hlVendor = hl && (hl.dim === "vendor" || hl.dim === "employee") ? hl : null;
  const downloadCsv = () => {
    const cols = ["type", "name", "domain", "project", "bu", "csi", "status", "amount", "activity"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(","), ...filtered.map((r) => cols.map((c) => esc(r[c])).join(","))];
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "clayco-data.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* filter bar + cross-filter chips */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 text-sm">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, type, project, CSI, status…" aria-label="Search entities"
            className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm w-60 outline-none focus:border-amber-500/40" />
          <Sel value={typeF} onChange={setTypeF} opts={types} placeholder="All types" />
          <Sel value={domainF} onChange={setDomainF} opts={domains} placeholder="All domains" />
          <Sel value={buF} onChange={setBuF} opts={bus.map((b) => b.name)} placeholder="All business units" />
          {focus && <Chip color="amber" onClear={() => setFocus(null)}>Project: {focus.code || focus.name}</Chip>}
          {hlClass && <Chip color="cyan" onClear={() => setHl(null)}>{hlClass.label}</Chip>}
          {hlVendor && <Chip color="cyan" onClear={() => setHl(null)}>{hlVendor.label}</Chip>}
          {(q || typeF || domainF || buF) && <button onClick={() => { setQ(""); setTypeF(""); setDomainF(""); setBuF(""); }} className="text-xs text-white/50 hover:text-white/80">clear filters</button>}
          <button onClick={downloadCsv} className="text-xs text-white/55 hover:text-white/90 border border-white/10 rounded px-2 py-1">⤓ CSV</button>
          <button onClick={() => setShowQuant((s) => !s)} className="ml-auto text-xs text-white/45 hover:text-white/80">{showQuant ? "▾" : "▸"} quantify</button>
          <div className="text-xs text-white/45">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} · {fmt$(stats.amount)}</div>
        </div>

        {/* quantification — reacts to the filters */}
        {showQuant && ents && (
          <div className="px-4 py-3 border-b border-white/10 bg-[#0a0e13] overflow-auto max-h-64">
            <div className="flex flex-wrap gap-2 mb-3">
              <Tile label="Data points" value={stats.count.toLocaleString()} />
              <Tile label="$ value" value={fmt$(stats.amount)} />
              <Tile label="Moved · 7d" value={stats.m7} accent />
              <Tile label="Moved · 30d" value={stats.m30} accent />
              <Tile label="Moved · 60d" value={stats.m60} accent />
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {/* by domain */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">By domain</div>
                <div className="space-y-1">
                  {stats.byDomain.map(([d, c]) => (
                    <div key={d} className="flex items-center gap-2 text-xs">
                      <span className="w-28 shrink-0 text-white/60 truncate capitalize">{d.replace(/_/g, " ")}</span>
                      <span className="flex-1 h-2 bg-white/5 rounded"><span className="block h-2 bg-cyan-500/50 rounded" style={{ width: `${(c / maxDomain) * 100}%` }} /></span>
                      <span className="w-10 text-right tabular-nums text-white/70">{c}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* by type */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">By type</div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {stats.byType.map(([t, v]) => (
                    <button key={t} onClick={() => setTypeF(typeF === t ? "" : t)} className={`flex items-center gap-1.5 text-xs text-left hover:text-white ${typeF === t ? "text-amber-300" : "text-white/70"}`}>
                      <span className="w-3 text-center leading-none shrink-0" style={{ color: colorFor(t) }}>{shapeFor(t)}</span>
                      <span className="flex-1 truncate">{t}</span>
                      <span className="tabular-nums text-white/50">{v.count}</span>
                    </button>
                  ))}
                </div>
              </div>
              {/* status deep-dives */}
              <div>
                <div className="text-[10px] uppercase tracking-wide text-white/40 mb-1">Status / disposition</div>
                <div className="flex flex-wrap gap-2">
                  {stats.statusByType.length === 0 && <div className="text-xs text-white/30">— no status fields in view —</div>}
                  {stats.statusByType.map(([t, sm]) => (
                    <div key={t} className="bg-white/5 rounded-lg px-2.5 py-1.5">
                      <div className="text-[11px] text-white/60 mb-0.5">{t}</div>
                      <div className="flex gap-2">
                        {[...sm.entries()].map(([s, c]) => (
                          <span key={s} className="text-[11px]"><span className={`font-semibold ${s === "open" ? "text-red-400" : "text-white/85"}`}>{c}</span> <span className="text-white/40">{s}</span></span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* table */}
        <div className="flex-1 overflow-auto">
          {!ents ? <SkeletonTable /> : (
            <table className="w-full text-sm border-collapse max-md:min-w-[880px]" aria-label="Clayco entities">
              <thead className="sticky top-0 bg-[#0b0f14] z-10">
                <tr className="text-left text-white/45 text-xs uppercase tracking-wide">
                  {COLS.map((c) => (
                    <th key={c.key} scope="col" tabIndex={0} onClick={() => setSortKey(c.key)}
                      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setSortKey(c.key); } }}
                      aria-sort={sort.key === c.key ? (sort.dir > 0 ? "ascending" : "descending") : "none"}
                      className={`px-3 py-2 cursor-pointer hover:text-white/80 select-none border-b border-white/10 focus:outline-none focus:text-amber-300 focus:ring-1 focus:ring-amber-500/40 ${c.align === "right" ? "text-right" : ""}`}>
                      {c.label}{sort.key === c.key ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.slice(0, 800).map((r) => (
                  <tr key={r.id} onClick={() => openRow(r.id)} tabIndex={0} aria-label={`${r.type}: ${r.name}`}
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); openRow(r.id); } }}
                    className="border-b border-white/5 hover:bg-white/5 focus:bg-white/10 focus:outline-none cursor-pointer">
                    <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1.5"><span className="w-3 text-center leading-none shrink-0" style={{ color: colorFor(r.type) }}>{shapeFor(r.type)}</span>{r.type}</span></td>
                    <td className="px-3 py-1.5 text-white/90 max-w-[26rem] truncate">{r.name}</td>
                    <td className="px-3 py-1.5 text-white/55 capitalize">{r.domain.replace(/_/g, " ")}</td>
                    <td className="px-3 py-1.5 text-white/70">{r.project}</td>
                    <td className="px-3 py-1.5 text-white/55">{r.bu}</td>
                    <td className="px-3 py-1.5 text-white/55">{r.csi}</td>
                    <td className={`px-3 py-1.5 ${r.status === "open" ? "text-red-400/90" : "text-white/55"}`}>{r.status}</td>
                    <td className="px-3 py-1.5 text-right text-cyan-300/80 tabular-nums">{fmt$(r.amount)}</td>
                    <td className="px-3 py-1.5 text-white/55 tabular-nums">{fmtDate(r.activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {ents && filtered.length > 800 && (
            <div className="px-4 py-3 text-xs text-white/40">Showing first 800 of {filtered.length.toLocaleString()} rows — refine the filters or export CSV for the full set.</div>
          )}
        </div>
      </div>

      {selected && (
        <aside className="w-80 max-w-[80vw] shrink-0 border-l border-white/10 p-4 overflow-auto text-sm bg-[#0d1218]
          max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:w-full max-md:max-w-none max-md:border-l-0 max-md:border-t max-md:rounded-t-xl max-md:max-h-[70vh] max-md:pb-16 max-md:shadow-2xl">
          {selected.loading ? <div className="text-white/50">loading…</div> : selected.missing ? <div className="text-white/50">no detail</div> : (
            <>
              <div className="flex items-center justify-between mb-2">
                <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white/70 text-xs">✕ close</button>
                {selected.entity && (() => { const r = rows.find((x) => x.id === selected.entity.id); return r?.pid ? <button onClick={() => viewInOntology(r)} className="text-xs text-amber-300/90 hover:text-amber-200">⤴ view in ontology</button> : null; })()}
              </div>
              <div className="flex items-center gap-2 mb-1"><span className="w-3 h-3 rounded-full" style={{ background: colorFor(selected.entity.entity_type) }} /><span className="text-xs text-white/50">{selected.entity.entity_type} · {selected.entity.domain}</span></div>
              <div className="text-base font-semibold mb-3">{selected.entity.label}</div>
              <div className="text-white/40 text-xs uppercase tracking-wide mb-1">Record · {selected.entity.source_table}</div>
              <table className="w-full text-xs mb-4"><tbody>
                {Object.entries(selected.record || {}).filter(([k]) => k !== "id").slice(0, 28).map(([k, v]) => (
                  <tr key={k} className="border-b border-white/5"><td className="py-1 pr-2 text-white/40 align-top">{k}</td><td className="py-1 text-white/80 break-words">{v === null ? "—" : String(v)}</td></tr>
                ))}
              </tbody></table>
              <div className="text-white/40 text-xs uppercase tracking-wide mb-1">Connected ({(selected.neighbors.nodes || []).length - 1})</div>
              <div className="space-y-1">
                {(selected.neighbors.nodes || []).filter((n) => n.id !== selected.entity.id).slice(0, 30).map((n) => (
                  <div key={n.id} className="flex items-center gap-2 text-white/70"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(n.type) }} /><span className="truncate">{n.label}</span><span className="text-white/30 text-[10px] ml-auto shrink-0">{n.type}</span></div>
                ))}
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

function Sel({ value, onChange, opts, placeholder }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={placeholder} className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white/80 outline-none">
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
function Chip({ children, onClear, color }) {
  const c = color === "cyan" ? "bg-cyan-500/15 text-cyan-200" : "bg-amber-500/15 text-amber-200";
  return <span className={`inline-flex items-center gap-1 text-xs rounded px-2 py-1 ${c}`}>{children}<button onClick={onClear} className="opacity-70 hover:opacity-100">✕</button></span>;
}
function Tile({ label, value, accent }) {
  return (
    <div className="bg-[#0d1218] border border-white/10 rounded-lg px-3 py-1.5 min-w-[92px]">
      <div className="text-[10px] text-white/45">{label}</div>
      <div className={`text-lg font-semibold leading-tight ${accent ? "text-cyan-300" : "text-white/90"}`}>{value}</div>
    </div>
  );
}
