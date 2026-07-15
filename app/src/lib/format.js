// Shared currency formatter. Picks the readable magnitude tier instead of always
// dividing by 1e6 (which printed portfolio totals as "$92171.5M").
//   $92.2B · $421M · $87K · $950 · −$11.3M
export const fmtMoney = (n, { dash = "—" } = {}) => {
  if (n == null || Number.isNaN(Number(n))) return dash;
  const v = Number(n);
  const sign = v < 0 ? "−" : "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${sign}$${trim((a / 1e9).toFixed(1))}B`;
  if (a >= 1e6) return `${sign}$${trim((a / 1e6).toFixed(1))}M`;
  if (a >= 1e3) return `${sign}$${Math.round(a / 1e3)}K`;
  return `${sign}$${Math.round(a)}`;
};

// "92.0" → "92" but "92.2" stays
const trim = (s) => s.replace(/\.0$/, "");
