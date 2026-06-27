// Color per entity type for the ontology viewer + legends.
export const TYPE_COLOR = {
  Project: "#f59e0b", Phase: "#fbbf24", Work: "#a3e635", Activity: "#84cc16",
  CostAccount: "#22d3ee", PayApp: "#06b6d4", Contract: "#0ea5e9",
  RFI: "#ef4444", Submittal: "#f97316", DailyLog: "#fb7185", QualityEvent: "#e879f9", SafetyEvent: "#dc2626",
  Space: "#60a5fa", BuildingElement: "#818cf8", Document: "#c084fc",
  Person: "#34d399", Organization: "#10b981",
  Pursuit: "#eab308", Estimate: "#facc15", Requisition: "#2dd4bf", ITAsset: "#94a3b8",
};
export const colorFor = (t) => TYPE_COLOR[t] || "#9ca3af";

export const DOMAINS = [
  "project", "project_controls", "design", "field_ops", "safety", "quality",
  "financials", "procurement", "business_development", "estimating", "enterprise", "hr", "recruiting", "it",
];
