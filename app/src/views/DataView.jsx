import { useEffect, useMemo, useState } from "react";
import { allEntities, listBusinessUnits, projectsLite, entityFacts, classificationCodes, entityDetail } from "../lib/api.js";
import { colorFor } from "../lib/palette.js";

// ─────────────────────────────────────────────────────────────────────────────
// Data Explorer — every node in the ontology as one sortable, filterable table.
// The "translate the graph into organized rows" layer between ontology & reporting.
// ─────────────────────────────────────────────────────────────────────────────

const COLS = [
  { key: "type", label: "Type" },
  { key: "name", label: "Name", grow: true },
  { key: "domain", label: "Domain" },
  { key: "project", label: "Project" },
  { key: "bu", label: "Business Unit" },
  { key: "csi", label: "CSI" },
  { key: "amount", label: "$ Amount", num: true, align: "right" },
  { key: "activity", label: "Last Activity", date: true },
];

const fmt$ = (n) => (n == null ? "" : "$" + (Number(n) >= 1e6 ? (n / 1e6).toFixed(1) + "M" : (n / 1e3).toFixed(0) + "K"));
const fmtDate = (s) => (s ? new Date(s).toISOString().slice(0, 10) : "");

export default function DataView({ businessUnit }) {
  const [ents, setEnts] = useState(null);
  const [bus, setBus] = useState([]);
  const [projs, setProjs] = useState([]);
  const [facts, setFacts] = useState({ a: new Map(), m: new Map() });
  const [codes, setCodes] = useState(new Map());
  const [selected, setSelected] = useState(null);

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

  const buById = useMemo(() => new Map(bus.map((b) => [b.id, b.name])), [bus]);
  const projById = useMemo(() => new Map(projs.map((p) => [p.id, p])), [projs]);

  const rows = useMemo(() => {
    if (!ents) return [];
    return ents.map((e) => {
      const pid = e.properties?.project_id;
      const proj = pid ? projById.get(pid) : (e.entity_type === "Project" ? { code: e.properties?.code } : null);
      const c = e.classification_id ? codes.get(e.classification_id) : null;
      return {
        id: e.id, type: e.entity_type, name: e.label, domain: e.domain || "",
        project: proj?.code || "", bu: buById.get(e.business_unit_id) || "",
        csi: c ? c.code : "", amount: facts.m.get(e.id) ?? null, activity: facts.a.get(e.id) || "",
      };
    });
  }, [ents, projById, buById, codes, facts]);

  const types = useMemo(() => [...new Set(rows.map((r) => r.type))].sort(), [rows]);
  const domains = useMemo(() => [...new Set(rows.map((r) => r.domain).filter(Boolean))].sort(), [rows]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter((r) =>
      (!typeF || r.type === typeF) && (!domainF || r.domain === domainF) && (!buF || r.bu === buF) &&
      (!businessUnit || r.bu === (buById.get(businessUnit) || "")) &&
      (!needle || `${r.name} ${r.type} ${r.project} ${r.csi}`.toLowerCase().includes(needle)),
    );
    const { key, dir } = sort;
    out = [...out].sort((x, y) => {
      let a = x[key], b = y[key];
      if (key === "amount") { a = a ?? -1; b = b ?? -1; return (a - b) * dir; }
      a = (a || "").toString(); b = (b || "").toString();
      return a.localeCompare(b) * dir;
    });
    return out;
  }, [rows, q, typeF, domainF, buF, businessUnit, buById, sort]);

  const totalAmt = useMemo(() => filtered.reduce((s, r) => s + (r.amount || 0), 0), [filtered]);

  const setSortKey = (key) => setSort((s) => (s.key === key ? { key, dir: -s.dir } : { key, dir: 1 }));
  const openRow = async (id) => { setSelected({ loading: true }); const d = await entityDetail(id); setSelected(d || { missing: true }); };

  return (
    <div className="h-full flex">
      <div className="flex-1 min-w-0 flex flex-col">
        {/* filter bar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 text-sm">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, type, project, CSI…"
            className="bg-white/5 border border-white/10 rounded-md px-3 py-1.5 text-sm w-64 outline-none focus:border-amber-500/40" />
          <Sel value={typeF} onChange={setTypeF} opts={types} placeholder="All types" />
          <Sel value={domainF} onChange={setDomainF} opts={domains} placeholder="All domains" />
          <Sel value={buF} onChange={setBuF} opts={bus.map((b) => b.name)} placeholder="All business units" />
          {(q || typeF || domainF || buF) && <button onClick={() => { setQ(""); setTypeF(""); setDomainF(""); setBuF(""); }} className="text-xs text-amber-300/80 hover:text-amber-200">clear</button>}
          <div className="ml-auto text-xs text-white/45">
            {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} · {fmt$(totalAmt)} total
          </div>
        </div>

        {/* table */}
        <div className="flex-1 overflow-auto">
          {!ents ? <div className="p-6 text-white/50 text-sm">loading data…</div> : (
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-[#0b0f14] z-10">
                <tr className="text-left text-white/45 text-xs uppercase tracking-wide">
                  {COLS.map((c) => (
                    <th key={c.key} onClick={() => setSortKey(c.key)}
                      className={`px-3 py-2 cursor-pointer hover:text-white/80 select-none border-b border-white/10 ${c.align === "right" ? "text-right" : ""}`}>
                      {c.label}{sort.key === c.key ? (sort.dir > 0 ? " ↑" : " ↓") : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.id} onClick={() => openRow(r.id)} className="border-b border-white/5 hover:bg-white/5 cursor-pointer">
                    <td className="px-3 py-1.5"><span className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(r.type) }} />{r.type}</span></td>
                    <td className="px-3 py-1.5 text-white/90 max-w-[28rem] truncate">{r.name}</td>
                    <td className="px-3 py-1.5 text-white/55">{r.domain.replace(/_/g, " ")}</td>
                    <td className="px-3 py-1.5 text-white/70">{r.project}</td>
                    <td className="px-3 py-1.5 text-white/55">{r.bu}</td>
                    <td className="px-3 py-1.5 text-white/55">{r.csi}</td>
                    <td className="px-3 py-1.5 text-right text-cyan-300/80 tabular-nums">{fmt$(r.amount)}</td>
                    <td className="px-3 py-1.5 text-white/55 tabular-nums">{fmtDate(r.activity)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <aside className="w-80 shrink-0 border-l border-white/10 p-4 overflow-auto text-sm bg-[#0d1218]">
          {selected.loading ? <div className="text-white/50">loading…</div> : selected.missing ? <div className="text-white/50">no detail</div> : (
            <>
              <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white/70 text-xs mb-2">✕ close</button>
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
    <select value={value} onChange={(e) => onChange(e.target.value)}
      className="bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white/80 outline-none">
      <option value="">{placeholder}</option>
      {opts.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
