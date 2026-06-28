import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  subgraph, entityDetail, classificationCodes, entityClassMap,
  buRollup, evmByProject, fieldByProject, safetyByProject, ask,
} from "../lib/api.js";
import { colorFor, TYPE_COLOR } from "../lib/palette.js";

// ─────────────────────────────────────────────────────────────────────────────
// ClayOS — one interface.
// The ontology is the centerpiece: projects are interwoven VASCULAR SYSTEMS —
// glowing vessels with flowing signals, floating in the ether, talking to each
// other and to the shared enterprise systems. Lifecycle runs left→right and
// recedes into depth. Selection drives everything: click a project and the KPI
// strip + the agent rescope to it. Cross-cutting keys (CSI, UniFormat, vendor,
// employee) light up across the whole portfolio.
// ─────────────────────────────────────────────────────────────────────────────

const STAGES = ["pursuit", "design", "precon", "construction", "closeout"];
const STAGE_LABEL = { pursuit: "Pursuit", design: "Design", precon: "Preconstruction", construction: "Construction", closeout: "Closeout" };
const STAGE_INDEX = Object.fromEntries(STAGES.map((s, i) => [s, i]));
const BACKBONE_GROUPS = [
  { key: "people", label: "People", types: ["Person"], tint: "#34d399" },
  { key: "vendors", label: "Vendors / orgs", types: ["Organization"], tint: "#10b981" },
  { key: "it", label: "IT", types: ["ITAsset"], tint: "#94a3b8" },
  { key: "pipeline", label: "Pipeline", types: ["Pursuit", "Estimate", "Requisition"], tint: "#eab308" },
];
const BU_PALETTE = ["#38bdf8", "#a78bfa", "#f472b6", "#fb923c", "#4ade80"];
const PHI = Math.PI * (3 - Math.sqrt(5));
const RK = 11, GAP = 70;
const DIR = (() => { const v = { x: 1, y: 0, z: -0.62 }; const m = Math.hypot(v.x, v.y, v.z); return { x: v.x / m, y: v.y / m, z: v.z / m }; })();

function classify(data) {
  const nodesById = new Map(data.nodes.map((n) => [n.id, n]));
  const projectNodes = data.nodes.filter((n) => n.type === "Project");
  const adj = new Map();
  for (const e of data.edges) {
    if (!adj.has(e.source)) adj.set(e.source, []);
    if (!adj.has(e.target)) adj.set(e.target, []);
    adj.get(e.source).push(e.target); adj.get(e.target).push(e.source);
  }
  const projByPid = new Map(), pidByNodeId = new Map();
  for (const p of projectNodes) {
    const counts = {};
    for (const nbrId of adj.get(p.id) || []) { const pid = nodesById.get(nbrId)?.properties?.project_id; if (pid) counts[pid] = (counts[pid] || 0) + 1; }
    const pid = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (pid) { projByPid.set(pid, p); pidByNodeId.set(p.id, pid); }
  }
  const childrenByPid = new Map(), backbone = [];
  for (const n of data.nodes) {
    if (n.type === "Project") continue;
    const pid = n.properties?.project_id;
    if (pid && projByPid.has(pid)) { if (!childrenByPid.has(pid)) childrenByPid.set(pid, []); childrenByPid.get(pid).push(n); }
    else backbone.push(n);
  }
  const projects = [...projByPid.entries()].map(([pid, node]) => ({
    pid, node, kids: childrenByPid.get(pid) || [], count: (childrenByPid.get(pid) || []).length,
    stage: node.properties?.lifecycle_stage || "construction", stageIdx: STAGE_INDEX[node.properties?.lifecycle_stage] ?? 3,
    name: node.label, code: node.properties?.code || "", bu: node.business_unit_id || "—",
  }));
  projects.sort((a, b) => a.stageIdx - b.stageIdx || b.count - a.count);
  return { projects, backbone, nodesById, adj, projByPid, pidByNodeId };
}

function spherePoint(k, n) {
  const y = 1 - 2 * (k + 0.5) / n, rad = Math.sqrt(Math.max(0, 1 - y * y)), th = k * PHI;
  const r = Math.cbrt(((k * 73 + 13) % n + 0.5) / n);
  return { x: Math.cos(th) * rad * r, y: y * r, z: Math.sin(th) * rad * r };
}

function buildClusters(model) {
  const { projects, backbone } = model;
  const pos = new Map(), meta = new Map(), clusters = [], labels = [];
  const buIds = [...new Set(projects.map((p) => p.bu))];
  const buColor = (bu) => BU_PALETTE[buIds.indexOf(bu) % BU_PALETTE.length];

  let center = { x: -520, y: 0, z: 360 };
  projects.forEach((p, i) => {
    const R = RK * Math.sqrt(Math.max(p.count, 6));
    if (i === 0) center = { x: center.x + DIR.x * R, y: center.y, z: center.z + DIR.z * R };
    else { const prevR = RK * Math.sqrt(Math.max(projects[i - 1].count, 6)); const step = prevR + R + GAP; center = { x: center.x + DIR.x * step, y: 0, z: center.z + DIR.z * step }; }
    const c = { x: center.x, y: Math.sin(i * 1.9) * 70, z: center.z };
    const color = buColor(p.bu);
    clusters.push({ kind: "project", cid: p.pid, center: c, radius: R, color, label: p.code, count: p.count });
    pos.set(p.node.id, { ...c });
    meta.set(p.node.id, { cid: p.pid, pid: p.pid, domain: "project", type: "Project", label: p.name });
    labels.push({ text: p.code, x: c.x, y: c.y + R + 26, z: c.z, color: "#fde68a", size: 13 });
    const n = p.kids.length || 1;
    p.kids.forEach((kid, k) => {
      const sp = spherePoint(k, n);
      pos.set(kid.id, { x: c.x + sp.x * R, y: c.y + sp.y * R, z: c.z + sp.z * R });
      meta.set(kid.id, { cid: p.pid, pid: p.pid, domain: kid.domain, type: kid.type, label: kid.label });
    });
  });

  const stageX = new Map();
  projects.forEach((p) => { const c = clusters.find((cl) => cl.cid === p.pid).center; if (!stageX.has(p.stage)) stageX.set(p.stage, []); stageX.get(p.stage).push(c); });
  for (const [stage, cs] of stageX) {
    const cx = cs.reduce((a, b) => a + b.x, 0) / cs.length, cz = cs.reduce((a, b) => a + b.z, 0) / cs.length;
    labels.push({ text: STAGE_LABEL[stage] || stage, x: cx, y: 235, z: cz, color: "#9aa6b2", size: 15, faint: true });
  }

  const present = BACKBONE_GROUPS.map((g) => ({ ...g, members: backbone.filter((n) => g.types.includes(n.type)) })).filter((g) => g.members.length);
  present.forEach((g, gi) => {
    const R = RK * Math.sqrt(Math.max(g.members.length, 6));
    const c = { x: -340 + gi * 300, y: -250, z: -40 };
    clusters.push({ kind: "backbone", cid: "bb:" + g.key, center: c, radius: R, color: g.tint, label: g.label, count: g.members.length });
    labels.push({ text: g.label, x: c.x, y: c.y - R - 20, z: c.z, color: g.tint, size: 12, faint: true });
    const n = g.members.length || 1;
    g.members.forEach((node, k) => {
      const sp = spherePoint(k, n);
      pos.set(node.id, { x: c.x + sp.x * R, y: c.y + sp.y * R, z: c.z + sp.z * R });
      meta.set(node.id, { cid: "bb:" + g.key, pid: null, domain: node.domain, type: node.type, label: node.label });
    });
  });

  const cs = clusters.filter((c) => c.kind === "project").map((c) => c.center);
  return { pos, meta, clusters, labels, centroid: { x: avg(cs, "x"), y: 0, z: avg(cs, "z") } };
}
const avg = (arr, k) => arr.reduce((a, b) => a + b[k], 0) / (arr.length || 1);

const SYSTEM_LABEL = { masterformat: "MasterFormat (CSI)", uniformat: "UniFormat" };
const DIM = "#222933";
const num = (v) => (v == null ? null : Number(v));
const fmt$ = (n) => (n == null ? "—" : "$" + (Number(n) / 1e6).toFixed(0) + "M");

// deterministic "hours since this data point last moved" (synthetic POC activity).
// Linear over 30 days → few changed in the last hour, more over a week, all within a month.
function hashId(id) { let h = 2166136261; for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; }
const recencyHours = (id) => hashId(id) * 720;
const WINDOWS = [{ h: 1, label: "1h" }, { h: 6, label: "6h" }, { h: 24, label: "24h" }, { h: 72, label: "3d" }, { h: 168, label: "7d" }, { h: 720, label: "30d" }];

function computeKpis(focus, evm, field, safety) {
  if (focus) {
    const e = evm.find((p) => p.project_name === focus.name) || {};
    const f = field.find((p) => p.project_name === focus.name) || {};
    const s = safety.find((p) => p.project_name === focus.name) || {};
    return { scope: focus.name, bac: num(e.bac), eac: num(e.eac), cpi: num(e.cpi), spi: num(e.spi), openRfis: f.open_rfis, totalRfis: f.total_rfis, trir: num(s.trir) };
  }
  const totBac = evm.reduce((a, p) => a + num(p.bac || 0), 0);
  const wsum = (key) => evm.reduce((a, p) => a + num(p[key] || 0) * num(p.bac || 0), 0) / (totBac || 1);
  const totHours = safety.reduce((a, p) => a + num(p.hours_worked || 0), 0);
  const wTrir = safety.reduce((a, p) => a + num(p.trir || 0) * num(p.hours_worked || 0), 0) / (totHours || 1);
  return {
    scope: "Clayco — enterprise", bac: totBac, eac: evm.reduce((a, p) => a + num(p.eac || 0), 0),
    cpi: wsum("cpi"), spi: wsum("spi"), openRfis: field.reduce((a, p) => a + (p.open_rfis || 0), 0), trir: wTrir, projects: evm.length,
  };
}

export default function Lifecycle3DView({ businessUnit }) {
  const mountRef = useRef(null), fgRef = useRef(null), hotRef = useRef(null), controlsRef = useRef(null);
  const windowRef = useRef(24), flowSpeedRef = useRef(0.0035), flowSizeRef = useRef(1.1);
  const [data, setData] = useState(null);
  const [codes, setCodes] = useState([]);
  const [classByEntity, setClassByEntity] = useState(new Map());
  const [evm, setEvm] = useState([]); const [field, setField] = useState([]); const [safety, setSafety] = useState([]); const [rollup, setRollup] = useState([]);
  const [selected, setSelected] = useState(null);   // detail rail
  const [focus, setFocus] = useState(null);          // {pid,name,code} drives KPIs + agent
  const [hl, setHl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [spin, setSpin] = useState(true);
  // flow controls (recent-activity particles)
  const [windowIdx, setWindowIdx] = useState(2); // 24h
  const [flowSpeed, setFlowSpeed] = useState(0.0035);
  const [flowSize, setFlowSize] = useState(1.1);
  // docked agent
  const [askOpen, setAskOpen] = useState(false);
  const [askMsgs, setAskMsgs] = useState([]); const [askInput, setAskInput] = useState(""); const [askBusy, setAskBusy] = useState(false);

  useEffect(() => {
    let killed = false; setLoading(true);
    subgraph({ businessUnit, limit: 2000 }).then((d) => { if (!killed) { setData(d); setLoading(false); } }).catch((e) => { console.error(e); if (!killed) setLoading(false); });
    return () => { killed = true; };
  }, [businessUnit]);
  useEffect(() => {
    Promise.all([classificationCodes(), entityClassMap()]).then(([cc, em]) => { setCodes(cc); setClassByEntity(new Map(em.map((r) => [r.id, r.classification_id]))); }).catch((e) => console.error(e));
    evmByProject().then(setEvm); fieldByProject().then(setField); safetyByProject().then(setSafety); buRollup().then(setRollup);
  }, []);

  const model = useMemo(() => (data?.nodes?.length ? classify(data) : null), [data]);
  const codesById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);
  const kpis = useMemo(() => computeKpis(focus, evm, field, safety), [focus, evm, field, safety]);

  const graph = useMemo(() => {
    if (!model) return null;
    const { pos, meta, clusters, labels, centroid } = buildClusters(model);
    const nodes = []; const cidById = new Map(); const recById = new Map();
    for (const [id, p] of pos) {
      const m = meta.get(id);
      const rh = m.type === "Project" ? Infinity : recencyHours(id); // project hubs never gate the flow
      nodes.push({ id, ...m, rh, x: p.x, y: p.y, z: p.z, fx: p.x, fy: p.y, fz: p.z });
      cidById.set(id, m.cid); recById.set(id, rh);
    }
    const ids = new Set(nodes.map((n) => n.id));
    const links = data.edges.filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, cross: cidById.get(e.source) !== cidById.get(e.target), rh: Math.min(recById.get(e.source), recById.get(e.target)) }));
    return { nodes, links, clusters, labels, centroid };
  }, [model, data]);

  const hot = useMemo(() => {
    if (!model || !hl) return null;
    const set = new Set(), pids = new Set();
    if (hl.dim === "masterformat" || hl.dim === "uniformat") {
      const byDivision = hl.dim === "masterformat" && hl.depth === 0;
      for (const [eid, codeId] of classByEntity) { const c = codesById.get(codeId); if (!c || c.system_id !== hl.dim) continue; if (byDivision ? c.code.slice(0, 2) === hl.value.slice(0, 2) : c.code === hl.value) set.add(eid); }
    } else if (hl.dim === "vendor" || hl.dim === "employee") { set.add(hl.value); for (const o of model.adj.get(hl.value) || []) set.add(o); }
    for (const eid of set) { const n = model.nodesById.get(eid); const pid = n?.type === "Project" ? model.pidByNodeId.get(eid) : n?.properties?.project_id; if (pid) pids.add(pid); }
    return { set, pids, count: set.size };
  }, [model, hl, classByEntity, codesById]);
  useEffect(() => { hotRef.current = hot; }, [hot]);

  const nodeColor = (n) => { const h = hotRef.current; return h && !h.set.has(n.id) ? DIM : colorFor(n.type); };
  const nodeVal = (n) => { const base = n.type === "Project" ? 34 : 3; const h = hotRef.current; return h && h.set.has(n.id) ? base * 2.2 : base; };

  useEffect(() => {
    if (!graph || !mountRef.current) return;
    const el = mountRef.current;
    const g = ForceGraph3D({ controlType: "orbit" })(el)
      .backgroundColor("#05070b")
      .showNavInfo(false)
      .width(el.clientWidth).height(el.clientHeight)
      .graphData({ nodes: graph.nodes, links: graph.links })
      .cooldownTicks(1) // nodes are pinned (fx/fy/fz); 1 tick initialises link curves for particles
      .nodeColor(nodeColor).nodeVal(nodeVal).nodeOpacity(0.96).nodeResolution(9)
      .nodeLabel((n) => `<div style="font-size:12px"><b>${n.label}</b><br/><span style="opacity:.6">${n.type} · ${n.domain}</span></div>`)
      .linkCurvature(0.22)
      // paths are a quiet, thin structure; the FLOW carries the story
      .linkWidth((l) => { const h = hotRef.current; if (h) return (h.set.has(l.source.id || l.source) && h.set.has(l.target.id || l.target)) ? 0.7 : 0.12; return 0.16; })
      .linkColor((l) => { const h = hotRef.current; if (h) return (h.set.has(l.source.id || l.source) && h.set.has(l.target.id || l.target)) ? "#f59e0b" : "#0a0e14"; return l.cross ? "#22303f" : "#161f29"; })
      .linkOpacity(0.32)
      // particles = actual data points that moved within the time window
      .linkDirectionalParticles((l) => (l.rh <= windowRef.current ? 1 : 0))
      .linkDirectionalParticleWidth(flowSizeRef.current).linkDirectionalParticleSpeed(flowSpeedRef.current).linkDirectionalParticleColor(() => "#7dd3fc")
      .onNodeClick(async (n) => {
        // clicking anywhere in a project's globe focuses that project
        if (n.pid) { const proj = model?.projects?.find((p) => p.pid === n.pid); if (proj) setFocus({ pid: proj.pid, name: proj.name, code: proj.code }); }
        setSelected({ loading: true });
        const d = await entityDetail(n.id); setSelected(d || { missing: true });
      });

    // depth haze for the "flying through" feel
    g.scene().fog = new THREE.FogExp2(0x05070b, 0.00055);

    // faint membrane around each vascular system
    for (const c of graph.clusters) {
      const col = new THREE.Color(c.color);
      const fill = new THREE.Mesh(new THREE.SphereGeometry(c.radius * 1.05, 18, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.045 }));
      fill.position.set(c.center.x, c.center.y, c.center.z);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(c.radius * 1.05, 12, 9)), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.09 }));
      wire.position.copy(fill.position);
      fill.raycast = () => {}; wire.raycast = () => {}; // decorative — don't block node clicks
      g.scene().add(fill); g.scene().add(wire);
    }
    for (const lb of graph.labels) {
      const s = new SpriteText(lb.text); s.color = lb.color; s.textHeight = lb.size;
      s.backgroundColor = "rgba(4,7,11,0.6)"; s.padding = lb.size * 0.35; s.borderRadius = 2; // dark chip keeps text crisp under bloom
      s.material.opacity = lb.faint ? 0.7 : 1; s.material.transparent = true; s.position.set(lb.x, lb.y, lb.z);
      s.raycast = () => {};
      g.scene().add(s);
    }
    g.scene().add(new THREE.AmbientLight(0xffffff, 0.95));

    // glow — gentle, so labels stay legible (only bright cores bloom)
    const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.7, 0.5, 0.22);
    g.postProcessingComposer().addPass(bloom);

    const ctr = graph.centroid;
    g.cameraPosition({ x: ctr.x + 220, y: 240, z: ctr.z + 980 }, ctr, 0);
    const controls = g.controls();
    controlsRef.current = controls;
    if (controls) {
      controls.autoRotate = true; controls.autoRotateSpeed = 0.42;
      controls.enablePan = true; controls.enableZoom = true;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    }

    fgRef.current = g;
    const onResize = () => g.width(el.clientWidth).height(el.clientHeight);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      try { g._destructor && g._destructor(); } catch { /* noop */ }
      fgRef.current = null; if (el) el.innerHTML = "";
    };
  }, [graph]);

  useEffect(() => { const g = fgRef.current; if (g) g.nodeColor(nodeColor).nodeVal(nodeVal).linkColor(g.linkColor()).linkWidth(g.linkWidth()).linkDirectionalParticles((l) => (l.rh <= windowRef.current ? 1 : 0)); }, [hot]);
  useEffect(() => { if (controlsRef.current) controlsRef.current.autoRotate = spin; }, [spin]);
  // flow controls → live-update the particle system
  useEffect(() => { windowRef.current = WINDOWS[windowIdx].h; const g = fgRef.current; if (g) g.linkDirectionalParticles((l) => (l.rh <= windowRef.current ? 1 : 0)); }, [windowIdx, graph]);
  useEffect(() => { flowSpeedRef.current = flowSpeed; const g = fgRef.current; if (g) g.linkDirectionalParticleSpeed(flowSpeed); }, [flowSpeed, graph]);
  useEffect(() => { flowSizeRef.current = flowSize; const g = fgRef.current; if (g) g.linkDirectionalParticleWidth(flowSize); }, [flowSize, graph]);
  const activeCount = useMemo(() => (graph ? graph.nodes.filter((n) => n.type !== "Project" && n.rh <= WINDOWS[windowIdx].h).length : 0), [graph, windowIdx]);

  const mfCodes = useMemo(() => codes.filter((c) => c.system_id === "masterformat"), [codes]);
  const ufCodes = useMemo(() => codes.filter((c) => c.system_id === "uniformat"), [codes]);
  const vendors = useMemo(() => (model?.backbone || []).filter((n) => n.type === "Organization").sort((a, b) => a.label.localeCompare(b.label)), [model]);
  const employees = useMemo(() => (model?.backbone || []).filter((n) => n.type === "Person").sort((a, b) => a.label.localeCompare(b.label)), [model]);
  const pick = (dim, value, label, depth = null) => setHl(value ? { dim, value, label, depth } : null);

  async function sendAsk(q) {
    const question = (q ?? askInput).trim(); if (!question || askBusy) return;
    setAskInput(""); setAskOpen(true);
    const ctx = focus ? `Regarding the ${focus.name} project: ${question}` : question;
    setAskMsgs((m) => [...m, { role: "user", text: question }]); setAskBusy(true);
    try { const r = await ask(ctx); setAskMsgs((m) => [...m, { role: "assistant", text: r.answer || r.error || "(no answer)" }]); }
    catch (e) { setAskMsgs((m) => [...m, { role: "assistant", text: "Error: " + e.message }]); }
    finally { setAskBusy(false); }
  }

  return (
    <div className="h-full flex">
      <aside className="w-60 shrink-0 border-r border-white/10 p-3 overflow-auto text-sm bg-[#0b0f14]">
        <div className="text-white/40 text-[10px] uppercase tracking-wide mb-1">Highlight by</div>
        <div className="text-white/35 text-[11px] mb-3 leading-snug">Light up the keys that carry data <em>between</em> systems — across every project at once.</div>
        <Field label="MasterFormat · CSI code">
          <select className="cl-select" value={hl?.dim === "masterformat" ? hl.value : ""} onChange={(e) => { const c = mfCodes.find((x) => x.code === e.target.value); pick("masterformat", c?.code, c && `${c.code} · ${c.title}`, c?.depth); }}>
            <option value="">— any —</option>{mfCodes.map((c) => (<option key={c.id} value={c.code}>{c.depth ? "    " : ""}{c.code} {c.title}</option>))}
          </select>
        </Field>
        <Field label="UniFormat · element">
          <select className="cl-select" value={hl?.dim === "uniformat" ? hl.value : ""} onChange={(e) => { const c = ufCodes.find((x) => x.code === e.target.value); pick("uniformat", c?.code, c && `${c.code} · ${c.title}`, c?.depth); }}>
            <option value="">— any —</option>{ufCodes.map((c) => (<option key={c.id} value={c.code}>{c.code} {c.title}</option>))}
          </select>
        </Field>
        <Field label="Vendor / organization">
          <select className="cl-select" value={hl?.dim === "vendor" ? hl.value : ""} onChange={(e) => { const n = vendors.find((x) => x.id === e.target.value); pick("vendor", n?.id, n?.label); }}>
            <option value="">— any —</option>{vendors.map((n) => (<option key={n.id} value={n.id}>{n.label}</option>))}
          </select>
        </Field>
        <Field label="Employee">
          <select className="cl-select" value={hl?.dim === "employee" ? hl.value : ""} onChange={(e) => { const n = employees.find((x) => x.id === e.target.value); pick("employee", n?.id, n?.label); }}>
            <option value="">— any —</option>{employees.map((n) => (<option key={n.id} value={n.id}>{n.label}</option>))}
          </select>
        </Field>
        {hl && (<button onClick={() => setHl(null)} className="mt-2 w-full text-xs px-2 py-1.5 rounded bg-amber-500/15 text-amber-300 hover:bg-amber-500/25">✕ clear highlight</button>)}
        <div className="text-white/40 text-[10px] uppercase tracking-wide mt-5 mb-1">Reading it</div>
        <div className="text-[10px] text-white/50 leading-snug space-y-1">
          <div>Each glowing globe = a <b>project</b> (a vascular system), tinted by business unit, sized by its data.</div>
          <div>Each cyan pulse = a <b>data point that moved</b> within the time window (set it below the map).</div>
          <div>Click a project → its KPIs + the agent rescope to it.</div>
        </div>
        <div className="text-white/40 text-[10px] uppercase tracking-wide mt-4 mb-1">Entity types</div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">{Object.keys(TYPE_COLOR).map((t) => (<div key={t} className="flex items-center gap-1 text-[10px] text-white/55"><span className="w-2 h-2 rounded-full" style={{ background: colorFor(t) }} />{t}</div>))}</div>
        <style>{`.cl-select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 6px;font-size:12px;color:#e5e7eb}`}</style>
      </aside>

      <div className="relative flex-1 min-w-0">
        <div ref={mountRef} className="absolute inset-0" />

        <div className="absolute top-3 left-4 right-4 z-10 pointer-events-none">
          <div className="text-sm text-white/80 font-medium">ClayOS — interwoven project systems</div>
          <div className="text-xs text-white/45 mt-0.5">orbit: left/middle drag · pan: right drag · zoom: scroll · click a project to focus everything on it.</div>
          {hl && hot && (
            <div className="mt-2 inline-block bg-amber-500/15 text-amber-200 text-xs rounded px-2 py-1 pointer-events-auto">
              Highlighting <b>{SYSTEM_LABEL[hl.dim] || (hl.dim === "vendor" ? "Vendor" : "Employee")}</b> · {hl.label}<span className="text-amber-200/70"> — {hot.count} pts across {hot.pids.size} project{hot.pids.size === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>

        <button onClick={() => setSpin((s) => !s)} className="absolute top-3 right-3 z-10 text-[11px] px-2 py-1 rounded bg-black/40 text-white/60 hover:text-white">{spin ? "⏸ drift" : "▶ drift"}</button>

        {/* flow controls — what's moving, how fast, how big */}
        <div className="absolute left-3 bottom-24 z-20 w-56 bg-[#0d1218]/90 border border-white/10 rounded-xl p-3 text-xs">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-white/70 font-medium">Flow · recent activity</span>
            <span className="text-cyan-300/90">{activeCount} moved</span>
          </div>
          <label className="block text-white/45 text-[10px] mt-1">Active in the last <b className="text-white/70">{WINDOWS[windowIdx].label}</b></label>
          <input type="range" min="0" max={WINDOWS.length - 1} step="1" value={windowIdx} onChange={(e) => setWindowIdx(+e.target.value)} className="cl-range" />
          <label className="block text-white/45 text-[10px] mt-2">Speed</label>
          <input type="range" min="0.001" max="0.012" step="0.0005" value={flowSpeed} onChange={(e) => setFlowSpeed(+e.target.value)} className="cl-range" />
          <label className="block text-white/45 text-[10px] mt-2">Size</label>
          <input type="range" min="0.5" max="3" step="0.1" value={flowSize} onChange={(e) => setFlowSize(+e.target.value)} className="cl-range" />
          <style>{`.cl-range{width:100%;accent-color:#38bdf8;height:3px}`}</style>
        </div>

        {loading && <div className="absolute inset-0 grid place-items-center text-white/50 text-sm">loading ontology…</div>}

        {/* selection-driven KPI strip */}
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 pt-6 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] uppercase tracking-wide text-white/45">Live KPIs ·</span>
            <span className="text-sm text-white/85 font-medium">{kpis.scope}</span>
            {focus && <button onClick={() => setFocus(null)} className="text-[11px] text-amber-300/80 hover:text-amber-200">↩ enterprise</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Kpi label="Contract / BAC" value={fmt$(kpis.bac)} />
            <Kpi label="EAC" value={fmt$(kpis.eac)} warn={kpis.eac > kpis.bac} sub={kpis.eac > kpis.bac ? `+${fmt$(kpis.eac - kpis.bac)} over` : "on budget"} />
            <Kpi label="CPI" value={kpis.cpi?.toFixed(2) ?? "—"} warn={kpis.cpi < 1} />
            <Kpi label="SPI" value={kpis.spi?.toFixed(2) ?? "—"} warn={kpis.spi < 1} />
            <Kpi label="Open RFIs" value={kpis.openRfis ?? "—"} sub={kpis.totalRfis ? `of ${kpis.totalRfis}` : null} />
            <Kpi label="TRIR" value={kpis.trir != null ? kpis.trir.toFixed(2) : "—"} warn={kpis.trir > 3} />
            {!focus && <Kpi label="Projects" value={kpis.projects ?? "—"} />}
          </div>
        </div>

        {/* docked agent */}
        <div className="absolute right-3 bottom-24 z-20 w-80">
          {askOpen && (
            <div className="mb-2 bg-[#0d1218]/95 border border-white/10 rounded-xl p-3 max-h-72 overflow-auto">
              <div className="flex items-center justify-between mb-2"><span className="text-xs text-white/50">Ask {focus ? `· ${focus.code || focus.name}` : "· all of Clayco"}</span><button onClick={() => setAskOpen(false)} className="text-white/30 hover:text-white/70 text-xs">▾</button></div>
              {askMsgs.length === 0 && <div className="text-[11px] text-white/40 mb-2">Ask about {focus ? "this project's" : "the portfolio's"} costs, schedule, RFIs, safety, people…</div>}
              <div className="space-y-2">
                {askMsgs.map((m, i) => (<div key={i} className={`text-[12px] rounded-lg px-2 py-1.5 ${m.role === "user" ? "bg-amber-500/15 text-amber-100" : "bg-white/5 text-white/85"}`}>{m.text}</div>))}
                {askBusy && <div className="text-white/40 text-[11px]">analyzing…</div>}
              </div>
            </div>
          )}
          <div className="flex gap-1">
            <input value={askInput} onChange={(e) => setAskInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && sendAsk()} onFocus={() => setAskOpen(true)}
              placeholder={focus ? `Ask about ${focus.code || focus.name}…` : "Ask ClayOS…"} className="flex-1 bg-[#0d1218]/95 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-amber-500/40" />
            <button onClick={() => sendAsk()} disabled={askBusy} className="px-3 py-2 rounded-lg bg-amber-500/20 text-amber-300 text-xs hover:bg-amber-500/30 disabled:opacity-40">→</button>
          </div>
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
                {Object.entries(selected.record || {}).filter(([k]) => k !== "id").slice(0, 24).map(([k, v]) => (<tr key={k} className="border-b border-white/5"><td className="py-1 pr-2 text-white/40 align-top">{k}</td><td className="py-1 text-white/80 break-words">{v === null ? "—" : String(v)}</td></tr>))}
              </tbody></table>
              <div className="text-white/40 text-xs uppercase tracking-wide mb-1">Connected ({(selected.neighbors.nodes || []).length - 1})</div>
              <div className="space-y-1">
                {(selected.neighbors.nodes || []).filter((n) => n.id !== selected.entity.id).slice(0, 30).map((n) => (<div key={n.id} className="flex items-center gap-2 text-white/70"><span className="w-2 h-2 rounded-full shrink-0" style={{ background: colorFor(n.type) }} /><span className="truncate">{n.label}</span><span className="text-white/30 text-[10px] ml-auto shrink-0">{n.type}</span></div>))}
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}

function Field({ label, children }) { return (<div className="mb-3"><div className="text-white/55 text-[11px] mb-1">{label}</div>{children}</div>); }
function Kpi({ label, value, sub, warn }) {
  return (
    <div className="bg-[#0d1218]/85 border border-white/10 rounded-lg px-3 py-1.5 min-w-[92px]">
      <div className="text-[10px] text-white/45">{label}</div>
      <div className={`text-lg font-semibold leading-tight ${warn ? "text-red-400" : "text-white/90"}`}>{value}</div>
      {sub && <div className={`text-[10px] ${warn ? "text-red-400/80" : "text-white/40"}`}>{sub}</div>}
    </div>
  );
}
