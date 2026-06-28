import { useState } from "react";
import { ask } from "../lib/api.js";

// Small, constant "ask a question" widget in the bottom-right corner of every page.
// If the answer points at a single project, it focuses + jumps to the ontology.
export default function AskDock({ projects, focus, setFocus, setHl, goToOntology }) {
  const [open, setOpen] = useState(false);
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function send() {
    const question = input.trim(); if (!question || busy) return;
    setInput(""); setOpen(true);
    const ctx = focus ? `Regarding the ${focus.name} project: ${question}` : question;
    setMsgs((m) => [...m, { role: "user", text: question }]); setBusy(true);
    try {
      const r = await ask(ctx); const answer = r.answer || r.error || "(no answer)";
      setMsgs((m) => [...m, { role: "assistant", text: answer }]);
      // prefer the agent's structured view hint; fall back to prose matching
      let drove = false;
      if (r.focus?.project_code) {
        const p = (projects || []).find((x) => x.code === r.focus.project_code);
        if (p) { setFocus({ pid: p.id, name: p.name, code: p.code }); goToOntology?.(); drove = true; }
      }
      if (r.highlight?.dim === "masterformat" && setHl) {
        const v = r.highlight.value;
        setHl({ dim: "masterformat", value: v, label: v, depth: /00 00$/.test(v.trim()) ? 0 : null });
        goToOntology?.(); drove = true;
      }
      if (!drove) {
        const text = (question + " " + answer).toLowerCase();
        const hits = (projects || []).filter((p) => {
          const kw = (p.name || "").split(" ")[0].toLowerCase();
          return (p.code && text.includes(p.code.toLowerCase())) || (kw.length > 3 && text.includes(kw));
        });
        if (hits.length === 1) { const p = hits[0]; setFocus({ pid: p.id, name: p.name, code: p.code }); goToOntology?.(); }
      }
    } catch (e) { setMsgs((m) => [...m, { role: "assistant", text: "Error: " + e.message }]); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed right-3 bottom-3 z-50 w-80 max-w-[calc(100vw-1.5rem)]">
      {open && (
        <div className="mb-2 bg-[#0d1218]/95 border border-white/10 rounded-xl p-3 max-h-72 overflow-auto shadow-xl">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-white/50">Ask Clayco {focus ? `· ${focus.code || focus.name}` : ""}</span>
            <button onClick={() => setOpen(false)} className="text-white/30 hover:text-white/70 text-xs">▾</button>
          </div>
          {msgs.length === 0 && <div className="text-[11px] text-white/40 mb-1">Ask about projects, costs, schedule, RFIs, safety, people… The view follows the answer.</div>}
          <div className="space-y-2">
            {msgs.map((m, i) => (
              <div key={i} className={`text-[12px] rounded-lg px-2 py-1.5 ${m.role === "user" ? "bg-amber-500/15 text-amber-100" : "bg-white/5 text-white/85 whitespace-pre-wrap leading-relaxed"}`}>{m.text}</div>
            ))}
            {busy && <div className="text-white/40 text-[11px]">analyzing…</div>}
          </div>
        </div>
      )}
      <div className="flex gap-1">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} onFocus={() => setOpen(true)}
          placeholder={focus ? `Ask about ${focus.code || focus.name}…` : "Ask a question about Clayco…"}
          className="flex-1 bg-[#0d1218]/95 border border-white/10 rounded-lg px-3 py-2 text-xs outline-none focus:border-amber-500/40 shadow-lg" />
        <button onClick={send} disabled={busy} className="px-3 py-2 rounded-lg bg-amber-500/20 text-amber-300 text-xs hover:bg-amber-500/30 disabled:opacity-40 shadow-lg">→</button>
      </div>
    </div>
  );
}
