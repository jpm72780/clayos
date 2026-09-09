import { supabase, FUNCTIONS_URL, REST_URL, ANON_KEY } from "./supabase.js";

const MAX_PAGES = 50; // safety stop (50k rows) — guards against a server that ignores paging

// PostgREST caps every response at 1,000 rows (db-max-rows). The graph is 1,711
// entities, so a plain select silently returns the first 1,000 — the Data table,
// its quantification/CSV, and the 3D highlight map were all missing ~711 rows.
// Table reads honor the Range header, so page via .range() until a short page.
// `makeQuery` must return a fresh, deterministically-ordered query each call.
async function fetchAllRows(makeQuery, pageSize = 1000) {
  let from = 0; const out = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await makeQuery().range(from, from + pageSize - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return out;
}

// Set-returning RPCs ignore the Range header but DO honor ?limit/?offset query
// params — so page those explicitly (supabase-js .range() would loop on dupes).
async function fetchAllRpc(fn, { order, pageSize = 1000 } = {}) {
  const headers = {
    apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}`, "Content-Type": "application/json",
    "Accept-Profile": "clayos", "Content-Profile": "clayos",
  };
  const out = []; let offset = 0;
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${REST_URL}/rpc/${fn}?${order ? `order=${order}&` : ""}limit=${pageSize}&offset=${offset}`;
    const r = await fetch(url, { method: "POST", headers, body: "{}" });
    if (!r.ok) throw new Error(`rpc ${fn} failed (${r.status})`);
    const data = await r.json();
    if (!Array.isArray(data) || data.length === 0) break;
    out.push(...data);
    if (data.length < pageSize) break;
    offset += pageSize;
  }
  return out;
}

export async function listBusinessUnits() {
  const { data } = await supabase.from("business_units").select("id,slug,name,kind").order("name");
  return data || [];
}

// Lightweight reachability probe — distinguishes "no data" (real) from "can't reach
// the API" (network/edge block), so the UI can say so instead of showing silent zeros.
export async function dataHealth() {
  try {
    const { data, error } = await supabase.from("business_units").select("id").limit(1);
    if (error) return { ok: false, message: error.message || "request failed" };
    if (!data || data.length === 0) return { ok: false, message: "no rows returned" };
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e?.message || "Failed to fetch" };
  }
}

// Full entity list for the Data Explorer (the whole graph, all 1,711 rows — paged).
export async function allEntities() {
  return fetchAllRows(() => supabase.from("entities")
    .select("id,entity_type,domain,label,business_unit_id,source_table,source_id,classification_id,properties")
    .order("entity_type").order("id")); // secondary key → stable paging
}

export async function projectsLite() {
  const { data } = await supabase.from("projects").select("id,code,name");
  return data || [];
}

// Full project rows for the map view — every project has a real city/state in seed.
export async function projectsGeo() {
  return fetchAllRows(() => supabase.from("projects")
    .select("id,code,name,business_unit_id,sector,lifecycle_stage,status,contract_value,city,state,gross_sf,start_date,end_date")
    .order("code"));
}

export async function buRollup() {
  const { data } = await supabase.from("kg_bu_rollup").select("*").order("total_contract_value", { ascending: false });
  return data || [];
}

export async function evmByProject() {
  const { data } = await supabase.from("kpi_evm").select("*").order("cpi");
  return data || [];
}

export async function fieldByProject() {
  const { data } = await supabase.from("kpi_field").select("*").order("open_rfis", { ascending: false });
  return data || [];
}

export async function safetyByProject() {
  const { data } = await supabase.from("kpi_safety").select("*").gt("hours_worked", 0).order("trir", { ascending: false });
  return data || [];
}

// Previously-computed-but-unused KPI matviews (migration 007), now surfaced in Analytics.
export async function wipByProject() {
  const { data } = await supabase.from("kpi_wip").select("*").order("over_under_billing", { ascending: false });
  return data || [];
}
export async function backlogByBu() {
  const { data } = await supabase.from("kpi_backlog").select("*").order("backlog", { ascending: false });
  return data || [];
}
export async function pipelineByBu() {
  const { data } = await supabase.from("kpi_pipeline").select("*").order("weighted_pipeline_value", { ascending: false });
  return data || [];
}
export async function utilizationByBu() {
  const { data } = await supabase.from("kpi_resource_util").select("*").order("avg_utilization_pct", { ascending: false });
  return data || [];
}
// Time-series snapshots for trend charts (migration 007 kpi_history; backfilled in
// seed, then appended nightly by pg_cron).
//
// This USED to be a plain select, which PostgREST silently capped at 1,000 rows —
// so the Analytics trend chart was quietly plotting only the earliest slice of a
// table that grows every night. Paged now, and narrowable server-side: always
// scope by project or BU where you can, because an unfiltered read of every
// metric would approach fetchAllRows' 50k safety stop.
export async function kpiHistory(metric, { projectId = null, businessUnitId = null, from = null, to = null } = {}) {
  return fetchAllRows(() => {
    let q = supabase.from("kpi_history")
      .select("snapshot_date,project_id,business_unit_id,value")
      .eq("metric", metric)
      .order("snapshot_date").order("project_id"); // secondary key → stable paging
    if (projectId) q = q.eq("project_id", projectId);
    if (businessUnitId) q = q.eq("business_unit_id", businessUnitId);
    if (from) q = q.gte("snapshot_date", from);
    if (to) q = q.lte("snapshot_date", to);
    return q;
  });
}

// ─── Time views: schedule ────────────────────────────────────────────────────
// Project spans — the only date range that covers all 200 projects, so it's what
// the portfolio Gantt is built from. projectsGeo() omits actual_finish; this
// doesn't, because planned-vs-actual needs it.
export async function projectSchedule() {
  return fetchAllRows(() => supabase.from("projects")
    .select("id,code,name,business_unit_id,sector,lifecycle_stage,status,contract_value,start_date,end_date,actual_finish")
    .order("start_date").order("id"));
}

// Activity bars. Deep projects carry real CPM detail; the long tail carries
// is_summary rows (relational-only — migration 015 keeps them out of the graph).
export async function scheduleActivities() {
  return fetchAllRows(() => supabase.from("schedule_activities")
    .select("id,project_id,activity_code,name,planned_start,planned_finish,actual_start," +
            "actual_finish,pct_complete,is_critical,total_float_days,activity_kind,is_summary")
    .order("project_id").order("planned_start").order("id"));
}

// Read the TABLE, not the graph: the `depends_on` edge projection drops dep_type
// and lag_days (migration 006), which are exactly what a Gantt needs to draw logic.
export async function scheduleDependencies() {
  return fetchAllRows(() => supabase.from("schedule_dependencies")
    .select("id,predecessor_id,successor_id,dep_type,lag_days").order("id"));
}

export async function projectPhases() {
  return fetchAllRows(() => supabase.from("phases")
    .select("id,project_id,name,seq,start_date,end_date,status")
    .order("project_id").order("seq"));
}

// PV/EV/AC by month for one project (the EVM S-curve). Scoped deliberately —
// never pull cost_progress portfolio-wide.
export async function costCurve(projectId) {
  const { data, error } = await supabase.from("cost_progress")
    .select("period,pv,ev,ac,cost_accounts!inner(project_id)")
    .eq("cost_accounts.project_id", projectId).order("period");
  if (error) throw error;
  return data || [];
}

// ─── Time views: transaction history ─────────────────────────────────────────
// Every dated record, normalised to { at, kind, id, pid, label, amount, endAt }.
//
// Deliberately NOT built on kg_entity_facts(): that RPC COALESCEs each record to
// a single instant (so answered_date REPLACES submitted_date and RFI turnaround
// becomes uncomputable), omits five entity types, and would need a join against
// all ~6.4k entities to recover type/project/label. Ten skinny selects are
// smaller on the wire and strictly more expressive.
const EVENT_SOURCES = [
  { table: "rfis", kind: "RFI",
    cols: "id,project_id,number,subject,status,submitted_date,answered_date,cost_impact",
    at: "submitted_date", endAt: "answered_date", amount: "cost_impact",
    label: (r) => `RFI ${r.number} — ${r.subject || ""}`.trim() },
  { table: "daily_logs", kind: "DailyLog", cols: "id,project_id,log_date,manpower_count",
    at: "log_date", label: (r) => `Daily log — ${r.manpower_count ?? 0} on site` },
  { table: "contracts", kind: "Contract",
    cols: "id,project_id,contract_type,value,executed_date,scope",
    at: "executed_date", amount: "value",
    label: (r) => `${(r.contract_type || "contract").replace(/_/g, " ")} — ${r.scope || ""}`.trim() },
  { table: "submittals", kind: "Submittal", cols: "id,project_id,number,title,status,submitted_date,returned_date",
    at: "submitted_date", endAt: "returned_date", label: (r) => `Submittal ${r.number} — ${r.title || ""}`.trim() },
  { table: "pay_apps", kind: "PayApp", cols: "id,project_id,number,period_end,status,submitted_date,approved_date",
    at: "period_end", label: (r) => `Pay application #${r.number}` },
  { table: "safety_events", kind: "SafetyEvent", cols: "id,project_id,event_date,type,severity,recordable",
    at: "event_date", label: (r) => `${String(r.type || "event").replace(/_/g, " ")}${r.recordable ? " (recordable)" : ""}` },
  { table: "quality_events", kind: "QualityEvent", cols: "id,project_id,type,status,identified_date,resolved_date",
    at: "identified_date", endAt: "resolved_date", label: (r) => `${String(r.type || "").replace(/_/g, " ")} — ${r.status || ""}`.trim() },
  { table: "documents", kind: "Document", cols: "id,project_id,doc_type,number,title,issued_date",
    at: "issued_date", label: (r) => `${r.doc_type || "document"} ${r.number || ""} ${r.title || ""}`.trim() },
];

export async function timelineEvents() {
  const per = await Promise.all(EVENT_SOURCES.map(async (src) => {
    const rows = await fetchAllRows(() => supabase.from(src.table).select(src.cols).order("id"));
    return rows.map((r) => ({
      id: `${src.table}:${r.id}`, kind: src.kind, pid: r.project_id,
      at: r[src.at] || null, endAt: src.endAt ? r[src.endAt] || null : null,
      amount: src.amount != null ? r[src.amount] : null,
      status: r.status || null, label: src.label(r),
    })).filter((e) => e.at);
  }));
  return per.flat();
}

// Filtered subgraph for the ontology viewer: { nodes:[...], edges:[...] }
export async function subgraph({ businessUnit = null, domains = null, entityTypes = null, limit = 1200 } = {}) {
  const { data, error } = await supabase.rpc("kg_subgraph", {
    p_business_unit: businessUnit, p_domains: domains, p_entity_types: entityTypes, p_limit: limit,
  });
  if (error) throw error;
  return data || { nodes: [], edges: [] };
}

// Full detail for one node: entity row + underlying domain record + neighbors.
export async function entityDetail(entityId) {
  const { data: ent } = await supabase.from("entities")
    .select("id,entity_type,domain,label,source_table,source_id,properties,business_unit_id")
    .eq("id", entityId).maybeSingle();
  if (!ent) return null;
  const { data: record } = await supabase.from(ent.source_table).select("*").eq("id", ent.source_id).maybeSingle();
  const { data: nbr } = await supabase.rpc("kg_neighbors", { p_entity: entityId });
  return { entity: ent, record, neighbors: nbr || { nodes: [], edges: [] } };
}

export async function neighbors(entityId) {
  const { data } = await supabase.rpc("kg_neighbors", { p_entity: entityId });
  return data || { nodes: [], edges: [] };
}

// Cross-cutting classification dimensions (MasterFormat/CSI, UniFormat).
export async function classificationCodes() {
  const { data } = await supabase.from("classification_codes")
    .select("id,system_id,code,title,depth").order("system_id").order("code");
  return data || [];
}

// id -> classification_id for every classified entity (for highlight filtering). Paged.
export async function entityClassMap() {
  return fetchAllRows(() => supabase.from("entities")
    .select("id,classification_id").not("classification_id", "is", null).order("id"));
}

// Per-entity facts: real "last activity" date + dollar amount (migration 010).
// Drives the recent-activity flow window + $-weighted vessels.
export async function entityFacts() {
  // SETOF RPC — also subject to the 1,000-row cap; page via ?limit/?offset.
  return fetchAllRpc("kg_entity_facts", { order: "entity_id" });
}

export async function ask(question, history = []) {
  const r = await fetch(`${FUNCTIONS_URL}/agent-ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ question, history }),
  });
  return r.json();
}

// Streaming ask: the edge function emits Server-Sent Events while it works —
//   onTool({name,label})  a kg_* tool started (progress: "exploring relationships…")
//   onToken(text)         a chunk of the answer (stream tokens as they arrive)
//   onDone({focus,highlight,tool_calls})  finished; drive the view from the hints
//   onError(message)      something failed (network, server, or stream error)
// Falls back to onError if the server returns a non-stream error response.
export async function askStream(question, history = [], { onTool, onToken, onDone, onError, signal } = {}) {
  try {
    const r = await fetch(`${FUNCTIONS_URL}/agent-ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ANON_KEY}`, "Accept": "text/event-stream" },
      body: JSON.stringify({ question, history }),
      signal,
    });
    if (!r.ok || !r.body) {
      let msg = `request failed (${r.status})`;
      try { const j = await r.json(); msg = j.error || msg; } catch { /* not json */ }
      onError?.(msg); return;
    }
    // Fallback: if the server answered with plain JSON (old function, or a proxy that
    // collapsed the stream), surface the whole answer at once instead of "(no answer)".
    if (!(r.headers.get("content-type") || "").includes("text/event-stream")) {
      const j = await r.json().catch(() => null);
      if (j && (j.answer || j.error)) { if (j.answer) onToken?.(j.answer); onDone?.(j); }
      else onError?.("unexpected response");
      return;
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf("\n\n")) !== -1) {
        const raw = buf.slice(0, idx); buf = buf.slice(idx + 2);
        let event = "message", data = "";
        for (const line of raw.split("\n")) {
          if (line.startsWith("event:")) event = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (!data) continue;
        let payload; try { payload = JSON.parse(data); } catch { continue; }
        if (event === "tool") onTool?.(payload);
        else if (event === "token") onToken?.(payload.text || "");
        else if (event === "done") onDone?.(payload);
        else if (event === "error") onError?.(payload.error || "stream error");
      }
    }
  } catch (e) {
    if (e?.name !== "AbortError") onError?.(e?.message || String(e));
  }
}
