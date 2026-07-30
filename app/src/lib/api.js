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
// Time-series snapshots for trend charts (migration 007 kpi_history; backfilled in seed).
export async function kpiHistory(metric, projectId = null) {
  let q = supabase.from("kpi_history").select("snapshot_date,project_id,business_unit_id,value").eq("metric", metric).order("snapshot_date");
  if (projectId) q = q.eq("project_id", projectId);
  const { data } = await q;
  return data || [];
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
