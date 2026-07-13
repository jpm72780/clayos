// Plain-language definitions for the construction / finance acronyms the dashboards
// use. Executives and field staff don't share a vocabulary, so a hover definition
// removes that friction. `defOf(label)` matches a metric label — exact, or by the
// acronym it contains — to a definition, so any KPI label can be wrapped without
// hard-coding the mapping at every call site.
export const GLOSSARY = {
  CPI: "Cost Performance Index — earned value ÷ actual cost. 1.0 = on budget; below 1.0 means you're spending faster than you're earning (over budget).",
  SPI: "Schedule Performance Index — earned value ÷ planned value. 1.0 = on schedule; below 1.0 = behind plan.",
  EAC: "Estimate at Completion — the forecast total cost of the work. EAC above BAC signals a projected overrun.",
  BAC: "Budget at Completion — the baseline total budget (the original contract value).",
  TRIR: "Total Recordable Incident Rate — recordable safety incidents per 200,000 hours worked. Lower is safer; ~3.0 is a common industry benchmark.",
  WIP: "Work in Progress — billed-to-date vs. earned-to-date. Positive = overbilled (billed ahead of the work); negative = underbilled.",
  RFI: "Request for Information — a formal question from the field to the design team. Open RFIs can hold up work.",
  Backlog: "Contracted work not yet earned — remaining revenue under signed contracts.",
  Pipeline: "Weighted value of open pursuits — potential value × win probability.",
  "Win rate": "Share of decided pursuits that were won. Needs closed (won / lost) decision history to compute.",
  Utilization: "Share of available workforce hours that are billable / assigned.",
  Submittal: "Contractor-supplied product data or samples submitted to the design team for approval.",
  Pursuit: "A potential project being chased in business development — a bid or opportunity.",
  Estimate: "A priced cost estimate for a pursuit or a defined scope of work.",
};

// Order matters: match the most specific alias first. Each entry is [canonicalKey, ...aliases].
const ALIASES = [
  ["TRIR"], ["CPI"], ["SPI"], ["EAC"], ["BAC"], ["WIP"],
  ["RFI", "RFIs"], ["Backlog"], ["Pipeline"], ["Win rate"],
  ["Utilization", "util"], ["Submittal"], ["Pursuit"], ["Estimate"],
];

export function defOf(label) {
  if (!label) return null;
  if (GLOSSARY[label]) return GLOSSARY[label];
  const L = String(label);
  for (const [key, ...alts] of ALIASES) {
    const re = new RegExp(`\\b(${[key, ...alts].join("|")})\\b`, "i");
    if (re.test(L)) return GLOSSARY[key];
  }
  return null;
}
