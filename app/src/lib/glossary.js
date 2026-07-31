// Plain-language KPI guide for the dashboards. Executives, field staff, and
// visitors outside the AEC world don't share a vocabulary, so every metric
// explains itself in three parts: WHAT it measures, what a GOOD number looks
// like (and what it means), and what a BAD number looks like (and what it
// means). `guideOf(label)` fuzzy-matches any KPI label to its entry;
// `defOf(label)` flattens the same entry into text for native title= tooltips
// (the 3D KPI strip and other hover-only spots).
export const KPI_GUIDE = {
  CPI: {
    name: "CPI — Cost Performance Index",
    what: "For every dollar spent, how much planned work actually got done: the value of work completed divided by what it cost to do it.",
    good: "1.0 or above. Each dollar spent bought at least a dollar of planned work — the project is on or under budget.",
    bad: "Below 1.0. Money is going out faster than work is getting done — a CPI of 0.90 means only 90¢ of work for every $1 spent. Expect a cost overrun unless performance recovers.",
  },
  SPI: {
    name: "SPI — Schedule Performance Index",
    what: "The pace of progress against the plan: the value of work completed divided by the value that was scheduled to be complete by now.",
    good: "1.0 or above. Work is getting done as fast as — or faster than — planned: on or ahead of schedule.",
    bad: "Below 1.0. The job is moving slower than planned — an SPI of 0.85 means it's progressing at 85% of the planned pace, so the finish date will slip unless the pace improves.",
  },
  BAC: {
    name: "BAC — Budget at Completion",
    what: "The original approved budget for all the work — what the job was supposed to cost when it was planned.",
    good: "BAC is the yardstick rather than a score: a project is healthy when its forecast final cost (EAC) stays at or below this number.",
    bad: "When the forecast final cost (EAC) climbs above BAC, the project is expected to cost more than was budgeted — by that difference.",
  },
  EAC: {
    name: "EAC — Estimate at Completion",
    what: "Today's forecast of what the work will actually cost when it's finished, projected from performance so far.",
    good: "At or below the original budget (BAC) — the project is on track to finish within the money set aside for it.",
    bad: "Above BAC — a projected overrun. The gap between EAC and BAC is the extra money the project is expected to need; someone has to fund it or recover it.",
  },
  TRIR: {
    name: "TRIR — Total Recordable Incident Rate",
    what: "How often people get hurt: recordable injuries per 200,000 hours worked (about 100 people working a full year). The standard safety score in US industry.",
    good: "Low — roughly under 3.0, which is the common industry benchmark; well-run projects push it far lower. Fewer people getting hurt, lower insurance cost, easier to win work.",
    bad: "Above ~3.0. People are being injured more often than the industry norm — a human problem first, and also a flag that supervision, planning, or culture on that site needs attention.",
  },
  WIP: {
    name: "WIP — over / under billing",
    what: "Compares what has been billed to the client against the value of work actually completed so far (work in progress).",
    good: "Slightly overbilled (a small positive number). Billing runs a bit ahead of the work, so the client's money — not the contractor's — is funding the job. Healthy cash flow.",
    bad: "Underbilled (negative): work is done but hasn't been billed yet, so the contractor is financing the job from its own pocket — often a sign of billing lag or unapproved change orders. Heavily overbilled can also be a warning: it may mean early billings are quietly funding later work.",
  },
  RFI: {
    name: "RFI — Request for Information",
    what: "A formal question from the construction team to the designers when drawings are unclear or conflict. \"Open\" means it's still waiting for an answer.",
    good: "Few open RFIs and quick answers. Questions get resolved before they hold anything up.",
    bad: "Many open or long-lived RFIs. Crews may be waiting on answers to keep building — that means idle time, delays, and often extra-cost changes downstream.",
  },
  Backlog: {
    name: "Backlog",
    what: "Work that is under signed contract but not yet performed — future revenue the company has already won.",
    good: "A healthy backlog (commonly a year or two of revenue) means the order book is full and future workload is secured.",
    bad: "A shrinking backlog means work is being finished faster than new work is being won — future revenue is at risk. (An outsized backlog can strain staffing too.)",
  },
  Pipeline: {
    name: "Pipeline (weighted)",
    what: "The value of potential new work being pursued, discounted by each pursuit's chance of winning — a $100M pursuit at 30% counts as $30M.",
    good: "Comfortably larger than the revenue the company needs to replace as backlog burns off — enough realistic opportunities are being chased.",
    bad: "A thin pipeline means not enough pursuits to replace the work being completed — a revenue gap is coming even if today's numbers look fine.",
  },
  "Win rate": {
    name: "Win rate",
    what: "Of the pursuits that have been decided (won or lost), the share that were won.",
    good: "Winning a solid share — 25–50% is common in competitive construction bidding. The company is chasing the right work at the right price.",
    bad: "A low win rate means effort is going into bids that don't land — wrong opportunities, uncompetitive pricing, or both.",
  },
  "Over budget": {
    name: "Over budget (project count)",
    what: "How many projects in the current scope are running over budget right now (their CPI is below 1.0).",
    good: "Zero or a small number of marginal cases — the portfolio is delivering within the money planned for it.",
    bad: "A large count — cost trouble is widespread rather than isolated, and the portfolio-level forecast overrun is likely to grow.",
  },
  Utilization: {
    name: "Workforce utilization",
    what: "The share of the workforce's available hours that is assigned to project work.",
    good: "High but sustainable — roughly 80–95%. People are productively deployed without being stretched.",
    bad: "Low utilization means paying for idle capacity. Over 100% (overallocated) means people are committed beyond full time — a burnout and quality risk.",
  },
  Bench: {
    name: "Bench (unstaffed)",
    what: "People not currently assigned to any project.",
    good: "A small bench provides flexibility to staff new work quickly.",
    bad: "A large bench is unproductive payroll — or, if it's zero while work keeps coming, a hiring gap.",
  },
  Overallocated: {
    name: "Overallocated",
    what: "People assigned to more than 100% of their available time across projects.",
    good: "None — everyone's commitments fit within their actual capacity.",
    bad: "Any sustained overallocation: schedules assume more hours than exist, so something will slip — or people burn out.",
  },
  Submittal: {
    name: "Submittal",
    what: "Product data, drawings, or samples the contractor sends to the design team for approval before building that part of the work.",
    good: "Reviewed and approved ahead of when the material is needed on site.",
    bad: "Stuck in review — materials can't be ordered or installed, which quietly pushes the schedule.",
  },
  Pursuit: {
    name: "Pursuit",
    what: "A potential project being chased in business development — a bid or opportunity that isn't won yet.",
  },
  Estimate: {
    name: "Estimate",
    what: "A priced cost estimate for a pursuit or a defined scope of work.",
  },
};

// Order matters: match the most specific alias first. Each entry is [canonicalKey, ...aliases].
const ALIASES = [
  ["Win rate"], ["Over budget", "over-budget"], ["Overallocated", "over-allocated"],
  ["TRIR"], ["CPI"], ["SPI"], ["EAC"], ["BAC"], ["WIP"],
  ["RFI", "RFIs"], ["Backlog"], ["Pipeline"],
  ["Utilization", "util"], ["Bench", "unstaffed"], ["Submittal"], ["Pursuit"], ["Estimate"],
];

export function guideOf(label) {
  if (!label) return null;
  if (KPI_GUIDE[label]) return KPI_GUIDE[label];
  const L = String(label);
  for (const [key, ...alts] of ALIASES) {
    const re = new RegExp(`\\b(${[key, ...alts].join("|")})\\b`, "i");
    if (re.test(L)) return KPI_GUIDE[key];
  }
  return null;
}

// Flattened text form for native title= tooltips (newlines render in the hover).
export function defOf(label) {
  const g = guideOf(label);
  if (!g) return null;
  return [g.what, g.good && `✓ Good: ${g.good}`, g.bad && `✗ Bad: ${g.bad}`].filter(Boolean).join("\n");
}
