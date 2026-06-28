// ClayOS agent tool registry (read-only). Mirrors counterpart's cp_tools pattern:
// a list of Anthropic tool schemas + an executor that runs each against the DB.
// All tools are READ-ONLY — there is no write path in this registry.
import { embed, vectorToPgLiteral } from "./embeddings.ts";

// deno-lint-ignore-file no-explicit-any
export type AnthropicTool = { name: string; description: string; input_schema: any };

export const KG_TOOLS: AnthropicTool[] = [
  {
    name: "kg_search",
    description:
      "Semantic search over the knowledge graph. Returns entities (projects, RFIs, cost accounts, people, orgs, etc.) most similar to a natural-language query. Use to locate things by meaning ('curtain wall RFIs', 'electrical subcontractors').",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query." },
        limit: { type: "integer", description: "Max results (default 12)." },
        business_unit_id: { type: "string", description: "Optional UUID to scope to one business unit." },
        domains: { type: "array", items: { type: "string" }, description: "Optional lifecycle domains to filter (e.g. ['field_ops','financials'])." },
      },
      required: ["query"],
    },
  },
  {
    name: "kg_get_entity",
    description:
      "Fetch full detail for one entity by its id: its properties, the underlying domain record, and its immediate graph neighbors. Use after kg_search/kg_traverse to drill in.",
    input_schema: {
      type: "object",
      properties: { entity_id: { type: "string", description: "entities.id UUID." } },
      required: ["entity_id"],
    },
  },
  {
    name: "kg_traverse",
    description:
      "Walk the knowledge graph outward from an entity up to N hops (undirected). Returns reachable entities with the relationship used. Use to answer 'what is connected to X' / 'which subs work on this project'.",
    input_schema: {
      type: "object",
      properties: {
        entity_id: { type: "string", description: "Starting entities.id UUID." },
        max_depth: { type: "integer", description: "Hops (default 2, max 3)." },
        edge_types: { type: "array", items: { type: "string" }, description: "Optional edge types to follow (e.g. ['has_rfi','depends_on'])." },
      },
      required: ["entity_id"],
    },
  },
  {
    name: "kg_kpi",
    description:
      "Look up computed KPIs. THE GOLDEN PATH for any numeric question (budget, schedule, billing, safety) — always prefer this over reasoning about raw numbers. With a project name/code returns that project's EVM (SPI/CPI/EAC), WIP, safety (TRIR), and field metrics. With a business-unit name returns its rollup. With neither, returns the rollup for every business unit.",
    input_schema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Project name or code (e.g. 'Aurora', 'DC-001')." },
        business_unit: { type: "string", description: "Business-unit name (e.g. 'Clayco Compute')." },
      },
    },
  },
  {
    name: "kg_classification",
    description:
      "Resolve or search industry classification codes (MasterFormat, UniFormat, OmniClass). Returns matching codes by number or title.",
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Code number or title fragment (e.g. '03 30', 'concrete')." } },
      required: ["query"],
    },
  },
  {
    name: "kg_schema",
    description:
      "Describe the knowledge graph: entity types, edge types, lifecycle domains, tables, and KPI views available. Use to orient before querying (especially before kg_query).",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "kg_query",
    description:
      "Run a single read-only SELECT against the clayos schema for ad-hoc aggregate questions the other tools don't cover (e.g. 'average RFI turnaround by discipline', 'count of open quality events by severity per business unit'). SELECT/WITH only, single statement, runs read-only with a 5s timeout and 500-row cap. Call kg_schema first to learn table/column names. Tables include: projects, business_units, organizations, persons, rfis, submittals, daily_logs, safety_events, quality_events, cost_accounts, cost_progress, schedule_activities, contracts, pay_apps, pay_app_lines, building_elements, spaces, documents, pursuits, estimates, requisitions, it_assets, staffing_assignments, plus the KPI views kpi_evm/kpi_wip/kpi_field/kpi_safety/kpi_backlog/kpi_pipeline/kpi_resource_util/kg_bu_rollup/kpi_history. Always schema-qualify (clayos.<table>).",
    input_schema: {
      type: "object",
      properties: { sql: { type: "string", description: "A single SELECT or WITH statement, no trailing semicolon. Schema-qualify tables as clayos.<name>." } },
      required: ["sql"],
    },
  },
];

export const KG_TOOL_NAMES = new Set(KG_TOOLS.map((t) => t.name));

const SCHEMA_DOC = {
  entity_types: ["Project", "Phase", "Work", "Space", "BuildingElement", "Document", "CostAccount",
    "Activity", "RFI", "Submittal", "DailyLog", "SafetyEvent", "QualityEvent", "PayApp", "Pursuit",
    "Estimate", "Contract", "Person", "Organization", "Requisition", "ITAsset"],
  edge_types: ["has_phase", "has_work", "part_of", "has_activity", "depends_on", "has_cost_account",
    "costs_for", "contains_space", "has_element", "located_in", "has_document", "has_rfi", "pertains_to",
    "has_submittal", "has_daily_log", "has_safety_event", "has_quality_event", "concerns", "has_pay_app",
    "client_for", "gc_for", "architect_for", "developer_for", "has_contract", "contracted_to",
    "pursuing", "has_estimate", "estimate_for", "staffed_on", "assigned_to", "hiring_manager"],
  domains: ["project", "project_controls", "design", "field_ops", "safety", "quality", "financials",
    "procurement", "business_development", "estimating", "enterprise", "hr", "recruiting", "it"],
  kpi_views: {
    kpi_evm: "per-project EVM: project_id, project_name, business_unit_id, bac, pv, ev, ac, spi, cpi, eac, pct_complete",
    kpi_wip: "per-project billing: project_id, contract_value, earned_revenue, billings_to_date, over_under_billing, retainage_held",
    kpi_safety: "per-project safety: project_id, hours_worked, recordables, trir, dart",
    kpi_field: "per-project field: project_id, open_rfis, total_rfis, avg_rfi_turnaround_days, open_submittals",
    kpi_backlog: "per-business-unit: business_unit_id, contract_value_active, earned_to_date, backlog",
    kpi_pipeline: "per-business-unit: business_unit_id, pursuits, won, lost, open_pipeline_value, weighted_pipeline_value, win_rate",
    kpi_resource_util: "per-business-unit: business_unit_id, people, avg_utilization_pct, unstaffed, overallocated",
    kpi_history: "time-series snapshots: snapshot_date, business_unit_id, project_id, metric (cpi/spi/pct_complete/trir), value",
    kg_bu_rollup: "per-business-unit rollup (incl. descendants): business_unit_name, projects, total_contract_value, spi, cpi, trir, open_rfis",
  },
  query_tables: ["projects", "business_units", "organizations", "persons", "rfis", "submittals",
    "daily_logs", "safety_events", "quality_events", "cost_accounts", "cost_progress", "schedule_activities",
    "contracts", "pay_apps", "pay_app_lines", "building_elements", "spaces", "documents", "pursuits",
    "estimates", "requisitions", "it_assets", "staffing_assignments", "classification_codes"],
};

export type KgContext = { admin: any; business_unit_ids?: string[] };

export async function executeKgTool(name: string, ctx: KgContext, args: Record<string, unknown>): Promise<unknown> {
  const { admin } = ctx;
  switch (name) {
    case "kg_schema":
      return SCHEMA_DOC;

    case "kg_search": {
      const vec = await embed(String(args.query || ""));
      const { data, error } = await admin.rpc("kg_search", {
        p_query_vec: vectorToPgLiteral(vec),
        p_limit: (args.limit as number) || 12,
        p_business_unit: (args.business_unit_id as string) || null,
        p_domains: (args.domains as string[]) || null,
      });
      if (error) throw new Error(`kg_search: ${error.message}`);
      return data;
    }

    case "kg_traverse": {
      const { data, error } = await admin.rpc("kg_traverse", {
        p_start: args.entity_id,
        p_max_depth: Math.min((args.max_depth as number) || 2, 3),
        p_edge_types: (args.edge_types as string[]) || null,
      });
      if (error) throw new Error(`kg_traverse: ${error.message}`);
      return data;
    }

    case "kg_get_entity": {
      const id = args.entity_id as string;
      const { data: ent, error: e1 } = await admin.from("entities").select("*").eq("id", id).maybeSingle();
      if (e1) throw new Error(`kg_get_entity: ${e1.message}`);
      if (!ent) return { error: "entity not found" };
      const { data: rec } = await admin.from(ent.source_table).select("*").eq("id", ent.source_id).maybeSingle();
      const { data: neighbors } = await admin.rpc("kg_neighbors", { p_entity: id });
      return { entity: ent, source_record: rec, neighbors };
    }

    case "kg_kpi": {
      const projectQ = (args.project as string) || "";
      const buQ = (args.business_unit as string) || "";
      if (projectQ) {
        const { data: proj } = await admin.from("projects").select("id,name,code")
          .or(`name.ilike.%${projectQ}%,code.ilike.%${projectQ}%`).limit(1).maybeSingle();
        if (!proj) return { error: `no project matching '${projectQ}'` };
        const { data, error } = await admin.rpc("kg_project_kpis", { p_project: proj.id });
        if (error) throw new Error(`kg_kpi: ${error.message}`);
        return { project: proj, kpis: data };
      }
      if (buQ) {
        const { data } = await admin.from("kg_bu_rollup").select("*").ilike("business_unit_name", `%${buQ}%`);
        return data;
      }
      const { data } = await admin.from("kg_bu_rollup").select("*").order("total_contract_value", { ascending: false });
      return data;
    }

    case "kg_classification": {
      const q = args.query as string;
      const { data } = await admin.from("classification_codes").select("system_id,code,title")
        .or(`code.ilike.%${q}%,title.ilike.%${q}%`).limit(25);
      return data;
    }

    case "kg_query": {
      const sql = String(args.sql || "");
      const { data, error } = await admin.rpc("kg_query_safe", { p_sql: sql });
      if (error) throw new Error(`kg_query: ${error.message}`);
      return data;
    }

    default:
      throw new Error(`unknown tool: ${name}`);
  }
}
