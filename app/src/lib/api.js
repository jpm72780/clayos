import { supabase, FUNCTIONS_URL, ANON_KEY } from "./supabase.js";

export async function listBusinessUnits() {
  const { data } = await supabase.from("business_units").select("id,slug,name,kind").order("name");
  return data || [];
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

// id -> classification_id for every classified entity (for highlight filtering).
export async function entityClassMap() {
  const { data } = await supabase.from("entities")
    .select("id,classification_id").not("classification_id", "is", null);
  return data || [];
}

export async function ask(question, history = []) {
  const r = await fetch(`${FUNCTIONS_URL}/agent-ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": `Bearer ${ANON_KEY}` },
    body: JSON.stringify({ question, history }),
  });
  return r.json();
}
