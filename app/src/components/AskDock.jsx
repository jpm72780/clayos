import { useEffect, useRef, useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askStream } from "../lib/api.js";

// Compact dark-themed markdown for the chat dock — the agent answers in markdown
// (headings, **bold**, lists, short tables), so render it instead of showing raw ## / **.
const MD = {
  p: (p) => <p className="mb-1.5 last:mb-0" {...p} />,
  strong: (p) => <strong className="text-white font-semibold" {...p} />,
  em: (p) => <em className="text-white/90" {...p} />,
  ul: (p) => <ul className="list-disc ml-4 mb-1.5 space-y-0.5" {...p} />,
  ol: (p) => <ol className="list-decimal ml-4 mb-1.5 space-y-0.5" {...p} />,
  h1: (p) => <div className="font-semibold text-white/90 mt-2 mb-1" {...p} />,
  h2: (p) => <div className="font-semibold text-white/90 mt-2 mb-1" {...p} />,
  h3: (p) => <div className="font-semibold text-white/85 mt-1.5 mb-0.5" {...p} />,
  a: (p) => <a className="text-amber-300 underline" target="_blank" rel="noreferrer" {...p} />,
  code: (p) => <code className="bg-white/10 rounded px-1 py-0.5 text-[11px]" {...p} />,
  pre: (p) => <pre className="bg-black/40 rounded p-2 overflow-x-auto text-[11px] mb-1.5" {...p} />,
  table: (p) => <div className="overflow-x-auto mb-1.5"><table className="w-full text-[11px] border-collapse" {...p} /></div>,
  th: (p) => <th className="text-left font-semibold border-b border-white/15 px-1.5 py-1" {...p} />,
  td: (p) => <td className="border-b border-white/5 px-1.5 py-1 align-top" {...p} />,
  blockquote: (p) => <blockquote className="border-l-2 border-white/20 pl-2 text-white/70 mb-1.5" {...p} />,
};
const Md = ({ text }) => <Markdown remarkPlugins={[remarkGfm]} components={MD}>{text}</Markdown>;

const DEFAULT_SIZE = { w: 320, h: 360 };
const LARGE_SIZE = { w: 560, h: 680 };
const loadSize = () => { try { return JSON.parse(localStorage.getItem("clayos.ask.size")) || DEFAULT_SIZE; } catch { return DEFAULT_SIZE; } };

// Small, constant "ask a question" widget in the bottom-right corner of every page.
// Streams the answer (tool progress + tokens), renders markdown, and if it points at
// a single project, focuses + jumps to the ontology. Resizable (drag the top-left grip)
// and expandable; size persists in localStorage.
export default function AskDock({ projects, focus, setFocus, setHl, goToOntology, seed, onSeedConsumed }) {
  const [open, setOpen] = useState(false);
  // fully-minimized pill — the dock floats over tables/charts, so it must be dismissible
  const [min, setMin] = useState(() => { try { return localStorage.getItem("clayos.ask.min") === "1"; } catch { return false; } });
  const [msgs, setMsgs] = useState([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState(null); // { text, tool } while a stream is in flight
  const [size, setSize] = useState(loadSize);
  const sizeRef = useRef(size); sizeRef.current = size;
  const scrollRef = useRef(null);

  // keep the transcript pinned to the latest as tokens stream / messages append
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; }, [msgs, live, open]);

  const setMinPersisted = (v) => { setMin(v); try { localStorage.setItem("clayos.ask.min", v ? "1" : "0"); } catch { /* ignore */ } };
  const hide = () => { setMinPersisted(true); setOpen(false); };

  // "Ask Clayco about this" from a chart pushes a question in here → open + send it.
  const seedRef = useRef(null);
  useEffect(() => {
    if (seed && seed !== seedRef.current && !busy) { seedRef.current = seed; setMinPersisted(false); setOpen(true); send(seed); onSeedConsumed?.(); }
  }, [seed]); // eslint-disable-line react-hooks/exhaustive-deps

  // drag the top-left grip to resize (dock is anchored bottom-right, so dragging
  // left/up grows it); persist the final size.
  const startResize = (e) => {
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY, sw = size.w, sh = size.h;
    const move = (ev) => setSize({
      w: Math.min(Math.max(280, sw - (ev.clientX - sx)), window.innerWidth - 40),
      h: Math.min(Math.max(200, sh - (ev.clientY - sy)), window.innerHeight - 90),
    });
    const up = () => {
      window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up);
      try { localStorage.setItem("clayos.ask.size", JSON.stringify(sizeRef.current)); } catch { /* ignore */ }
    };
    window.addEventListener("pointermove", move); window.addEventListener("pointerup", up);
  };
  const toggleExpand = () => {
    const big = size.w >= LARGE_SIZE.w - 1;
    const next = big ? DEFAULT_SIZE : { w: Math.min(LARGE_SIZE.w, window.innerWidth - 40), h: Math.min(LARGE_SIZE.h, window.innerHeight - 90) };
    setSize(next); try { localStorage.setItem("clayos.ask.size", JSON.stringify(next)); } catch { /* ignore */ }
  };

  // If the answer points at a single subject, drive the shared view (focus / highlight).
  function driveView(d, question, answer) {
    let drove = false;
    if (d?.focus?.project_code) {
      const p = (projects || []).find((x) => x.code === d.focus.project_code);
      if (p) { setFocus({ pid: p.id, name: p.name, code: p.code }); goToOntology?.(); drove = true; }
    }
    if (d?.highlight?.dim === "masterformat" && setHl) {
      const v = d.highlight.value;
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
  }

  async function send(qOverride) {
    const question = (typeof qOverride === "string" ? qOverride : input).trim(); if (!question || busy) return;
    setInput(""); setOpen(true);
    const ctx = focus ? `Regarding the ${focus.name} project: ${question}` : question;
    setMsgs((m) => [...m, { role: "user", text: question }]);
    setBusy(true); setLive({ text: "", tool: "thinking…" });
    let acc = "";
    await askStream(ctx, [], {
      onTool: (t) => setLive((l) => ({ text: (l && l.text) || "", tool: t.label })),
      onToken: (text) => { acc += text; setLive({ text: acc, tool: null }); },
      onDone: (d) => {
        setMsgs((m) => [...m, { role: "assistant", text: acc.trim() || "(no answer)" }]);
        setLive(null); setBusy(false);
        driveView(d, question, acc);
      },
      onError: (err) => {
        setMsgs((m) => [...m, { role: "assistant", text: "⚠ " + err }]);
        setLive(null); setBusy(false);
      },
    });
  }

  if (min) {
    return (
      <button onClick={() => setMinPersisted(false)} aria-label="Open Ask Clayco chat" title="Ask Clayco"
        className="fixed right-3 bottom-3 z-50 w-10 h-10 max-md:w-12 max-md:h-12 grid place-items-center rounded-full bg-[#0d1218]/95 border border-white/15 text-amber-300 shadow-lg hover:bg-white/10">✦</button>
    );
  }

  return (
    <div className="fixed right-3 bottom-3 z-50 max-w-[calc(100vw-1.5rem)]" style={{ width: open ? size.w : 320 }}>
      {open && (
        <div className="mb-2 bg-[#0d1218]/95 border border-white/10 rounded-xl shadow-xl flex flex-col overflow-hidden" style={{ height: size.h }}>
          <div className="flex items-center gap-2 px-3 pt-3 pb-2 shrink-0">
            {/* drag-to-resize grip (dock is anchored bottom-right, so drag up/left to grow) */}
            <span onPointerDown={startResize} title="Drag to resize" aria-label="Resize chat"
              className="cursor-nwse-resize text-white/30 hover:text-white/60 select-none text-xs leading-none -ml-0.5">⤡</span>
            <h2 className="text-xs text-white/50 mr-auto font-normal">Ask Clayco {focus ? `· ${focus.code || focus.name}` : ""}</h2>
            <div className="flex items-center gap-2">
              <button onClick={toggleExpand} aria-label="Expand or shrink chat" title="Expand / shrink" className="text-white/30 hover:text-white/70 text-xs">{size.w >= LARGE_SIZE.w - 1 ? "🗗" : "⤢"}</button>
              <button onClick={() => setOpen(false)} aria-label="Collapse chat" title="Collapse" className="text-white/30 hover:text-white/70 text-xs">▾</button>
            </div>
          </div>
          <div ref={scrollRef} className="flex-1 overflow-auto px-3 pb-3">
            {msgs.length === 0 && !live && <div className="text-[11px] text-white/40 mb-1">Ask about projects, costs, schedule, RFIs, safety, people… The view follows the answer.</div>}
            <div className="space-y-2">
              {msgs.map((m, i) => (
                <div key={i} className={`text-[12px] rounded-lg px-2 py-1.5 ${m.role === "user" ? "bg-amber-500/15 text-amber-100" : "bg-white/5 text-white/85 leading-relaxed"}`}>
                  {m.role === "user" ? m.text : <Md text={m.text} />}
                </div>
              ))}
              {live && (
                <div className="text-[12px] rounded-lg px-2 py-1.5 bg-white/5 text-white/85 leading-relaxed">
                  {live.text
                    ? <><Md text={live.text} /><span className="inline-block w-1.5 h-3 ml-0.5 align-middle bg-amber-300/70 animate-pulse" /></>
                    : <span className="flex items-center gap-2 text-white/45"><span className="flex gap-0.5"><Dot /><Dot d="150ms" /><Dot d="300ms" /></span>{live.tool}</span>}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="flex gap-1">
        <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} onFocus={() => setOpen(true)}
          aria-label="Ask Clayco a question"
          placeholder={focus ? `Ask about ${focus.code || focus.name}…` : "Ask a question about Clayco…"}
          className="flex-1 bg-[#0d1218]/95 border border-white/10 rounded-lg px-3 py-2 max-md:py-3 text-xs outline-none focus:border-amber-500/40 shadow-lg" />
        <button onClick={send} disabled={busy} aria-label="Send" className="px-3 py-2 max-md:px-4 max-md:py-3 rounded-lg bg-amber-500/20 text-amber-300 text-xs hover:bg-amber-500/30 disabled:opacity-40 shadow-lg">→</button>
        <button onClick={hide} aria-label="Hide chat" title="Hide chat — it becomes a ✦ button"
          className="px-2 py-2 max-md:px-3 max-md:py-3 rounded-lg bg-[#0d1218]/95 border border-white/10 text-white/40 text-xs hover:text-white/80 shadow-lg">–</button>
      </div>
    </div>
  );
}

function Dot({ d = "0ms" }) {
  return <span className="w-1 h-1 rounded-full bg-white/40 animate-bounce" style={{ animationDelay: d }} />;
}
