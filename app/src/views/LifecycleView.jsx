import { useEffect, useMemo, useState } from "react";
import { subgraph, entityDetail, classificationCodes, entityClassMap } from "../lib/api.js";
import { colorFor, TYPE_COLOR } from "../lib/palette.js";

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle "story" layout for the ontology.
//
// Instead of a force-directed hairball, we read the data the way the business
// reads: LEFT → RIGHT along the project lifecycle. Each project is a MASS whose
// size = how much data it has accumulated, so the portfolio's data profile forms
// a bell over the lifecycle axis (thin in pursuit/design, fat in construction,
// tapering at closeout). Below the baseline sits the ENTERPRISE BACKBONE —
// people, orgs, IT, pipeline — the data that runs the business but barely touches
// any one project; faint threads show where it does.
//
// "Highlight by" rail lets you light up the cross-cutting dimensions that carry
// data BETWEEN systems — MasterFormat (CSI) & UniFormat standards, a vendor, an
// employee — across every project at once (highlight, don't remove).
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = [
  { key: "pursuit", label: "Pursuit" },
  { key: "design", label: "Design" },
  { key: "precon", label: "Preconstruction" },
  { key: "construction", label: "Construction" },
  { key: "closeout", label: "Closeout" },
];
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s.key, i]));

const BACKBONE_ROWS = [
  { label: "People", types: ["Person"] },
  { label: "Organizations", types: ["Organization"] },
  { label: "IT assets", types: ["ITAsset"] },
  { label: "Pipeline & precon", types: ["Pursuit", "Estimate", "Requisition"] },
];

const VH = 1000;
const BASELINE = 560;
const MARGIN_X = 90;
const GAP = 60;
const RK = 10;
const BACKBONE_TOP = 690;
const BACKBONE_BOT = 950;
const PHI = Math.PI * (3 - Math.sqrt(5));

function classify(data) {
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const projectNodes = data.nodes.filter((n) => n.type === "Project");

  const adj = new Map();
  for (const e of data.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target);
    adj.get(e.target).push(e.source);
  }

  const projByPid = new Map();   // projects.id -> project node
  const pidByNodeId = new Map(); // project node id -> projects.id
  for (const p of projectNodes) {
    const counts = {};
    for (const nbrId of adj.get(p.id) || []) {
      const pid = nodesById.get(nbrId)?.properties?.project_id;
      if (pid) counts[pid] = (counts[pid] || 0) + 1;
    }
    const pid = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (pid) { projByPid.set(pid, p); pidByNodeId.set(p.id, pid); }
  }

  const childrenByPid = new Map();
  const backbone = [];
  for (const n of data.nodes) {
    if (n.type === "Project") continue;
    const pid = n.properties?.project_id;
    if (pid && projByPid.has(pid)) {
      if (!childrenByPid.has(pid)) childrenByPid.set(pid, []);
      childrenByPid.get(pid).push(n);
    } else {
      backbone.push(n);
    }
  }

  const projects = [...projByPid.entries()].map(([pid, node]) => {
    const kids = childrenByPid.get(pid) || [];
    const stage = node.properties?.lifecycle_stage || "construction";
    return {
      pid, node, kids, count: kids.length, stage,
      stageIdx: STAGE_INDEX[stage] ?? 3,
      name: node.label,
      code: node.properties?.code || "",
      value: Number(node.properties?.contract_value) || 0,
    };
  });
  projects.sort((a, b) => a.stageIdx - b.stageIdx || b.count - a.count);

  return { projects, backbone, nodesById, adj, projByPid, pidByNodeId };
}

function layout(model) {
  const { projects, backbone, adj, nodesById, projByPid, pidByNodeId } = model;

  let cursor = MARGIN_X;
  const placed = projects.map((p) => {
    const R = RK * Math.sqrt(Math.max(p.count, 4));
    const x = cursor + R;
    cursor = x + R + GAP;
    return { ...p, R, anchor: { x, y: BASELINE } };
  });
  const VW = Math.max(cursor + MARGIN_X, 1400);
  const anchorByPid = new Map(placed.map((p) => [p.pid, p.anchor]));

  const dots = [];
  for (const p of placed) {
    const n = p.kids.length || 1;
    p.kids.forEach((kid, k) => {
      const rr = p.R * Math.sqrt((k + 0.5) / n);
      const a = k * PHI;
      dots.push({
        id: kid.id, node: kid, pid: p.pid,
        x: p.anchor.x + rr * Math.cos(a),
        y: p.anchor.y - Math.abs(rr * Math.sin(a)) - 6,
        color: colorFor(kid.type),
      });
    });
  }

  const brackets = [];
  for (const p of placed) {
    const last = brackets[brackets.length - 1];
    if (last && last.stage === p.stage) {
      last.x0 = Math.min(last.x0, p.anchor.x - p.R);
      last.x1 = Math.max(last.x1, p.anchor.x + p.R);
    } else {
      brackets.push({
        stage: p.stage,
        label: STAGES.find((s) => s.key === p.stage)?.label || p.stage,
        x0: p.anchor.x - p.R, x1: p.anchor.x + p.R,
      });
    }
  }

  const tops = placed.map((p) => ({ x: p.anchor.x, y: p.anchor.y - p.R * 1.08 }));
  const envelope = smoothArea(
    [{ x: MARGIN_X * 0.5, y: BASELINE }, ...tops, { x: VW - MARGIN_X * 0.5, y: BASELINE }],
    BASELINE,
  );

  const rowH = (BACKBONE_BOT - BACKBONE_TOP) / BACKBONE_ROWS.length;
  const backDots = [];
  BACKBONE_ROWS.forEach((row, ri) => {
    const members = backbone.filter((n) => row.types.includes(n.type));
    const y = BACKBONE_TOP + rowH * (ri + 0.5);
    const span = VW - 2 * MARGIN_X;
    members.forEach((n, i) => {
      const x = MARGIN_X + (members.length === 1 ? span / 2 : (span * i) / (members.length - 1));
      backDots.push({ id: n.id, node: n, x, y, color: colorFor(n.type) });
    });
  });

  const threads = [];
  for (const d of backDots) {
    const touched = new Set();
    for (const nbrId of adj.get(d.node.id) || []) {
      const nbr = nodesById.get(nbrId);
      const pid = nbr?.type === "Project" ? pidByNodeId.get(nbrId) : nbr?.properties?.project_id;
      if (pid && anchorByPid.has(pid)) touched.add(pid);
    }
    for (const pid of touched) {
      const a = anchorByPid.get(pid);
      threads.push({ fromId: d.id, pid, x1: d.x, y1: d.y, x2: a.x, y2: a.y, color: d.color });
    }
  }

  return { VW, placed, dots, brackets, envelope, backDots, threads, anchorByPid };
}

function smoothArea(pts, floorY) {
  if (pts.length < 2) return "";
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${last.x} ${floorY} L ${pts[0].x} ${floorY} Z`;
  return d;
}

const SYSTEM_LABEL = { masterformat: "MasterFormat (CSI)", uniformat: "UniFormat" };

export default function LifecycleView({ businessUnit }) {
  const [data, setData] = useState(null);
  const [codes, setCodes] = useState([]);          // classification_codes
  const [classByEntity, setClassByEntity] = useState(new Map()); // entityId -> classCodeId
  const [selected, setSelected] = useState(null);
  const [hl, setHl] = useState(null);              // { dim, value, label, depth }
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let killed = false;
    setLoading(true);
    subgraph({ businessUnit, limit: 2000 })
      .then((d) => { if (!killed) { setData(d); setLoading(false); } })
      .catch((e) => { console.error(e); if (!killed) setLoading(false); });
    return () => { killed = true; };
  }, [businessUnit]);

  useEffect(() => {
    Promise.all([classificationCodes(), entityClassMap()]).then(([cc, em]) => {
      setCodes(cc);
      setClassByEntity(new Map(em.map((r) => [r.id, r.classification_id])));
    }).catch((e) => console.error(e));
  }, []);

  const model = useMemo(() => (data?.nodes?.length ? classify(data) : null), [data]);
  const L = useMemo(() => (model ? layout(model) : null), [model]);
  const codesById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);

  // Highlight set + touched projects for the active dimension.
  const hot = useMemo(() => {
    if (!L || !model || !hl) return null;
    const set = new Set();
    const pids = new Set();
    if (hl.dim === "masterformat" || hl.dim === "uniformat") {
      const byDivision = hl.dim === "masterformat" && hl.depth === 0;
      for (const [eid, codeId] of classByEntity) {
        const c = codesById.get(codeId);
        if (!c || c.system_id !== hl.dim) continue;
        const match = byDivision ? c.code.slice(0, 2) === hl.value.slice(0, 2) : c.code === hl.value;
        if (match) set.add(eid);
      }
    } else if (hl.dim === "vendor" || hl.dim === "employee") {
      set.add(hl.value);
      for (const o of model.adj.get(hl.value) || []) set.add(o);
    }
    for (const eid of set) {
      const n = model.nodesById.get(eid);
      if (!n) continue;
      const pid = n.type === "Project" ? model.pidByNodeId.get(eid) : n.properties?.project_id;
      if (pid && L.anchorByPid.has(pid)) pids.add(pid);
    }
    return { set, pids, count: set.size };
  }, [L, model, hl, classByEntity, codesById]);

  const onPick = async (node) => {
    setSelected({ loading: true });
    const d = await entityDetail(node.id);
    setSelected(d || { missing: true });
  };

  // Filter-rail option lists.
  const mfCodes = useMemo(() => codes.filter((c) => c.system_id === "masterformat"), [codes]);
  const ufCodes = useMemo(() => codes.filter((c) => c.system_id === "uniformat"), [codes]);
  const vendors = useMemo(() => (model?.backbone || []).filter((n) => n.type === "Organization").sort((a, b) => a.label.localeCompare(b.label)), [model]);
  const employees = useMemo(() => (model?.backbone || []).filter((n) => n.type === "Person").sort((a, b) => a.label.localeCompare(b.label)), [model]);

  const pick = (dim, value, label, depth = null) =>
    setHl(value ? { dim, value, label, depth } : null);

  const dot = (id, baseColor, baseR) => {
    if (!hot) return { op: 0.85, r: baseR };
    return hot.set.has(id) ? { op: 1, r: baseR + 0.9 } : { op: 0.06, r: baseR };
  };

  return (
    <div className="h-full flex">
      {/* ── Highlight-by rail ───────────────────────────────────────────── */}
      <aside className="w-60 shrink-0 border-r border-white/10 p-3 overflow-auto text-sm bg-[#0b0f14]">
        <div className="text-white/40 text-[10px] uppercase tracking-wide mb-1">Highlight by</div>
        <div className="text-white/35 text-[11px] mb-3 leading-snug">Light up the keys that carry data <em>between</em> systems — across every project at once.</div>

        <Field label="MasterFormat · CSI code">
          <select className="cl-select" value={hl?.dim === "masterformat" ? hl.value : ""}
            onChange={(e) => { const c = mfCodes.find((x) => x.code === e.target.value); pick("masterformat", c?.code, c && `${c.code} · ${c.title}`, c?.depth); }}>
            <option value="">— any —</option>
            {mfCodes.map((c) => (
              <option key={c.id} value={c.code}>{c.depth ? "    " : ""}{c.code} {c.title}</option>
            ))}
          </select>
        </Field>

        <Field label="UniFormat · element">
          <select className="cl-select" value={hl?.dim === "uniformat" ? hl.value : ""}
            onChange={(e) => { const c = ufCodes.find((x) => x.code === e.target.value); pick("uniformat", c?.code, c && `${c.code} · ${c.title}`, c?.depth); }}>
            <option value="">— any —</option>
            {ufCodes.map((c) => (<option key={c.id} value={c.code}>{c.code} {c.title}</option>))}
          </select>
        </Field>

        <Field label="Vendor / organization">
          <select className="cl-select" value={hl?.dim === "vendor" ? hl.value : ""}
            onChange={(e) => { const n = vendors.find((x) => x.id === e.target.value); pick("vendor", n?.id, n?.label); }}>
            <option value="">— any —</option>
            {vendors.map((n) => (<option key={n.id} value={n.id}>{n.label}</option>))}
          </select>
        </Field>

        <Field label="Employee">
          <select className="cl-select" value={hl?.dim === "employee" ? hl.value : ""}
            onChange={(e) => { const n = employees.find((x) => x.id === e.target.value); pick("employee", n?.id, n?.label); }}>
            <option value="">— any —</option>
            {employees.map((n) => (<option key={n.id} value={n.id}>{n.label}</option>))}
          </select>
        </Field>

        {hl && (
          <button onClick={() => setHl(null)} className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">
            ✕ clear highlight
          </button>
        )}

        <div className="text-white/40 text-[10px] uppercase tracking-wide mt-5 mb-1">Entity types</div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          {Object.keys(TYPE_COLOR).map((t) => (
            <div key={t} className="flex items-center gap-1 text-[10px] text-white/55">
              <span className="w-2 h-2 rounded-full" style={{ background: colorFor(t) }} />{t}
            </div>
          ))}
        </div>
        <style>{`.cl-select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 6px;font-size:12px;color:#e5e7eb}`}</style>
      </aside>

      {/* ── Story map ───────────────────────────────────────────────────── */}
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <div className="absolute top-3 left-4 right-4 z-10 pointer-events-none">
          <div className="text-sm text-white/80 font-medium">The Clayco data environment, read left → right along the project lifecycle.</div>
          <div className="text-xs text-white/45 mt-0.5 max-w-3xl">
            Each mound is a project, sized by the data it has accumulated — the portfolio peaks in construction (the bell).
            The lane below is the enterprise backbone: people, orgs, IT, pipeline that run the business but barely touch any one project.
          </div>
          {hl && hot && (
            <div className="mt-2 inline-block bg-amber-500/15 text-amber-200 text-xs rounded px-2 py-1 pointer-events-auto">
              Highlighting <b>{SYSTEM_LABEL[hl.dim] || (hl.dim === "vendor" ? "Vendor" : "Employee")}</b> · {hl.label}
              <span className="text-amber-200/70"> — {hot.count} data points across {hot.pids.size} project{hot.pids.size === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>

        {loading && <div className="absolute inset-0 grid place-items-center text-white/50 text-sm">loading ontology…</div>}

        {L && (
          <svg viewBox={`0 0 ${L.VW} ${VH}`} className="w-full h-full" preserveAspectRatio="xMidYMid meet">
            <defs>
              <linearGradient id="bell" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.16" />
                <stop offset="100%" stopColor="#f59e0b" stopOpacity="0.01" />
              </linearGradient>
            </defs>

            <path d={L.envelope} fill="url(#bell)" stroke="#f59e0b" strokeOpacity="0.25" strokeWidth="1" />
            <line x1="0" y1={BASELINE} x2={L.VW} y2={BASELINE} stroke="#ffffff" strokeOpacity="0.08" />

            {/* backbone threads */}
            <g>
              {L.threads.map((t, i) => {
                let op = 0.08;
                if (hot) op = (hl.dim === "vendor" || hl.dim === "employee") && t.fromId === hl.value ? 0.55
                  : hot.pids.has(t.pid) ? 0.05 : 0.02;
                return <line key={i} x1={t.x1} y1={t.y1} x2={t.x2} y2={t.y2} stroke={t.color} strokeOpacity={op} strokeWidth={op > 0.4 ? 1 : 0.6} />;
              })}
            </g>

            {/* stage brackets */}
            <g>
              {L.brackets.map((b, i) => (
                <g key={i}>
                  <line x1={b.x0} y1={BASELINE + 18} x2={b.x1} y2={BASELINE + 18} stroke="#ffffff" strokeOpacity="0.18" />
                  <text x={(b.x0 + b.x1) / 2} y={BASELINE + 38} textAnchor="middle" fontSize="15" fill="#cbd5e1" fillOpacity="0.7" style={{ letterSpacing: "0.08em" }}>{b.label.toUpperCase()}</text>
                </g>
              ))}
            </g>

            {/* project mounds: children */}
            <g>
              {L.dots.map((d, i) => {
                const s = dot(d.id, d.color, 2.6);
                return (
                  <circle key={i} cx={d.x} cy={d.y} r={s.r} fill={d.color} fillOpacity={s.op}
                    style={{ cursor: "pointer" }} onClick={() => onPick(d.node)}>
                    <title>{d.node.label} · {d.node.type}</title>
                  </circle>
                );
              })}
            </g>

            {/* mound rings for touched projects */}
            {hot && L.placed.filter((p) => hot.pids.has(p.pid)).map((p) => (
              <circle key={`ring-${p.pid}`} cx={p.anchor.x} cy={p.anchor.y} r={p.R + 6} fill="none" stroke="#f59e0b" strokeOpacity="0.5" strokeWidth="1.5" />
            ))}

            {/* project anchors + labels */}
            <g>
              {L.placed.map((p) => {
                const dim = hot && !hot.pids.has(p.pid) ? 0.3 : 1;
                return (
                  <g key={p.pid} opacity={dim}>
                    <circle cx={p.anchor.x} cy={p.anchor.y} r="7" fill="#f59e0b" stroke="#0d1218" strokeWidth="2" style={{ cursor: "pointer" }} onClick={() => onPick(p.node)}>
                      <title>{p.name} · {p.count} data points</title>
                    </circle>
                    <text x={p.anchor.x} y={p.anchor.y - p.R - 14} textAnchor="middle" fontSize="15" fontWeight="600" fill="#fde68a">{p.code}</text>
                    <text x={p.anchor.x} y={p.anchor.y - p.R + 2} textAnchor="middle" fontSize="12" fill="#cbd5e1" fillOpacity="0.6">{p.count} pts</text>
                  </g>
                );
              })}
            </g>

            {/* backbone lane */}
            <text x={MARGIN_X} y={BACKBONE_TOP - 10} fontSize="13" fill="#94a3b8" fillOpacity="0.7" style={{ letterSpacing: "0.1em" }}>ENTERPRISE BACKBONE — RUNS THE BUSINESS, BARELY TOUCHES ANY ONE PROJECT</text>
            <g>
              {L.backDots.map((d, i) => {
                const s = dot(d.id, d.color, 3);
                const isSel = hl && d.id === hl.value;
                return (
                  <g key={i}>
                    {isSel && <circle cx={d.x} cy={d.y} r="7" fill="none" stroke="#f59e0b" strokeOpacity="0.8" strokeWidth="1.5" />}
                    <circle cx={d.x} cy={d.y} r={s.r} fill={d.color} fillOpacity={isSel ? 1 : s.op}
                      style={{ cursor: "pointer" }} onClick={() => onPick(d.node)}>
                      <title>{d.node.label} · {d.node.type}</title>
                    </circle>
                  </g>
                );
              })}
            </g>
          </svg>
        )}
      </div>

      {/* ── Detail rail ─────────────────────────────────────────────────── */}
      {selected && (
        <aside className="w-80 shrink-0 border-l border-white/10 p-4 overflow-auto text-sm bg-[#0d1218]">
          {selected.loading ? <div className="text-white/50">loading…</div> : selected.missing ? <div className="text-white/50">no detail</div> : (
            <>
              <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white/70 text-xs mb-2">✕ close</button>
              <div className="flex items-center gap-2 mb-1">
                <span className="w-3 h-3 rounded-full" style={{ background: colorFor(selected.entity.entity_type) }} />
                <span className="text-xs text-white/50">{selected.entity.entity_type} · {selected.entity.domain}</span>
              </div>
              <div className="text-base font-semibold mb-3">{selected.entity.label}</div>
              <div className="text-white/40 text-xs uppercase tracking-wide mb-1">Record · {selected.entity.source_table}</div>
              <table className="w-full text-xs mb-4">
                <tbody>
                  {Object.entries(selected.record || {}).filter(([k]) => k !== "id").slice(0, 24).map(([k, v]) => (
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

function Field({ label, children }) {
  return (
    <div className="mb-3">
      <div className="text-white/55 text-[11px] mb-1">{label}</div>
      {children}
    </div>
  );
}
