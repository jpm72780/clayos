import { loadPrefs } from "./prefs.js";

// Color per entity type for the ontology viewer + legends.
export const TYPE_COLOR = {
  Project: "#f59e0b", Phase: "#fbbf24", Work: "#a3e635", Activity: "#84cc16",
  CostAccount: "#22d3ee", PayApp: "#06b6d4", Contract: "#0ea5e9",
  RFI: "#ef4444", Submittal: "#f97316", DailyLog: "#fb7185", QualityEvent: "#e879f9", SafetyEvent: "#dc2626",
  Space: "#60a5fa", BuildingElement: "#818cf8", Document: "#c084fc",
  Person: "#34d399", Organization: "#10b981",
  Pursuit: "#eab308", Estimate: "#facc15", Requisition: "#2dd4bf", ITAsset: "#94a3b8",
};

// Colorblind-safe variant (Okabe-Ito anchored). Hue encodes the domain family —
// the same grouping as TYPE_SHAPE — and lightness separates types within a family,
// so the mapping survives red-green CVD where the default's reds/greens collapse.
export const TYPE_COLOR_CB = {
  Project: "#e69f00", Phase: "#ffc94d", Work: "#b87d0a", Activity: "#ffe1a1",     // orange family
  CostAccount: "#56b4e9", PayApp: "#0072b2", Contract: "#9bd4f5",                 // blue family
  RFI: "#d55e00", Submittal: "#ff8a47", DailyLog: "#a34700", QualityEvent: "#ffb488", SafetyEvent: "#7a3500", // vermillion family
  Space: "#cc79a7", BuildingElement: "#96587c", Document: "#ecaed0",              // purple family
  Person: "#009e73", Organization: "#5cc9a7",                                     // bluish-green family
  Pursuit: "#f0e442", Estimate: "#bdb32f", Requisition: "#fbf3a5",                // yellow family
  ITAsset: "#94a3b8",                                                             // grey
};

// Semantic chart colors (good/bad bars, baseline vs forecast, trend lines). The
// default leans on red-vs-cyan and amber-vs-lime; the colorblind-safe variant swaps
// every good/bad pair for Okabe-Ito blue/vermillion pairs that survive red-green CVD.
const CHART = {
  cpiBad: "#ef4444", cpiOk: "#22d3ee", spiBad: "#f59e0b", spiOk: "#a3e635",
  bac: "#3b82f6", eac: "#f59e0b", over: "#f59e0b", under: "#22d3ee",
  total: "#334155", open: "#ef4444", danger: "#dc2626",
  cpiLine: "#22d3ee", spiLine: "#a3e635",
};
const CHART_CB = {
  cpiBad: "#d55e00", cpiOk: "#0072b2", spiBad: "#e69f00", spiOk: "#56b4e9",
  bac: "#0072b2", eac: "#e69f00", over: "#e69f00", under: "#56b4e9",
  total: "#475569", open: "#d55e00", danger: "#d55e00",
  cpiLine: "#56b4e9", spiLine: "#009e73",
};

// The active palette is a display preference; views bake colors at scene-build time,
// so App remounts them on change (colorFor just reads whatever is active).
let ACTIVE = loadPrefs().palette === "colorblind" ? TYPE_COLOR_CB : TYPE_COLOR;
let ACTIVE_CHART = loadPrefs().palette === "colorblind" ? CHART_CB : CHART;
export const setPalette = (name) => {
  ACTIVE = name === "colorblind" ? TYPE_COLOR_CB : TYPE_COLOR;
  ACTIVE_CHART = name === "colorblind" ? CHART_CB : CHART;
};
export const colorFor = (t) => ACTIVE[t] || "#9ca3af";
export const chartColor = (k) => ACTIVE_CHART[k] || "#94a3b8";

// Shape per domain family — a redundant, color-independent cue so the legends don't
// rely on hue alone (helps color-vision-deficient users). Color still varies per type
// within a family, so shape(family) + colour(type) reads as distinct.
export const TYPE_SHAPE = {
  Project: "●", Phase: "●", Work: "●", Activity: "●",            // project structure
  CostAccount: "◆", PayApp: "◆", Contract: "◆",                  // financial
  RFI: "▲", Submittal: "▲", DailyLog: "▲", QualityEvent: "▲", SafetyEvent: "▲", // field / quality / safety
  Space: "■", BuildingElement: "■", Document: "■",               // design / spaces / docs
  Person: "⬢", Organization: "⬢",                                // people / orgs
  Pursuit: "★", Estimate: "★", Requisition: "★",                 // pipeline
  ITAsset: "▮",                                                  // IT
};
export const shapeFor = (t) => TYPE_SHAPE[t] || "●";

export const DOMAINS = [
  "project", "project_controls", "design", "field_ops", "safety", "quality",
  "financials", "procurement", "business_development", "estimating", "enterprise", "hr", "recruiting", "it",
];
