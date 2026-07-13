// Lightweight shimmer placeholders shown while a view's data loads, so the UI reads
// as "working" rather than a bare "loading…". Pure CSS; the keyframes ship once via
// <ShimmerStyle/> (rendered at the app root).
export function SkeletonLine({ w = "100%", h = 12, className = "" }) {
  return <span className={`block rounded bg-white/5 cl-shimmer ${className}`} style={{ width: w, height: h }} aria-hidden="true" />;
}

export function SkeletonCard({ className = "" }) {
  return (
    <div className={`bg-[#0d1218] border border-white/10 rounded-xl p-4 ${className}`} aria-hidden="true">
      <SkeletonLine w="45%" h={10} />
      <div className="mt-3"><SkeletonLine w="65%" h={22} /></div>
      <div className="mt-2"><SkeletonLine w="85%" h={8} /></div>
    </div>
  );
}

export function SkeletonStats({ n = 8 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-2" aria-hidden="true">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="bg-[#0d1218] border border-white/10 rounded-lg px-3 py-2">
          <SkeletonLine w="70%" h={8} /><div className="mt-2"><SkeletonLine w="50%" h={16} /></div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 14 }) {
  const widths = ["14%", "30%", "12%", "10%", "14%", "8%", "8%"];
  return (
    <div className="p-4 space-y-2.5" role="status" aria-label="Loading data">
      <span className="sr-only">Loading data…</span>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 items-center">
          {widths.map((w, j) => <SkeletonLine key={j} w={w} h={10} />)}
        </div>
      ))}
    </div>
  );
}

export const ShimmerStyle = () => (
  <style>{`.cl-shimmer{position:relative;overflow:hidden}.cl-shimmer::after{content:"";position:absolute;inset:0;transform:translateX(-100%);background:linear-gradient(90deg,transparent,rgba(255,255,255,.07),transparent);animation:cl-sh 1.3s infinite}@keyframes cl-sh{100%{transform:translateX(100%)}}@media (prefers-reduced-motion: reduce){.cl-shimmer::after{animation:none}}`}</style>
);
