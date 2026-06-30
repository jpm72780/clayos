import { useState } from "react";
import { colorFor } from "../lib/palette.js";

// First-run "what am I looking at?" overlay for the 3D ontology. The vascular metaphor
// is beautiful but non-obvious; this explains the encodings once (persisted), and a small
// "?" button reopens it anytime. Mirrors the left-rail "Reading it" copy.
const KEY = "clayos.introSeen.v1";

export default function OntologyIntro() {
  const [open, setOpen] = useState(() => { try { return !localStorage.getItem(KEY); } catch { return true; } });
  const close = () => { setOpen(false); try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } };

  return (
    <>
      <button onClick={() => setOpen(true)} aria-label="What am I looking at?" title="What am I looking at?"
        className="absolute top-3 right-3 z-20 w-6 h-6 rounded-full bg-black/40 text-white/60 hover:text-white text-xs grid place-items-center">?</button>
      {open && (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/55 backdrop-blur-[1px] p-4" onClick={close}>
          <div className="max-w-md bg-[#0d1218]/95 border border-white/10 rounded-2xl p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="text-amber-300/90 font-semibold text-base mb-1">What am I looking at?</div>
            <div className="text-sm text-white/70 mb-3">Clayco's whole data environment, drawn as interwoven “vascular systems” — one glance reads as a portfolio.</div>
            <ul className="space-y-2 text-[13px] text-white/80">
              <li className="flex gap-2.5"><Glyph c={colorFor("Project")} ring />
                <span>Each glowing <b>globe</b> is a <b>project</b> (tinted by business unit), placed left→right along its lifecycle. It <b>pulses brighter</b> the more it has moved lately.</span></li>
              <li className="flex gap-2.5"><Glyph c="#22d3ee" />
                <span>Each travelling <b>pulse</b> is a real <b>data point that moved</b> in the time window — colour = what kind, faster = more recent.</span></li>
              <li className="flex gap-2.5"><span className="mt-1 w-3 h-[3px] rounded bg-white/50 shrink-0" />
                <span>Thicker <b>vessels</b> carry more <b>$</b> (contracts, pay-apps, cost accounts).</span></li>
              <li className="flex gap-2.5"><Glyph c={colorFor("RFI")} />
                <span><b>Click a project</b> → the KPI strip and the Ask agent rescope to it. Use <b>Highlight by</b> (left rail) to light up a CSI code, vendor, or person across every project at once.</span></li>
            </ul>
            <div className="mt-3 text-[11px] text-white/40">Orbit: left/middle drag · Pan: right drag · Zoom: scroll</div>
            <div className="mt-4 flex justify-end">
              <button onClick={close} className="px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-300 text-sm hover:bg-amber-500/30">Got it</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Glyph({ c, ring }) {
  return <span className="mt-0.5 w-3 h-3 rounded-full shrink-0" style={{ background: c, boxShadow: ring ? `0 0 6px ${c}` : "none" }} />;
}
