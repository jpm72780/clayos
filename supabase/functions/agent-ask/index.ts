// Edge Function: agent-ask
// ClayOS agentic Q&A. Forked from counterpart's agent-step-claude 32-turn tool
// loop, simplified to: read-only kg_* tools, a grounding world-state snapshot,
// and a single user question. Returns a grounded, cited answer.
//
// Model: claude-opus-4-8 (no temperature / no thinking — both rejected on 4.8).
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/db.ts";
import { KG_TOOLS, KG_TOOL_NAMES, executeKgTool } from "../_shared/kg_tools.ts";

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-4-8";
const MAX_TOOL_TURNS = 24;

// deno-lint-ignore-file no-explicit-any
type Msg = { role: "user" | "assistant"; content: any };

async function worldState(admin: any): Promise<string> {
  const { data: rollup } = await admin.from("kg_bu_rollup")
    .select("business_unit_name,projects,active_projects,total_contract_value,spi,cpi,trir,open_rfis")
    .order("total_contract_value", { ascending: false });
  const { data: atRisk } = await admin.from("kpi_evm")
    .select("project_name,spi,cpi,pct_complete").lt("cpi", 1).order("cpi").limit(5);
  return [
    "PORTFOLIO ROLLUP (by business unit, incl. descendants):",
    JSON.stringify(rollup),
    "PROJECTS WITH CPI < 1 (over budget):",
    JSON.stringify(atRisk),
  ].join("\n");
}

function systemPrompt(ws: string): string {
  return [
    "You are Clayco's data agent — the operating-system assistant for Clayco, a large design-build construction firm.",
    "You answer questions about the company's data — projects, costs, schedule, RFIs, safety, people, pursuits — by calling the read-only kg_* tools. You never invent numbers.",
    "",
    "RULES:",
    "- For ANY numeric/metric question (budget, SPI/CPI, billing, TRIR, RFI counts), call kg_kpi. Do not compute or estimate numbers yourself.",
    "- For ad-hoc aggregates the curated tools don't cover, use kg_query (read-only SELECT; call kg_schema first for table/column names).",
    "- To find things by meaning, use kg_search; to explore relationships, kg_get_entity then kg_traverse.",
    "- Ground every claim in tool results. Cite the entities/records you used by name (and id where useful).",
    "- Be concise and lead with the answer. Use short tables where helpful.",
    "- If you cannot find something, say so plainly rather than guessing.",
    "- VIEW CONTROL: if your answer is primarily about ONE project, end with a marker on its own line: @@VIEW project=<CODE>@@ (e.g. @@VIEW project=DC-001@@) so the UI can fly the 3D ontology to it. If it's primarily about one MasterFormat division, add @@VIEW masterformat=<code>@@ (e.g. @@VIEW masterformat=03 00 00@@). Only emit when a single subject clearly dominates; never explain the marker.",
    "",
    "CURRENT WORLD STATE (already fetched for you — use it to orient, but still call tools for specifics):",
    ws,
  ].join("\n");
}

async function callClaude(apiKey: string, system: string, messages: Msg[]): Promise<any> {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages, tools: KG_TOOLS }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`anthropic_error ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!apiKey) throw new Error("CLAUDE_API_KEY not set");
    const { question, history } = await req.json();
    if (!question) throw new Error("missing 'question'");

    const admin = adminClient();
    const ws = await worldState(admin);
    const system = systemPrompt(ws);

    const messages: Msg[] = [...(history || []), { role: "user", content: question }];
    const toolCalls: Array<{ name: string; ok: boolean }> = [];
    let finalText = "";

    for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
      const resp = await callClaude(apiKey, system, messages);
      const blocks = resp.content || [];
      const toolUses = blocks.filter((b: any) => b.type === "tool_use");
      if (toolUses.length === 0) {
        finalText = blocks.filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
        break;
      }
      messages.push({ role: "assistant", content: blocks });
      const results: any[] = [];
      for (const tu of toolUses) {
        let content: unknown, isError = false;
        try {
          if (!KG_TOOL_NAMES.has(tu.name)) throw new Error(`unknown tool ${tu.name}`);
          content = await executeKgTool(tu.name, { admin }, tu.input || {});
          toolCalls.push({ name: tu.name, ok: true });
        } catch (err) {
          content = { error: err instanceof Error ? err.message : String(err) };
          isError = true;
          toolCalls.push({ name: tu.name, ok: false });
        }
        results.push({
          type: "tool_result", tool_use_id: tu.id,
          content: typeof content === "string" ? content : JSON.stringify(content),
          ...(isError ? { is_error: true } : {}),
        });
      }
      messages.push({ role: "user", content: results });
    }

    if (!finalText) finalText = "I wasn't able to complete the analysis within the tool-call limit.";

    // structured view-control hints (parsed from the @@VIEW ...@@ markers, then stripped)
    let focus: { project_code: string } | null = null;
    let highlight: { dim: string; value: string } | null = null;
    const fm = finalText.match(/@@VIEW\s+project=([A-Za-z0-9-]+)\s*@@/i);
    if (fm) focus = { project_code: fm[1] };
    const hm = finalText.match(/@@VIEW\s+masterformat=([0-9 ]+?)\s*@@/i);
    if (hm) highlight = { dim: "masterformat", value: hm[1].trim() };
    finalText = finalText.replace(/@@VIEW[^@]*@@/gi, "").trim();

    return new Response(JSON.stringify({ answer: finalText, tool_calls: toolCalls, focus, highlight }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
