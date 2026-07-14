#!/usr/bin/env node
// Agent regression eval. Hits the LIVE agent-ask function with golden questions
// and checks the answer contains the expected grounded facts (and the right tool
// / focus hint where specified). Run:  node evals/run.mjs
//
// Env: CLAYOS_SUPABASE_URL + CLAYOS_SUPABASE_ANON_KEY (or source ~/.config/clayos.env).
import { readFileSync } from "node:fs";

const BASE = process.env.CLAYOS_SUPABASE_URL; // (not `URL` — that shadows the global URL constructor used below)
const KEY = process.env.CLAYOS_SUPABASE_ANON_KEY;
if (!BASE || !KEY) { console.error("Set CLAYOS_SUPABASE_URL + CLAYOS_SUPABASE_ANON_KEY"); process.exit(2); }

const cases = readFileSync(new URL("./agent.jsonl", import.meta.url), "utf8")
  .trim().split("\n").map((l) => JSON.parse(l));

let pass = 0, fail = 0;
for (const c of cases) {
  let ok = true, notes = [];
  try {
    const r = await fetch(`${BASE}/functions/v1/agent-ask`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ question: c.q }),
    }).then((x) => x.json());
    const answer = (r.answer || r.error || "");
    for (const e of c.expect || []) if (!answer.toLowerCase().includes(String(e).toLowerCase())) { ok = false; notes.push(`missing "${e}"`); }
    if (c.tool && !(r.tool_calls || []).some((t) => t.name === c.tool)) { ok = false; notes.push(`expected tool ${c.tool}`); }
    // focus may be a single code or an array of acceptable codes (e.g. "over budget"
    // has 20+ legitimate answers at 200 projects — any top offender is correct)
    if (c.focus && ![].concat(c.focus).includes(r.focus?.project_code)) { ok = false; notes.push(`focus ${r.focus?.project_code} not in ${[].concat(c.focus).join("/")}`); }
  } catch (e) { ok = false; notes.push("error: " + e.message); }
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.q.slice(0, 60)}${ok ? "" : "  — " + notes.join("; ")}`);
  ok ? pass++ : fail++;
}
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
