import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph3D from "3d-force-graph";
import * as THREE from "three";
import SpriteText from "three-spritetext";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import {
  subgraph, entityDetail, classificationCodes, entityClassMap, entityFacts,
  buRollup, evmByProject, fieldByProject, safetyByProject,
} from "../lib/api.js";
import { colorFor, shapeFor, TYPE_COLOR } from "../lib/palette.js";
import OntologyIntro from "../components/OntologyIntro.jsx";
import { defOf } from "../lib/glossary.js";
import { fmtMoney as fmt$ } from "../lib/format.js";
import { loadPrefs } from "../lib/prefs.js";

// literal-labels preference: read once per mount (App remounts the view on change)
const LITERAL = () => loadPrefs().literal;

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

// ── Orbital layout constants ──────────────────────────────────────────────────
// The enterprise "core" is a horizontal time axis (lifecycle left→right). Every
// project orbits it: ACTIVITY HEAT pulls a project toward the core, dormancy
// pushes it to the periphery — and the periphery fades. The angle around the
// axis is the project's business-unit sector, so the portfolio fills vertical
// AND depth instead of marching along a line. Globe size stays data volume.
// The backbone (people/vendors/IT/pipeline) keeps the corridor below.
const RK = 11;              // globe radius = RK * sqrt(data volume)
const R_CORE = 180;         // orbit radius of the hottest projects
const R_SPAN = 500;         // extra radius toward the periphery for cold ones
const STAGE_W = 740;        // x band per lifecycle stage
const SECTOR_ARC = 292;     // degrees available to project sectors (the bottom wedge stays clear)

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

function buildClusters(model, heatByPid) {
  const { projects, backbone } = model;
  const pos = new Map(), meta = new Map(), clusters = [], labels = [];
  const buIds = [...new Set(projects.map((p) => p.bu))].sort();
  const buColor = (bu) => BU_PALETTE[buIds.indexOf(bu) % BU_PALETTE.length];
  const maxHeat = Math.max(1e-6, ...projects.map((p) => heatByPid.get(p.pid) || 0));
  const cellIdx = new Map(); // per (stage|bu) sibling counter → deterministic spread in the sector patch

  projects.forEach((p) => {
    // sqrt spreads the mid-range so the core isn't a single winner + 199 stragglers
    const heat = Math.sqrt((heatByPid.get(p.pid) || 0) / maxHeat);
    const cellKey = p.stage + "|" + p.bu;
    const k = cellIdx.get(cellKey) || 0; cellIdx.set(cellKey, k + 1);
    const R = RK * Math.sqrt(Math.max(p.count, 6));
    // x: lifecycle band + deterministic in-band stagger (time still reads left→right)
    const x = (p.stageIdx - 2) * STAGE_W + (((k * 37) % 7) - 3) * (STAGE_W * 0.11);
    // orbit: hot hugs the core; angle = BU sector (0° = straight up), golden-ratio spread within it
    const r = R_CORE + (1 - heat) * R_SPAN + R * 0.4 + (k % 3) * 34;
    const arc = SECTOR_ARC / buIds.length;
    const thetaDeg = -SECTOR_ARC / 2 + buIds.indexOf(p.bu) * arc + ((k * PHI * 180 / Math.PI) % arc);
    const th = (thetaDeg * Math.PI) / 180;
    const c = { x, y: r * Math.cos(th), z: r * Math.sin(th) };
    const color = buColor(p.bu);
    const hubVal = 12 + Math.sqrt(Math.max(p.count, 4)) * 3.4;
    // raw heat travels with nodes/clusters/labels — the periphery-fade slider turns
    // it into an opacity/color falloff live (nothing is baked at build time)
    clusters.push({ kind: "project", cid: p.pid, center: c, radius: R, color, label: p.code, count: p.count, heat });
    pos.set(p.node.id, { ...c });
    meta.set(p.node.id, { cid: p.pid, pid: p.pid, domain: "project", type: "Project", label: p.name, heat, hubVal });
    const n = p.kids.length || 1;
    p.kids.forEach((kid, kk) => {
      const sp = spherePoint(kk, n);
      pos.set(kid.id, { x: c.x + sp.x * R, y: c.y + sp.y * R, z: c.z + sp.z * R });
      meta.set(kid.id, { cid: p.pid, pid: p.pid, domain: kid.domain, type: kid.type, label: kid.label, heat });
    });
  });

  // labels: 200 chips is noise — label the hot core + the biggest peripherals only
  const labeled = clusters.filter((c) => c.kind === "project")
    .sort((a, b) => (b.heat + b.count / 400) - (a.heat + a.count / 400)).slice(0, 48);
  for (const c of labeled) {
    labels.push({ text: c.label, x: c.center.x, y: c.center.y + c.radius + 24, z: c.center.z,
                  color: "#fde68a", size: 12, heat: c.heat });
  }

  // stage labels ride the core axis itself — large, so they still read zoomed-out
  for (const [stage, idx] of Object.entries(STAGE_INDEX)) {
    if (!projects.some((p) => p.stage === stage)) continue;
    labels.push({ text: STAGE_LABEL[stage] || stage, x: (idx - 2) * STAGE_W, y: 48, z: 0, color: "#b7c3cf", size: 30, faint: true });
  }

  // backbone corridor stays below the whole orbit
  const present = BACKBONE_GROUPS.map((g) => ({ ...g, members: backbone.filter((n) => g.types.includes(n.type)) })).filter((g) => g.members.length);
  const bbY = -(R_CORE + R_SPAN + 200);
  present.forEach((g, gi) => {
    const R = RK * Math.sqrt(Math.max(g.members.length, 6));
    const c = { x: (gi - (present.length - 1) / 2) * 420, y: bbY, z: 60 };
    clusters.push({ kind: "backbone", cid: "bb:" + g.key, center: c, radius: R, color: g.tint, label: g.label, count: g.members.length, heat: 1 });
    labels.push({ text: g.label, x: c.x, y: c.y - R - 22, z: c.z, color: g.tint, size: 12, faint: true });
    const n = g.members.length || 1;
    g.members.forEach((node, k) => {
      const sp = spherePoint(k, n);
      pos.set(node.id, { x: c.x + sp.x * R, y: c.y + sp.y * R, z: c.z + sp.z * R });
      meta.set(node.id, { cid: "bb:" + g.key, pid: null, domain: node.domain, type: node.type, label: node.label, heat: 1 });
    });
  });

  const xs = clusters.filter((c) => c.kind === "project").map((c) => c.center.x);
  const axis = { x0: Math.min(...xs) - 240, x1: Math.max(...xs) + 240 };
  return { pos, meta, clusters, labels, axis, centroid: { x: (axis.x0 + axis.x1) / 2, y: 0, z: 0 } };
}

const SYSTEM_LABEL = { masterformat: "MasterFormat (CSI)", uniformat: "UniFormat" };
const DIM = "#222933";
const num = (v) => (v == null ? null : Number(v));

// Flow time-window (hours back from now). Recency is REAL — derived from each
// record's semantic date via kg_entity_facts() (migration 010).
const D = 24;
const WINDOWS = [{ h: 7 * D, label: "7d" }, { h: 30 * D, label: "30d" }, { h: 60 * D, label: "60d" }, { h: 90 * D, label: "90d" }, { h: 180 * D, label: "6mo" }, { h: 365 * D, label: "1y" }, { h: 1e9, label: "all" }];
const NOOP = () => {}; // raycast override for greyed-out nodes
// vessel thickness grows with the dollars a record carries (log scale)
const vesselWidth = (amt) => (amt > 0 ? 0.12 + Math.max(0, Math.log10(amt) - 3.5) * 0.28 : 0.12);

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

export default function Lifecycle3DView({ businessUnit, focus, setFocus, hl, setHl }) {
  const mountRef = useRef(null), fgRef = useRef(null), hotRef = useRef(null), controlsRef = useRef(null);
  const windowRef = useRef(60 * 24), flowSpeedRef = useRef(0.001), flowSizeRef = useRef(3.0);
  const fadeAmtRef = useRef(0.8);                    // periphery-fade strength (slider)
  const membranesRef = useRef([]), labelSpritesRef = useRef([]); // fade-reactive scene objects
  const [data, setData] = useState(null);
  const [codes, setCodes] = useState([]);
  const [classByEntity, setClassByEntity] = useState(new Map());
  const [facts, setFacts] = useState(null); // { actHours: Map<id,hours>, amount: Map<id,$> }
  const [evm, setEvm] = useState([]); const [field, setField] = useState([]); const [safety, setSafety] = useState([]); const [rollup, setRollup] = useState([]);
  const [selected, setSelected] = useState(null);   // detail rail (focus + hl are shared via props)
  const [loading, setLoading] = useState(true);
  const [railOpen, setRailOpen] = useState(false);  // mobile highlight/filters drawer
  const [literal] = useState(LITERAL);              // plain terms instead of the flow metaphor
  // honor prefers-reduced-motion: the drifting auto-orbit can bother vestibular users
  const [spin, setSpin] = useState(() => { try { return !window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return true; } });
  // "lite" mode = no bloom, no flow particles, lower node resolution — for weak GPUs.
  // Toggled manually or auto-enabled once if the opening seconds run below ~25 fps.
  const [lite, setLite] = useState(false);
  const liteRef = useRef(false); useEffect(() => { liteRef.current = lite; }, [lite]);
  // flow controls (recent-activity particles) — speed defaults to minimum, size range
  // starts where the old maximum was (user wants pulses big)
  const [windowIdx, setWindowIdx] = useState(2); // 60d
  const [flowSpeed, setFlowSpeed] = useState(0.001);
  const [flowSize, setFlowSize] = useState(3.0);
  const [fadeAmt, setFadeAmt] = useState(0.8);  // 0 = no periphery fade · ~1 = periphery vanishes

  useEffect(() => {
    let killed = false; setLoading(true);
    subgraph({ businessUnit, limit: 6000 }).then((d) => { if (!killed) { setData(d); setLoading(false); } }).catch((e) => { console.error(e); if (!killed) setLoading(false); });
    return () => { killed = true; };
  }, [businessUnit]);
  useEffect(() => {
    Promise.all([classificationCodes(), entityClassMap()]).then(([cc, em]) => { setCodes(cc); setClassByEntity(new Map(em.map((r) => [r.id, r.classification_id]))); }).catch((e) => console.error(e));
    evmByProject().then(setEvm); fieldByProject().then(setField); safetyByProject().then(setSafety); buRollup().then(setRollup);
    entityFacts().then((rows) => {
      const now = Date.now();
      const actHours = new Map(), amount = new Map();
      for (const r of rows) {
        if (r.activity_at) { const h = (now - new Date(r.activity_at).getTime()) / 3.6e6; actHours.set(r.entity_id, h >= 0 ? h : Infinity); } // future = not yet moved
        if (r.amount != null) amount.set(r.entity_id, Number(r.amount));
      }
      setFacts({ actHours, amount });
    }).catch((e) => { console.error(e); setFacts({ actHours: new Map(), amount: new Map() }); }); // degrade gracefully
  }, []);

  const model = useMemo(() => (data?.nodes?.length ? classify(data) : null), [data]);
  const codesById = useMemo(() => new Map(codes.map((c) => [c.id, c])), [codes]);

  const graph = useMemo(() => {
    if (!model || !facts) return null;
    // activity heat per project: recency-decayed sum over its records' movement.
    // This (not a UI window) is what pulls a project toward the orbit core.
    const heatByPid = new Map();
    for (const p of model.projects) {
      let h = 0;
      for (const kid of p.kids) {
        const age = facts.actHours.get(kid.id);
        if (age != null && age !== Infinity) h += Math.exp(-age / (24 * 45)); // ~45-day decay
      }
      heatByPid.set(p.pid, h);
    }
    const { pos, meta, clusters, labels, axis, centroid } = buildClusters(model, heatByPid);
    const nodes = []; const cidById = new Map(); const recById = new Map(); const amtById = new Map(); const typeById = new Map();
    for (const [id, p] of pos) {
      const m = meta.get(id);
      const rh = m.type === "Project" ? Infinity : (facts.actHours.get(id) ?? Infinity); // hubs never gate; missing date = structural (never flows)
      const amt = facts.amount.get(id) ?? 0;
      nodes.push({ id, ...m, rh, amt, x: p.x, y: p.y, z: p.z, fx: p.x, fy: p.y, fz: p.z });
      cidById.set(id, m.cid); recById.set(id, rh); amtById.set(id, amt); typeById.set(id, m.type);
    }
    const ids = new Set(nodes.map((n) => n.id));
    const links = data.edges.filter((e) => e.source !== e.target && ids.has(e.source) && ids.has(e.target))
      .map((e) => {
        const rs = recById.get(e.source), rt = recById.get(e.target);
        return {
          source: e.source, target: e.target,
          cross: cidById.get(e.source) !== cidById.get(e.target),
          rh: Math.min(rs, rt),                                   // hours since the mover last moved
          moverType: (rs <= rt ? typeById.get(e.source) : typeById.get(e.target)), // what moved → pulse colour
          amt: Math.max(amtById.get(e.source), amtById.get(e.target)),             // $ carried → vessel width
        };
      });
    return { nodes, links, clusters, labels, axis, centroid };
  }, [model, data, facts]);

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

  // KPI strip scope: an active highlight rolls up that cross-cutting slice; else a
  // focused project; else the whole enterprise. (After `hot` so it's initialised.)
  const strip = useMemo(() => {
    if (hl && hot && model) {
      let amount = 0; const counts = {};
      for (const id of hot.set) {
        const a = facts?.amount.get(id); if (a) amount += a;
        const t = model.nodesById.get(id)?.type; if (t) counts[t] = (counts[t] || 0) + 1;
      }
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 4);
      return { mode: "slice", scope: hl.label, dim: SYSTEM_LABEL[hl.dim] || (hl.dim === "vendor" ? "Vendor" : "Employee"), amount, points: hot.count, projects: hot.pids.size, top };
    }
    return { mode: focus ? "project" : "enterprise", ...computeKpis(focus, evm, field, safety) };
  }, [hl, hot, focus, facts, model, evm, field, safety]);

  // periphery fade: blend a node's color toward the background by its project's heat,
  // scaled by the live fade slider (fadeAmt 0 → no fade, ~1 → periphery vanishes)
  const effFade = (heat) => (heat == null ? 1 : 1 - fadeAmtRef.current * (1 - heat));
  const faded = (hex, f) => "#" + new THREE.Color("#0b1017").lerp(new THREE.Color(hex), f).getHexString();
  const nodeColor = (n) => {
    const h = hotRef.current;
    if (h) return h.set.has(n.id) ? colorFor(n.type) : DIM; // highlight overrides fade
    const f = effFade(n.heat);
    return f < 1 ? faded(colorFor(n.type), f) : colorFor(n.type);
  };
  const nodeVal = (n) => { const base = n.type === "Project" ? (n.hubVal || 30) : 3; const h = hotRef.current; return h && h.set.has(n.id) ? base * 2.2 : base; };
  // pulses move faster the more recently their data point moved (within the window)
  const particleSpeed = (l) => flowSpeedRef.current * (1 + Math.min(1, Math.max(0, 1 - l.rh / windowRef.current)) * 2.5);
  const hubIntensityRef = useRef(new Map()); // pid -> 0..1 recent-activity intensity, drives hub pulse
  const clusterCentersRef = useRef(new Map()); // cid -> {center, radius}, for camera fly-to
  const flyTo = (pid) => {
    const g = fgRef.current, c = clusterCentersRef.current.get(pid);
    if (!g || !c) return;
    const d = (c.radius || 60) * 3.5 + 220;
    g.cameraPosition({ x: c.center.x + d * 0.25, y: c.center.y + d * 0.22, z: c.center.z + d }, c.center, 1200);
  };

  useEffect(() => {
    if (!graph || !mountRef.current) return;
    const el = mountRef.current;
    const g = ForceGraph3D({ controlType: "orbit" })(el)
      .backgroundColor("#05070b")
      .showNavInfo(false)
      // Nodes are pinned (fx/fy/fz) and the camera is orbit-driven — node dragging is
      // neither wired nor wanted, and DragControls' dragend fires a synthetic pointerup
      // into OrbitControls.onPointerUp that crashes ("reading 'x'" on an untracked
      // pointer). Disabling it removes DragControls entirely; clicks/orbit are unaffected.
      .enableNodeDrag(false)
      .width(el.clientWidth).height(el.clientHeight)
      .graphData({ nodes: graph.nodes, links: graph.links })
      .cooldownTicks(1) // nodes are pinned (fx/fy/fz); 1 tick initialises link curves for particles
      .nodeColor(nodeColor).nodeVal(nodeVal).nodeOpacity(0.96).nodeResolution(lite ? 4 : 7)
      .nodeLabel((n) => { const h = hotRef.current; if (h && !h.set.has(n.id)) return ""; return `<div style="font-size:12px"><b>${n.label}</b><br/><span style="opacity:.6">${n.type} · ${n.domain}</span></div>`; })
      .linkCurvature(0.22)
      // paths are a quiet, thin structure; thickness grows with the $ a record carries
      .linkWidth((l) => { const h = hotRef.current; if (h) return (h.set.has(l.source.id || l.source) && h.set.has(l.target.id || l.target)) ? 0.9 : 0.1; return vesselWidth(l.amt); })
      .linkColor((l) => { const h = hotRef.current; if (h) return (h.set.has(l.source.id || l.source) && h.set.has(l.target.id || l.target)) ? "#f59e0b" : "#0a0e14"; return l.amt > 1e6 ? "#26384b" : (l.cross ? "#22303f" : "#161f29"); })
      .linkOpacity(0.26)
      // particles = actual data points that moved within the window; colour = what moved, speed = how recent
      .linkDirectionalParticles((l) => (!lite && l.rh <= windowRef.current ? 1 : 0))
      .linkDirectionalParticleWidth(flowSizeRef.current).linkDirectionalParticleSpeed(particleSpeed).linkDirectionalParticleColor((l) => colorFor(l.moverType))
      .onNodeClick(async (n) => {
        const h = hotRef.current; if (h && !h.set.has(n.id)) return; // greyed-out → not selectable
        // clicking anywhere in a project's globe focuses that project (the [focus] effect flies there)
        if (n.pid) { const proj = model?.projects?.find((p) => p.pid === n.pid); if (proj) setFocus({ pid: proj.pid, name: proj.name, code: proj.code }); }
        setSelected({ loading: true });
        const d = await entityDetail(n.id); setSelected(d || { missing: true });
      });

    // depth haze — lighter than before: the orbit is a much bigger volume
    g.scene().fog = new THREE.FogExp2(0x05070b, 0.00028);

    // the enterprise core: a faint glowing time axis the whole portfolio orbits
    if (graph.axis) {
      const lineGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(graph.axis.x0, 0, 0), new THREE.Vector3(graph.axis.x1, 0, 0)]);
      const line = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x2dd4bf, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending }));
      line.raycast = () => {};
      g.scene().add(line);
      const tube = new THREE.Mesh(
        new THREE.CylinderGeometry(6, 6, graph.axis.x1 - graph.axis.x0, 8, 1, true),
        new THREE.MeshBasicMaterial({ color: 0x155e63, transparent: true, opacity: 0.1, blending: THREE.AdditiveBlending, depthWrite: false }));
      tube.rotation.z = Math.PI / 2;
      tube.position.set((graph.axis.x0 + graph.axis.x1) / 2, 0, 0);
      tube.raycast = () => {};
      g.scene().add(tube);
    }

    // faint membrane around each vascular system — periphery membranes fade too
    // (fade-reactive: registered so the slider updates them live)
    membranesRef.current = []; labelSpritesRef.current = [];
    for (const c of graph.clusters) {
      const col = new THREE.Color(c.color);
      const f = effFade(c.heat ?? 1);
      const fill = new THREE.Mesh(new THREE.SphereGeometry(c.radius * 1.05, 18, 14), new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.045 * (0.35 + 0.65 * f) }));
      fill.position.set(c.center.x, c.center.y, c.center.z);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.SphereGeometry(c.radius * 1.05, 12, 9)), new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.09 * f }));
      wire.position.copy(fill.position);
      fill.raycast = () => {}; wire.raycast = () => {}; // decorative — don't block node clicks
      g.scene().add(fill); g.scene().add(wire);
      membranesRef.current.push({ fill, wire, heat: c.heat ?? 1 });
    }
    for (const lb of graph.labels) {
      const s = new SpriteText(lb.text); s.color = lb.color; s.textHeight = lb.size;
      s.backgroundColor = "rgba(4,7,11,0.6)"; s.padding = lb.size * 0.35; s.borderRadius = 2; // dark chip keeps text crisp under bloom
      s.material.opacity = lb.heat != null ? 0.35 + 0.65 * effFade(lb.heat) : (lb.faint ? 0.7 : 1);
      s.material.transparent = true; s.position.set(lb.x, lb.y, lb.z);
      s.raycast = () => {};
      g.scene().add(s);
      if (lb.heat != null) labelSpritesRef.current.push({ s, heat: lb.heat });
    }
    g.scene().add(new THREE.AmbientLight(0xffffff, 0.95));

    // glow — gentle, so labels stay legible (only bright cores bloom). Skipped in lite mode.
    if (!lite) {
      const bloom = new UnrealBloomPass(new THREE.Vector2(el.clientWidth, el.clientHeight), 0.7, 0.5, 0.22);
      g.postProcessingComposer().addPass(bloom);
    }

    // hub pulse: each project breathes brighter the more it's moved recently
    const halos = [];
    for (const c of graph.clusters.filter((cl) => cl.kind === "project")) {
      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(1, 16, 12),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(c.color), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      halo.position.set(c.center.x, c.center.y, c.center.z);
      halo.raycast = () => {};
      halo.scale.setScalar(c.radius * 0.6);
      g.scene().add(halo);
      halos.push({ mesh: halo, base: c.radius * 0.6, pid: c.pid, phase: (c.center.x % 11) });
    }
    let raf;
    // FPS watch: average the first few seconds; if it's struggling on a weak GPU,
    // auto-downgrade to lite once (drops bloom + particles, which dominate cost).
    let fpsStart = performance.now(), frames = 0, fpsChecked = false;
    const animate = () => {
      const now = performance.now(), t = now / 1000;
      for (const h of halos) {
        const I = hubIntensityRef.current.get(h.pid) || 0;
        const pulse = 0.55 + 0.45 * Math.sin(t * 1.7 + h.phase);
        h.mesh.material.opacity = 0.02 + 0.24 * I * pulse;
        h.mesh.scale.setScalar(h.base * (1 + 0.14 * I * pulse));
      }
      if (!fpsChecked && !liteRef.current) {
        frames++;
        const elapsed = now - fpsStart;
        if (elapsed > 3000) { // give it a moment to settle, then judge
          if (frames / (elapsed / 1000) < 25) setLite(true);
          fpsChecked = true;
        }
      }
      raf = requestAnimationFrame(animate);
    };
    animate();

    clusterCentersRef.current = new Map(graph.clusters.map((c) => [c.cid, c]));
    const ctr = graph.centroid;
    // frame the whole orbit: distance follows the time-axis span, not a fixed constant
    const span = graph.axis ? graph.axis.x1 - graph.axis.x0 : 2400;
    g.cameraPosition({ x: ctr.x + 260, y: 540, z: ctr.z + span * 0.6 + 950 }, ctr, 0);
    const controls = g.controls();
    controlsRef.current = controls;
    if (controls) {
      controls.autoRotate = true; controls.autoRotateSpeed = 0.28;
      controls.enablePan = true; controls.enableZoom = true;
      controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.PAN };
    }

    fgRef.current = g;
    // clamp DPR so high-density phones don't over-allocate the WebGL backing store
    try { g.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); } catch { /* noop */ }
    if (focus?.pid) flyTo(focus.pid); // mounted with a project already focused (e.g. from Data/Ask)
    // resize the renderer to the *container* (not just the window) so mobile stacking,
    // the filters drawer, and orientation changes all re-fit the canvas instead of
    // leaving it sized to its first (desktop) layout.
    const onResize = () => g.width(el.clientWidth).height(el.clientHeight);
    const ro = (typeof ResizeObserver !== "undefined") ? new ResizeObserver(onResize) : null;
    if (ro) ro.observe(el); else window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
    return () => {
      if (ro) ro.disconnect(); else window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onResize);
      cancelAnimationFrame(raf);
      try { g._destructor && g._destructor(); } catch { /* noop */ }
      fgRef.current = null; if (el) el.innerHTML = "";
    };
  }, [graph, lite]); // rebuild when quality mode flips

  useEffect(() => {
    const g = fgRef.current; if (!g) return;
    g.nodeColor(nodeColor).nodeVal(nodeVal).linkColor(g.linkColor()).linkWidth(g.linkWidth()).linkDirectionalParticles((l) => (!liteRef.current && l.rh <= windowRef.current ? 1 : 0));
    // turn off raycast on greyed-out nodes so colored (filtered) ones are easy to grab
    for (const n of g.graphData().nodes) {
      const obj = n.__threeObj; if (!obj) continue;
      if (!obj.__origRaycast) obj.__origRaycast = obj.raycast;
      obj.raycast = (hot && !hot.set.has(n.id)) ? NOOP : obj.__origRaycast;
    }
  }, [hot]);
  useEffect(() => { if (controlsRef.current) controlsRef.current.autoRotate = spin; }, [spin]);
  // focus changed from anywhere (click / Data row / agent) → fly the camera there
  useEffect(() => { if (focus?.pid) flyTo(focus.pid); }, [focus?.pid]); // eslint-disable-line
  // flow controls → live-update the particle system
  useEffect(() => { windowRef.current = WINDOWS[windowIdx].h; const g = fgRef.current; if (g) g.linkDirectionalParticles((l) => (!liteRef.current && l.rh <= windowRef.current ? 1 : 0)).linkDirectionalParticleSpeed(particleSpeed); }, [windowIdx, graph]);
  useEffect(() => { flowSpeedRef.current = flowSpeed; const g = fgRef.current; if (g) g.linkDirectionalParticleSpeed(particleSpeed); }, [flowSpeed, graph]);
  useEffect(() => { flowSizeRef.current = flowSize; const g = fgRef.current; if (g) g.linkDirectionalParticleWidth(flowSize); }, [flowSize, graph]);
  // periphery-fade slider → recolor nodes + refade membranes/labels live (no rebuild)
  useEffect(() => {
    fadeAmtRef.current = fadeAmt;
    const g = fgRef.current; if (!g) return;
    g.nodeColor((n) => nodeColor(n));
    for (const m of membranesRef.current) {
      const f = effFade(m.heat);
      m.fill.material.opacity = 0.045 * (0.35 + 0.65 * f);
      m.wire.material.opacity = 0.09 * f;
    }
    for (const l of labelSpritesRef.current) l.s.material.opacity = 0.35 + 0.65 * effFade(l.heat);
  }, [fadeAmt]); // eslint-disable-line
  const activeCount = useMemo(() => (graph ? graph.nodes.filter((n) => n.type !== "Project" && n.rh <= WINDOWS[windowIdx].h).length : 0), [graph, windowIdx]);
  // recompute per-project recent-activity intensity (drives the hub pulse) when window/data changes
  useEffect(() => {
    if (!graph) return;
    const win = WINDOWS[windowIdx].h, counts = new Map();
    for (const n of graph.nodes) { if (n.type !== "Project" && n.pid && n.rh <= win) counts.set(n.pid, (counts.get(n.pid) || 0) + 1); }
    const max = Math.max(1, ...counts.values());
    const inten = new Map(); for (const [pid, c] of counts) inten.set(pid, c / max);
    hubIntensityRef.current = inten;
  }, [graph, windowIdx]);

  const mfCodes = useMemo(() => codes.filter((c) => c.system_id === "masterformat"), [codes]);
  const ufCodes = useMemo(() => codes.filter((c) => c.system_id === "uniformat"), [codes]);
  const vendors = useMemo(() => (model?.backbone || []).filter((n) => n.type === "Organization").sort((a, b) => a.label.localeCompare(b.label)), [model]);
  const employees = useMemo(() => (model?.backbone || []).filter((n) => n.type === "Person").sort((a, b) => a.label.localeCompare(b.label)), [model]);
  const pick = (dim, value, label, depth = null) => setHl(value ? { dim, value, label, depth } : null);

  return (
    <div className="h-full flex flex-col md:flex-row">
      {/* mobile-only toolbar: open the highlight/filters drawer */}
      <div className="md:hidden shrink-0 flex items-center gap-3 px-3 py-2 border-b border-white/10 bg-[#0b0f14]">
        <button onClick={() => setRailOpen(true)} className="text-xs px-3 py-2 rounded bg-white/5 text-white/75 active:bg-white/10">☰ Highlight / filters</button>
        {hl && <span className="text-xs text-amber-200/80 truncate">{hl.label}</span>}
      </div>
      {/* drawer backdrop (mobile) */}
      {railOpen && <div className="md:hidden fixed inset-0 z-30 bg-black/50" onClick={() => setRailOpen(false)} />}

      <aside className={`w-60 shrink-0 border-r border-white/10 p-3 overflow-auto text-sm bg-[#0b0f14] md:static md:block
        max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72 max-md:max-w-[85vw] max-md:shadow-2xl
        ${railOpen ? "max-md:block" : "max-md:hidden"}`}>
        <button onClick={() => setRailOpen(false)} className="md:hidden mb-3 text-xs text-white/45 hover:text-white/80">✕ close</button>
        <h3 className="text-white/40 text-[10px] uppercase tracking-wide mb-1">Highlight by</h3>
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
        <h3 className="text-white/40 text-[10px] uppercase tracking-wide mt-5 mb-1">Reading it</h3>
        <div className="text-[10px] text-white/50 leading-snug space-y-1">
          {literal ? (
            <>
              <div>Each sphere = a <b>project</b>, tinted by business unit; sized by how much data it holds.</div>
              <div><b>Active projects sit near the glowing time axis</b>; dormant ones drift outward and fade. Left→right = lifecycle. Angle = business unit.</div>
              <div>Each moving dot = a <b>record updated</b> in the time window (colour = record type); faster = more recent.</div>
              <div>Thicker links carry more <b>contract $</b>. Click a project → KPIs + agent rescope.</div>
            </>
          ) : (
            <>
              <div>Each glowing globe = a <b>project</b> (a vascular system), tinted by business unit, sized by its data mass.</div>
              <div><b>The core pulls in whatever is hot</b> — active projects orbit the glowing time axis; dormant ones drift to the faded periphery. Left→right = lifecycle. Angle = business unit.</div>
              <div>Each pulse = a <b>real data point that moved</b> in the window (colour = what kind); faster = more recent.</div>
              <div>Thicker vessels carry more <b>$</b>. Click a project → KPIs + agent rescope.</div>
            </>
          )}
        </div>
        <h3 className="text-white/40 text-[10px] uppercase tracking-wide mt-4 mb-1">Entity types</h3>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">{Object.keys(TYPE_COLOR).map((t) => (<div key={t} className="flex items-center gap-1 text-[10px] text-white/55"><span className="w-3 text-center leading-none shrink-0" style={{ color: colorFor(t) }}>{shapeFor(t)}</span>{t}</div>))}</div>
        <style>{`.cl-select{width:100%;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:6px;padding:5px 6px;font-size:12px;color:#e5e7eb}`}</style>
      </aside>

      <div className="relative flex-1 min-w-0 min-h-0 max-md:h-[60vh]">
        <div ref={mountRef} className="absolute inset-0" />
        <OntologyIntro />

        <div className="absolute top-3 left-4 right-4 z-10 pointer-events-none">
          <h2 className="text-sm text-white/80 font-medium">{literal ? "Clayco ontology — projects and the systems they share" : "Clayco ontology — interwoven project systems"}</h2>
          <div className="text-xs text-white/45 mt-0.5 max-md:hidden">orbit: left/middle drag · pan: right drag · zoom: scroll · click a project to focus everything on it.</div>
          {hl && hot && (
            <div className="mt-2 inline-block bg-amber-500/15 text-amber-200 text-xs rounded px-2 py-1 pointer-events-auto">
              Highlighting <b>{SYSTEM_LABEL[hl.dim] || (hl.dim === "vendor" ? "Vendor" : "Employee")}</b> · {hl.label}<span className="text-amber-200/70"> — {hot.count} pts across {hot.pids.size} project{hot.pids.size === 1 ? "" : "s"}</span>
            </div>
          )}
        </div>

        <div className="absolute top-3 right-11 z-10 flex items-center gap-1.5">
          <button onClick={() => setLite((v) => !v)} aria-label="Toggle lite visual quality" aria-pressed={lite} title="Visual quality — lite drops glow + flow particles for weaker GPUs"
            className="text-[11px] px-2 py-1 rounded bg-black/40 text-white/60 hover:text-white">{lite ? "○ lite" : "● full"}</button>
          <button onClick={() => setSpin((s) => !s)} aria-label="Toggle camera drift" aria-pressed={spin} title="Camera drift — slow auto-orbit" className="text-[11px] px-2 py-1 rounded bg-black/40 text-white/60 hover:text-white">{spin ? "⏸ drift" : "▶ drift"}</button>
        </div>

        {/* flow controls — what's moving, how fast, how big */}
        <div className="absolute left-3 bottom-24 z-20 w-56 bg-[#0d1218]/90 border border-white/10 rounded-xl p-3 text-xs">
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-white/70 font-medium">{literal ? "Recent activity" : "Flow · recent activity"}</span>
            <span className="text-cyan-300/90">{activeCount} {literal ? "updated" : "moved"}</span>
          </div>
          <label className="block text-white/45 text-[10px] mt-1">Active in the last <b className="text-white/70">{WINDOWS[windowIdx].label}</b></label>
          <input type="range" aria-label="Activity time window" min="0" max={WINDOWS.length - 1} step="1" value={windowIdx} onChange={(e) => setWindowIdx(+e.target.value)} className="cl-range" />
          <label className="block text-white/45 text-[10px] mt-2">Speed</label>
          <input type="range" aria-label="Flow speed" min="0.001" max="0.012" step="0.0005" value={flowSpeed} onChange={(e) => setFlowSpeed(+e.target.value)} className="cl-range" />
          <label className="block text-white/45 text-[10px] mt-2">Size</label>
          <input type="range" aria-label="Flow particle size" min="3" max="10" step="0.25" value={flowSize} onChange={(e) => setFlowSize(+e.target.value)} className="cl-range" />
          <label className="block text-white/45 text-[10px] mt-2">Periphery fade <span className="text-white/30">· dormant projects dim</span></label>
          <input type="range" aria-label="Periphery fade for dormant projects" min="0" max="0.95" step="0.05" value={fadeAmt} onChange={(e) => setFadeAmt(+e.target.value)} className="cl-range" />
          <style>{`.cl-range{width:100%;accent-color:#38bdf8;height:3px}`}</style>
        </div>

        {loading && <div className="absolute inset-0 grid place-items-center text-white/50 text-sm">loading ontology…</div>}

        {/* selection-driven KPI strip */}
        <div className="absolute bottom-0 left-0 right-0 z-10 bg-gradient-to-t from-black/70 to-transparent px-4 pt-6 pb-2">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[11px] uppercase tracking-wide text-white/45">{strip.mode === "slice" ? "Slice ·" : "Live KPIs ·"}</span>
            <span className="text-sm text-white/85 font-medium">{strip.mode === "slice" ? `${strip.dim} · ${strip.scope}` : strip.scope}</span>
            {strip.mode === "slice" && <button onClick={() => setHl(null)} className="text-[11px] text-amber-300/80 hover:text-amber-200">✕ clear</button>}
            {strip.mode === "project" && <button onClick={() => setFocus(null)} className="text-[11px] text-amber-300/80 hover:text-amber-200">↩ enterprise</button>}
          </div>
          <div className="flex flex-wrap gap-2">
            {strip.mode === "slice" ? (
              <>
                <Kpi label={literal ? "Value in slice" : "$ carried"} value={fmt$(strip.amount)} />
                <Kpi label={literal ? "Records" : "Data points"} value={strip.points} />
                <Kpi label="Projects touched" value={strip.projects} />
                {strip.top.map(([t, c]) => <Kpi key={t} label={t} value={c} />)}
              </>
            ) : (
              <>
                <Kpi label="Contract / BAC" value={fmt$(strip.bac)} />
                <Kpi label="EAC" value={fmt$(strip.eac)} warn={strip.eac > strip.bac} sub={strip.eac > strip.bac ? `+${fmt$(strip.eac - strip.bac)} over` : "on budget"} />
                <Kpi label="CPI" value={strip.cpi?.toFixed(2) ?? "—"} warn={strip.cpi < 1} />
                <Kpi label="SPI" value={strip.spi?.toFixed(2) ?? "—"} warn={strip.spi < 1} />
                <Kpi label="Open RFIs" value={strip.openRfis ?? "—"} sub={strip.totalRfis ? `of ${strip.totalRfis}` : null} />
                <Kpi label="TRIR" value={strip.trir != null ? strip.trir.toFixed(2) : "—"} warn={strip.trir > 3} />
                {strip.mode === "enterprise" && <Kpi label="Projects" value={strip.projects ?? "—"} />}
              </>
            )}
          </div>
        </div>
      </div>

      {selected && (
        <aside className="w-80 max-w-[80vw] shrink-0 border-l border-white/10 p-4 overflow-auto text-sm bg-[#0d1218]
          max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-40 max-md:w-full max-md:max-w-none max-md:border-l-0 max-md:border-t max-md:rounded-t-xl max-md:max-h-[70vh] max-md:pb-16 max-md:shadow-2xl">
          {selected.loading ? <div className="text-white/50">loading…</div> : selected.missing ? <div className="text-white/50">no detail</div> : (
            <>
              <button onClick={() => setSelected(null)} className="text-white/30 hover:text-white/70 text-xs mb-2">✕ close</button>
              <div className="flex items-center gap-2 mb-1"><span className="w-3 h-3 rounded-full" style={{ background: colorFor(selected.entity.entity_type) }} /><span className="text-xs text-white/50">{selected.entity.entity_type} · {selected.entity.domain}</span></div>
              <div className="text-base font-semibold mb-3">{selected.entity.label}</div>
              <h3 className="text-white/40 text-xs uppercase tracking-wide mb-1 font-normal">Record · {selected.entity.source_table}</h3>
              <table className="w-full text-xs mb-4"><tbody>
                {Object.entries(selected.record || {}).filter(([k]) => k !== "id").slice(0, 24).map(([k, v]) => (<tr key={k} className="border-b border-white/5"><td className="py-1 pr-2 text-white/40 align-top">{k}</td><td className="py-1 text-white/80 break-words">{v === null ? "—" : String(v)}</td></tr>))}
              </tbody></table>
              <h3 className="text-white/40 text-xs uppercase tracking-wide mb-1 font-normal">Connected ({(selected.neighbors.nodes || []).length - 1})</h3>
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

function Field({ label, children }) { return (<label className="block mb-3"><span className="block text-white/55 text-[11px] mb-1">{label}</span>{children}</label>); }
function Kpi({ label, value, sub, warn }) {
  const def = defOf(label);
  return (
    <div className="bg-[#0d1218]/85 border border-white/10 rounded-lg px-3 py-1.5 min-w-[92px]">
      <div title={def || undefined}
        className={`text-[10px] text-white/45${def ? " cursor-help underline decoration-dotted decoration-white/25 underline-offset-2" : ""}`}>{label}</div>
      <div className={`text-lg font-semibold leading-tight ${warn ? "text-red-400" : "text-white/90"}`}>{value}</div>
      {sub && <div className={`text-[10px] ${warn ? "text-red-400/80" : "text-white/40"}`}>{sub}</div>}
    </div>
  );
}
