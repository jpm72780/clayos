// Edge Function: agent-ask
// ClayOS agentic Q&A. Forked from counterpart's agent-step-claude 32-turn tool
// loop, simplified to: read-only kg_* tools, a grounding world-state snapshot,
// and a single user question. Returns a grounded, cited answer.
//
// Two response modes:
//   - JSON (default): blocking; { answer, tool_calls, focus, highlight }. Used by evals.
//   - SSE (when the client sends `Accept: text/event-stream`): streams `tool`
//     progress events as each kg_* tool runs, `token` events as the answer is
//     generated, then a final `done` event with { focus, highlight, tool_calls }.
//
// Model: claude-opus-4-8 (no temperature / no thinking — both rejected on 4.8).
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/db.ts";
import { KG_TOOLS, KG_TOOL_NAMES, executeKgTool } from "../_shared/kg_tools.ts";

const ANTHROPIC_VERSION = "2023-06-01";
const MODEL = "claude-opus-4-8";
const MAX_TOOL_TURNS = 24;
const MESSAGES_URL = "https://api.anthropic.com/v1/messages";

// deno-lint-ignore-file no-explicit-any
type Msg = { role: "user" | "assistant"; content: any };

// Friendly progress labels so the chat can say what the agent is doing
// ("exploring relationships…", "pulling KPIs for DC-001") instead of a spinner.
const TOOL_LABEL: Record<string, string> = {
  kg_kpi: "pulling KPIs",
  kg_query: "running a query",
  kg_search: "searching records",
  kg_traverse: "exploring relationships",
  kg_get_entity: "fetching record details",
  kg_classification: "looking up CSI codes",
  kg_schema: "reading the schema",
};
function toolLabel(name: string, input: any): string {
  let base = TOOL_LABEL[name] || name;
  if (name === "kg_kpi" && (input?.project || input?.business_unit)) base += ` for ${input.project || input.business_unit}`;
  else if ((name === "kg_search" || name === "kg_classification") && input?.query) base += `: “${String(input.query).slice(0, 40)}”`;
  return base;
}

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

// ── view-control markers (parsed from the @@VIEW ...@@ markers, then stripped) ──
function parseMarkers(markerText: string): { focus: any; highlight: any } {
  let focus: { project_code: string } | null = null;
  let highlight: { dim: string; value: string } | null = null;
  const fm = markerText.match(/@@VIEW\s+project=([^@]+?)\s*@@/i);
  if (fm) focus = { project_code: fm[1].trim() };
  const hm = markerText.match(/@@VIEW\s+masterformat=([0-9 ]+?)\s*@@/i);
  if (hm) highlight = { dim: "masterformat", value: hm[1].trim() };
  return { focus, highlight };
}

// ── non-streaming Claude call (JSON mode) ──
async function callClaude(apiKey: string, system: string, messages: Msg[]): Promise<any> {
  const r = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages, tools: KG_TOOLS }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`anthropic_error ${r.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
}

// Run one tool turn's tool_use blocks; returns the tool_result content array.
async function runTools(admin: any, toolUses: any[], toolCalls: Array<{ name: string; ok: boolean }>): Promise<any[]> {
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
  return results;
}

// The model sometimes emits the project NAME in the @@VIEW@@ marker instead of its
// code ("Aurora" vs "DC-001"); the eval harness and deep-links expect the code, so
// resolve it server-side. Unknown/ambiguous values pass through unchanged (the client
// keeps its fallback name-matcher).
async function normalizeFocus(admin: any, focus: { project_code: string } | null) {
  if (!focus?.project_code) return focus;
  const v = focus.project_code.trim();
  const { data: byCode } = await admin.from("projects").select("code").ilike("code", v).limit(1);
  if (byCode?.length) return { project_code: byCode[0].code };
  const { data: byName } = await admin.from("projects").select("code").ilike("name", `%${v}%`).limit(2);
  if (byName?.length === 1) return { project_code: byName[0].code };
  return focus;
}

// ── JSON mode: the original blocking loop (unchanged contract; used by evals) ──
async function runJson(apiKey: string, admin: any, system: string, messages: Msg[]): Promise<Response> {
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
    messages.push({ role: "user", content: await runTools(admin, toolUses, toolCalls) });
  }
  if (!finalText) finalText = "I wasn't able to complete the analysis within the tool-call limit.";
  const { focus: rawFocus, highlight } = parseMarkers(finalText);
  const focus = await normalizeFocus(admin, rawFocus);
  finalText = finalText.replace(/@@VIEW[^@]*@@/gi, "").trim();
  return new Response(JSON.stringify({ answer: finalText, tool_calls: toolCalls, focus, highlight }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── streaming Claude call: parses Anthropic SSE, assembles content blocks,
// fires onText per text delta and onToolStop once a tool_use block's input is complete. ──
async function streamClaude(
  apiKey: string, system: string, messages: Msg[],
  onText: (t: string) => void, onToolStop: (b: any) => void,
): Promise<any[]> {
  const r = await fetch(MESSAGES_URL, {
    method: "POST",
    headers: { "x-api-key": apiKey, "anthropic-version": ANTHROPIC_VERSION, "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: 4096, system, messages, tools: KG_TOOLS, stream: true }),
  });
  if (!r.ok || !r.body) {
    const text = await r.text().catch(() => "");
    throw new Error(`anthropic_error ${r.status}: ${text.slice(0, 400)}`);
  }
  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const blocks: any[] = [];
  const partial: Record<number, string> = {}; // index -> accumulating tool input JSON
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      let ev: any;
      try { ev = JSON.parse(payload); } catch { continue; }
      if (ev.type === "content_block_start") {
        const cb = ev.content_block || {};
        blocks[ev.index] = cb.type === "tool_use"
          ? { type: "tool_use", id: cb.id, name: cb.name, input: {} }
          : { type: "text", text: "" };
        partial[ev.index] = "";
      } else if (ev.type === "content_block_delta") {
        const d = ev.delta || {};
        if (d.type === "text_delta" && blocks[ev.index]) { blocks[ev.index].text += d.text; onText(d.text); }
        else if (d.type === "input_json_delta") { partial[ev.index] += d.partial_json || ""; }
      } else if (ev.type === "content_block_stop") {
        const b = blocks[ev.index];
        if (b && b.type === "tool_use") {
          try { b.input = partial[ev.index] ? JSON.parse(partial[ev.index]) : {}; } catch { b.input = {}; }
          onToolStop(b);
        }
      } else if (ev.type === "error") {
        throw new Error(`anthropic_stream_error: ${JSON.stringify(ev.error).slice(0, 300)}`);
      }
    }
  }
  return blocks.filter(Boolean);
}

// ── SSE mode: stream tool-progress + answer tokens, then a `done` summary. ──
function runStream(apiKey: string, admin: any, system: string, initialMessages: Msg[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: string, data: unknown) =>
        controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));

      // Hold back any "@@…" tail so a @@VIEW@@ marker never streams to the user;
      // captured markers are parsed for focus/highlight at the end.
      let tail = "", markerText = "";
      const feed = (chunk: string) => {
        tail += chunk;
        for (;;) {
          const at = tail.indexOf("@@");
          if (at === -1) { if (tail) { send("token", { text: tail }); tail = ""; } break; }
          if (at > 0) { send("token", { text: tail.slice(0, at) }); tail = tail.slice(at); }
          const close = tail.indexOf("@@", 2);
          if (close === -1) break; // incomplete marker — keep holding the @@-tail
          markerText += tail.slice(0, close + 2);
          tail = tail.slice(close + 2);
        }
      };

      try {
        const messages: Msg[] = [...initialMessages];
        const toolCalls: Array<{ name: string; ok: boolean }> = [];
        for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
          const blocks = await streamClaude(
            apiKey, system, messages,
            (t) => feed(t),
            (b) => send("tool", { name: b.name, label: toolLabel(b.name, b.input) }),
          );
          const toolUses = blocks.filter((b: any) => b.type === "tool_use");
          if (toolUses.length === 0) break; // final answer streamed
          messages.push({ role: "assistant", content: blocks });
          messages.push({ role: "user", content: await runTools(admin, toolUses, toolCalls) });
        }
        if (tail) { if (tail.startsWith("@@")) markerText += tail; else send("token", { text: tail }); tail = ""; }
        const { focus: rawFocus, highlight } = parseMarkers(markerText);
        const focus = await normalizeFocus(admin, rawFocus);
        send("done", { focus, highlight, tool_calls: toolCalls });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: { ...corsHeaders, "Content-Type": "text/event-stream", "Cache-Control": "no-cache" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const apiKey = Deno.env.get("CLAUDE_API_KEY") || Deno.env.get("ANTHROPIC_API_KEY") || "";
    if (!apiKey) throw new Error("CLAUDE_API_KEY not set");
    const { question, history } = await req.json();
    if (!question) throw new Error("missing 'question'");

    const admin = adminClient();
    const system = systemPrompt(await worldState(admin));
    const messages: Msg[] = [...(history || []), { role: "user", content: question }];

    const wantsStream = (req.headers.get("accept") || "").includes("text/event-stream");
    return wantsStream
      ? runStream(apiKey, admin, system, messages)
      : await runJson(apiKey, admin, system, messages);
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
