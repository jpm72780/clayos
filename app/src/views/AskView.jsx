import { useState, useRef, useEffect } from "react";
import { ask } from "../lib/api.js";

const SUGGESTIONS = [
  "Which Clayco Compute projects are over budget, and why?",
  "What's the portfolio's total contract value by business unit?",
  "Which project has the worst safety record and what happened?",
  "Show me the open RFIs on the Aurora data center.",
  "Is Cedar Rapids over or under billed?",
];

export default function AskView() {
  const [msgs, setMsgs] = useState([]); // {role, text, tools?}
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, busy]);

  async function send(q) {
    const question = (q ?? input).trim();
    if (!question || busy) return;
    setInput("");
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true);
    try {
      const r = await ask(question);
      setMsgs((m) => [...m, { role: "assistant", text: r.answer || r.error || "(no answer)", tools: r.tool_calls }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: "Error: " + e.message }]);
    } finally { setBusy(false); }
  }

  return (
    <div className="h-full flex flex-col max-w-4xl mx-auto w-full">
      <div className="flex-1 overflow-auto p-5 space-y-4">
        {msgs.length === 0 && (
          <div className="text-white/60">
            <div className="text-lg font-medium text-white/80 mb-1">Ask ClayOS</div>
            <p className="text-sm mb-4">Natural-language questions over all of Clayco's data. The agent calls read-only graph + KPI tools and cites what it used.</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button key={s} onClick={() => send(s)} className="text-sm px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/5 text-white/70">{s}</button>
              ))}
            </div>
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className={m.role === "user" ? "text-right" : ""}>
            <div className={`inline-block text-left rounded-xl px-4 py-3 max-w-full ${
              m.role === "user" ? "bg-amber-500/15 text-amber-100" : "bg-white/5 text-white/90"
            }`}>
              {m.role === "assistant" && m.tools && (
                <div className="text-[10px] text-white/30 mb-2">
                  tools: {m.tools.map((t) => t.name).join(" · ")}
                </div>
              )}
              <div className="text-sm whitespace-pre-wrap leading-relaxed">{m.text}</div>
            </div>
          </div>
        ))}
        {busy && <div className="text-white/40 text-sm">ClayOS is analyzing…</div>}
        <div ref={endRef} />
      </div>
      <div className="border-t border-white/10 p-3 flex gap-2">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Ask about projects, costs, schedule, RFIs, safety, people…"
          className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm outline-none focus:border-amber-500/40" />
        <button onClick={() => send()} disabled={busy}
          className="px-4 py-2 rounded-lg bg-amber-500/20 text-amber-300 text-sm hover:bg-amber-500/30 disabled:opacity-40">Send</button>
      </div>
    </div>
  );
}
