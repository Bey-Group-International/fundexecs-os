export type SignalColor = "gold" | "blue" | "green" | "navy";

export interface TwinAgent {
  name: string;
  title: string;
  district: string;
  responsibilities: string[];
  x: number;
  y: number;
  signal: SignalColor;
}

export interface TwinDistrict {
  name: string;
  summary: string;
  x: number;
  y: number;
  w: number;
  h: number;
  signal: SignalColor;
}

export interface TaskNode {
  title: string;
  agent: string;
  signal: SignalColor;
}

export const TWIN_DISTRICTS: TwinDistrict[] = [
  { name: "Executive Operations Center", summary: "Earn orchestration and decision routing", x: 39, y: 38, w: 22, h: 20, signal: "gold" },
  { name: "Intelligence Center", summary: "AI brain, confidence, utilization, velocity", x: 37, y: 8, w: 26, h: 17, signal: "green" },
  { name: "Capital Markets Hub", summary: "LPs, family offices, lenders, funds", x: 6, y: 12, w: 25, h: 21, signal: "gold" },
  { name: "Deal Flow Center", summary: "Target sourcing and opportunity qualification", x: 7, y: 62, w: 25, h: 22, signal: "navy" },
  { name: "Diligence Lab", summary: "Risk, underwriting, financial review", x: 68, y: 11, w: 25, h: 22, signal: "green" },
  { name: "Legal & Compliance Wing", summary: "Documentation and transaction review", x: 70, y: 63, w: 23, h: 22, signal: "blue" },
  { name: "Relationship Network Center", summary: "Introductions, CRM, follow-ups", x: 7, y: 38, w: 23, h: 18, signal: "blue" },
  { name: "Portfolio Operations Hub", summary: "Portfolio support and workflow execution", x: 38, y: 69, w: 23, h: 18, signal: "navy" },
  { name: "Marketing Studio", summary: "Outreach and campaign execution", x: 70, y: 38, w: 23, h: 18, signal: "gold" },
];

export const TWIN_AGENTS: TwinAgent[] = [
  {
    name: "Earn",
    title: "Chief Executive Agent",
    district: "Executive Operations Center",
    responsibilities: ["Planning", "Orchestration", "Delegation", "Monitoring", "Decision routing"],
    x: 50,
    y: 48,
    signal: "gold",
  },
  {
    name: "Capital Agent",
    title: "Capital Formation Executive",
    district: "Capital Markets Hub",
    responsibilities: ["Capital raising", "LP matching", "Investor sourcing"],
    x: 19,
    y: 24,
    signal: "gold",
  },
  {
    name: "Deal Agent",
    title: "Deal Flow Executive",
    district: "Deal Flow Center",
    responsibilities: ["Deal sourcing", "Pipeline creation", "Opportunity qualification"],
    x: 20,
    y: 73,
    signal: "navy",
  },
  {
    name: "Diligence Agent",
    title: "Underwriting Executive",
    district: "Diligence Lab",
    responsibilities: ["Risk analysis", "Underwriting", "Financial review"],
    x: 81,
    y: 24,
    signal: "green",
  },
  {
    name: "Legal Agent",
    title: "Legal & Compliance Executive",
    district: "Legal & Compliance Wing",
    responsibilities: ["Documentation", "Compliance", "Transaction review"],
    x: 82,
    y: 74,
    signal: "blue",
  },
  {
    name: "Operations Agent",
    title: "Portfolio Operations Executive",
    district: "Portfolio Operations Hub",
    responsibilities: ["Portfolio support", "Workflow execution"],
    x: 50,
    y: 79,
    signal: "navy",
  },
  {
    name: "Marketing Agent",
    title: "Market Outreach Executive",
    district: "Marketing Studio",
    responsibilities: ["Outreach", "Campaign execution"],
    x: 82,
    y: 48,
    signal: "gold",
  },
  {
    name: "Relationship Agent",
    title: "Relationship Capital Executive",
    district: "Relationship Network Center",
    responsibilities: ["CRM", "Introductions", "Follow-ups"],
    x: 19,
    y: 48,
    signal: "blue",
  },
];

export const TASK_GRAPH: TaskNode[] = [
  { title: "Source Targets", agent: "Deal Agent", signal: "navy" },
  { title: "Build Outreach List", agent: "Marketing Agent", signal: "gold" },
  { title: "Qualify Opportunities", agent: "Deal Agent", signal: "navy" },
  { title: "Analyze Financials", agent: "Diligence Agent", signal: "green" },
  { title: "Build CIM Review", agent: "Legal Agent", signal: "blue" },
  { title: "Prepare Financing Package", agent: "Capital Agent", signal: "gold" },
  { title: "Generate Investor Updates", agent: "Relationship Agent", signal: "blue" },
];
